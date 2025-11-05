// src/components/PlanCards.jsx
import React, { useState } from "react";

/**
 * PlanCards (v3) — 카드 원문(라벨줄 + 값줄) 파서
 * 입력 예시(카드 1장):
 * 종목
 * 달리기
 * 빈도(F)
 * 주 3회
 * 강도(I)
 * 심박수 120~150 bpm 또는 RPE 12-15
 * 시간(T)
 * 회당 30분
 * 유형(T)
 * 달리기 · 대표영상: 달리기 (YouTube: https://www.youtube.com/watch?v=fmtLoxbuflw)
 * (대표영상: 달리기)
 * 진행규칙·주의
 * 운동 전 충분한 준비운동...
 * 🎬 달리기
 * CSV:10171
 *
 * 카드들은 빈 줄(또는 다음 "종목" 라인)로 구분됨.
 * 카드 순서: [유산소(심폐), 근력/근지구력, 유연성] 으로 가정(백엔드 보장).
 */

const CAT_ORDER = ["유산소(심폐)", "근력/근지구력", "유연성"];
const CAT_INFO = {
  "유산소(심폐)":   { color: "#0ea5e9", emoji: "🏃", bg: "#e0f2fe" },
  "근력/근지구력": { color: "#22c55e", emoji: "🏋️", bg: "#dcfce7" },
  "유연성":        { color: "#f59e0b", emoji: "🧘", bg: "#fef3c7" },
  "기타":          { color: "#334155", emoji: "📋", bg: "#f1f5f9" },
};

// 라벨 리스트 (콜론 없음! 라벨 줄 다음 줄이 값 줄)
const LABELS = [
  "종목",
  "빈도(F)",
  "강도(I)",
  "시간(T)",
  "유형(T)",
  "세트/반복/휴식",
  "주의/대안",
  "진행규칙·주의",
];

/* ───────── 파서 유틸 ───────── */

// 전체 텍스트에서 카드 블록들을 뽑는다.
// 규칙: "종목" 라인으로 시작하는 덩어리들.
function splitIntoCardBlocks(full) {
  if (!full) return [];
  // 표나 기타 부록이 없으니, "종목\n" 기준으로 안전 분할
  const parts = full
    .split(/\n(?=종목\s*$)/m) // "종목" 라인이 새로 시작되면 분할
    .map(s => s.trim())
    .filter(Boolean);

  // 혹시 첫 블록이 "종목"으로 안 시작하면 버린다
  return parts.filter(b => /^종목\s*$/m.test(b.split("\n")[0] || ""));
}

// 라벨의 값(다음 라벨 전까지가 아니라, 바로 '다음 줄' 한 줄만) 추출
// (백엔드가 '라벨줄 + 값줄' 포맷을 보장)
function valueAfterSingleLine(block, label) {
  // label 줄을 찾고 그 바로 다음 줄을 값으로 간주
  const re = new RegExp(`^${escapeRegExp(label)}\\s*$`, "m");
  const m = block.match(re);
  if (!m) return "";
  // m.index는 label 줄의 시작. 그 다음 줄을 값으로.
  const after = block.slice(m.index + m[0].length);
  // 다음 줄만 추출
  const nextLine = (after.match(/^\s*\n?([^\n]+)\n?/m) || [])[1] || "";
  return nextLine.trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 유형(T) 라인 파싱
// 예: "달리기 · 대표영상: 달리기 (YouTube: https://...)" 형태
function parseTypeLine(typeLine) {
  const url   = (typeLine.match(/https?:\/\/[^\s)]+/i) || [])[0] || "";
  const title = ((typeLine.match(/대표영상:\s*([^()]+)\s*\(/) || [])[1] || "").trim();
  const names = (typeLine.split("· 대표영상:")[0] || "").trim();
  return { url, title, names };
}

// CSV 라인 추출 ("CSV:숫자")
function pickCsvId(block) {
  const m = block.match(/CSV\s*:\s*(\d+)/i);
  return (m && m[1]) || "";
}

// 🎬 라인에서 대표영상 제목 보강
function pickMovieTitle(block) {
  const m = block.match(/^\s*🎬\s*([^\n]+)\s*$/m);
  return (m && m[1].trim()) || "";
}

// (대표영상: 제목) 단독 줄도 있을 수 있음 → 제목 보강
function pickParenMovieTitle(block) {
  const m = block.match(/\(대표영상:\s*([^)]+)\)/);
  return (m && m[1].trim()) || "";
}

function parseOneCard(block) {
  const subject = valueAfterSingleLine(block, "종목");
  const freq    = valueAfterSingleLine(block, "빈도(F)");
  const inten   = valueAfterSingleLine(block, "강도(I)");
  const time    = valueAfterSingleLine(block, "시간(T)");
  const typeRaw = valueAfterSingleLine(block, "유형(T)");
  const sets    = valueAfterSingleLine(block, "세트/반복/휴식");
  const caut    = valueAfterSingleLine(block, "주의/대안");
  const rule    = valueAfterSingleLine(block, "진행규칙·주의");

  const yt = parseTypeLine(typeRaw);
  const csv = pickCsvId(block);

  // 대표영상 제목 보강 (🎬 제목 / (대표영상: 제목))
  const movieA = pickMovieTitle(block);
  const movieB = pickParenMovieTitle(block);
  const movieTitle = yt.title || movieA || movieB || "";

  return {
    subject,
    freq,
    inten,
    time,
    type: typeRaw,
    sets,
    caut,
    rule,
    evid: { csv },
    yt: { ...yt, title: movieTitle || yt.title, names: yt.names },
    _raw: block,
  };
}

/* ───────── UI 컴포넌트 ───────── */

function Pill({ children, color = "#334155", bg = "#e2e8f0" }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        color,
        background: bg,
        border: `1px solid ${color}22`,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10 }}>
      <div style={{ color: "#475569", fontWeight: 700 }}>{label}</div>
      <div style={{ whiteSpace: "pre-wrap" }}>{value}</div>
    </div>
  );
}

function Card({ catTitle, data }) {
  const info = CAT_INFO[catTitle] || CAT_INFO["기타"];
  const showType = data.yt?.names
    ? `${data.yt.names}\n(대표영상: ${data.yt.title || "-"})`
    : data.type;

  return (
    <div
      style={{
        border: `1px solid ${info.color}33`,
        borderRadius: 16,
        overflow: "hidden",
        boxShadow: "0 14px 36px rgba(2,6,23,.06)",
        background: "#fff",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: `linear-gradient(180deg, ${info.bg}, #ffffff)`,
          borderBottom: `1px solid ${info.color}22`,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: 999,
              background: info.color,
              boxShadow: `0 0 0 4px ${info.color}22`,
            }}
          />
          <div style={{ fontSize: 16, fontWeight: 900 }}>
            {info.emoji} {catTitle}
          </div>
        </div>
        {data.yt?.url && (
          <a
            href={data.yt.url}
            target="_blank"
            rel="noreferrer"
            style={{
              textDecoration: "none",
              border: `1px solid ${info.color}`,
              color: "#fff",
              background: info.color,
              borderRadius: 10,
              padding: "8px 10px",
              fontWeight: 800,
              fontSize: 13,
            }}
          >
            대표영상 보기
          </a>
        )}
      </div>

      {/* Body */}
      <div style={{ padding: 16, display: "grid", gap: 12 }}>
        <Row label="종목" value={data.subject} />
        <Row label="빈도(F)" value={data.freq} />
        <Row label="강도(I)" value={data.inten} />
        <Row label="시간(T)" value={data.time} />
        <Row label="유형(T)" value={showType} />
        <Row label="세트/반복/휴식" value={data.sets} />
        <Row label="주의/대안" value={data.caut} />
        <Row label="진행규칙·주의" value={data.rule} />

        {/* Evidence / Video title */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
          {data.yt?.title && <Pill color="#0f172a" bg="#e5e7eb">🎬 {data.yt.title}</Pill>}
          {data.evid?.csv  && <Pill color="#0b5cab" bg="#dee9ff">CSV:{data.evid.csv}</Pill>}
        </div>
      </div>
    </div>
  );
}

export default function PlanCards({ planMd, showRawToggle = true }) {
  const [open, setOpen] = useState(false);
  if (!planMd || typeof planMd !== "string") return null;

  // 카드 블록 파싱
  const blocks = splitIntoCardBlocks(planMd);
  const cards = blocks.map(parseOneCard);

  // 카테고리 매핑: 백엔드가 [유산소, 근력, 유연성] 순으로 보냄을 가정
  const withCats = cards.map((c, idx) => ({
    catTitle: CAT_ORDER[idx] || "기타",
    data: c,
  }));

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {withCats.map((c, i) => (
        <Card key={i} catTitle={c.catTitle} data={c.data} />
      ))}

      {showRawToggle && (
        <details style={{ marginTop: 8 }} open={open} onToggle={(e) => setOpen(e.target.open)}>
          <summary style={{ cursor: "pointer", color: "#0b5cab", fontWeight: 800 }}>
            {open ? "원문 닫기" : "원문 보기 (전체 텍스트)"}
          </summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 12,
              marginTop: 8,
              fontSize: 12,
              color: "#0f172a",
            }}
          >
{planMd}
          </pre>
        </details>
      )}
    </div>
  );
}
