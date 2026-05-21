const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const app = express();

// Community corrections — persisted to disk
const CORRECTIONS_FILE = path.join(__dirname, "corrections.json");
let corrections = {};
try { corrections = JSON.parse(fs.readFileSync(CORRECTIONS_FILE, "utf8")); } catch (_) {}

function correctionKey(address, zip) {
  return `${address.trim().toLowerCase()}|${String(zip).trim()}`;
}
function saveCorrections() {
  fs.writeFileSync(CORRECTIONS_FILE, JSON.stringify(corrections, null, 2));
}

// Geocoding cache — JSON file, persists forever, shared across all drivers
const GEOCACHE_FILE = path.join(__dirname, "geocache.json");
let geocache = {};
try { geocache = JSON.parse(fs.readFileSync(GEOCACHE_FILE, "utf8")); } catch (_) {}
function saveGeocache() {
  try { fs.writeFileSync(GEOCACHE_FILE, JSON.stringify(geocache)); } catch (_) {}
}
function geocacheKey(address, zip) {
  return `${address.trim().toLowerCase()}|${String(zip || "").trim()}`;
}
function cacheHit(address, zip) {
  return geocache[geocacheKey(address, zip)] || null;
}
function cacheSet(address, zip, lat, lng, source) {
  geocache[geocacheKey(address, zip)] = { lat, lng, source };
  saveGeocache();
}

app.post("/community/correct", (req, res) => {
  const { address, zip, type, name } = req.body;
  if (!address || !zip || !type) return res.status(400).json({ error: "Missing fields" });
  const key = correctionKey(address, zip);
  const prev = corrections[key] || { count: 0 };
  corrections[key] = {
    type,
    name: name || prev.name || "",
    count: prev.count + 1,
    updatedAt: new Date().toISOString(),
  };
  saveCorrections();
  console.log(`Community correction saved: "${address}" → ${type} (${corrections[key].count} driver${corrections[key].count !== 1 ? "s" : ""})`);
  res.json({ ok: true, count: corrections[key].count });
});

app.post("/community/lookup", (req, res) => {
  if (!req.body) return res.json({ corrections: {} });
  const { addresses } = req.body;
  const results = {};
  (addresses || []).forEach(({ address, zip }) => {
    const key = correctionKey(address, zip);
    if (corrections[key]) results[key] = corrections[key];
  });
  res.json({ corrections: results });
});
app.use(cors());
app.use(express.json({ limit: "50mb" }));

app.post("/extract", async (req, res) => {
  const { b64, mediaType, apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: "No API key" });

  const client = new Anthropic({ apiKey });

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 8192,
      tools: [{
        name: "record_stops",
        description: "Record every delivery stop address extracted from the image",
        input_schema: {
          type: "object",
          properties: {
            stops: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  address: { type: "string", description: "Street number and name only, convert spelled-out numbers to ordinals (Fifth→5th, Eighth→8th, Ninth→9th)" },
                  city: { type: "string", description: "City name only, e.g. Tampa" },
                  state: { type: "string", description: "2-letter state code, e.g. FL" },
                  zip: { type: "string", description: "5-digit ZIP code, e.g. 33605" },
                  type: { type: "string", enum: ["business", "residential"] },
                  name: { type: "string", description: "Business name if visible, empty string otherwise" }
                },
                required: ["address", "city", "state", "zip", "type", "name"]
              }
            }
          },
          required: ["stops"]
        }
      }],
      tool_choice: { type: "any" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `Extract EVERY delivery stop from this address list. Work top to bottom, stop by stop — do not skip any.

The format is one of:
- DIAD screen: numbered rows on a handheld scanner
- Printed route list: businesses at the top (numbered, with name in parentheses like "1. 3801 E Hillsborough Ave, Tampa, FL 33610 (Home Depot)"), then a dense block of numbered residential addresses running together like "16. 3214 W Swann Ave, Tampa, FL 33609 17. 4821 N Cortez Ave, Tampa, FL 33614 18..."

Rules:
1. Each number followed by a period (16. 47. 123.) marks a new stop — extract the full address that follows it.
2. If the image starts mid-sentence (e.g. "Ave, Tampa, FL 33609 47. ...") skip the partial fragment and start from the first COMPLETE numbered stop.
3. For 'name': if a business name appears in parentheses after the address, extract it (e.g. "(Home Depot)" → name="Home Depot"). Otherwise empty string.
4. For 'type': "business" if a name/company appears with the address. "residential" for plain numbered addresses with no name.
5. 'address' field = street number + name ONLY (e.g. "3214 W Swann Ave"). NEVER include the stop sequence number (46, 47, 123...) in the address field.

Use the record_stops tool. Include every stop you can find.` }
        ]
      }]
    });

    const toolResult = msg.content.find((c) => c.type === "tool_use");
    const stops = toolResult?.input?.stops || [];
    console.log(`Extracted ${stops.length} stops from image`);
    res.json({ stops });
  } catch (err) {
    console.error("Anthropic error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Batch geocode using Census Bureau batch API — one call for all addresses
app.post("/geocode-batch", async (req, res) => {
  let { addresses } = req.body; // [{address, city, state, zip}]
  if (!addresses?.length) return res.json({ results: [] });

  // Strip leading stop sequence numbers Claude sometimes embeds: "46 2618 E Main St" → "2618 E Main St"
  addresses = addresses.map((a) => ({
    ...a,
    address: (a.address || "").replace(/^\d{1,3}\s+(?=\d)/, "").trim(),
    zip: (a.zip || "").replace(/[^0-9]/g, "").slice(0, 5) || "",
  }));

  const https = require("https");
  const results = addresses.map(() => ({ lat: null, lng: null, source: "not_found" }));

  // Step 0: Serve from geocache — free, instant, no API call needed
  let cacheHits = 0;
  addresses.forEach((a, i) => {
    const hit = cacheHit(a.address, a.zip);
    if (hit) { results[i] = { ...hit }; cacheHits++; }
  });
  if (cacheHits > 0) console.log(`Geocache: ${cacheHits}/${addresses.length} served from cache instantly`);

  function fetchUrl(url) {
    return new Promise((resolve) => {
      https.get(url, { headers: { "User-Agent": "lastmile-app/1.0" } }, (r) => {
        let data = "";
        r.on("data", (d) => data += d);
        r.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      }).on("error", () => resolve(null));
    });
  }

  function parseCSV(line) {
    const fields = [];
    let cur = "", inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { fields.push(cur); cur = ""; }
      else { cur += ch; }
    }
    fields.push(cur);
    return fields;
  }

  // Step 1: Census batch — chunked at 100 so large routes don't time out
  const t0 = Date.now();
  console.log(`Geocoding batch of ${addresses.length} — sample: ${addresses.slice(0,3).map(a=>`"${a.address}"|"${a.city}"|"${a.state}"|"${a.zip}"`).join(", ")}`);

  async function censusBatch(chunk, offset) {
    const boundary = `----${Date.now()}`;
    const csvContent = chunk
      .map((a, i) => `${offset + i + 1},"${(a.address||"").replace(/"/g,"")}","${(a.city||"").replace(/"/g,"")}","${(a.state||"").replace(/"/g,"")}","${(a.zip||"").replace(/"/g,"")}"`)
      .join("\n");
    const parts = [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="benchmark"\r\n\r\nPublic_AR_Current\r\n`),
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="addressFile"; filename="addr.csv"\r\nContent-Type: text/csv\r\n\r\n`),
      Buffer.from(csvContent, "utf8"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ];
    const bodyBuf = Buffer.concat(parts);
    return new Promise((resolve) => {
      const req = https.request({
        hostname: "geocoding.geo.census.gov",
        path: "/geocoder/locations/addressbatch",
        method: "POST",
        headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": bodyBuf.length, "User-Agent": "lastmile-app/1.0" },
        timeout: 60000,
      }, (r) => {
        let data = "";
        r.on("data", (d) => data += d);
        r.on("end", () => {
          for (const line of data.split("\n")) {
            if (!line.trim()) continue;
            const f = parseCSV(line.trim());
            const idx = parseInt(f[0]) - 1;
            if (isNaN(idx) || idx < 0 || idx >= addresses.length) continue;
            if ((f[2] === "Match" || f[2] === "Tie") && f[5]) {
              const [lngStr, latStr] = f[5].split(",");
              const lat = parseFloat(latStr), lng = parseFloat(lngStr);
              if (!isNaN(lat) && !isNaN(lng) && lat > 20 && lat < 55 && lng < -60) {
                results[idx] = { lat, lng, source: "census" };
                cacheSet(addresses[idx].address, addresses[idx].zip, lat, lng, "census");
              }
            }
          }
          resolve();
        });
      });
      req.on("error", resolve);
      req.on("timeout", () => { req.destroy(); resolve(); });
      req.write(bodyBuf);
      req.end();
    });
  }

  try {
    const CENSUS_CHUNK = 100;
    for (let i = 0; i < addresses.length; i += CENSUS_CHUNK) {
      await censusBatch(addresses.slice(i, i + CENSUS_CHUNK), i);
    }
  } catch (_) {}

  // Step 2: Nominatim for Census misses — batches of 3 with 1.2s gap (respects rate limit)
  function cleanForNominatim(addr) {
    return addr
      .replace(/\bSt\.\s*/g, "St ")   // St. James → St James
      .replace(/\bAve\.\s*/g, "Ave ")
      .replace(/\bBlvd\.\s*/g, "Blvd ")
      .replace(/\s+/g, " ").trim();
  }

  // Nominatim fallback — cap at 60 addresses max to prevent 9-min waits on Railway
  const nomFallbacks = results.reduce((acc, r, i) => { if (!r.lat) acc.push([i, addresses[i]]); return acc; }, []);
  const nomCapped = nomFallbacks.slice(0, 60);
  if (nomFallbacks.length > 60) console.log(`Nominatim capped at 60 of ${nomFallbacks.length} misses to keep response time reasonable`);
  for (const [idx, a] of nomCapped) {
    const clean = cleanForNominatim(a.address);
    const streetOnly = clean.replace(/^\d+\s*/, "").trim();
    let nom = await fetchUrl(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(clean + ", " + a.city + ", " + a.state)}&format=json&limit=1`);
    await new Promise((r) => setTimeout(r, 1100));
    if (!nom?.[0] && streetOnly) {
      nom = await fetchUrl(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(streetOnly + ", " + a.city + ", " + a.state)}&format=json&limit=1`);
      await new Promise((r) => setTimeout(r, 1100));
    }
    if (nom?.[0]) {
      const lat = parseFloat(nom[0].lat), lng = parseFloat(nom[0].lon);
      results[idx] = { lat, lng, source: "nominatim" };
      cacheSet(a.address, a.zip, lat, lng, "nominatim");
    }
  }

  const censusMatched = results.filter((r) => r.source === "census").length;
  const nomMatched = results.filter((r) => r.source === "nominatim").length;
  const failed = results.map((r, i) => [r, addresses[i]]).filter(([r]) => !r.lat).map(([, a]) => `${a.address}, ${a.city} ${a.zip}`);
  console.log(`Batch geocoded ${addresses.length} addresses — ${censusMatched} Census, ${nomMatched} Nominatim, ${failed.length} failed — ${Date.now() - t0}ms`);
  if (failed.length) console.log(`Failed addresses:\n${failed.map((a, i) => `  ${i + 1}. ${a}`).join("\n")}`);
  res.json({ results });
});

app.post("/geocode", async (req, res) => {
  const { address, city, state, zip } = req.body;
  const https = require("https");

  function fetchUrl(url) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "lastmile-app/1.0" } }, (r) => {
        let data = "";
        r.on("data", (d) => data += d);
        r.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      }).on("error", reject);
    });
  }

  try {
    const street = encodeURIComponent(address);
    const q = encodeURIComponent(`${address}, ${city}, ${state} ${zip}`);
    const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/address?street=${street}&city=${encodeURIComponent(city)}&state=${encodeURIComponent(state)}&zip=${encodeURIComponent(zip)}&benchmark=Public_AR_Current&format=json`;
    const nomUrl = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=1`;

    // Run both in parallel — Census for coords, Nominatim for business/residential type
    const [census, nom] = await Promise.all([fetchUrl(censusUrl), fetchUrl(nomUrl)]);

    // Detect type from Nominatim regardless of which geocoder we use for coords
    let detectedType = null;
    let detectedName = null;
    if (nom?.[0]) {
      const nomClass = nom[0].class || "";
      const nomType = nom[0].type || "";
      const displayName = nom[0].display_name || "";
      const businessClasses = ["shop", "amenity", "office", "commercial", "industrial", "tourism", "craft", "healthcare", "food"];
      const residentialTypes = ["house", "residential", "apartments", "detached", "terrace", "semidetached_house"];
      // If display_name starts with a non-numeric word it's a named POI (business)
      const firstName = displayName.split(",")[0].trim();
      const isStreetName = /\b(avenue|ave|street|st|boulevard|blvd|road|rd|drive|dr|lane|ln|court|ct|way|place|pl|highway|hwy|parkway|pkwy|circle|cir|trail|terrace|ter|north|south|east|west)\b/i.test(firstName);
      const startsWithName = /^[A-Za-z]/.test(displayName) && !isStreetName;
      console.log(`Nominatim [${address}]: class=${nomClass} type=${nomType} display="${displayName.slice(0, 60)}"`);
      if (businessClasses.includes(nomClass) || startsWithName) {
        detectedType = "business";
        if (startsWithName) detectedName = firstName;
      } else if (nomClass === "building" && residentialTypes.includes(nomType)) {
        detectedType = "residential";
      } else if (nomClass === "building") {
        detectedType = "business";
      }
    } else {
      console.log(`Nominatim [${address}]: no result`);
    }

    const suburb = nom?.[0]?.address?.suburb || null;

    const match = census?.result?.addressMatches?.[0];
    if (match) {
      return res.json({ lat: match.coordinates.y, lng: match.coordinates.x, source: "census", detectedType, detectedName, suburb });
    }
    if (nom?.[0]) {
      return res.json({ lat: parseFloat(nom[0].lat), lng: parseFloat(nom[0].lon), source: "nominatim", detectedType, detectedName, suburb });
    }

    res.json({ lat: null, lng: null, source: "not_found" });
  } catch (err) {
    console.error("Geocode error:", err.message);
    res.json({ lat: null, lng: null, source: "error" });
  }
});

app.post("/classify", async (req, res) => {
  const { addresses, apiKey } = req.body;
  if (!apiKey || !addresses?.length) return res.json({ classifications: [] });

  const client = new Anthropic({ apiKey });
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      tools: [{
        name: "classify_stops",
        description: "Classify each delivery address as business or residential",
        input_schema: {
          type: "object",
          properties: {
            classifications: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  index: { type: "number", description: "The index from the input list" },
                  type: { type: "string", enum: ["business", "residential"] },
                  name: { type: "string", description: "Business name if known, empty string otherwise" }
                },
                required: ["index", "type", "name"]
              }
            }
          },
          required: ["classifications"]
        }
      }],
      tool_choice: { type: "any" },
      messages: [{
        role: "user",
        content: `Classify each delivery address as "business" or "residential". Default to "residential" unless you have a strong reason not to.

Mark as "business" if ANY of these apply:
- You can name a specific business at that exact address (chain store, restaurant, office, clinic, etc.) — include the name
- The address contains Suite/Ste/Floor/Fl/Unit/Dept/Bldg indicating a commercial unit
- The street is a numbered US highway or state road (US-301, US-19, US-41, SR-60, SR-674, etc.) — these are commercial corridors, not residential streets

Mark as "residential" for everything else — regular named streets, subdivision roads, avenues where you're not sure.

${addresses.map((a, i) => `${i}: ${a}`).join("\n")}

Use the classify_stops tool.`
      }]
    });
    const toolResult = msg.content.find((c) => c.type === "tool_use");
    res.json({ classifications: toolResult?.input?.classifications || [] });
  } catch (err) {
    console.error("Classify error:", err.message);
    res.json({ classifications: [] });
  }
});

app.get("/health", (_, res) => res.json({ ok: true }));

app.get("/cache/stats", (_, res) => {
  const entries = Object.entries(geocache);
  const sources = {};
  entries.forEach(([, v]) => { sources[v.source || "unknown"] = (sources[v.source || "unknown"] || 0) + 1; });
  res.json({ total: entries.length, sources });
});

app.delete("/cache/entry", (req, res) => {
  const { address, zip } = req.body;
  if (!address) return res.status(400).json({ error: "Missing address" });
  delete geocache[geocacheKey(address, zip || "")];
  saveGeocache();
  res.json({ ok: true });
});

// Serve React build in production
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "build")));
  app.get("/{*path}", (req, res) => res.sendFile(path.join(__dirname, "build", "index.html")));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Last Mile server running on port ${PORT}`));
