// src/pages/Review.jsx
import React, { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useApp } from "../state/AppState";
import PlanCalendar from "../components/PlanCalendar.jsx";

/*************************************************
 * 운동처방 검수 페이지 (결과페이지 카드 양식 그대로 + 인라인 편집)
 *************************************************/
export default function Review() {
  const { session, setResultFromServer } = useApp();
  const traceId = session?.traceId || "draft";
  const aiPlanMd = session?.planMd || "";

  // 편집용 마크다운
  const [editedMd, setEditedMd] = useState("");
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState("draft"); // draft | approved | needs_changes

  // 캘린더 컨트롤
  const [weeksCal, setWeeksCal] = useState(4);
  const [startDateCal, setStartDateCal] = useState(null);

  // 초기 로드 + 임시저장 복구
  useEffect(() => {
    const key = lsKey(traceId);
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const { md, weeks, startISO, status: s } = JSON.parse(cached);
        setEditedMd(md ?? aiPlanMd);
        setWeeksCal(weeks ?? 4);
        setStartDateCal(startISO ? new Date(startISO) : null);
        setStatus(s ?? "draft");
        return;
      } catch {}
    }
    setEditedMd(aiPlanMd || seedMd);
  }, [traceId, aiPlanMd]);

  // 오토세이브
  useEffect(() => {
    const key = lsKey(traceId);
    const t = setTimeout(() => {
      localStorage.setItem(
        key,
        JSON.stringify({
          md: editedMd,
          weeks: weeksCal,
          startISO: startDateCal ? startDateCal.toISOString() : null,
          status,
          ts: Date.now(),
        })
      );
    }, 350);
    return () => clearTimeout(t);
  }, [traceId, editedMd, weeksCal, startDateCal, status]);

  // 설문 근거
  const evidence = useMemo(() => buildSurveyEvidence(session), [session]);

  // 결과 페이지 상단 요약 표시(읽기전용)
  const user = session?.payload?.user ?? {};
  const m = session?.payload?.measurements ?? {};
  const name = user?.name || "-";
  const sex = user?.sex || "-";
  const age = user?.age ?? "-";
  const height = user?.height_cm ?? "-";
  const weight = user?.weight_kg ?? "-";
  const bmi = calcBMI(weight, height);
  const bmiInfo = bmiBadge(bmi);

  const situp = (m?.situp_reps ?? session?.situp?.reps) ?? 0;
  const reach = (m?.reach_cm ?? session?.reach?.cm) ?? 0;
  const step_bpm = (m?.step_bpm ?? session?.step?.bpm) ?? 0;
  const vo2 = (m?.vo2max ?? session?.step?.vo2max) ?? 0;

  const scoreSitup = normalize(Number(situp), 10, 50);
  const scoreReach = normalize(Number(reach), -5, 12);
  const scoreStep  = normalize(Number(step_bpm), 120, 80, true);
  const scoreVo2   = normalize(Number(vo2), 30, 55);

  // 승인/반려 (백엔드 연동 시 교체)
  async function handleSubmit(newStatus) {
    setStatus(newStatus);
    setMsg(newStatus === "approved" ? "승인 완료 (임시 저장됨)" : "반려 요청이 저장되었습니다");
  }

  // === 카드 편집 반영 ===
  function handleCardsApply(blocks) {
    const newMd = serializeBlocksToMd(blocks);
    setEditedMd(newMd);
    // 결과페이지 자동 반영
    setResultFromServer?.({ traceId, planMd: newMd });
    setMsg("변경 사항이 결과 페이지에 반영되었습니다.");
  }

  // 현재 마크다운 → 블록(카드) 파싱
  const blocks = useMemo(() => parsePlanMdToBlocks(editedMd), [editedMd]);
  const hasPlan = blocks && blocks.length > 0;

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.rxHeader}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>운동처방 검수</div>
          <div style={{ fontSize: 12, color: "#64748b" }}>trace_id: {traceId}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={styles.primaryBtn} onClick={() => handleSubmit("approved")}>승인 확정</button>
          <button style={styles.ghostWarnBtn} onClick={() => handleSubmit("needs_changes")}>반려 요청</button>
        </div>
      </div>

      {msg && <div style={styles.infoBox}>{msg}</div>}

      {/* 상단 요약 (읽기전용) */}
      <div style={styles.topGrid}>
        <section style={styles.panel}>
          <div style={styles.panelTitle}>🧍 개인 프로필</div>
          <div style={styles.profileGrid}>
            <div>이름</div><div>{name}</div>
            <div>성별</div><div>{sex}</div>
            <div>나이</div><div>{age} 세</div>
            <div>키</div><div>{height} cm</div>
            <div>체중</div><div>{weight} kg</div>
            <div>BMI</div>
            <div>
              {bmi ?? "-"}{" "}
              <span style={{
                marginLeft: 8, padding: "2px 8px", borderRadius: 999,
                fontSize: 12, fontWeight: 700,
                background: `${bmiInfo.color}1a`, color: bmiInfo.color,
                border: `1px solid ${bmiInfo.color}55`
              }}>
                {bmiInfo.label}
              </span>
            </div>
          </div>
        </section>

        <section style={styles.panel}>
          <div style={styles.panelTitle}>⚙️ 측정 결과</div>
          <Row name="윗몸일으키기" value={situp} unit="회" score={scoreSitup} />
          <Row name="좌전굴" value={reach} unit="cm" score={scoreReach} />
          <Row name="스텝 회복기" value={step_bpm} unit="BPM" score={scoreStep} />
          <Row name="추정 VO₂max" value={vo2} unit="ml/kg/min" score={scoreVo2} />
        </section>
      </div>

      {/* 맞춤 운동처방: “카드 양식 그대로” + 인라인 편집 */}
      <section style={styles.planPanel}>
        <div style={styles.planHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.planDot} />
            <h3 style={{ margin: 0, fontSize: 18 }}>맞춤 운동처방 (검수용 카드)</h3>
          </div>
        </div>

        <div style={{ padding: 16 }}>
          {hasPlan ? (
            <PlanCardsEditable blocks={blocks} onApply={handleCardsApply} />
          ) : (
            <div style={{ color: "#64748b", fontSize: 14 }}>
              처방 내용이 없습니다.
            </div>
          )}
        </div>

        {/* 원문 MD 미리보기(선택) */}
        <div style={{ padding: "0 16px 14px", color:"#475569" }}>
          <details>
            <summary style={{ cursor:"pointer" }}>마크다운 원문 보기</summary>
            <div style={{ marginTop: 8, background:"#fafafa", border:"1px solid #e2e8f0", borderRadius:8, padding:12 }}>
              <ReactMarkdown>{editedMd}</ReactMarkdown>
            </div>
          </details>
        </div>
      </section>

      {/* 설문 근거 */}
      <section style={styles.planPanel}>
        <div style={styles.planHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.planDot} />
            <h3 style={{ margin: 0, fontSize: 18 }}>검수 참고: 설문 근거</h3>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          <EvidencePanel evidence={evidence} />
        </div>
      </section>

      {/* 캘린더 미리보기 */}
      <section style={styles.planPanel}>
        <div style={styles.planHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={styles.planDot} />
            <h3 style={{ margin: 0, fontSize: 18 }}>주간 계획표 (검수본 기준)</h3>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              style={{ ...styles.ghostBtn, boxShadow: weeksCal===4 ? "inset 0 0 0 1px #cbd5e1" : "none" }}
              onClick={() => setWeeksCal(4)}
            >4주</button>
            <button
              style={{ ...styles.ghostBtn, boxShadow: weeksCal===6 ? "inset 0 0 0 1px #cbd5e1" : "none" }}
              onClick={() => setWeeksCal(6)}
            >6주</button>
            <input
              type="date"
              style={{ border: "1px solid #cbd5e1", borderRadius: 8, padding: "6px 8px" }}
              onChange={(e) => setStartDateCal(e.target.value ? new Date(e.target.value + "T09:00:00") : null)}
            />
          </div>
        </div>

        <div style={{ padding: 12 }}>
          {typeof PlanCalendar === "function" ? (
            <PlanCalendar planMd={editedMd} weeks={weeksCal} startDate={startDateCal || undefined} />
          ) : (
            <div style={{ color: "#64748b", fontSize: 14 }}>PlanCalendar 컴포넌트를 사용할 수 없습니다.</div>
          )}
        </div>
      </section>
    </div>
  );
}

/******************** 카드 에디터 (결과 카드 모양 그대로) ********************/
function PlanCardsEditable({ blocks, onApply }) {
  const [rows, setRows] = useState(blocks);

  useEffect(() => { setRows(blocks); }, [blocks]);

  function upd(i, k, v) {
    setRows(prev => {
      const nx = [...prev];
      nx[i] = { ...nx[i], [k]: v };
      return nx;
    });
  }

  return (
    <div style={cards.grid}>
      {rows.map((b, i) => (
        <article key={i} style={cards.card}>
          {/* 카드 헤더 = 섹션명 */}
          <div style={cards.h}>
            <span style={cards.dot} />
            <span style={{ fontWeight: 900 }}>{b.category || `섹션 ${i+1}`}</span>
          </div>

          {/* 본문: 결과페이지 카드 양식 필드들 */}
          <div style={cards.body}>
            <LabeledInput label="종목" value={b.title} onChange={v=>upd(i,"title",v)} />

            <div style={cards.twocol}>
              <LabeledInput label="빈도(F)" value={b.freq} onChange={v=>upd(i,"freq",v)} placeholder="예: 주 3회" />
              <LabeledInput label="강도(I)" value={b.intensity} onChange={v=>upd(i,"intensity",v)} placeholder="예: 심박수 120~140 / RPE 11~13" />
            </div>

            <div style={cards.twocol}>
              <LabeledInput label="시간(T)" value={b.time} onChange={v=>upd(i,"time",v)} placeholder="예: 회당 20분 / 2세트×10회" />
              <LabeledInput label="유형(T)" value={b.type} onChange={v=>upd(i,"type",v)} placeholder="예: 걷기 / 매달려서 다리 들기" />
            </div>

            <div style={cards.twocol}>
              <LabeledInput label="대표영상 제목" value={b.videoTitle} onChange={v=>upd(i,"videoTitle",v)} placeholder="예: 트레드밀에서 걷기" />
              <LabeledInput label="YouTube URL" value={b.videoUrl} onChange={v=>upd(i,"videoUrl",v)} placeholder="https://www.youtube.com/..." />
            </div>

            <div>
              <LabeledTextarea label="진행규칙·주의" value={b.notes} onChange={v=>upd(i,"notes",v)} rows={3} />
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <LabeledInput label="CSV 근거 ID" value={b.csvId} onChange={v=>upd(i,"csvId",v)} placeholder="예: 2348" />
            </div>
          </div>
        </article>
      ))}

      <div style={{ gridColumn:"1 / -1", display:"flex", justifyContent:"flex-end" }}>
        <button style={styles.primaryBtn} onClick={() => onApply(rows)}>변경 반영</button>
      </div>
    </div>
  );
}

function LabeledInput({ label, value, onChange, placeholder }) {
  return (
    <label style={cards.label}>
      <span style={cards.labelText}>{label}</span>
      <input
        value={value || ""}
        onChange={(e)=>onChange?.(e.target.value)}
        placeholder={placeholder}
        style={cards.input}
      />
    </label>
  );
}
function LabeledTextarea({ label, value, onChange, rows = 3 }) {
  return (
    <label style={cards.label}>
      <span style={cards.labelText}>{label}</span>
      <textarea
        value={value || ""}
        onChange={(e)=>onChange?.(e.target.value)}
        rows={rows}
        style={{ ...cards.input, height: rows*20 + 20, resize:"vertical" }}
      />
    </label>
  );
}

/******************** Evidence Panel ********************/
function EvidencePanel({ evidence }) {
  if (!evidence) return null;
  return (
    <div>
      {evidence.blocks.map((b, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{b.title}</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "#334155", fontSize: 13 }}>
            {b.items.map((li, j) => <li key={j} style={{ marginBottom: 4 }}>{li}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

/******************** Parser & Serializer ********************/
function parsePlanMdToBlocks(md) {
  const out = [];
  if (!md || typeof md !== "string") return seedFromEmpty();

  // ### 섹션 단위로 분리
  const sectionRegex = /(^###[^\n]*\n[\s\S]*?)(?=^###|\Z)/gmi;
  const sections = md.match(sectionRegex);

  if (sections?.length) {
    sections.forEach(sec => {
      const category  = (sec.match(/^###\s*([^\n]+)/m)?.[1] || "").trim();
      const title     = pick(sec, /종목\s*[:：]\s*([^\n]+)/i);
      const freq      = pick(sec, /빈도\(F\)\s*[:：]\s*([^\n]+)/i);
      const intensity = pick(sec, /강도\(I\)\s*[:：]\s*([^\n]+)/i);
      const time      = pick(sec, /시간\(T\)\s*[:：]\s*([^\n]+)/i);

      const typeLine  = pick(sec, /유형\(T\)\s*[:：]\s*([^\n]+)/i) || "";
      const justType  = typeLine ? typeLine.split("·")[0].replace(/^유형\(T\)\s*[:：]\s*/i,"").trim() : "";
      const videoTitle = typeLine.match(/대표영상\s*[:：]\s*([^(]+?)\s*(?:\(|$)/i)?.[1]?.trim() || "";
      const videoUrl   = typeLine.match(/\(\s*YouTube\s*:\s*([^)]+)\)/i)?.[1]?.trim() || "";

      const notes     = pick(sec, /(진행규칙·주의|주의|메모)\s*[:：]?\s*([\s\S]*?)(?:\n{2,}|^CSV|^###|\Z)/i);
      const csvId     = (pick(sec, /CSV\s*[:：]\s*([0-9]+)/i) || "").trim();

      out.push({ category, title, freq, intensity, time, type: justType, videoTitle, videoUrl, notes, csvId });
    });
  } else {
    // 헤더가 없는 라벨 나열형일 때 대략적으로 3개로 분해
    const chunks = md.split(/\n{2,}(?=종목|🎬|CSV)/g);
    const catNames = ["유산소 운동","근력/근지구력","유연성"];
    chunks.slice(0,3).forEach((sec, idx) => {
      const title     = pick(sec, /종목\s*[:：]?\s*([^\n]+)/i);
      const freq      = pick(sec, /빈도\(F\)\s*[:：]\s*([^\n]+)/i);
      const intensity = pick(sec, /강도\(I\)\s*[:：]\s*([^\n]+)/i);
      const time      = pick(sec, /시간\(T\)\s*[:：]\s*([^\n]+)/i);
      const typeLine  = pick(sec, /유형\(T\)\s*[:：]\s*([^\n]+)/i) || "";
      const justType  = typeLine ? typeLine.split("·")[0].replace(/^유형\(T\)\s*[:：]\s*/i,"").trim() : "";
      const videoTitle= typeLine.match(/대표영상\s*[:：]\s*([^(]+?)\s*(?:\(|$)/i)?.[1]?.trim() || "";
      const videoUrl  = typeLine.match(/\(\s*YouTube\s*:\s*([^)]+)\)/i)?.[1]?.trim() || "";
      const notes     = pick(sec, /(진행규칙·주의|주의)\s*[:：]?\s*([\s\S]*?)(?:\n{2,}|^CSV|\Z)/i);
      const csvId     = (pick(sec, /CSV\s*[:：]\s*([0-9]+)/i) || "").trim();

      out.push({ category: catNames[idx] || "", title, freq, intensity, time, type: justType, videoTitle, videoUrl, notes, csvId });
    });
  }
  return fillToThree(out);
}

function serializeBlocksToMd(blocks) {
  const order = ["유산소", "유산소 운동", "심폐", "근력", "근력/근지구력", "유연성", "스트레칭"];
  const sorted = [...blocks].sort((a,b)=> orderIndex(a.category, order) - orderIndex(b.category, order));

  const parts = sorted.map(b => {
    const head = `### ${b.category || "운동"}`;
    const typeLine = joinDot(
      `유형(T): ${b.type || "-"}`,
      (b.videoTitle || b.videoUrl) ? `대표영상: ${b.videoTitle || "-"}${b.videoUrl ? ` (YouTube: ${b.videoUrl})` : ""}` : ""
    );
    const lines = [
      head,
      b.title ? `종목: ${b.title}` : null,
      `빈도(F): ${b.freq || "-"}`,
      `강도(I): ${b.intensity || "-"}`,
      `시간(T): ${b.time || "-"}`,
      typeLine,
      b.notes ? `진행규칙·주의: ${b.notes}` : null,
      b.csvId ? `CSV: ${b.csvId}` : null,
    ].filter(Boolean);
    return lines.join("\n");
  });

  return parts.join("\n\n").trim();
}

function pick(text, regex) {
  const m = text.match(regex);
  if (!m) return "";
  return (m[2] || m[1] || "").trim();
}
function seedFromEmpty() {
  return [
    { category: "유산소 운동",     title:"", freq:"", intensity:"", time:"", type:"", videoTitle:"", videoUrl:"", notes:"", csvId:"" },
    { category: "근력/근지구력",   title:"", freq:"", intensity:"", time:"", type:"", videoTitle:"", videoUrl:"", notes:"", csvId:"" },
    { category: "유연성",           title:"", freq:"", intensity:"", time:"", type:"", videoTitle:"", videoUrl:"", notes:"", csvId:"" },
  ];
}
function fillToThree(arr) {
  const base = seedFromEmpty();
  const out = [...arr];
  for (let i=arr.length; i<3; i++) out.push(base[i]);
  return out.slice(0,3);
}
function orderIndex(cat, order) {
  const s = (cat || "").toString();
  for (let i=0;i<order.length;i++) if (s.includes(order[i])) return i;
  return 999;
}
function joinDot(a,b){ return a && b ? `${a} · ${b}` : (a||b||""); }

/******************** 설문 근거 / 유틸 ********************/
function lsKey(traceId){ return `review:${traceId}`; }
function buildSurveyEvidence(session){
  const defaultBlocks = [
    {
      title: "설문 1·4 기반 주의사항 (ACSM 근거)",
      items: [
        "운동 시 흉통이 발생하므로 저강도로 시작하고, 증상을 지속적으로 모니터링하며 필요시 의료 상담을 권장합니다.",
        "노쇠 신호가 있어 균형과 기능 중심의 운동을 권장하며, 세트 및 시간 축소, 휴식 연장을 고려합니다.",
      ],
    },
    {
      title: "설문 2 기반 상담/동기부여 (ACSM 근거)",
      items: [
        "체력 측정이 목적이므로 기본기 향상 및 규칙적인 운동을 강조합니다.",
        "흥미의 부재를 해소하기 위해 게임화 또는 챌린지를 도입하고, 효과의 불확실성을 줄이기 위해 주간 지표(예: RPE, 휴식 심박수)를 시각화합니다.",
      ],
    },
    {
      title: "설문 3 기반 달성 전략",
      items: [
        "활동적인 일정을 고려하여 주 3회의 유산소 운동을 20분씩 나누어 진행하고, 중간중간 30~45분마다 1~2분 기립 및 보행을 포함합니다.",
        "고강도 운동을 피하고 중강도 운동 및 휴식일을 적절히 배치합니다.",
      ],
    },
  ];
  const fromServer = session?.evidence?.blocks;
  if (Array.isArray(fromServer) && fromServer.length) {
    return { blocks: mergeBlocks(defaultBlocks, fromServer) };
  }
  return { blocks: defaultBlocks };
}
function mergeBlocks(a, b){
  const map = new Map();
  [...a, ...b].forEach(block => {
    const key = (block.title || '').trim();
    const items = (block.items || []).map(String);
    if (!map.has(key)) map.set(key, new Set());
    const set = map.get(key);
    items.forEach(it => set.add(it));
  });
  return [...map.entries()].map(([title, set]) => ({ title, items: [...set] }));
}

/******************** 공용 스타일/컴포넌트 ********************/
function calcBMI(w, h) {
  const W = Number(w), H = Number(h);
  if (!W || !H) return null;
  return Number((W / ((H / 100) ** 2)).toFixed(1));
}
function normalize(v, min, max, invert = false) {
  if (v == null || isNaN(v)) return 0;
  const x = Math.max(min, Math.min(max, v));
  const r = (x - min) / (max - min);
  return Math.round((invert ? 1 - r : r) * 100);
}
function bmiBadge(bmi) {
  if (bmi == null) return { label: "-", color: "#64748b" };
  if (bmi < 18.5) return { label: "저체중", color: "#3b82f6" };
  if (bmi < 23)   return { label: "정상",   color: "#16a34a" };
  if (bmi < 25)   return { label: "과체중", color: "#f59e0b" };
  return { label: "비만", color: "#ef4444" };
}
function grade(score) {
  if (score >= 80) return { label: "우수", color: "#16a34a" };
  if (score >= 60) return { label: "보통", color: "#3b82f6" };
  if (score >= 40) return { label: "주의", color: "#f59e0b" };
  return { label: "개선필요", color: "#ef4444" };
}
function Bar({ score, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{
        flex: 1, height: 10, borderRadius: 8,
        background: "linear-gradient(90deg,#ef4444 0%,#f59e0b 40%,#60a5fa 60%,#16a34a 100%)",
        position: "relative", overflow: "hidden"
      }}>
        <div style={{
          position: "absolute", inset: 0, width: `${score}%`,
          background: "rgba(255,255,255,.85)", mixBlendMode: "overlay"
        }} />
      </div>
      <div style={{ width: 64, textAlign: "right", fontSize: 12 }}>{right}</div>
    </div>
  );
}
function Row({ name, value, unit, score }) {
  const g = grade(score);
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "140px 1fr 80px",
      gap: 12, alignItems: "center",
      padding: "10px 0",
      borderBottom: "1px solid rgba(15,23,42,.06)"
    }}>
      <div style={{ fontWeight: 600 }}>{name}</div>
      <Bar score={score} right={<b style={{ color: g.color }}>{g.label}</b>} />
      <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value ?? "-"} {unit}
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: 960,
    margin: "24px auto",
    padding: "16px",
    fontFamily: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
    color: "#0f172a",
  },
  rxHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    paddingBottom: 10, borderBottom: "1px solid rgba(15,23,42,.06)", marginBottom: 10,
  },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #0b5cab",
    background: "#0b5cab",
    color: "#fff",
    fontWeight: 800,
    fontSize: 14,
  },
  ghostBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #cbd5e1",
    background: "#fff",
    color: "#0f172a",
    fontWeight: 700,
    fontSize: 14,
  },
  ghostWarnBtn: {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #ef4444",
    background: "#fff",
    color: "#b00020",
    fontWeight: 700,
    fontSize: 14,
  },
  topGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1.4fr",
    gap: 12,
    marginTop: 12,
  },
  panel: {
    background: "#fafafa",
    border: "1px solid rgba(15,23,42,.06)",
    borderRadius: 12,
    padding: 14,
  },
  panelTitle: { fontWeight: 800, marginBottom: 8, fontSize: 15 },
  profileGrid: {
    display: "grid",
    gridTemplateColumns: "100px 1fr",
    rowGap: 8, columnGap: 12, fontSize: 14,
  },
  infoBox: {
    marginTop: 10,
    background: "#eef6ff",
    border: "1px solid #bcdcff",
    color: "#0b5cab",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
  },
  planPanel: {
    marginTop: 14,
    background: "#fff",
    border: "1px solid rgba(15,23,42,.06)",
    borderRadius: 12,
    overflow: "hidden",
  },
  planHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px",
    background: "linear-gradient(180deg,#f8fafc,#ffffff)",
    borderBottom: "1px solid rgba(15,23,42,.06)",
  },
  planDot: {
    width: 10, height: 10, borderRadius: 999, background: "#16a34a",
    boxShadow: "0 0 0 3px #22c55e33",
  },
};

const cards = {
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
  },
  card: {
    background: "#ffffff",
    border: "1px solid rgba(15,23,42,.08)",
    borderRadius: 12,
    boxShadow: "0 12px 24px rgba(2,6,23,.04)",
    overflow: "hidden",
  },
  h: {
    display: "flex", alignItems: "center", gap: 8,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(15,23,42,.06)",
    background: "linear-gradient(180deg,#f8fafc,#ffffff)",
    fontSize: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 999, background:"#22c55e" },
  body: { padding: 12 },
  twocol: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  label: { display:"flex", flexDirection:"column", gap:6, marginBottom:8 },
  labelText: { fontSize:12, color:"#475569", fontWeight:700 },
  input: {
    height: 36, border:"1px solid #cbd5e1", borderRadius:8, padding:"0 10px",
    fontSize:13, background:"#fff",
  },
};

/******************** 기본 시드/유틸 ********************/
const seedMd = `### 유산소 운동
종목: -
빈도(F): 주 3회
강도(I): RPE 11-13
시간(T): 20-30분
유형(T): 빠른 걷기 · 대표영상: -
진행규칙·주의: -
CSV: -

### 근력/근지구력
종목: -
빈도(F): 주 2-3회
강도(I): 10-15RM
시간(T): 20-30분
유형(T): 하체/코어
진행규칙·주의: -
CSV: -

### 유연성
종목: -
빈도(F): 매일
강도(I): 통증 없는 범위
시간(T): 10-15분
유형(T): 대근육군 스트레칭
진행규칙·주의: -
CSV: -`;

