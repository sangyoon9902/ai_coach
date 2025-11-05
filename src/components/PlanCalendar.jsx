// src/components/PlanCalendar.jsx
import React, { useMemo, useState } from "react";

/* =========================================================
 * PlanCalendar (v3, 카드형 처방 텍스트 전용)
 * - 입력: "종목\n<값>\n빈도(F)\n<값>\n강도(I)\n<값> ..." 식의 카드 3장(유산소/근력/유연성)
 * - 달력: 유산소=월·수·금 / 근력=화·목 / 유연성=평일 분배(빈도만큼)
 * - 셀: 종목명만 칩에 표시
 * - 클릭: 라벨+값 카드(🎬/CSV 포함) 모달로 표시
 * - ICS: 종목명/시간/강도/빈도 등 포함
 * ========================================================= */

/* ───────── 공통 파서 (PlanCards v3와 동일 규칙) ───────── */

// 카드 블록 분할: "종목" 라인이 새로 시작될 때
function splitIntoCardBlocks(full) {
  if (!full) return [];
  return full
    .replace(/\r\n/g, "\n")
    .split(/\n(?=종목\s*$)/m)
    .map((s) => s.trim())
    .filter((b) => b && /^종목\s*$/m.test((b.split("\n")[0] || "")));
}

// 라벨 다음 "한 줄"만 값을 취함 (백엔드가 라벨줄+값줄 보장)
function valueAfterSingleLine(block, label) {
  const re = new RegExp(`^${escapeRegExp(label)}\\s*$`, "m");
  const m = block.match(re);
  if (!m) return "";
  const after = block.slice(m.index + m[0].length);
  const next = (after.match(/^\s*\n?([^\n]+)\n?/m) || [])[1] || "";
  return next.trim();
}
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTypeLine(typeLine) {
  const url   = (typeLine.match(/https?:\/\/[^\s)]+/i) || [])[0] || "";
  const title = ((typeLine.match(/대표영상:\s*([^()]+)\s*\(/) || [])[1] || "").trim();
  const names = (typeLine.split("· 대표영상:")[0] || "").trim();
  return { url, title, names };
}
function pickCsvId(block) {
  const m = block.match(/CSV\s*:\s*(\d+)/i);
  return (m && m[1]) || "";
}
function pickMovieTitle(block) {
  const m = block.match(/^\s*🎬\s*([^\n]+)\s*$/m);
  return (m && m[1].trim()) || "";
}
function pickParenMovieTitle(block) {
  const m = block.match(/\(대표영상:\s*([^)]+)\)/);
  return (m && m[1].trim()) || "";
}

function parseCardsFromPlan(planMd) {
  const blocks = splitIntoCardBlocks(planMd || "");
  return blocks.map((block, idx) => {
    const subject = valueAfterSingleLine(block, "종목");
    const freq    = valueAfterSingleLine(block, "빈도(F)");
    const inten   = valueAfterSingleLine(block, "강도(I)");
    const time    = valueAfterSingleLine(block, "시간(T)");
    const typeRaw = valueAfterSingleLine(block, "유형(T)");
    const sets    = valueAfterSingleLine(block, "세트/반복/휴식");
    const caut    = valueAfterSingleLine(block, "주의/대안");
    const rule    = valueAfterSingleLine(block, "진행규칙·주의");

    const yt  = parseTypeLine(typeRaw);
    const csv = pickCsvId(block);
    const movieA = pickMovieTitle(block);
    const movieB = pickParenMovieTitle(block);
    const movieTitle = yt.title || movieA || movieB || "";

    return {
      idx,
      subject,                 // 칩/ICS summary 표시용
      freqText: freq,          // "주 3회"
      inten,
      time,
      typeRaw,
      sets,
      caut,
      rule,
      evid: { csv },
      yt: { ...yt, title: movieTitle || yt.title, names: yt.names },
      _raw: block,             // 모달 원문 카드 렌더링용
    };
  });
}

/* ───────── 분배 로직 ───────── */

// 빈도 숫자만 뽑기 ("주 3회" -> 3)
function extractFreqNum(freqText, defaultN) {
  if (!freqText) return defaultN;
  const m = freqText.match(/주?\s*(\d+)\s*회?/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isNaN(n)) return n;
  }
  return defaultN;
}

// 카드가 유산소/근력/유연성인지 추론
function inferKind(card, fallbackIndex) {
  const sub = (card.subject || "");
  const ty  = (card.typeRaw || "");
  const it  = (card.inten || "");

  const cardioHints = /(달리기|조깅|자전거|사이클|수영|줄넘기|워킹|bpm|RPE|심박|유산소)/i;
  const strengthHints = /(1RM|세트|반복|스쿼트|푸시업|플랭크|버티기|근력|근지구력)/i;
  const flexHints = /(스트레칭|유연성|통증 없는 범위|가동성)/i;

  if (cardioHints.test(sub) || cardioHints.test(ty) || cardioHints.test(it)) return "cardio";
  if (strengthHints.test(sub) || strengthHints.test(ty) || strengthHints.test(it)) return "strength";
  if (flexHints.test(sub) || flexHints.test(ty) || flexHints.test(it)) return "flex";

  // 위치 기반 보정: 0=유산소, 1=근력, 2=유연성
  if (fallbackIndex === 0) return "cardio";
  if (fallbackIndex === 1) return "strength";
  if (fallbackIndex === 2) return "flex";
  return "cardio";
}

function buildWeeklyTemplateFromCards(cards) {
  // 요일(1~7, Mon~Sun) → entries[]
  const template = {}; for (let i = 1; i <= 7; i++) template[i] = [];

  const cardioDays   = [1, 3, 5];   // 월 수 금
  const strengthDays = [2, 4];      // 화 목
  const flexDays     = [1, 2, 3, 4, 5]; // 평일

  // 카드별 빈도 추출 및 분배
  cards.forEach((card, i) => {
    const kind = inferKind(card, i);
    let freq = 0;
    if (kind === "cardio")   freq = extractFreqNum(card.freqText, 3);
    if (kind === "strength") freq = extractFreqNum(card.freqText, 2);
    if (kind === "flex")     freq = extractFreqNum(card.freqText, flexDays.length);

    if (kind === "cardio") {
      for (let k = 0; k < freq; k++) {
        const wd = cardioDays[k % cardioDays.length];
        template[wd].push({ ...card, title: "유산소", kind });
      }
    } else if (kind === "strength") {
      for (let k = 0; k < freq; k++) {
        const wd = strengthDays[k % strengthDays.length];
        template[wd].push({ ...card, title: "근력", kind });
      }
    } else {
      // 유연성: 평일 순서대로 freq만큼
      for (let k = 0; k < freq && k < flexDays.length; k++) {
        const wd = flexDays[k];
        template[wd].push({ ...card, title: "유연성", kind });
      }
    }
  });

  return template;
}

/* ───────── 날짜/ICS 유틸 ───────── */
function startOfWeek(d, weekStartsOn = 1) {
  const date = new Date(d || Date.now());
  const day = date.getDay(); // 0=Sun ... 6=Sat
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  date.setDate(date.getDate() - diff);
  date.setHours(9, 0, 0, 0);
  return date;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fmtDate(date) { return date.toISOString().slice(0, 10); }

function guessDuration(timeText) {
  if (!timeText) return 30;
  const m = timeText.match(/(\d+)\s*분/);
  if (m) return Number(m[1]);
  const xs = timeText.match(/(\d+)\s*초\s*[×xX*]\s*(\d+)(?:\s*(?:세트|회))?/);
  if (xs) return Math.ceil((Number(xs[1]) * Number(xs[2])) / 60);
  const sec = timeText.match(/(\d+)\s*초/);
  if (sec) return Math.ceil(Number(sec[1]) / 60);
  return 30;
}

function fmtLocalForICS(dt) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = dt.getFullYear();
  const M = pad(dt.getMonth() + 1);
  const d = pad(dt.getDate());
  const h = pad(dt.getHours());
  const m = pad(dt.getMinutes());
  const s = pad(dt.getSeconds());
  return `${y}${M}${d}T${h}${m}${s}`;
}
function makeIcs(events) {
  const now = new Date();
  const dtstamp = fmtLocalForICS(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Fitness//Exercise Plan//KR",
  ];
  for (const ev of events) {
    const dtStart = new Date(ev.date);
    const dtEnd = new Date(dtStart.getTime() + (ev.durationMin || 30) * 60000);
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${fmtLocalForICS(dtStart)}`);
    lines.push(`DTEND:${fmtLocalForICS(dtEnd)}`);
    lines.push(`SUMMARY:${ev.summary}`);
    if (ev.description) lines.push(`DESCRIPTION:${ev.description.replace(/\n/g, "\\n")}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/* ───────── 스타일/UI ───────── */
function pillColor(kind) {
  if (kind === "cardio") return { background: "#eef6ff", borderColor: "#bfdbfe", color: "#1d4ed8" };
  if (kind === "strength") return { background: "#ecfdf5", borderColor: "#a7f3d0", color: "#047857" };
  return { background: "#fefce8", borderColor: "#fde68a", color: "#92400e" }; // flex
}
const S = {
  wrap: { background: "#fff", border: "1px solid rgba(2,6,23,.06)", borderRadius: 12, padding: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  h1: { fontSize: 18, fontWeight: 900 },
  sub: { fontSize: 12, color: "#64748b" },
  ghostBtn: {
    padding: "8px 12px", borderRadius: 10, border: "1px solid #cbd5e1", background: "#fff",
    fontWeight: 700, fontSize: 13, cursor: "pointer"
  },

  weekHeader: {
    display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, padding: "6px 4px",
    background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 700
  },
  colHead: { textAlign: "center", color: "#334155" },

  weekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 },
  dayCell: {
    minHeight: 110, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8,
    display: "grid", gridTemplateRows: "auto 1fr", background: "#ffffff"
  },
  date: { fontSize: 12, color: "#64748b", textAlign: "right" },
  empty: { fontSize: 12, color: "#94a3b8", border: "1px dashed #e2e8f0", borderRadius: 8, padding: "6px 8px", textAlign: "center" },

  pill: {
    textAlign: "center", border: "1px solid", padding: "10px 10px", borderRadius: 10,
    fontSize: 12, fontWeight: 800, display: "block", cursor: "pointer"
  },

  modal: {
    position: "fixed", inset: 0, background: "rgba(15,23,42,.25)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50
  },
  modalCard: {
    background: "#fffef7",
    borderRadius: 12,
    padding: 16,
    width: 520,
    boxShadow: "0 24px 60px rgba(2,6,23,.25)",
    border: "1px solid #fde68a",
    position: "relative",
  },
  close: {
    border: "1px solid #cbd5e1", background: "#fff", borderRadius: 8,
    padding: "6px 10px", cursor: "pointer"
  },
  memoTitle: { fontWeight: 900, fontSize: 16, marginBottom: 6, color: "#92400e" },
  memoLine: { marginTop: 4, fontSize: 14, color: "#334155" },
  pillWrap: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 },
  pillTag: {
    display: "inline-block", padding: "4px 8px", borderRadius: 999,
    fontSize: 12, fontWeight: 700, color: "#0f172a", background: "#e5e7eb", border: "1px solid #cbd5e1"
  }
};

/* =========================================================
 * Component
 * ========================================================= */
export default function PlanCalendar({
  planMd,
  weeks = 4,
  startDate,
  title = "주간 계획표",
  showToolbar = true,
  defaultStartHour = 18,
}) {
  const [selected, setSelected] = useState(null);

  // 1) 카드 파싱 (유산소/근력/유연성 3장)
  const cards = useMemo(() => parseCardsFromPlan(planMd || ""), [planMd]);

  // 2) 주간 템플릿 (요일 라우팅)
  const template = useMemo(() => buildWeeklyTemplateFromCards(cards), [cards]);

  // 3) 베이스 주(월요일 시작)
  const base = useMemo(() => startOfWeek(startDate || new Date(), 1), [startDate]);

  // 4) 주차×요일 이벤트 구성
  const weeksData = useMemo(() => {
    const out = [];
    for (let w = 0; w < weeks; w++) {
      const weekStart = addDays(base, w * 7);
      const days = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(weekStart, i);
        const weekday = ((date.getDay() + 6) % 7) + 1; // 1~7 (Mon~Sun)
        const entries = (template[weekday] || []).map((e, idx) => ({
          ...e,
          uid: `${fmtDate(date)}-${idx}-${e.kind}`,
          // 셀 칩: 종목명만 표시 → e.subject 사용
          chipLabel: e.subject || e.title,
          date: new Date(new Date(date).setHours(defaultStartHour, 0, 0, 0)),
        }));
        days.push({ date, entries });
      }
      out.push({ weekStart, days });
    }
    return out;
  }, [base, weeks, template, defaultStartHour]);

  // 5) ICS 내보내기
  function downloadIcs() {
    const events = [];
    for (const w of weeksData) {
      for (const day of w.days) {
        for (const e of day.entries) {
          events.push({
            uid: e.uid,
            date: e.date,
            summary: e.subject || e.title || "", // 종목명
            durationMin: guessDuration(e.time),
            description: [
              `유형(T): ${e.typeRaw || "-"}`,
              `시간(T): ${e.time || "-"}`,
              e.inten ? `강도(I): ${e.inten}` : "",
              e.freqText ? `빈도(F): ${e.freqText}` : "",
              e.sets ? `세트/반복/휴식: ${e.sets}` : "",
              e.caut ? `주의/대안: ${e.caut}` : "",
              e.rule ? `진행규칙·주의: ${e.rule}` : "",
              e.yt?.title ? `🎬 ${e.yt.title}` : "",
              e.yt?.url ? `URL: ${e.yt.url}` : "",
              e.evid?.csv ? `CSV:${e.evid.csv}` : "",
            ].filter(Boolean).join("\n"),
          });
        }
      }
    }
    const ics = makeIcs(events);
    const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "exercise_plan.ics";
    a.click();
    URL.revokeObjectURL(url);
  }

  const hasAny = cards.length > 0;

  return (
    <div style={S.wrap}>
      {showToolbar && (
        <div style={S.header}>
          <div>
            <div style={S.h1}>{title}</div>
            <div style={S.sub}>처방 카드(유산소·근력·유연성)를 자동 배치한 {weeks}주 루틴</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.ghostBtn} onClick={downloadIcs}>캘린더(.ics) 다운로드</button>
          </div>
        </div>
      )}

      {!hasAny && (
        <div style={{ background: "#fff7ed", border: "1px solid #fdba74", color: "#9a3412",
                      padding: 10, borderRadius: 10, fontSize: 13, marginBottom: 12 }}>
          처방 텍스트에서 카드를 찾지 못했습니다. 카드 하나는
          <b> “종목 / 빈도(F) / 강도(I) / 시간(T) / 유형(T) … + 🎬 … + CSV:####”</b> 형식이어야 합니다.
        </div>
      )}

      {/* 요일 헤더 */}
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, padding: "6px 4px",
          background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, fontWeight: 700
        }}>
          {["월","화","수","목","금","토","일"].map((d) => (
            <div key={d} style={{ textAlign: "center", color: "#334155" }}>{d}</div>
          ))}
        </div>

        {/* 주간 그리드 */}
        {weeksData.map((w, wi) => (
          <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
            {w.days.map((day, di) => (
              <div key={di} style={{
                minHeight: 110, border: "1px solid #e2e8f0", borderRadius: 8, padding: 8,
                display: "grid", gridTemplateRows: "auto 1fr", background: "#ffffff"
              }}>
                <div style={{ fontSize: 12, color: "#64748b", textAlign: "right" }}>{day.date.getDate()}</div>
                <div style={{ display: "grid", gap: 6 }}>
                  {day.entries.length === 0 && (
                    <div style={{
                      fontSize: 12, color: "#94a3b8", border: "1px dashed #e2e8f0",
                      borderRadius: 8, padding: "6px 8px", textAlign: "center"
                    }}>휴식</div>
                  )}
                  {day.entries.map((e, i) => (
                    <button
                      key={i}
                      onClick={() => setSelected({ date: day.date, card: e })}
                      style={{ ...S.pill, ...pillColor(e.kind) }}
                      title={e.title}
                    >
                      <b>{e.chipLabel}</b>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 모달: “우리가 처방한 카드” 그대로 */}
      {selected && (
        <div style={S.modal} onClick={() => setSelected(null)}>
          <div style={S.modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={S.memoTitle}>
                {fmtDate(selected.date)} · {selected.card.subject}
              </div>
              <button style={S.close} onClick={() => setSelected(null)}>닫기</button>
            </div>

            {/* 라벨+값 카드 본문 */}
            <KV label="종목" value={selected.card.subject} />
            <KV label="빈도(F)" value={selected.card.freqText} />
            <KV label="강도(I)" value={selected.card.inten} />
            <KV label="시간(T)" value={selected.card.time} />
            <KV
              label="유형(T)"
              value={
                selected.card.yt?.names
                  ? `${selected.card.yt.names}\n(대표영상: ${selected.card.yt.title || "-"})`
                  : selected.card.typeRaw
              }
            />
            <KV label="세트/반복/휴식" value={selected.card.sets} />
            <KV label="주의/대안" value={selected.card.caut} />
            <KV label="진행규칙·주의" value={selected.card.rule} />

            {/* 🎬 / CSV */}
            <div style={S.pillWrap}>
              {selected.card.yt?.title && <span style={S.pillTag}>🎬 {selected.card.yt.title}</span>}
              {selected.card.evid?.csv && <span style={S.pillTag}>CSV:{selected.card.evid.csv}</span>}
              {selected.card.yt?.url && (
                <a
                  href={selected.card.yt.url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ ...S.pillTag, textDecoration: "none", color: "#0b5cab", background: "#dee9ff", borderColor: "#b6d0ff" }}
                >
                  대표영상 보기
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── 소형 컴포넌트 ───────── */
function KV({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, marginTop: 6 }}>
      <div style={{ color: "#475569", fontWeight: 700 }}>{label}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}
