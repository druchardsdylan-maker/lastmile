import { useState, useRef } from "react";

const screens = {
  HOME: "HOME",
  CAPTURE: "CAPTURE",
  PROCESSING: "PROCESSING",
  RESULTS: "RESULTS",
  STOP_DETAIL: "STOP_DETAIL",
};

const mockStops = [
  { id: 1, address: "1420 Harbor Blvd", city: "Weehawken, NJ 07086", type: "business", name: "Harbor Freight Tools", priority: 1, seq: 1 },
  { id: 2, address: "88 Pine St", city: "Jersey City, NJ 07302", type: "business", name: "Pine St Deli & Market", priority: 2, seq: 2 },
  { id: 3, address: "245 Washington St", city: "Hoboken, NJ 07030", type: "business", name: "Washington Pharmacy", priority: 3, seq: 3 },
  { id: 4, address: "31 Elm Ct", city: "Secaucus, NJ 07094", type: "residential", name: "", priority: 4, seq: 4 },
  { id: 5, address: "7 Maple Dr", city: "North Bergen, NJ 07047", type: "residential", name: "", priority: 5, seq: 5 },
  { id: 6, address: "502 Kennedy Blvd", city: "Bayonne, NJ 07002", type: "business", name: "Kennedy Auto Parts", priority: 6, seq: 6 },
  { id: 7, address: "19 Oak Ave", city: "Kearny, NJ 07032", type: "residential", name: "", priority: 7, seq: 7 },
  { id: 8, address: "1100 Raymond Blvd", city: "Newark, NJ 07102", type: "business", name: "Raymond Office Supply", priority: 8, seq: 8 },
  { id: 9, address: "66 Cedar Lane", city: "Rutherford, NJ 07070", type: "residential", name: "", priority: 9, seq: 9 },
  { id: 10, address: "330 Market St", city: "Saddle Brook, NJ 07663", type: "business", name: "Market Fresh Grocery", priority: 10, seq: 10 },
];

export default function App() {
  const [screen, setScreen] = useState(screens.HOME);
  const [photos, setPhotos] = useState([]);
  const [processingStep, setProcessingStep] = useState(0);
  const [activeStop, setActiveStop] = useState(null);
  const [completedStops, setCompletedStops] = useState([]);
  const fileRef = useRef();

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
    }));
    setPhotos((p) => [...p, ...newPhotos]);
  }

  function handleProcess() {
    setScreen(screens.PROCESSING);
    setProcessingStep(0);
    let step = 0;
    const interval = setInterval(() => {
      step++;
      setProcessingStep(step);
      if (step >= processingSteps.length - 1) {
        clearInterval(interval);
        setTimeout(() => setScreen(screens.RESULTS), 700);
      }
    }, 700);
  }

  function toggleComplete(id) {
    setCompletedStops((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const businesses = mockStops.filter((s) => s.type === "business");
  const residential = mockStops.filter((s) => s.type === "residential");
  const orderedStops = [...businesses, ...residential];
  const remaining = orderedStops.filter((s) => !completedStops.includes(s.id));
  const done = orderedStops.filter((s) => completedStops.includes(s.id));

  return (
    <div style={styles.shell}>
      <div style={styles.phone}>
        {/* Status bar */}
        <div style={styles.statusBar}>
          <span style={styles.statusTime}>9:41</span>
          <div style={styles.statusIcons}>
            <span>▲▲▲</span>
            <span>WiFi</span>
            <span>🔋</span>
          </div>
        </div>

        {/* HOME */}
        {screen === screens.HOME && (
          <div style={styles.screen}>
            <div style={styles.homeHero}>
              <div style={styles.logoMark}>⟳</div>
              <h1 style={styles.appTitle}>RIGHT HAND<br />TURN PRO</h1>
              <p style={styles.appTagline}>Smart routing. Every stop. Every time.</p>
            </div>

            <div style={styles.homeStats}>
              <div style={styles.statCard}>
                <span style={styles.statNum}>0</span>
                <span style={styles.statLabel}>Today's Routes</span>
              </div>
              <div style={styles.statCard}>
                <span style={styles.statNum}>0</span>
                <span style={styles.statLabel}>Stops Done</span>
              </div>
              <div style={styles.statCard}>
                <span style={styles.statNum}>—</span>
                <span style={styles.statLabel}>Avg Time</span>
              </div>
            </div>

            <button style={styles.primaryBtn} onClick={() => setScreen(screens.CAPTURE)}>
              <span style={styles.btnIcon}>📸</span>
              NEW ROUTE
            </button>

            <div style={styles.homeTips}>
              <div style={styles.tipRow}><span style={styles.tipDot} />Businesses auto-prioritized first</div>
              <div style={styles.tipRow}><span style={styles.tipDot} />Right-turn optimized path</div>
              <div style={styles.tipRow}><span style={styles.tipDot} />Snap multiple DIAD screens</div>
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

            <div style={styles.captureInstructions}>
              <p style={styles.instrText}>Photograph each DIAD screen.<br />All stops will be extracted automatically.</p>
            </div>

            <input
              ref={fileRef}
              type="file"
              accept="image/*"
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
                    style={{ color: "#F5A623", cursor: "pointer", textDecoration: "underline" }}
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
                  <span style={styles.processingPct}>
                    {Math.round((processingStep / (processingSteps.length - 1)) * 100)}%
                  </span>
                </div>
              </div>

              <div style={styles.processingSteps}>
                {processingSteps.map((step, i) => (
                  <div
                    key={i}
                    style={{
                      ...styles.processingStep,
                      opacity: i <= processingStep ? 1 : 0.25,
                      color: i === processingStep ? "#F5A623" : i < processingStep ? "#4CAF50" : "#666",
                    }}
                  >
                    <span style={styles.stepIcon}>
                      {i < processingStep ? "✓" : i === processingStep ? "▶" : "○"}
                    </span>
                    {step}
                  </div>
                ))}
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
              <span style={styles.stopCount}>{remaining.length} left</span>
            </div>

            <div style={styles.routeSummary}>
              <div style={styles.summaryChip}>
                <span style={styles.chipDot} />
                {businesses.length} Business
              </div>
              <div style={{ ...styles.summaryChip, background: "#1a2a1a" }}>
                <span style={{ ...styles.chipDot, background: "#4CAF50" }} />
                {residential.length} Residential
              </div>
              <div style={{ ...styles.summaryChip, background: "#2a1a00" }}>
                <span style={{ ...styles.chipDot, background: "#F5A623" }} />
                {mockStops.length} Total
              </div>
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
              <div style={styles.detailBadge}>
                {activeStop.type === "business" ? "🏢 BUSINESS" : "🏠 RESIDENTIAL"}
              </div>
              {activeStop.name && <div style={styles.detailName}>{activeStop.name}</div>}
              <div style={styles.detailAddress}>{activeStop.address}</div>
              <div style={styles.detailCity}>{activeStop.city}</div>
            </div>

            <div style={styles.detailActions}>
              <button style={styles.navBtn}>
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

        {/* Bottom nav */}
        {(screen === screens.HOME || screen === screens.RESULTS) && (
          <div style={styles.bottomNav}>
            <button
              style={{ ...styles.navTab, color: screen === screens.HOME ? "#F5A623" : "#555" }}
              onClick={() => { setScreen(screens.HOME); setCompletedStops([]); setPhotos([]); }}
            >
              <span style={styles.navTabIcon}>⌂</span>
              Home
            </button>
            <button
              style={{ ...styles.navTab, color: screen === screens.RESULTS ? "#F5A623" : "#555" }}
              onClick={() => screen !== screens.RESULTS && setScreen(screens.CAPTURE)}
            >
              <span style={styles.navTabIcon}>+</span>
              Route
            </button>
            <button style={{ ...styles.navTab, color: "#555" }}>
              <span style={styles.navTabIcon}>◷</span>
              History
            </button>
            <button style={{ ...styles.navTab, color: "#555" }}>
              <span style={styles.navTabIcon}>⚙</span>
              Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StopCard({ stop, onTap, onComplete, completed }) {
  return (
    <div
      style={{
        ...styles.stopCard,
        opacity: completed ? 0.45 : 1,
        borderLeft: `3px solid ${stop.type === "business" ? "#F5A623" : "#4CAF50"}`,
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
        <div style={styles.stopTypeBadge}>
          {stop.type === "business" ? "🏢" : "🏠"}
        </div>
        <button
          style={{
            ...styles.checkBtn,
            background: completed ? "#4CAF50" : "transparent",
            border: `2px solid ${completed ? "#4CAF50" : "#333"}`,
          }}
          onClick={(e) => { e.stopPropagation(); onComplete(); }}
        >
          {completed ? "✓" : ""}
        </button>
      </div>
    </div>
  );
}

const styles = {
  shell: {
    minHeight: "100vh",
    background: "#0a0a0a",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "'Courier New', Courier, monospace",
    padding: "24px 0",
  },
  phone: {
    width: 390,
    minHeight: 844,
    background: "#111",
    borderRadius: 48,
    overflow: "hidden",
    boxShadow: "0 0 0 8px #1a1a1a, 0 0 0 10px #222, 0 40px 80px rgba(0,0,0,0.8)",
    display: "flex",
    flexDirection: "column",
    position: "relative",
    border: "1px solid #2a2a2a",
  },
  statusBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 24px 4px",
    background: "#111",
  },
  statusTime: { fontSize: 13, fontWeight: "bold", color: "#fff", letterSpacing: 1 },
  statusIcons: { display: "flex", gap: 6, fontSize: 10, color: "#888" },
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
    color: "#F5A623",
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
    background: "#161616",
    borderRadius: 12,
    padding: "12px 8px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    border: "1px solid #222",
  },
  statNum: { fontSize: 22, fontWeight: "bold", color: "#F5A623" },
  statLabel: { fontSize: 9, color: "#555", textTransform: "uppercase", letterSpacing: 1, marginTop: 2, textAlign: "center" },
  primaryBtn: {
    margin: "20px 20px 0",
    width: "calc(100% - 40px)",
    padding: "16px",
    background: "#F5A623",
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
  tipDot: { width: 6, height: 6, borderRadius: "50%", background: "#F5A623", flexShrink: 0 },

  // NAV BAR
  navBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 20px 10px",
    borderBottom: "1px solid #1a1a1a",
    background: "#111",
  },
  backBtn: {
    background: "none",
    border: "none",
    color: "#F5A623",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: 0,
  },
  navTitle: { fontSize: 14, fontWeight: "bold", color: "#fff", letterSpacing: "0.05em", textTransform: "uppercase" },
  stopCount: { fontSize: 12, color: "#F5A623", fontWeight: "bold" },

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
    border: "2px solid #F5A623",
    background: "#1a1a1a",
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
    border: "4px solid #F5A623",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 0 24px rgba(245,166,35,0.3)",
    animation: "spin 2s linear infinite",
  },
  processingInner: {
    width: 90,
    height: 90,
    borderRadius: "50%",
    background: "#1a1400",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  processingPct: { fontSize: 22, fontWeight: "bold", color: "#F5A623" },
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
    background: "#1a1200",
    borderRadius: 20,
    padding: "5px 10px",
    fontSize: 11,
    color: "#ccc",
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#F5A623",
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
    background: "#161616",
    borderRadius: 10,
    padding: "12px 12px",
    marginBottom: 8,
    cursor: "pointer",
    border: "1px solid #1e1e1e",
    transition: "opacity 0.2s",
  },
  stopSeq: {
    fontSize: 11,
    color: "#555",
    width: 24,
    textAlign: "center",
    flexShrink: 0,
  },
  stopInfo: { flex: 1, minWidth: 0 },
  stopName: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#F5A623",
    marginBottom: 2,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  stopAddr: {
    fontSize: 13,
    color: "#ddd",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  stopCity: {
    fontSize: 11,
    color: "#555",
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
    background: "#161616",
    borderRadius: 16,
    padding: "20px",
    border: "1px solid #2a2a2a",
  },
  detailBadge: {
    fontSize: 11,
    color: "#F5A623",
    letterSpacing: "0.1em",
    marginBottom: 10,
    textTransform: "uppercase",
  },
  detailName: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#fff",
    marginBottom: 6,
  },
  detailAddress: {
    fontSize: 15,
    color: "#ccc",
    marginBottom: 4,
  },
  detailCity: {
    fontSize: 13,
    color: "#666",
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
    background: "#1a1a1a",
    color: "#fff",
    border: "1px solid #333",
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
    background: "#F5A623",
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
    background: "#161616",
    borderRadius: 12,
    padding: "4px 16px",
    border: "1px solid #1e1e1e",
  },
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "10px 0",
    borderBottom: "1px solid #1e1e1e",
    fontSize: 13,
  },
  metaLabel: { color: "#555" },
  metaVal: { color: "#ccc", fontWeight: "bold" },
  nextUpWrap: { padding: "16px 20px 0" },
  nextUpLabel: { fontSize: 10, color: "#444", letterSpacing: "0.15em", marginBottom: 8 },
  nextUpCard: {
    background: "#161616",
    borderRadius: 10,
    padding: "12px 16px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: 13,
    color: "#888",
    border: "1px solid #1e1e1e",
  },
  nextUpType: { fontSize: 16 },

  // BOTTOM NAV
  bottomNav: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    display: "flex",
    background: "#111",
    borderTop: "1px solid #1e1e1e",
    padding: "8px 0 20px",
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
