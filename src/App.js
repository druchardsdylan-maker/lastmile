import { useState, useRef, useEffect } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-rotate";

const WAREHOUSE = [27.9555, -82.4274]; // Restaurant Depot area, Tampa 50th

function normalizeAddress(addr) {
  const map = { first:'1st',second:'2nd',third:'3rd',fourth:'4th',fifth:'5th',sixth:'6th',seventh:'7th',eighth:'8th',ninth:'9th',tenth:'10th',eleventh:'11th',twelfth:'12th',thirteenth:'13th',fourteenth:'14th',fifteenth:'15th' };
  return addr.replace(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth)\b/gi, (m) => map[m.toLowerCase()] || m);
}

function geoNearestNeighbor(warehouseLatLng, stops, businessesFirst = false) {
  function dist2(a, b) { return (a.lat - b[0]) ** 2 + (a.lng - b[1]) ** 2; }
  function dist2ss(a, b) { return (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2; }

  function nn(startLatLng, candidates) {
    const rem = [...candidates];
    const route = [];
    let cur = startLatLng;
    while (rem.length > 0) {
      let bestIdx = 0, bestDist = Infinity;
      // eslint-disable-next-line no-loop-func
      rem.forEach((s, i) => {
        const d = dist2(s, cur);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
      });
      route.push(rem[bestIdx]);
      cur = [rem[bestIdx].lat, rem[bestIdx].lng];
      rem.splice(bestIdx, 1);
    }
    return route;
  }

  function twoOptGeo(route, startLatLng) {
    if (route.length <= 3) return route;
    let best = [...route];
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 2; j < best.length; j++) {
          const prev = i === 0 ? { lat: startLatLng[0], lng: startLatLng[1] } : best[i - 1];
          const curA = dist2ss(prev, best[i]);
          const curB = j + 1 < best.length ? dist2ss(best[j], best[j + 1]) : 0;
          const newA = dist2ss(prev, best[j]);
          const newB = j + 1 < best.length ? dist2ss(best[i], best[j + 1]) : 0;
          if (newA + newB < curA + curB - 1e-12) {
            best = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
            improved = true;
          }
        }
      }
    }
    return best;
  }

  if (businessesFirst) {
    const biz = stops.filter((s) => s.type === "business");
    const res = stops.filter((s) => s.type !== "business");
    if (biz.length === 0) return twoOptGeo(nn(warehouseLatLng, res), warehouseLatLng);
    const bizRoute = twoOptGeo(nn(warehouseLatLng, biz), warehouseLatLng);
    const lastBiz = [bizRoute[bizRoute.length - 1].lat, bizRoute[bizRoute.length - 1].lng];
    return [...bizRoute, ...(res.length > 0 ? twoOptGeo(nn(lastBiz, res), lastBiz) : [])];
  }
  return twoOptGeo(nn(warehouseLatLng, stops), warehouseLatLng);
}

async function optimizeWithOSRM(warehouse, stops, businessesFirst = false) {
  if (stops.length === 0) return stops;
  // Public OSRM table max is 100 waypoints total (99 stops + warehouse)
  if (stops.length >= 100) return geoNearestNeighbor(warehouse, stops, businessesFirst);

  const allPoints = [warehouse, ...stops.map((s) => [s.lat, s.lng])];
  const coords = allPoints.map(([lat, lng]) => `${lng},${lat}`).join(";");
  const res = await fetch(
    `https://router.project-osrm.org/table/v1/driving/${coords}?annotations=duration`
  );
  const data = await res.json();
  if (!data.durations) throw new Error("no matrix");
  const matrix = data.durations;

  function nn(startIdx, candidates) {
    const rem = [...candidates];
    const route = [];
    let cur = startIdx;
    while (rem.length > 0) {
      let best = 0;
      let bestT = Infinity;
      // eslint-disable-next-line no-loop-func
      rem.forEach((mi, i) => {
        if (matrix[cur][mi] < bestT) { bestT = matrix[cur][mi]; best = i; }
      });
      route.push(rem[best]);
      cur = rem[best];
      rem.splice(best, 1);
    }
    return route;
  }

  function twoOpt(route, startIdx) {
    if (route.length <= 2) return route;
    let best = [...route];
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < best.length - 1; i++) {
        for (let j = i + 2; j < best.length; j++) {
          const prev = i === 0 ? startIdx : best[i - 1];
          const next = j === best.length - 1 ? null : best[j + 1];
          const oldCost = matrix[prev][best[i]] + (next != null ? matrix[best[j]][next] : 0);
          const newCost = matrix[prev][best[j]] + (next != null ? matrix[best[i]][next] : 0);
          if (newCost < oldCost - 0.5) {
            best = [...best.slice(0, i), ...best.slice(i, j + 1).reverse(), ...best.slice(j + 1)];
            improved = true;
          }
        }
      }
    }
    return best;
  }

  if (businessesFirst) {
    const bizIdx = stops.map((s, i) => s.type === "business" ? i + 1 : null).filter(Boolean);
    const resIdx = stops.map((s, i) => s.type === "residential" ? i + 1 : null).filter(Boolean);

    if (bizIdx.length === 0) {
      return twoOpt(nn(0, resIdx), 0).map((mi) => stops[mi - 1]);
    }
    const bizRoute = twoOpt(nn(0, bizIdx), 0);
    const lastBiz = bizRoute[bizRoute.length - 1];
    const resRoute = resIdx.length > 0 ? twoOpt(nn(lastBiz, resIdx), lastBiz) : [];
    return [...bizRoute, ...resRoute].map((mi) => stops[mi - 1]);
  }

  return twoOpt(nn(0, stops.map((_, i) => i + 1)), 0).map((mi) => stops[mi - 1]);
}

function rightHandRoute(startLatLng, stops, prevLatLng) {
  const remaining = [...stops];
  const route = [];
  let cur = startLatLng;
  let prev = prevLatLng || [startLatLng[0] - 0.01, startLatLng[1]];

  while (remaining.length > 0) {
    let bestScore = Infinity;
    let bestIdx = 0;

    const hx = cur[1] - prev[1];
    const hy = cur[0] - prev[0];
    const hMag = Math.hypot(hx, hy) || 0.001;

    // eslint-disable-next-line no-loop-func
    remaining.forEach((s, i) => {
      const dx = s.lng - cur[1];
      const dy = s.lat - cur[0];
      const dist = Math.hypot(dx, dy);

      const forward = (hx * dx + hy * dy) / hMag;
      const lateral = (hx * dy - hy * dx) / hMag;

      const backtrackPenalty = forward < 0 ? dist * 1.2 : 0;
      const leftPenalty = lateral > 0 ? lateral * 0.5 : 0;
      const forwardBonus = forward > 0 ? forward * 0.4 : 0;

      const score = dist + backtrackPenalty + leftPenalty - forwardBonus;
      if (score < bestScore) { bestScore = score; bestIdx = i; }
    });

    route.push(remaining[bestIdx]);
    prev = cur;
    cur = [remaining[bestIdx].lat, remaining[bestIdx].lng];
    remaining.splice(bestIdx, 1);
  }
  return route;
}

const screens = {
  HOME: "HOME",
  CAPTURE: "CAPTURE",
  PROCESSING: "PROCESSING",
  RESULTS: "RESULTS",
  STOP_DETAIL: "STOP_DETAIL",
  MAP: "MAP",
  NOTES: "NOTES",
  SETTINGS: "SETTINGS",
};

const mockStops = [
  // Businesses
  { id: 1,  address: "4542 Gall Blvd",         city: "Zephyrhills, FL 33542", type: "business",    name: "Harbor Freight",     seq: 1,  lat: 28.2241740, lng: -82.1798670 },
  { id: 2,  address: "4542 Gall Blvd",         city: "Zephyrhills, FL 33542", type: "business",    name: "Thomas & Son",       seq: 2,  lat: 28.2241740, lng: -82.1798670 },
  { id: 3,  address: "38430 Fifth Ave",         city: "Zephyrhills, FL 33542", type: "business",    name: "Uptown Creamery",    seq: 3,  lat: 28.2339320, lng: -82.1804690 },
  { id: 4,  address: "4518 Gall Blvd",         city: "Zephyrhills, FL 33542", type: "business",    name: "First National Bank", seq: 4, lat: 28.2235980, lng: -82.1798610 },
  // Residential — Census geocoded
  { id: 5,  address: "4523 Orange Blossom Dr", city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 5,  lat: 28.2235452, lng: -82.1874654 },
  { id: 6,  address: "4629 Olive Dr",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 6,  lat: 28.2247616, lng: -82.1866320 },
  { id: 7,  address: "4845 Gordon St",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 7,  lat: 28.2303490, lng: -82.1885440 },
  { id: 8,  address: "4751 Gordon St",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 8,  lat: 28.2303490, lng: -82.1885440 },
  { id: 9,  address: "4811 Timber Way",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 9,  lat: 28.2273916, lng: -82.1910083 },
  { id: 10, address: "4709 Wisteria Dr",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 10, lat: 28.2253098, lng: -82.1909750 },
  { id: 11, address: "4610 Blossom Blvd",      city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 11, lat: 28.2240724, lng: -82.1921019 },
  { id: 12, address: "37812 Alissa Dr",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 12, lat: 28.2232790, lng: -82.1912030 },
  { id: 13, address: "4414 Sentry Palm Loop",  city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 13, lat: 28.2219877, lng: -82.1900144 },
  { id: 14, address: "38161 Fallstone Way",    city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 14, lat: 28.2198498, lng: -82.1899796 },
  { id: 15, address: "4313 Court St",          city: "Zephyrhills, FL 33541", type: "residential", name: "",                   seq: 15, lat: 28.2282077, lng: -82.1925753 },
  { id: 16, address: "4422 Allen Rd",          city: "Zephyrhills, FL 33541", type: "residential", name: "",                   seq: 16, lat: 28.2280000, lng: -82.1940000 },
  { id: 17, address: "5146 Studio Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 17, lat: 28.2329912, lng: -82.1938511 },
  { id: 18, address: "5431 Ninth St",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 18, lat: 28.2365750, lng: -82.1799940 },
  { id: 19, address: "5453 Sixth St",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 19, lat: 28.2371368, lng: -82.1849184 },
  { id: 20, address: "38046 Eighth Ave",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 20, lat: 28.2345909, lng: -82.1867808 },
  { id: 21, address: "38032 14th Ave",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 21, lat: 28.2410350, lng: -82.1871201 },
  { id: 22, address: "38324 Jendral Ave",      city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 22, lat: 28.2218315, lng: -82.1824711 },
  { id: 23, address: "4350 Fifth St",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                   seq: 23, lat: 28.2210850, lng: -82.1819502 },
  { id: 24, address: "38406 Vinson Ave",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 24,  lat: 28.2208505, lng: -82.1819236 },
  // Extended stops for 50-stop test
  { id: 25, address: "38506 Florida Ave",        city: "Zephyrhills, FL 33542", type: "business",    name: "Dollar General",      seq: 25,  lat: 28.2450,    lng: -82.1783   },
  { id: 26, address: "5601 Dean Dairy Rd",       city: "Zephyrhills, FL 33540", type: "residential", name: "",                    seq: 26,  lat: 28.2522,    lng: -82.1892   },
  { id: 27, address: "38204 15th Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 27,  lat: 28.2435,    lng: -82.1858   },
  { id: 28, address: "5214 Arbor St",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 28,  lat: 28.2384,    lng: -82.1924   },
  { id: 29, address: "37900 Oakmont Ave",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 29,  lat: 28.2388,    lng: -82.1863   },
  { id: 30, address: "38100 County Line Rd",     city: "Zephyrhills, FL 33542", type: "business",    name: "AutoZone",            seq: 30,  lat: 28.2382,    lng: -82.1815   },
  { id: 31, address: "37400 Chancey Rd",         city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 31,  lat: 28.2103,    lng: -82.1823   },
  { id: 32, address: "4200 Drexel Ave",          city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 32,  lat: 28.2149,    lng: -82.1869   },
  { id: 33, address: "37225 Pony Tail Loop",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 33,  lat: 28.2088,    lng: -82.1938   },
  { id: 34, address: "4710 Sioux Dr",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 34,  lat: 28.2262,    lng: -82.1932   },
  { id: 35, address: "4820 Lakeland Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 35,  lat: 28.2298,    lng: -82.1947   },
  { id: 36, address: "38400 Pretty Pond Rd",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 36,  lat: 28.2188,    lng: -82.1773   },
  { id: 37, address: "38012 Magnolia Ave",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 37,  lat: 28.2358,    lng: -82.1751   },
  { id: 38, address: "5003 Nightshade Blvd",     city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 38,  lat: 28.2338,    lng: -82.1963   },
  { id: 39, address: "4302 Meadow Wood Ln",      city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 39,  lat: 28.2173,    lng: -82.1896   },
  { id: 40, address: "5524 Laurel Dr",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 40,  lat: 28.2402,    lng: -82.1832   },
  { id: 41, address: "38214 Kossik Rd",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 41,  lat: 28.2312,    lng: -82.1779   },
  { id: 42, address: "5306 Peregrine Ave",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 42,  lat: 28.2363,    lng: -82.1878   },
  { id: 43, address: "4415 Gall Blvd",           city: "Zephyrhills, FL 33542", type: "business",    name: "CVS Pharmacy",        seq: 43,  lat: 28.2228,    lng: -82.1799   },
  { id: 44, address: "38326 Medical Way",        city: "Zephyrhills, FL 33541", type: "business",    name: "AdventHealth Zeph",   seq: 44,  lat: 28.2143,    lng: -82.1831   },
  { id: 45, address: "5715 Sioux Dr",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 45,  lat: 28.2482,    lng: -82.1928   },
  { id: 46, address: "38700 18th Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 46,  lat: 28.2463,    lng: -82.1871   },
  { id: 47, address: "4619 Lemon Tree Ln",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 47,  lat: 28.2253,    lng: -82.1852   },
  { id: 48, address: "37618 Sky High Dr",        city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 48,  lat: 28.2118,    lng: -82.1906   },
  { id: 49, address: "5008 Water Oak Cir",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                    seq: 49,  lat: 28.2318,    lng: -82.1943   },
  { id: 50, address: "38515 Lake Bernadette Dr", city: "Zephyrhills, FL 33541", type: "residential", name: "",                    seq: 50,  lat: 28.2153,    lng: -82.1958   },
  // Extended stops for 100-150 stop test
  { id: 51,  address: "39200 Eiland Blvd",        city: "Zephyrhills, FL 33542", type: "business",    name: "Winn-Dixie",           seq: 51,  lat: 28.2278,    lng: -82.1655   },
  { id: 52,  address: "39350 Handcart Rd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 52,  lat: 28.2245,    lng: -82.1678   },
  { id: 53,  address: "6214 Fort King Rd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 53,  lat: 28.2335,    lng: -82.1713   },
  { id: 54,  address: "39520 Collins St",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 54,  lat: 28.2398,    lng: -82.1700   },
  { id: 55,  address: "5845 Crystal Springs Rd",  city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 55,  lat: 28.2551,    lng: -82.1843   },
  { id: 56,  address: "5920 Dean Dairy Rd",       city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 56,  lat: 28.2595,    lng: -82.1881   },
  { id: 57,  address: "38800 Cargile Rd",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 57,  lat: 28.2580,    lng: -82.1753   },
  { id: 58,  address: "6011 Fort King Rd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 58,  lat: 28.2632,    lng: -82.1801   },
  { id: 59,  address: "39400 Fort King Hwy",      city: "Zephyrhills, FL 33542", type: "business",    name: "McDonald's",           seq: 59,  lat: 28.2352,    lng: -82.1682   },
  { id: 60,  address: "5112 Crystal Lake Dr",     city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 60,  lat: 28.2360,    lng: -82.1910   },
  { id: 61,  address: "4508 Woodland Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 61,  lat: 28.2218,    lng: -82.1840   },
  { id: 62,  address: "38620 Kossik Rd",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 62,  lat: 28.2318,    lng: -82.1761   },
  { id: 63,  address: "5345 Vista Dr",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 63,  lat: 28.2410,    lng: -82.1900   },
  { id: 64,  address: "37050 Morris Bridge Rd",   city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 64,  lat: 28.2053,    lng: -82.1861   },
  { id: 65,  address: "36900 Chancey Rd",         city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 65,  lat: 28.2025,    lng: -82.1820   },
  { id: 66,  address: "4110 Allen Rd",            city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 66,  lat: 28.2070,    lng: -82.1905   },
  { id: 67,  address: "37180 Lake Bernadette Dr", city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 67,  lat: 28.2080,    lng: -82.1960   },
  { id: 68,  address: "36800 Pony Tail Loop",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 68,  lat: 28.2010,    lng: -82.1945   },
  { id: 69,  address: "36700 Fox Chase Dr",       city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 69,  lat: 28.1988,    lng: -82.1920   },
  { id: 70,  address: "36580 Morning Star Rd",    city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 70,  lat: 28.1965,    lng: -82.1878   },
  { id: 71,  address: "36450 Ridge Rd",           city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 71,  lat: 28.1940,    lng: -82.1853   },
  { id: 72,  address: "36320 Meadow Vista Blvd",  city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 72,  lat: 28.1910,    lng: -82.1875   },
  { id: 73,  address: "36200 Gall Blvd",          city: "Zephyrhills, FL 33541", type: "business",    name: "Circle K",             seq: 73,  lat: 28.1885,    lng: -82.1800   },
  { id: 74,  address: "36100 Pretty Pond Rd",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 74,  lat: 28.1860,    lng: -82.1775   },
  { id: 75,  address: "36000 Windmill Dr",        city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 75,  lat: 28.1835,    lng: -82.1820   },
  { id: 76,  address: "4008 Lake Bernadette Dr",  city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 76,  lat: 28.2050,    lng: -82.2000   },
  { id: 77,  address: "3950 Shady Oak Ln",        city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 77,  lat: 28.2035,    lng: -82.2018   },
  { id: 78,  address: "5002 Hunters Ridge Dr",    city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 78,  lat: 28.2302,    lng: -82.1972   },
  { id: 79,  address: "5118 Hunters Ridge Dr",    city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 79,  lat: 28.2325,    lng: -82.1980   },
  { id: 80,  address: "5230 Fox Chase Dr",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 80,  lat: 28.2348,    lng: -82.1995   },
  { id: 81,  address: "5412 Misty Dawn Dr",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 81,  lat: 28.2388,    lng: -82.2010   },
  { id: 82,  address: "5620 Palomino Dr",         city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 82,  lat: 28.2432,    lng: -82.1988   },
  { id: 83,  address: "5744 Palomino Dr",         city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 83,  lat: 28.2458,    lng: -82.1975   },
  { id: 84,  address: "5810 Crystal Springs Rd",  city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 84,  lat: 28.2500,    lng: -82.1950   },
  { id: 85,  address: "5925 Crystal Springs Rd",  city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 85,  lat: 28.2535,    lng: -82.1895   },
  { id: 86,  address: "6100 Dean Dairy Rd",       city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 86,  lat: 28.2655,    lng: -82.1870   },
  { id: 87,  address: "6250 Cargile Rd",          city: "Zephyrhills, FL 33540", type: "business",    name: "Sunrise Feed",         seq: 87,  lat: 28.2700,    lng: -82.1748   },
  { id: 88,  address: "6312 Fort King Rd",        city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 88,  lat: 28.2720,    lng: -82.1798   },
  { id: 89,  address: "39700 Market Sq Dr",       city: "Zephyrhills, FL 33542", type: "business",    name: "Tractor Supply",       seq: 89,  lat: 28.2270,    lng: -82.1720   },
  { id: 90,  address: "39850 Eiland Blvd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 90,  lat: 28.2268,    lng: -82.1695   },
  { id: 91,  address: "4105 Sycamore Ln",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 91,  lat: 28.2195,    lng: -82.1840   },
  { id: 92,  address: "4225 Birch Dr",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 92,  lat: 28.2212,    lng: -82.1858   },
  { id: 93,  address: "38700 Vinson Ave",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 93,  lat: 28.2222,    lng: -82.1810   },
  { id: 94,  address: "38900 Jendral Ave",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 94,  lat: 28.2234,    lng: -82.1823   },
  { id: 95,  address: "5050 Palm Tree Cir",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 95,  lat: 28.2340,    lng: -82.1830   },
  { id: 96,  address: "5160 Pine Needle Cir",     city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 96,  lat: 28.2362,    lng: -82.1845   },
  { id: 97,  address: "5270 Maple Dr",            city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 97,  lat: 28.2378,    lng: -82.1860   },
  { id: 98,  address: "5380 Heritage Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 98,  lat: 28.2395,    lng: -82.1882   },
  { id: 99,  address: "5490 Heritage Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 99,  lat: 28.2418,    lng: -82.1895   },
  { id: 100, address: "5600 Heritage Dr",         city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 100, lat: 28.2440,    lng: -82.1908   },
  { id: 101, address: "37800 Pretty Pond Rd",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 101, lat: 28.2165,    lng: -82.1758   },
  { id: 102, address: "37650 Kossik Rd",          city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 102, lat: 28.2138,    lng: -82.1780   },
  { id: 103, address: "37500 Gall Blvd",          city: "Zephyrhills, FL 33541", type: "business",    name: "Burger King",          seq: 103, lat: 28.2115,    lng: -82.1799   },
  { id: 104, address: "37350 Gall Blvd",          city: "Zephyrhills, FL 33541", type: "business",    name: "Walgreens",            seq: 104, lat: 28.2088,    lng: -82.1799   },
  { id: 105, address: "37200 Morris Bridge Rd",   city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 105, lat: 28.2068,    lng: -82.1840   },
  { id: 106, address: "4602 Oak Hammock Dr",      city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 106, lat: 28.2045,    lng: -82.1870   },
  { id: 107, address: "4718 Oak Hammock Dr",      city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 107, lat: 28.2058,    lng: -82.1883   },
  { id: 108, address: "36950 Fox Chase Dr",       city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 108, lat: 28.2030,    lng: -82.1928   },
  { id: 109, address: "36800 Windmill Dr",        city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 109, lat: 28.2008,    lng: -82.1895   },
  { id: 110, address: "36650 Pony Tail Loop",     city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 110, lat: 28.1985,    lng: -82.1948   },
  { id: 111, address: "36500 Morning Star Rd",    city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 111, lat: 28.1952,    lng: -82.1905   },
  { id: 112, address: "36350 Ridge Rd",           city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 112, lat: 28.1928,    lng: -82.1862   },
  { id: 113, address: "36180 Windmill Dr",        city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 113, lat: 28.1900,    lng: -82.1838   },
  { id: 114, address: "36050 Allen Rd",           city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 114, lat: 28.1875,    lng: -82.1910   },
  { id: 115, address: "35900 Allen Rd",           city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 115, lat: 28.1850,    lng: -82.1932   },
  { id: 116, address: "35750 Chancey Rd",         city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 116, lat: 28.1825,    lng: -82.1850   },
  { id: 117, address: "35600 Lake Bernadette Dr", city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 117, lat: 28.1800,    lng: -82.1978   },
  { id: 118, address: "35450 Meadow Vista Blvd",  city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 118, lat: 28.1778,    lng: -82.1890   },
  { id: 119, address: "35300 Gall Blvd",          city: "Zephyrhills, FL 33541", type: "business",    name: "Sunoco",               seq: 119, lat: 28.1755,    lng: -82.1801   },
  { id: 120, address: "35150 Fort King Hwy",      city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 120, lat: 28.1730,    lng: -82.1820   },
  { id: 121, address: "6400 Fort King Rd",        city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 121, lat: 28.2752,    lng: -82.1820   },
  { id: 122, address: "6508 Fort King Rd",        city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 122, lat: 28.2780,    lng: -82.1838   },
  { id: 123, address: "6612 Dean Dairy Rd",       city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 123, lat: 28.2808,    lng: -82.1875   },
  { id: 124, address: "39080 14th Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 124, lat: 28.2418,    lng: -82.1850   },
  { id: 125, address: "39180 16th Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 125, lat: 28.2445,    lng: -82.1843   },
  { id: 126, address: "5758 Dean Dairy Rd",       city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 126, lat: 28.2568,    lng: -82.1863   },
  { id: 127, address: "5870 Crystal Springs Rd",  city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 127, lat: 28.2570,    lng: -82.1862   },
  { id: 128, address: "38920 20th Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 128, lat: 28.2470,    lng: -82.1830   },
  { id: 129, address: "38820 22nd Ave",           city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 129, lat: 28.2490,    lng: -82.1818   },
  { id: 130, address: "5012 Lakeside Blvd",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 130, lat: 28.2308,    lng: -82.1958   },
  { id: 131, address: "4904 Lakeside Blvd",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 131, lat: 28.2285,    lng: -82.1968   },
  { id: 132, address: "4812 Lakeside Blvd",       city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 132, lat: 28.2270,    lng: -82.1982   },
  { id: 133, address: "37900 Allen Rd",           city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 133, lat: 28.2145,    lng: -82.1940   },
  { id: 134, address: "37700 Chancey Rd",         city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 134, lat: 28.2120,    lng: -82.1840   },
  { id: 135, address: "38050 Sunset Dr",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 135, lat: 28.2168,    lng: -82.1808   },
  { id: 136, address: "38150 Sunset Dr",          city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 136, lat: 28.2178,    lng: -82.1798   },
  { id: 137, address: "4302 Palm Dr",             city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 137, lat: 28.2160,    lng: -82.1920   },
  { id: 138, address: "4418 Hammock Cir",         city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 138, lat: 28.2175,    lng: -82.1940   },
  { id: 139, address: "5502 Trailhead Dr",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 139, lat: 28.2420,    lng: -82.1855   },
  { id: 140, address: "5615 Trailhead Dr",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 140, lat: 28.2445,    lng: -82.1868   },
  { id: 141, address: "39620 Fort King Hwy",      city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 141, lat: 28.2410,    lng: -82.1715   },
  { id: 142, address: "39750 Fort King Hwy",      city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 142, lat: 28.2432,    lng: -82.1730   },
  { id: 143, address: "39900 Fort King Hwy",      city: "Zephyrhills, FL 33542", type: "business",    name: "Zeph Veterinary",      seq: 143, lat: 28.2455,    lng: -82.1745   },
  { id: 144, address: "6020 Meadow Creek Dr",     city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 144, lat: 28.2610,    lng: -82.1865   },
  { id: 145, address: "6130 Meadow Creek Dr",     city: "Zephyrhills, FL 33540", type: "residential", name: "",                     seq: 145, lat: 28.2638,    lng: -82.1885   },
  { id: 146, address: "38750 Eiland Blvd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 146, lat: 28.2256,    lng: -82.1670   },
  { id: 147, address: "38850 Eiland Blvd",        city: "Zephyrhills, FL 33542", type: "residential", name: "",                     seq: 147, lat: 28.2262,    lng: -82.1682   },
  { id: 148, address: "4720 Oak Hammock Blvd",    city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 148, lat: 28.2042,    lng: -82.1895   },
  { id: 149, address: "4832 Oak Hammock Blvd",    city: "Zephyrhills, FL 33541", type: "residential", name: "",                     seq: 149, lat: 28.2055,    lng: -82.1908   },
  { id: 150, address: "35000 Fort King Hwy",      city: "Zephyrhills, FL 33541", type: "business",    name: "Advance Auto",         seq: 150, lat: 28.1705,    lng: -82.1835   },
];

function weatherEmoji(code) {
  if (code === 0) return "☀️";
  if (code <= 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code <= 48) return "🌫️";
  if (code <= 55) return "🌦️";
  if (code <= 67) return "🌧️";
  if (code <= 77) return "❄️";
  if (code <= 82) return "🌧️";
  return "⛈️";
}
function weatherLabel(code) {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly Clear";
  if (code === 3) return "Overcast";
  if (code <= 48) return "Foggy";
  if (code <= 55) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  return "Thunderstorm";
}

export default function App() {
  const [screen, setScreen] = useState(screens.HOME);
  const [photos, setPhotos] = useState([]);
  const [processingStep, setProcessingStep] = useState(0);
  const [activeStop, setActiveStop] = useState(null);
  const [completedStops, setCompletedStops] = useState([]);
  const [stopNotes, setStopNotes] = useState({});
  const [stopTypes, setStopTypes] = useState({});
  const [optimizedRoute, setOptimizedRoute] = useState(null);
  const [routeOptimizing, setRouteOptimizing] = useState(false);
  const [dynamicStops, setDynamicStops] = useState(null);
  const [processingMessage, setProcessingMessage] = useState("");
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("lm_api_key") || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyVisible, setKeyVisible] = useState(false);
  const [businessesFirst, setBusinessesFirst] = useState(() => localStorage.getItem("lm_biz_first") === "true");
  const [defaultCity, setDefaultCity] = useState(() => localStorage.getItem("lm_default_city") || "");
  const [defaultState, setDefaultState] = useState(() => localStorage.getItem("lm_default_state") || "FL");
  const [defaultZip, setDefaultZip] = useState(() => localStorage.getItem("lm_default_zip") || "");
  const [failedStops, setFailedStops] = useState([]);
  const [fixingStop, setFixingStop] = useState(null);
  const [fixInput, setFixInput] = useState("");
  const [fixStatus, setFixStatus] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [googleActive, setGoogleActive] = useState(null);
  const [weather, setWeather] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const { latitude: lat, longitude: lng } = pos.coords;
        const data = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`
        ).then((r) => r.json());
        const c = data.current;
        setWeather({
          temp: Math.round(c.temperature_2m),
          feelsLike: Math.round(c.apparent_temperature),
          wind: Math.round(c.wind_speed_10m),
          code: c.weather_code,
        });
      } catch (_) {}
    }, () => {}, { timeout: 10000 });
  }, []);

  const activeStops = dynamicStops || mockStops;

  useEffect(() => {
    const effective = activeStops.map((s) => ({ ...s, type: stopTypes[s.id] || s.type }));
    const all = effective.filter((s) => s.lat);
    setRouteOptimizing(true);
    setOptimizedRoute(null);
    optimizeWithOSRM(WAREHOUSE, all, businessesFirst)
      .then((route) => { setOptimizedRoute(route); setRouteOptimizing(false); })
      .catch(() => { setRouteOptimizing(false); });
  }, [stopTypes, dynamicStops, businessesFirst]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-navigate to results when real processing + optimization both finish
  useEffect(() => {
    if (!routeOptimizing && optimizedRoute && optimizedRoute.length > 0 && screen === screens.PROCESSING && dynamicStops) {
      setScreen(screens.RESULTS);
    }
  }, [routeOptimizing, optimizedRoute, screen, dynamicStops]);

  const processingSteps = [
    "Reading DIAD screens...",
    "Extracting addresses...",
    "Identifying businesses vs residential...",
    "Calculating optimal route...",
    "Applying right-turn bias...",
    "Route ready.",
  ];

  function handleAddPhoto() {
    fileRef.current?.click();
  }

  function handleFileChange(e) {
    const files = Array.from(e.target.files);
    const newPhotos = files.map((f) => ({
      id: Date.now() + Math.random(),
      name: f.name,
      url: URL.createObjectURL(f),
      file: f,
    }));
    setPhotos((p) => [...p, ...newPhotos]);
  }

  async function handleProcess() {
    setScreen(screens.PROCESSING);
    setProcessingStep(0);
    setOptimizedRoute(null);
    setDynamicStops(null);
    setCompletedStops([]);
    setStopTypes({});
    setStopNotes({});

    // Demo mode — no photos
    if (photos.length === 0) {
      let step = 0;
      const interval = setInterval(() => {
        step++;
        setProcessingStep(step);
        if (step >= processingSteps.length - 1) {
          clearInterval(interval);
          setTimeout(() => setScreen(screens.RESULTS), 700);
        }
      }, 700);
      return;
    }

    // Real mode — need API key
    const key = apiKey || localStorage.getItem("lm_api_key");
    if (!key) {
      setScreen(screens.SETTINGS);
      return;
    }

    try {
      // Step 1: Extract addresses from each photo
      let allAddresses = [];
      for (let i = 0; i < photos.length; i++) {
        setProcessingMessage(`Reading DIAD screen ${i + 1} of ${photos.length}...`);
        setProcessingStep(Math.round(((i + 0.5) / photos.length) * 40));
        // Resize to max 2000px and convert to JPEG for consistent quality
        const b64 = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
              const MAX = 2000;
              const scale = Math.min(1, MAX / Math.max(img.width, img.height));
              const canvas = document.createElement("canvas");
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
              res(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
            };
            img.src = e.target.result;
          };
          reader.readAsDataURL(photos[i].file);
        });
        const mediaType = "image/jpeg";

        // Retry once on failure — skip bad photos instead of crashing the batch
        let stops = [];
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            if (attempt === 2) {
              setProcessingMessage(`Screen ${i + 1}: retrying in 3s...`);
              await new Promise((r) => setTimeout(r, 3000));
            }
            const resp = await fetch("/extract", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ b64, mediaType, apiKey: key }),
            });
            if (!resp.ok) {
              const errBody = await resp.json();
              throw new Error(errBody.error || `HTTP ${resp.status}`);
            }
            const data = await resp.json();
            stops = data.stops || [];
            break;
          } catch (err) {
            if (attempt === 2) {
              console.warn(`Screen ${i + 1} skipped after 2 attempts:`, err.message);
              setProcessingMessage(`Screen ${i + 1} skipped — ${err.message}`);
              await new Promise((r) => setTimeout(r, 1500));
            }
          }
        }

        console.log(`Screen ${i + 1}: ${stops.length} stops`);
        allAddresses = [...allAddresses, ...stops];
        if (stops.length > 0) setProcessingMessage(`Screen ${i + 1}: found ${stops.length} stops`);
        if (i < photos.length - 1) await new Promise((r) => setTimeout(r, 500));
      }

      if (allAddresses.length === 0) throw new Error("No addresses found in any photos — try clearer shots");

      // Step 2: Deduplicate
      setProcessingMessage("Deduplicating addresses...");
      setProcessingStep(45);
      const seen = new Set();
      const unique = allAddresses.filter((a) => {
        const k = `${a.address}|${a.zip}`.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      // Step 3: Batch geocode all addresses in one Census API call
      setProcessingMessage(`Locating ${unique.length} addresses...`);
      setProcessingStep(52);
      let batchGeo = [];
      try {
        const batchRes = await fetch("/geocode-batch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            addresses: unique.map((a) => ({
              address: normalizeAddress(a.address),
              city: (!a.city || a.city.toLowerCase().includes("unknown") || a.city.trim() === "") ? defaultCity : a.city,
              state: (!a.state || a.state.toLowerCase().includes("unknown") || a.state.trim() === "") ? defaultState : a.state,
              zip: (!a.zip || a.zip.toLowerCase().includes("unknown") || a.zip.replace(/\D/g,"") === "") ? defaultZip : a.zip,
            })),
          }),
        }).then((r) => r.json());
        batchGeo = batchRes.results || [];
      } catch (_) {}
      setProcessingStep(72);

      const geocoded = unique.map((a, i) => {
        const geo = batchGeo[i] || { lat: null, lng: null };
        const name = a.name || "";
        const type = name.trim() ? "business" : (a.type || "residential");
        const isUnknown = (v) => !v || v.toLowerCase().includes("unknown") || v.trim() === "";
        const dispCity = isUnknown(a.city) ? defaultCity : a.city;
        const dispState = isUnknown(a.state) ? defaultState : a.state;
        const dispZip = (!a.zip || a.zip.replace(/\D/g, "") === "") ? defaultZip : a.zip;
        return {
          id: i + 1, seq: i + 1,
          address: a.address,
          city: `${dispCity}, ${dispState} ${dispZip}`.trim(),
          type, name,
          lat: geo.lat, lng: geo.lng,
        };
      });

      // Step 4: Apply community corrections first — highest trust source
      setProcessingMessage("Checking community corrections...");
      setProcessingStep(85);
      try {
        const lookupRes = await fetch("/community/lookup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            addresses: geocoded.map((s) => ({ address: s.address, zip: s.city.split(" ").pop() })),
          }),
        }).then((r) => r.json());
        geocoded.forEach((s) => {
          const zip = s.city.split(" ").pop();
          const key = `${s.address.trim().toLowerCase()}|${zip}`;
          const correction = lookupRes.corrections?.[key];
          if (correction) {
            s.type = correction.type;
            if (correction.name) s.name = correction.name;
            s.communityVerified = true;
            s.communityCount = correction.count;
          }
        });
      } catch (_) {}

      // Step 5: Classify in chunks of 50 (handles 200+ stops without token issues)
      setProcessingMessage("Identifying businesses...");
      setProcessingStep(88);
      const CLASSIFY_CHUNK = 50;
      for (let start = 0; start < geocoded.length; start += CLASSIFY_CHUNK) {
        const chunk = geocoded.slice(start, start + CLASSIFY_CHUNK);
        try {
          const addressStrings = chunk.map((s) => `${s.address}, ${s.city}`);
          const classRes = await fetch("/classify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ addresses: addressStrings, apiKey: key }),
          }).then((r) => r.json());
          (classRes.classifications || []).forEach(({ index, type, name }) => {
            const g = geocoded[start + index];
            if (g && !g.communityVerified) {
              if (type === "business" || g.type !== "business") g.type = type;
              if (name && name.trim() && !g.name) g.name = name;
            }
          });
        } catch (_) {}
      }

      // Step 6: Hand off to optimizer
      const validStops = geocoded.filter((s) => s.lat);
      const missed = geocoded.filter((s) => !s.lat);
      if (validStops.length === 0) throw new Error("No addresses found in photos — try clearer shots");
      setProcessingMessage(`Found ${validStops.length} stops — optimizing route...`);
      setProcessingStep(92);
      setFailedStops(missed);
      setDynamicStops(validStops);

    } catch (err) {
      setProcessingMessage(`Error: ${err.message}`);
      setTimeout(() => setScreen(screens.CAPTURE), 3000);
    }
  }

  async function handleFixStop(stop, addressText) {
    setFixStatus("Locating...");
    const parts = addressText.split(",").map((s) => s.trim());
    const address = parts[0] || addressText;
    const cityState = parts[1] || "";
    const zipMatch = addressText.match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : "";
    const stateMatch = cityState.match(/\b([A-Z]{2})\b/);
    const state = stateMatch ? stateMatch[1] : "FL";
    const city = cityState.replace(/\b[A-Z]{2}\b/, "").replace(zip, "").replace(/,/g, "").trim();

    try {
      const res = await fetch("/geocode-batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: [{ address, city: city || stop.city.split(",")[0], state, zip }] }),
      }).then((r) => r.json());
      const geo = res.results?.[0];
      if (!geo?.lat) { setFixStatus("Still couldn't find it — try a nearby intersection"); return; }
      const fixed = { ...stop, address, city: `${city || stop.city.split(",")[0]}, ${state} ${zip}`, lat: geo.lat, lng: geo.lng };
      setDynamicStops((prev) => [...(prev || []), fixed]);
      setFailedStops((prev) => prev.filter((s) => s.id !== stop.id));
      setFixingStop(null);
      setFixStatus("");
    } catch (_) {
      setFixStatus("Error — check your connection");
    }
  }

  function toggleComplete(id) {
    setCompletedStops((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const effectiveStops = activeStops.map((s) => ({
    ...s,
    type: stopTypes[s.id] || s.type,
    name: stopNotes[s.id] !== undefined ? stopNotes[s.id] : s.name,
  }));
  const businesses = effectiveStops.filter((s) => s.type === "business");
  const residential = effectiveStops.filter((s) => s.type === "residential");
  const communityVerifiedCount = effectiveStops.filter((s) => s.communityVerified).length;
  const fromNorth = [WAREHOUSE[0] + 0.01, WAREHOUSE[1]];
  const heuristicStops = rightHandRoute(WAREHOUSE, effectiveStops.filter((s) => s.lat), fromNorth);
  const orderedStops = (optimizedRoute && optimizedRoute.length > 0) ? optimizedRoute : heuristicStops;
  const remaining = orderedStops.filter((s) => !completedStops.includes(s.id));
  const done = orderedStops.filter((s) => completedStops.includes(s.id));

  return (
    <div style={styles.shell}>
        {/* HOME */}
        {screen === screens.HOME && (
          <div style={styles.screen}>
            {/* Header */}
            <div style={{ padding: "20px 20px 16px", background: "linear-gradient(160deg, #07070F 60%, #071018 100%)", borderBottom: "1px solid #14142A" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 20, color: "#00C8FF" }}>⟳</span>
                    <span style={{ fontSize: 15, fontWeight: "900", color: "#E8E8FF", letterSpacing: "0.08em" }}>RIGHT HAND TURN PRO</span>
                  </div>
                  <div style={{ fontSize: 11, color: "#555", letterSpacing: "0.06em" }}>
                    {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                  </div>
                </div>
                {/* Weather widget */}
                {weather ? (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 22, lineHeight: 1 }}>{weatherEmoji(weather.code)}</div>
                    <div style={{ fontSize: 20, fontWeight: "bold", color: "#fff", lineHeight: 1.1 }}>{weather.temp}°</div>
                    <div style={{ fontSize: 10, color: "#555" }}>{weatherLabel(weather.code)}</div>
                    <div style={{ fontSize: 10, color: "#444" }}>Feels {weather.feelsLike}° · {weather.wind}mph</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: "#333" }}>Loading weather...</div>
                )}
              </div>
            </div>

            <div style={{ padding: "20px 20px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              {/* New Route — primary action */}
              <button style={styles.primaryBtn} onClick={() => setScreen(screens.CAPTURE)}>
                <span style={styles.btnIcon}>📸</span>
                NEW ROUTE
              </button>

              {/* Continue route — only if a route is loaded */}
              {orderedStops.length > 0 && (
                <button
                  style={{ ...styles.primaryBtn, background: "#1a1a1a", color: "#fff", border: "1px solid #333", marginTop: 0 }}
                  onClick={() => setScreen(screens.RESULTS)}
                >
                  <span style={styles.btnIcon}>≡</span>
                  CONTINUE ROUTE
                  <span style={{ marginLeft: "auto", fontSize: 11, color: "#555" }}>{remaining.length} left</span>
                </button>
              )}

              {/* Notes */}
              <button
                style={{ ...styles.primaryBtn, background: "#161616", color: "#aaa", border: "1px solid #222", marginTop: 0 }}
                onClick={() => { setScreen(screens.NOTES); setSearchQuery(""); setEditingNoteId(null); }}
              >
                <span style={styles.btnIcon}>📝</span>
                NOTES & SEARCH
              </button>

              {/* Delivery area status */}
              <div
                style={{ background: "#111", borderRadius: 12, padding: "12px 14px", border: `1px solid ${defaultCity ? "#1e2a1e" : "#2a1500"}`, cursor: "pointer" }}
                onClick={() => setScreen(screens.SETTINGS)}
              >
                <div style={{ fontSize: 10, color: "#444", letterSpacing: "0.08em", marginBottom: 4 }}>DELIVERY AREA</div>
                {defaultCity ? (
                  <div style={{ fontSize: 13, color: "#22D47A" }}>✓ {defaultCity}, {defaultState} {defaultZip}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#F59E0B" }}>⚠ Not set — tap to configure</div>
                )}
              </div>

              {/* Route stats if active */}
              {orderedStops.length > 0 && (
                <div style={{ display: "flex", gap: 8 }}>
                  <div style={styles.statCard}>
                    <span style={styles.statNum}>{orderedStops.length}</span>
                    <span style={styles.statLabel}>Total Stops</span>
                  </div>
                  <div style={styles.statCard}>
                    <span style={styles.statNum}>{completedStops.length}</span>
                    <span style={styles.statLabel}>Delivered</span>
                  </div>
                  <div style={styles.statCard}>
                    <span style={styles.statNum}>{remaining.length}</span>
                    <span style={styles.statLabel}>Remaining</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* CAPTURE */}
        {screen === screens.CAPTURE && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <button style={styles.backBtn} onClick={() => { setScreen(screens.HOME); setPhotos([]); }}>← Back</button>
              <span style={styles.navTitle}>Capture Route</span>
              <span />
            </div>

            {!defaultCity && (
              <div style={{ background: "#0A0A18", border: "1px solid #F59E0B", borderRadius: 10, margin: "10px 16px 0", padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12, color: "#F59E0B", fontWeight: "bold" }}>⚠ Delivery area not set!</div>
                  <div style={{ fontSize: 11, color: "#5A5A80", marginTop: 2 }}>Stops without city/zip will geocode wrong</div>
                </div>
                <button
                  style={{ background: "#F59E0B", border: "none", borderRadius: 8, color: "#000", fontSize: 12, fontWeight: "bold", padding: "8px 14px", cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => setScreen(screens.SETTINGS)}
                >FIX →</button>
              </div>
            )}

            <div style={styles.captureInstructions}>
              <p style={styles.instrText}>Photograph each DIAD screen.<br />All stops will be extracted automatically.</p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/*"
              multiple
              style={{ display: "none" }}
              onChange={handleFileChange}
            />

            <div style={styles.photoGrid}>
              {photos.map((p, i) => (
                <div key={p.id} style={styles.photoThumb}>
                  <img src={p.url} alt="" style={styles.thumbImg} />
                  <div style={styles.thumbLabel}>Screen {i + 1}</div>
                  <button
                    style={styles.removeBtn}
                    onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                  >✕</button>
                </div>
              ))}

              <button style={styles.addPhotoBtn} onClick={handleAddPhoto}>
                <span style={{ fontSize: 28 }}>+</span>
                <span style={{ fontSize: 11, marginTop: 4 }}>Add Screen</span>
              </button>
            </div>

            {photos.length > 0 && (
              <div style={styles.captureBottom}>
                <div style={styles.photoCount}>{photos.length} screen{photos.length !== 1 ? "s" : ""} captured</div>
                <button style={styles.primaryBtn} onClick={handleProcess}>
                  BUILD ROUTE →
                </button>
              </div>
            )}

            {photos.length === 0 && (
              <div style={styles.demoNote}>
                <span style={styles.demoNoteText}>
                  💡 No camera? Tap "Add Screen" to upload from your gallery, or{" "}
                  <span
                    style={{ color: "#00C8FF", cursor: "pointer", textDecoration: "underline" }}
                    onClick={handleProcess}
                  >
                    skip to demo route
                  </span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* PROCESSING */}
        {screen === screens.PROCESSING && (
          <div style={styles.screen}>
            <div style={styles.processingWrap}>
              <div style={styles.processingRing}>
                <div style={styles.processingInner}>
                  <span style={styles.processingPct}>{processingStep}%</span>
                </div>
              </div>
              <div style={styles.processingSteps}>
                {photos.length === 0
                  ? processingSteps.map((step, i) => (
                      <div key={i} style={{ ...styles.processingStep, opacity: i <= processingStep ? 1 : 0.25, color: i === processingStep ? "#00C8FF" : i < processingStep ? "#22D47A" : "#2A2A45" }}>
                        <span style={styles.stepIcon}>{i < processingStep ? "✓" : i === processingStep ? "▶" : "○"}</span>
                        {step}
                      </div>
                    ))
                  : (
                      <div style={{ ...styles.processingStep, color: "#00C8FF", fontSize: 13 }}>
                        <span style={styles.stepIcon}>▶</span>
                        {processingMessage || "Starting..."}
                      </div>
                    )
                }
              </div>
            </div>
          </div>
        )}

        {/* RESULTS */}
        {screen === screens.RESULTS && !activeStop && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <button style={styles.backBtn} onClick={() => { setScreen(screens.HOME); setPhotos([]); setCompletedStops([]); }}>✕</button>
              <span style={styles.navTitle}>Today's Route</span>
              <span style={styles.stopCount}>{routeOptimizing ? "⟳ optimizing..." : `${remaining.length} left`}</span>
            </div>

            <div style={styles.routeSummary}>
              <div style={styles.summaryChip}>
                <span style={styles.chipDot} />
                {businesses.length} Biz
              </div>
              <div style={{ ...styles.summaryChip, background: "#1a2a1a" }}>
                <span style={{ ...styles.chipDot, background: "#22D47A" }} />
                {residential.length} Res
              </div>
              <div style={{ ...styles.summaryChip, background: "#2a1a00" }}>
                <span style={{ ...styles.chipDot, background: "#F59E0B" }} />
                {orderedStops.length} Total
              </div>
              {communityVerifiedCount > 0 && (
                <div style={{ ...styles.summaryChip, background: "#0d1a0d" }}>
                  <span style={{ ...styles.chipDot, background: "#22D47A" }} />
                  👥 {communityVerifiedCount}
                </div>
              )}
            </div>

            <div style={styles.stopList}>
              {remaining.length > 0 && (
                <>
                  <div style={styles.listSectionLabel}>REMAINING</div>
                  {remaining.map((stop) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      onTap={() => setActiveStop(stop)}
                      onComplete={() => toggleComplete(stop.id)}
                      completed={false}
                    />
                  ))}
                </>
              )}

              {done.length > 0 && (
                <>
                  <div style={{ ...styles.listSectionLabel, marginTop: 16 }}>COMPLETED</div>
                  {done.map((stop) => (
                    <StopCard
                      key={stop.id}
                      stop={stop}
                      onTap={() => {}}
                      onComplete={() => toggleComplete(stop.id)}
                      completed={true}
                    />
                  ))}
                </>
              )}

              {failedStops.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...styles.listSectionLabel, color: "#ff6b6b" }}>
                    ⚠ {failedStops.length} COULDN'T LOCATE
                  </div>
                  {failedStops.map((stop) => (
                    <div key={stop.id} style={{ background: "#1a0f0f", border: "1px solid #3a1a1a", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                      {fixingStop?.id === stop.id ? (
                        <div>
                          <input
                            style={{ ...styles.notesInput, marginBottom: 8, fontSize: 12 }}
                            value={fixInput}
                            onChange={(e) => setFixInput(e.target.value)}
                            placeholder="e.g. 1805 N 16th St, Tampa, FL 33605"
                          />
                          {fixStatus && <div style={{ fontSize: 11, color: fixStatus.includes("couldn't") || fixStatus.includes("Error") ? "#ff6b6b" : "#00C8FF", marginBottom: 6 }}>{fixStatus}</div>}
                          <div style={{ display: "flex", gap: 8 }}>
                            <button style={{ ...styles.completeBtn, flex: 1, padding: "10px", fontSize: 12 }} onClick={() => handleFixStop(stop, fixInput)}>LOCATE</button>
                            <button style={{ ...styles.saveNoteBtn, flex: 1, padding: "10px", fontSize: 12 }} onClick={() => { setFixingStop(null); setFixStatus(""); }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 12, color: "#ccc" }}>{stop.address}</div>
                            <div style={{ fontSize: 11, color: "#555" }}>{stop.city}</div>
                          </div>
                          <button
                            style={{ background: "#2a1a1a", border: "1px solid #ff6b6b", borderRadius: 8, color: "#ff6b6b", fontSize: 11, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}
                            onClick={() => { setFixingStop(stop); setFixInput(`${stop.address}, ${stop.city}`); setFixStatus(""); }}
                          >FIX</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STOP DETAIL */}
        {screen === screens.RESULTS && activeStop && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <button style={styles.backBtn} onClick={() => setActiveStop(null)}>← Back</button>
              <span style={styles.navTitle}>Stop #{activeStop.seq}</span>
              <span />
            </div>

            <div style={styles.detailCard}>
              <button
                style={{
                  ...styles.detailBadge,
                  background: (stopTypes[activeStop.id] || activeStop.type) === "business" ? "#1a1200" : "#0d1a0d",
                  border: `1px solid ${(stopTypes[activeStop.id] || activeStop.type) === "business" ? "#F59E0B" : "#22D47A"}`,
                  borderRadius: 8,
                  cursor: "pointer",
                  padding: "6px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontFamily: "inherit",
                }}
                onClick={() => {
                  const cur = stopTypes[activeStop.id] || activeStop.type;
                  const newType = cur === "business" ? "residential" : "business";
                  setStopTypes((prev) => ({ ...prev, [activeStop.id]: newType }));
                  const zip = activeStop.city.split(" ").pop();
                  fetch("/community/correct", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ address: activeStop.address, zip, type: newType, name: stopNotes[activeStop.id] || activeStop.name || "" }),
                  }).catch(() => {});
                }}
              >
                <span>{(stopTypes[activeStop.id] || activeStop.type) === "business" ? "🏢 BUSINESS" : "🏠 RESIDENTIAL"}</span>
                <span style={{ fontSize: 9, color: "#555", letterSpacing: "0.05em" }}>TAP TO CORRECT</span>
              </button>
              {activeStop.communityVerified && (
                <div style={{ fontSize: 10, color: "#22D47A", marginTop: 8, display: "flex", alignItems: "center", gap: 5 }}>
                  <span>👥</span>
                  <span>Verified by {activeStop.communityCount} driver{activeStop.communityCount !== 1 ? "s" : ""}</span>
                </div>
              )}
              {activeStop.name && <div style={styles.detailName}>{activeStop.name}</div>}
              <div style={styles.detailAddress}>{activeStop.address}</div>
              <div style={styles.detailCity}>{activeStop.city}</div>
            </div>

            <div style={styles.notesWrap}>
              <div style={styles.notesLabel}>NOTES</div>
              <textarea
                style={styles.notesTextarea}
                placeholder="e.g. leave at back door, apt 2B, business name..."
                value={stopNotes[activeStop.id] !== undefined ? stopNotes[activeStop.id] : (activeStop.name || "")}
                onChange={(e) => setStopNotes((prev) => ({ ...prev, [activeStop.id]: e.target.value }))}
                rows={4}
              />
              <button
                style={styles.saveNoteBtn}
                onClick={() => {
                  const note = stopNotes[activeStop.id] !== undefined ? stopNotes[activeStop.id] : (activeStop.name || "");
                  if (!note.trim()) return;
                  const zip = activeStop.city.split(" ").pop();
                  fetch("/community/correct", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ address: activeStop.address, zip, type: stopTypes[activeStop.id] || activeStop.type, name: note.trim() }),
                  }).catch(() => {});
                }}
              >
                SAVE NOTE
              </button>
            </div>

            <div style={styles.detailActions}>
              <button
                style={styles.navBtn}
                onClick={() => {
                  const url = activeStop.lat
                    ? `https://maps.google.com/maps?daddr=${activeStop.lat},${activeStop.lng}`
                    : `https://maps.google.com/maps?daddr=${encodeURIComponent(activeStop.address + ", " + activeStop.city)}`;
                  window.open(url, "_blank");
                }}
              >
                🧭 Navigate
              </button>
              <button
                style={styles.completeBtn}
                onClick={() => { toggleComplete(activeStop.id); setActiveStop(null); }}
              >
                ✓ Mark Delivered
              </button>
            </div>

            <div style={styles.detailMeta}>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Priority</span>
                <span style={styles.metaVal}>#{activeStop.priority}</span>
              </div>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Type</span>
                <span style={styles.metaVal}>{activeStop.type === "business" ? "Business" : "Residential"}</span>
              </div>
              <div style={styles.metaRow}>
                <span style={styles.metaLabel}>Route Position</span>
                <span style={styles.metaVal}>{activeStop.seq} of {mockStops.length}</span>
              </div>
            </div>

            <div style={styles.nextUpWrap}>
              {orderedStops[activeStop.seq] && (
                <>
                  <div style={styles.nextUpLabel}>NEXT UP</div>
                  <div style={styles.nextUpCard}>
                    <span>{orderedStops[activeStop.seq].address}</span>
                    <span style={styles.nextUpType}>
                      {orderedStops[activeStop.seq].type === "business" ? "🏢" : "🏠"}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* MAP */}
        {screen === screens.MAP && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <span style={styles.navTitle}>Route Map</span>
              <span style={styles.stopCount}>{remaining.length} left</span>
            </div>
            <MapView orderedStops={orderedStops} completedStops={completedStops} remaining={remaining} />
          </div>
        )}

        {/* NOTES / SEARCH */}
        {screen === screens.NOTES && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <span style={styles.navTitle}>Notes & Search</span>
              <span style={{ fontSize: 11, color: "#555" }}>{orderedStops.length} stops</span>
            </div>

            <div style={{ padding: "12px 16px 8px" }}>
              <input
                style={{ ...styles.notesInput, fontSize: 14, padding: "12px 14px" }}
                placeholder="Search address, street, business..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus={false}
              />
            </div>

            <div style={{ padding: "0 16px 16px" }}>
              {(() => {
                const q = searchQuery.toLowerCase().trim();
                const filtered = orderedStops.filter((s) =>
                  !q ||
                  s.address.toLowerCase().includes(q) ||
                  (s.city || "").toLowerCase().includes(q) ||
                  (s.name || "").toLowerCase().includes(q)
                );
                if (filtered.length === 0) return (
                  <div style={{ color: "#444", fontSize: 13, textAlign: "center", marginTop: 40 }}>No stops match</div>
                );
                return filtered.map((stop) => {
                  const note = stopNotes[stop.id] !== undefined ? stopNotes[stop.id] : (stop.name || "");
                  const isEditing = editingNoteId === stop.id;
                  const isDone = completedStops.includes(stop.id);
                  return (
                    <div key={stop.id} style={{ background: "#161616", borderRadius: 12, padding: "12px 14px", marginBottom: 10, border: `1px solid ${isDone ? "#1e2e1e" : "#1e1e1e"}`, opacity: isDone ? 0.6 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: isEditing ? 10 : 0 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                            <span style={{ fontSize: 10, color: "#555" }}>#{stop.seq}</span>
                            <span style={{ fontSize: 10, color: stop.type === "business" ? "#F59E0B" : "#22D47A" }}>
                              {stop.type === "business" ? "🏢" : "🏠"}
                            </span>
                            {isDone && <span style={{ fontSize: 10, color: "#22D47A" }}>✓ done</span>}
                          </div>
                          <div style={{ fontSize: 13, color: "#ddd", fontWeight: "bold" }}>{stop.address}</div>
                          <div style={{ fontSize: 11, color: "#555" }}>{stop.city}</div>
                          {!isEditing && note ? (
                            <div style={{ marginTop: 6, fontSize: 12, color: "#00C8FF", fontStyle: "italic" }}>📝 {note}</div>
                          ) : null}
                        </div>
                        <button
                          style={{ background: "none", border: "1px solid #2a2a2a", borderRadius: 8, color: isEditing ? "#22D47A" : "#555", fontSize: 11, padding: "5px 10px", cursor: "pointer", fontFamily: "inherit", flexShrink: 0, marginLeft: 8 }}
                          onClick={() => setEditingNoteId(isEditing ? null : stop.id)}
                        >{isEditing ? "Done" : "Note"}</button>
                      </div>
                      {isEditing && (
                        <div>
                          <textarea
                            style={{ ...styles.notesTextarea, fontSize: 13 }}
                            rows={3}
                            placeholder="e.g. leave at back door, gate code 1234, apt 2B..."
                            value={stopNotes[stop.id] !== undefined ? stopNotes[stop.id] : (stop.name || "")}
                            onChange={(e) => setStopNotes((prev) => ({ ...prev, [stop.id]: e.target.value }))}
                            autoFocus
                          />
                          <button
                            style={{ ...styles.saveNoteBtn, marginTop: 6 }}
                            onClick={() => {
                              const n = stopNotes[stop.id] !== undefined ? stopNotes[stop.id] : (stop.name || "");
                              if (!n.trim()) return;
                              const zip = (stop.city || "").split(" ").pop();
                              fetch("/community/correct", {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify({ address: stop.address, zip, type: stopTypes[stop.id] || stop.type, name: n.trim() }),
                              }).catch(() => {});
                              setEditingNoteId(null);
                            }}
                          >SAVE NOTE</button>
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}

        {/* SETTINGS */}
        {screen === screens.SETTINGS && (
          <div style={styles.screen}>
            <div style={styles.navBar}>
              <button style={styles.backBtn} onClick={() => setScreen(screens.HOME)}>← Back</button>
              <span style={styles.navTitle}>Settings</span>
              <span />
            </div>
            <div style={{ padding: "24px 20px" }}>
              {/* Google Maps status */}
              <div
                style={{ background: "#161616", borderRadius: 12, padding: "16px", border: "1px solid #2a2a2a", marginBottom: 24, cursor: "pointer" }}
                onClick={async () => {
                  setGoogleActive("checking");
                  try {
                    const d = await fetch("/cache/stats").then((r) => r.json());
                    setGoogleActive(d.hasGoogleKey ? "active" : "missing");
                  } catch (_) {
                    setGoogleActive("error");
                  }
                }}
              >
                <div style={{ fontSize: 13, color: "#fff", fontWeight: "bold", letterSpacing: "0.05em", marginBottom: 4 }}>GOOGLE MAPS GEOCODING</div>
                <div style={{ fontSize: 11, color: "#555", lineHeight: 1.5, marginBottom: googleActive ? 8 : 0 }}>
                  Finds private roads &amp; golf communities Census/Nominatim miss. Set GOOGLE_MAPS_KEY in Railway env vars.
                </div>
                {googleActive === "checking" && <div style={{ fontSize: 11, color: "#00C8FF" }}>Checking...</div>}
                {googleActive === "active" && <div style={{ fontSize: 11, color: "#22D47A" }}>✓ Google Maps active — hard-to-find roads will now geocode</div>}
                {googleActive === "missing" && <div style={{ fontSize: 11, color: "#ff6b6b" }}>✗ Key not set — add GOOGLE_MAPS_KEY to Railway environment variables</div>}
                {googleActive === "error" && <div style={{ fontSize: 11, color: "#ff6b6b" }}>✗ Couldn't reach server</div>}
                {!googleActive && <div style={{ fontSize: 11, color: "#444", marginTop: 6 }}>Tap to check status</div>}
              </div>
              {/* Default Delivery Area */}
              <div style={{ background: "#161616", borderRadius: 12, padding: "16px", border: "1px solid #2a2a2a", marginBottom: 24 }}>
                <div style={{ fontSize: 13, color: "#fff", fontWeight: "bold", letterSpacing: "0.05em", marginBottom: 4 }}>DEFAULT DELIVERY AREA</div>
                <div style={{ fontSize: 11, color: "#555", marginBottom: 12, lineHeight: 1.5 }}>Used when your route screen doesn't show city/zip (Amazon Flex, etc.)</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <input
                    style={{ ...styles.notesInput, flex: 2 }}
                    placeholder="City (e.g. Tampa)"
                    value={defaultCity}
                    onChange={(e) => { setDefaultCity(e.target.value); localStorage.setItem("lm_default_city", e.target.value); }}
                  />
                  <input
                    style={{ ...styles.notesInput, flex: 1 }}
                    placeholder="ST"
                    maxLength={2}
                    value={defaultState}
                    onChange={(e) => { setDefaultState(e.target.value.toUpperCase()); localStorage.setItem("lm_default_state", e.target.value.toUpperCase()); }}
                  />
                </div>
                <input
                  style={styles.notesInput}
                  placeholder="ZIP code (e.g. 33610)"
                  value={defaultZip}
                  maxLength={5}
                  onChange={(e) => { setDefaultZip(e.target.value); localStorage.setItem("lm_default_zip", e.target.value); }}
                />
                {defaultCity && <div style={{ fontSize: 11, color: "#22D47A", marginTop: 8 }}>✓ Using {defaultCity}, {defaultState} {defaultZip} as fallback</div>}
              </div>

              {/* Businesses First toggle */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#161616", borderRadius: 12, padding: "16px", border: "1px solid #2a2a2a", marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 13, color: "#fff", fontWeight: "bold", letterSpacing: "0.05em" }}>BUSINESSES FIRST</div>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 4, lineHeight: 1.5 }}>Run all business stops before any residential</div>
                </div>
                <button
                  style={{
                    width: 52, height: 28, borderRadius: 14,
                    background: businessesFirst ? "#F59E0B" : "#1E1E35",
                    border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s",
                  }}
                  onClick={() => {
                    const next = !businessesFirst;
                    setBusinessesFirst(next);
                    localStorage.setItem("lm_biz_first", next);
                  }}
                >
                  <div style={{
                    width: 22, height: 22, borderRadius: "50%", background: "#fff",
                    position: "absolute", top: 3,
                    left: businessesFirst ? 27 : 3,
                    transition: "left 0.2s",
                  }} />
                </button>
              </div>

              <div style={styles.notesLabel}>ANTHROPIC API KEY</div>
              <p style={{ fontSize: 11, color: "#555", marginBottom: 16, lineHeight: 1.6 }}>
                Get yours at console.anthropic.com — $5 credit lasts hundreds of routes. Stored only on this device.
              </p>
              <div style={{ position: "relative" }}>
                <input
                  style={{ ...styles.notesInput, paddingRight: 48, letterSpacing: keyVisible ? 0 : 3 }}
                  type={keyVisible ? "text" : "password"}
                  placeholder="sk-ant-api03-..."
                  value={apiKeyInput || apiKey}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14 }}
                  onClick={() => setKeyVisible((v) => !v)}
                >{keyVisible ? "🙈" : "👁"}</button>
              </div>
              <button
                style={{ ...styles.primaryBtn, marginTop: 16, marginLeft: 0, width: "100%" }}
                onClick={() => {
                  const k = apiKeyInput || apiKey;
                  localStorage.setItem("lm_api_key", k);
                  setApiKey(k);
                  setApiKeyInput("");
                  setScreen(screens.HOME);
                }}
              >SAVE KEY</button>
              {apiKey && (
                <div style={{ marginTop: 16, fontSize: 11, color: "#22D47A", textAlign: "center" }}>
                  ✓ Key saved
                </div>
              )}
              {apiKey && (
                <button
                  style={{ ...styles.primaryBtn, marginTop: 12, marginLeft: 0, width: "100%", background: "#1a1a1a", color: "#fff", border: "1px solid #333" }}
                  onClick={async () => {
                    setProcessingMessage("Testing local server...");
                    try {
                      const r = await fetch("/health");
                      const d = await r.json();
                      if (d.ok) setProcessingMessage("✓ Local server reachable! Testing API key...");
                      else { setProcessingMessage("✗ Local server error"); return; }
                    } catch (e) {
                      setProcessingMessage(`✗ Cannot reach local server: ${e.message} — make sure you ran 'npm run dev' not 'npm start'`);
                      return;
                    }
                    try {
                      const r = await fetch("https://api.anthropic.com/v1/messages", {
                        method: "POST",
                        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json", "anthropic-dangerous-direct-browser-access": "true" },
                        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
                      });
                      if (r.ok) setProcessingMessage("✓ All good — local server up, API key valid. Ready to process photos.");
                      else { const e = await r.json(); setProcessingMessage(`✗ API key error: ${e.error?.message || r.status}`); }
                    } catch (e) {
                      setProcessingMessage(`✓ Local server OK but direct API blocked (${e.message}) — photos will still work through server`);
                    }
                  }}
                >TEST CONNECTION</button>
              )}
              {processingMessage ? (
                <div style={{ marginTop: 12, fontSize: 11, color: processingMessage.startsWith("✓") ? "#22D47A" : "#ff6b6b", textAlign: "center", lineHeight: 1.5 }}>
                  {processingMessage}
                </div>
              ) : null}
              {apiKey && (
                <button
                  style={{ ...styles.backBtn, display: "block", margin: "20px auto 0", fontSize: 11, color: "#ff4444" }}
                  onClick={() => { localStorage.removeItem("lm_api_key"); setApiKey(""); setApiKeyInput(""); setProcessingMessage(""); }}
                >Remove key</button>
              )}
            </div>
          </div>
        )}

        {/* Bottom nav */}
        {(screen === screens.HOME || screen === screens.RESULTS || screen === screens.MAP || screen === screens.NOTES || screen === screens.SETTINGS) && (
          <div style={styles.bottomNav}>
            <button
              style={{ ...styles.navTab, color: screen === screens.HOME ? "#00C8FF" : "#3A3A5C" }}
              onClick={() => { setScreen(screens.HOME); setCompletedStops([]); setPhotos([]); }}
            >
              <span style={styles.navTabIcon}>⌂</span>
              Home
            </button>
            <button
              style={{ ...styles.navTab, color: screen === screens.RESULTS ? "#00C8FF" : "#3A3A5C" }}
              onClick={() => setScreen(orderedStops.length > 0 ? screens.RESULTS : screens.CAPTURE)}
            >
              <span style={styles.navTabIcon}>≡</span>
              Route
            </button>
            <button
              style={{ ...styles.navTab, color: screen === screens.MAP ? "#00C8FF" : "#3A3A5C" }}
              onClick={() => setScreen(screens.MAP)}
            >
              <span style={styles.navTabIcon}>⊞</span>
              Map
            </button>
            <button
              style={{ ...styles.navTab, color: screen === screens.SETTINGS ? "#00C8FF" : "#3A3A5C" }}
              onClick={() => setScreen(screens.SETTINGS)}
            >
              <span style={styles.navTabIcon}>⚙</span>
              Settings
            </button>
          </div>
        )}
    </div>
  );
}

function StopCard({ stop, onTap, onComplete, completed }) {
  return (
    <div
      style={{
        ...styles.stopCard,
        opacity: completed ? 0.45 : 1,
        borderLeft: `3px solid ${stop.type === "business" ? "#F59E0B" : "#22D47A"}`,
      }}
      onClick={onTap}
    >
      <div style={styles.stopSeq}>#{stop.seq}</div>
      <div style={styles.stopInfo}>
        {stop.name && <div style={styles.stopName}>{stop.name}</div>}
        <div style={styles.stopAddr}>{stop.address}</div>
        <div style={styles.stopCity}>{stop.city}</div>
      </div>
      <div style={styles.stopRight}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <div style={styles.stopTypeBadge}>
            {stop.type === "business" ? "🏢" : "🏠"}
          </div>
          {stop.communityVerified && (
            <div style={{ fontSize: 9, color: "#22D47A", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
              👥 {stop.communityCount}
            </div>
          )}
        </div>
        <button
          style={{
            ...styles.checkBtn,
            background: completed ? "#22D47A" : "transparent",
            border: `2px solid ${completed ? "#22D47A" : "#333"}`,
          }}
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
        >
          {completed ? "✓" : ""}
        </button>
      </div>
    </div>
  );
}

function MapView({ orderedStops, completedStops, remaining }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (mapRef.current) return;

    let map;
    try {
      map = L.map(containerRef.current, {
        center: [28.229, -82.186],
        zoom: 15,
        zoomControl: true,
        rotate: true,
        touchRotate: true,
        rotateControl: { closeOnZeroBearing: false },
      });
    } catch (e) {
      return;
    }
    mapRef.current = map;
    let destroyed = false;

    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap © CARTO",
      maxZoom: 19,
    }).addTo(map);

    // Fit to remaining stops so map focuses on what's ahead
    const focusStops = (remaining && remaining.length > 0 ? remaining : orderedStops).filter((s) => s.lat);
    const focusCoords = focusStops.map((s) => [s.lat, s.lng]);
    if (focusCoords.length > 0) {
      map.fitBounds(focusCoords, { padding: [50, 50], maxZoom: 15 });
    }

    const nextStopId = remaining && remaining.length > 0 ? remaining[0].id : null;

    orderedStops.forEach((stop, i) => {
      if (!stop.lat) return;
      const done = completedStops.includes(stop.id);
      const isNext = stop.id === nextStopId;

      let pinW, pinH, fill, stroke, strokeW, numColor, numSize, topLabel;
      if (isNext) {
        pinW = 32; pinH = 40;
        fill = "#fff"; stroke = "#00C8FF"; strokeW = 2.5;
        numColor = "#000"; numSize = 12;
        topLabel = `<tspan x="16" dy="-3" font-size="6" font-weight="900" letter-spacing="1">NXT</tspan><tspan x="16" dy="11" font-size="12" font-weight="900">${i + 1}</tspan>`;
      } else if (done) {
        pinW = 16; pinH = 20;
        fill = "#1E1E35"; stroke = "#2A2A45"; strokeW = 1;
        numColor = "#3A3A5C"; numSize = 8;
        topLabel = `<tspan x="8" dy="0" font-size="8">✓</tspan>`;
      } else {
        pinW = 26; pinH = 32;
        fill = stop.type === "business" ? "#F59E0B" : "#22D47A";
        stroke = "#fff"; strokeW = 1.5;
        numColor = "#000"; numSize = 10;
        topLabel = `<tspan x="${pinW / 2}" dy="0" font-size="${numSize}" font-weight="900">${i + 1}</tspan>`;
      }

      const cx = pinW / 2;
      const r = pinW / 2;
      const bodyH = pinH - r;
      const shadowId = `s${stop.id}`;
      const svgPin = `
        <svg width="${pinW}" height="${pinH}" viewBox="0 0 ${pinW} ${pinH}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="${shadowId}" x="-40%" y="-20%" width="180%" height="180%">
              <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="rgba(0,0,0,0.5)"/>
            </filter>
          </defs>
          <path d="M${cx},${pinH - 1} C${cx},${pinH - 1} ${strokeW},${bodyH} ${strokeW},${r} A${r - strokeW},${r - strokeW} 0 1 1 ${pinW - strokeW},${r} C${pinW - strokeW},${bodyH} ${cx},${pinH - 1} ${cx},${pinH - 1}Z"
            fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" filter="url(#${shadowId})"/>
          <text text-anchor="middle" dominant-baseline="middle" font-family="'Courier New',monospace" font-weight="900" fill="${numColor}"
            y="${done ? r : isNext ? r - 3 : r}">
            ${topLabel}
          </text>
        </svg>`.trim();

      const icon = L.divIcon({
        html: svgPin,
        className: "",
        iconSize: [pinW, pinH],
        iconAnchor: [pinW / 2, pinH],
        popupAnchor: [0, -pinH],
      });

      L.marker([stop.lat, stop.lng], { icon })
        .addTo(map)
        .bindPopup(`<b style="font-size:13px;">${stop.name || stop.address}</b><br><span style="font-size:11px;color:#888;">${stop.city}</span>${done ? "<br><span style='color:#4CAF50;font-size:11px;'>✓ Delivered</span>" : ""}`);
    });

    // Live truck location — blue pulsing dot
    let userMarker = null;
    let watchId = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          if (!destroyed) {
            if (userMarker) {
              userMarker.setLatLng([lat, lng]);
            } else {
              const userIcon = L.divIcon({
                html: `<div style="width:20px;height:20px;border-radius:50%;background:#4A90E2;border:3px solid #fff;box-shadow:0 0 0 4px rgba(74,144,226,0.35)"></div>`,
                className: "",
                iconSize: [20, 20],
                iconAnchor: [10, 10],
              });
              userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
              userMarker.bindPopup("<b>You are here</b>");
            }
          }
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );
    }

    const controller = new AbortController();

    return () => {
      destroyed = true;
      controller.abort();
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      try { map.remove(); } catch (e) {}
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <div ref={containerRef} style={{ width: "100%", height: "calc(100dvh - 120px)" }} />
      <div style={{ display: "flex", gap: 16, padding: "10px 20px", borderTop: "1px solid #14142A", justifyContent: "center", background: "#0A0A18" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#3A3A5C" }}>
          <div style={{ width: 10, height: 13, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "#fff", border: "2px solid #00C8FF" }} /> Next
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#3A3A5C" }}>
          <div style={{ width: 10, height: 13, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "#F59E0B" }} /> Business
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#3A3A5C" }}>
          <div style={{ width: 10, height: 13, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "#22D47A" }} /> Residential
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#3A3A5C" }}>
          <div style={{ width: 10, height: 13, borderRadius: "50% 50% 50% 50% / 60% 60% 40% 40%", background: "#2A2A45" }} /> Done
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#3A3A5C" }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4A90E2", border: "2px solid #0A0A18", boxShadow: "0 0 0 2px rgba(74,144,226,0.4)" }} /> You
        </div>
      </div>
    </div>
  );
}

const styles = {
  shell: {
    height: "100dvh",
    background: "#111",
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Courier New', Courier, monospace",
    position: "relative",
    overflow: "hidden",
    maxWidth: 500,
    margin: "0 auto",
  },
  screen: {
    flex: 1,
    overflowY: "auto",
    padding: "0 0 80px",
    scrollbarWidth: "none",
  },

  // HOME
  homeHero: {
    padding: "32px 28px 24px",
    borderBottom: "1px solid #1e1e1e",
    background: "linear-gradient(160deg, #111 60%, #1a1200 100%)",
  },
  logoMark: {
    fontSize: 36,
    color: "#00C8FF",
    display: "block",
    marginBottom: 8,
  },
  appTitle: {
    margin: 0,
    fontSize: 28,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: "0.05em",
    lineHeight: 1.1,
    textTransform: "uppercase",
  },
  appTagline: {
    margin: "8px 0 0",
    fontSize: 12,
    color: "#666",
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },
  homeStats: {
    display: "flex",
    gap: 8,
    padding: "16px 20px",
    borderBottom: "1px solid #1a1a1a",
  },
  statCard: {
    flex: 1,
    background: "#0D0D1C",
    borderRadius: 12,
    padding: "12px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    border: "1px solid #1E1E35",
  },
  statNum: { fontSize: 22, fontWeight: "bold", color: "#00C8FF" },
  statLabel: { fontSize: 9, color: "#3A3A5C", textTransform: "uppercase", letterSpacing: 1, marginTop: 2, textAlign: "center" },
  primaryBtn: {
    margin: "0",
    width: "100%",
    padding: "16px",
    background: "#00C8FF",
    color: "#000",
    border: "none",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: "0.1em",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontFamily: "inherit",
  },
  btnIcon: { fontSize: 18 },
  homeTips: {
    padding: "20px 24px 0",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  tipRow: { display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#555" },
  tipDot: { width: 6, height: 6, borderRadius: "50%", background: "#00C8FF", flexShrink: 0 },

  // NAV BAR
  navBar: {
    position: "sticky",
    top: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px 10px",
    borderBottom: "1px solid #14142A",
    background: "#0A0A18",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#00C8FF",
    fontSize: 16,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "8px 12px 8px 0",
    minWidth: 60,
    minHeight: 44,
  },
  navTitle: { fontSize: 14, fontWeight: "bold", color: "#E8E8FF", letterSpacing: "0.08em", textTransform: "uppercase" },
  stopCount: { fontSize: 12, color: "#00C8FF", fontWeight: "bold" },

  // CAPTURE
  captureInstructions: {
    padding: "16px 24px",
    borderBottom: "1px solid #1a1a1a",
  },
  instrText: { margin: 0, fontSize: 13, color: "#888", lineHeight: 1.6, textAlign: "center" },
  photoGrid: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    padding: "16px 20px",
  },
  photoThumb: {
    width: 100,
    height: 130,
    borderRadius: 10,
    overflow: "hidden",
    position: "relative",
    border: "2px solid #00C8FF",
    background: "#0D0D1C",
  },
  thumbImg: { width: "100%", height: "100%", objectFit: "cover" },
  thumbLabel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    background: "rgba(0,0,0,0.7)",
    fontSize: 10,
    color: "#fff",
    textAlign: "center",
    padding: "3px 0",
  },
  removeBtn: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 20,
    height: 20,
    borderRadius: "50%",
    background: "#ff4444",
    color: "#fff",
    border: "none",
    fontSize: 10,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoBtn: {
    width: 100,
    height: 130,
    borderRadius: 10,
    border: "2px dashed #333",
    background: "transparent",
    color: "#555",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  captureBottom: {
    padding: "0 20px",
  },
  photoCount: { textAlign: "center", fontSize: 12, color: "#888", marginBottom: 12 },
  demoNote: {
    padding: "24px 24px 0",
  },
  demoNoteText: { fontSize: 12, color: "#555", lineHeight: 1.6 },

  // PROCESSING
  processingWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "60px 28px 40px",
    gap: 40,
  },
  processingRing: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    border: "4px solid #00C8FF",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 28px rgba(0,200,255,0.35)",
    animation: "spin 2s linear infinite",
  },
  processingInner: {
    width: 90,
    height: 90,
    borderRadius: "50%",
    background: "#070714",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  processingPct: { fontSize: 22, fontWeight: "bold", color: "#00C8FF" },
  processingSteps: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    width: "100%",
  },
  processingStep: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    fontSize: 13,
    transition: "all 0.3s ease",
  },
  stepIcon: { fontSize: 14, width: 20, textAlign: "center" },

  // RESULTS
  routeSummary: {
    display: "flex",
    gap: 8,
    padding: "12px 20px",
    borderBottom: "1px solid #1a1a1a",
  },
  summaryChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#0D0D1C",
    borderRadius: 20,
    padding: "5px 10px",
    fontSize: 11,
    color: "#B0B0D0",
    border: "1px solid #1E1E35",
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#00C8FF",
    flexShrink: 0,
  },
  stopList: {
    padding: "12px 16px",
  },
  listSectionLabel: {
    fontSize: 10,
    color: "#444",
    letterSpacing: "0.15em",
    marginBottom: 8,
    paddingLeft: 4,
  },
  stopCard: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    background: "#0D0D1C",
    borderRadius: 10,
    padding: "12px 12px",
    marginBottom: 8,
    cursor: "pointer",
    border: "1px solid #1E1E35",
    transition: "opacity 0.2s",
  },
  stopSeq: {
    fontSize: 11,
    color: "#3A3A5C",
    width: 24,
    textAlign: "center",
    flexShrink: 0,
  },
  stopInfo: { flex: 1, minWidth: 0 },
  stopName: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#F59E0B",
    marginBottom: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  stopAddr: {
    fontSize: 13,
    color: "#C8C8E8",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  stopCity: {
    fontSize: 11,
    color: "#3A3A5C",
    marginTop: 2,
  },
  stopRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  stopTypeBadge: { fontSize: 14 },
  checkBtn: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    cursor: "pointer",
    fontSize: 11,
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  },

  // DETAIL
  detailCard: {
    margin: "16px 20px",
    background: "#0D0D1C",
    borderRadius: 16,
    padding: "20px",
    border: "1px solid #1E1E35",
  },
  detailBadge: {
    fontSize: 11,
    color: "#00C8FF",
    letterSpacing: "0.12em",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  detailName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#E8E8FF",
    marginBottom: 6,
  },
  detailAddress: {
    fontSize: 15,
    color: "#B0B0D0",
    marginBottom: 4,
  },
  detailCity: {
    fontSize: 13,
    color: "#4A4A70",
  },
  notesWrap: {
    margin: "12px 20px 0",
  },
  notesLabel: {
    fontSize: 10,
    color: "#353555",
    letterSpacing: "0.15em",
    marginBottom: 6,
  },
  notesInput: {
    width: "100%",
    background: "#0D0D1C",
    border: "1px solid #1E1E35",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 13,
    color: "#C8C8E8",
    fontFamily: "'Courier New', Courier, monospace",
    outline: "none",
    boxSizing: "border-box",
  },
  notesTextarea: {
    width: "100%",
    background: "#0D0D1C",
    border: "1px solid #1E1E35",
    borderRadius: 10,
    padding: "14px",
    fontSize: 13,
    color: "#C8C8E8",
    fontFamily: "'Courier New', Courier, monospace",
    outline: "none",
    boxSizing: "border-box",
    resize: "none",
    lineHeight: 1.6,
    display: "block",
  },
  saveNoteBtn: {
    marginTop: 8,
    width: "100%",
    padding: "12px",
    background: "#0A0A18",
    color: "#00C8FF",
    border: "1px solid #00C8FF",
    borderRadius: 10,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: "0.1em",
    cursor: "pointer",
    fontFamily: "inherit",
  },
  detailActions: {
    padding: "0 20px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  navBtn: {
    width: "100%",
    padding: "14px",
    background: "#0D0D1C",
    color: "#C8C8E8",
    border: "1px solid #1E1E35",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: "bold",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.05em",
  },
  completeBtn: {
    width: "100%",
    padding: "14px",
    background: "#22D47A",
    color: "#000",
    border: "none",
    borderRadius: 12,
    fontSize: 14,
    fontWeight: "900",
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.1em",
  },
  detailMeta: {
    margin: "16px 20px 0",
    background: "#0D0D1C",
    borderRadius: 12,
    padding: "4px 16px",
    border: "1px solid #1E1E35",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid #14142A",
    fontSize: 13,
  },
  metaLabel: { color: "#3A3A5C" },
  metaVal: { color: "#C8C8E8", fontWeight: "bold" },
  nextUpWrap: { padding: "16px 20px 0" },
  nextUpLabel: { fontSize: 10, color: "#353555", letterSpacing: "0.15em", marginBottom: 8 },
  nextUpCard: {
    background: "#0D0D1C",
    borderRadius: 10,
    padding: "12px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#5A5A80",
    border: "1px solid #1E1E35",
  },
  nextUpType: { fontSize: 16 },

  // BOTTOM NAV
  bottomNav: {
    position: "fixed",
    bottom: 0,
    left: 0,
    right: 0,
    maxWidth: 500,
    margin: "0 auto",
    display: "flex",
    background: "#0A0A18",
    borderTop: "1px solid #14142A",
    padding: "8px 0 env(safe-area-inset-bottom, 16px)",
    zIndex: 100,
  },
  navTab: {
    flex: 1,
    background: "none",
    border: "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    fontSize: 10,
    cursor: "pointer",
    fontFamily: "inherit",
    letterSpacing: "0.05em",
    textTransform: "uppercase",
  },
  navTabIcon: { fontSize: 18 },
};
