// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());

const PULSOID_TOKEN = "23f9c9d7-66f3-4f58-a68f-505500ef6b15";

// 간단 요청 로그 (디버깅용)
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.get("/api/heart-rate", async (_req, res) => {
  try {
    const r = await fetch("https://dev.pulsoid.net/api/v1/data/heart_rate/latest", {
      headers: { Authorization: `Bearer ${PULSOID_TOKEN}` },
    });

    const rawTxt = await r.text();
    if (!r.ok) return res.status(r.status).send(rawTxt);

    let raw = {};
    try { raw = JSON.parse(rawTxt); } catch {}

    const bpm =
      raw?.bpm ??
      raw?.heart_rate ??
      raw?.value ??
      raw?.data?.heart_rate ??
      null;

    const measured_at = raw?.measured_at ?? raw?.timestamp ?? Date.now();

    // ✅ 항상 평탄화해서 반환
    res.json({ heart_rate: bpm, measured_at, _proxy: "v1_flat" });
  } catch (e) {
    console.error("Pulsoid fetch error:", e);
    res.status(500).json({ error: "Failed to fetch Pulsoid" });
  }
});

const PORT = 3001;
app.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Proxy server running on http://localhost:${PORT}`)
);
