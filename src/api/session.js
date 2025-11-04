// src/api/session.js

const DEFAULT_HOST =
  typeof window !== "undefined" ? window.location.hostname : "localhost";

export const API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_BASE) ||
  `http://${DEFAULT_HOST}:8080`;

// 빈 문자열을 null로 치환 (방어적)
function normalizeMeasurements(measurements = {}) {
  const out = { ...measurements };
  for (const k of Object.keys(out)) {
    if (out[k] === "" || out[k] === undefined) out[k] = null;
  }
  return out;
}

/**
 * 정규화된 페이로드(user/measurements/surveys) 전송
 * @returns {Promise<{ planMd: string, evidence: Array, traceId: string, raw: any }>}
 */
export async function sendSessionSummary({ user, measurements, surveys, signal }) {
  const url = `${API_BASE}/session_summary`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user,
      measurements: normalizeMeasurements(measurements),
      surveys,
    }),
    signal,
  });

  const text = await resp.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    // Results.jsx에서 메시지 보여줄 수 있도록 에러 throw
    const detail = typeof data === "object" ? JSON.stringify(data) : String(data);
    throw new Error(`HTTP ${resp.status} ${detail}`);
  }

  // ✅ 서버 구조에 맞춰 추출
  const planMd   = data?.planText?.planText ?? "";
  const evidence = Array.isArray(data?.evidence) ? data.evidence : [];
  const traceId  = data?.trace_id ?? "";

  // 기존과의 호환을 위해 raw도 그대로 반환
  return { planMd, evidence, traceId, raw: data };
}
