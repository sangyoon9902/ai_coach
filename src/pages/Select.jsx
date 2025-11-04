// src/pages/Select.jsx
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState";

export default function Select() {
  const nav = useNavigate();
  const location = useLocation();
  const { session, markSessionReady } = useApp();

  // 방금 측정 완료 알림 (선택)
  const [justFinished, setJustFinished] = useState(() => location.state?.justFinished ?? null);
  useEffect(() => {
    if (location.state?.justFinished) {
      const t = setTimeout(() => {
        nav(".", { replace: true, state: null }); // 히스토리 state 정리
        setJustFinished(null);
      }, 2500);
      return () => clearTimeout(t);
    }
  }, [location.state, nav]);

  // 완료 여부/요약 계산
  const {
    situpDone, reachDone, stepDone, allDone,
    situpSummary, reachSummary, stepSummary,
  } = useMemo(() => {
    // 싯업: 1회 이상이면 완료
    const reps = Number(session?.situp?.reps ?? 0);
    const situpDone = reps > 0;
    const situpSummary = situpDone ? `횟수 ${reps}회` : "미측정";

    // 좌전굴: 0cm도 '완료'일 수 있음 → bestCm가 유효 숫자면 완료
    const bestCm = session?.reach?.bestCm;
    const reachHasBaseline = session?.reach?.baselinePx != null || (session?.reach?.scalePxPerCm ?? 0) > 0;
    const reachDone = Number.isFinite(bestCm) || reachHasBaseline;
    const reachSummary = reachDone
      ? `최대 ${Number(bestCm ?? 0) >= 0 ? "+" : ""}${Number(bestCm ?? 0).toFixed(1)} cm`
      : "미측정";

    // 스텝: vo2max 또는 회복심박 평균 중 하나만 있어도 완료
    const vo2 = session?.step?.vo2max;
    const rec = session?.step?.recoveryAvg;
    const stepDone = (vo2 != null) || (rec != null);
    const stepSummary = stepDone
      ? `VO₂max ${vo2 != null ? Number(vo2).toFixed(1) : "—"} / 회복 ${rec ?? "—"}`
      : "미측정";

    return {
      situpDone, reachDone, stepDone,
      allDone: situpDone && reachDone && stepDone,
      situpSummary, reachSummary, stepSummary,
    };
  }, [session]);

  const tests = [
    {
      id: "situp",
      title: "윗몸말아올리기",
      desc: "측면(약 70°), 엉덩이~무릎 프레임 인",
      guide: "누워 무릎을 세우고 상체를 말아 올렸다가 내립니다. 자동으로 횟수를 셉니다.",
      path: "/measure/situp",
      done: situpDone,
      summary: situpSummary,
    },
    {
      id: "step",
      title: "스텝검사",
      desc: "정면 카메라 / 스텝박스와 하체가 보이게",
      guide: "정해진 리듬으로 3분간 오르내린 후 1분 휴식. 심박수로 지구력을 평가합니다.",
      path: "/measure/step",
      done: stepDone,
      summary: stepSummary,
    },
    {
      id: "reach",
      title: "앉아윗몸앞으로굽히기(cm)",
      desc: "완전 측면(약 90°), 엉덩이·다리·손끝이 한 프레임",
      guide: "다리를 펴고 앉아 손끝을 최대한 멀리 뻗습니다. 최대 거리(cm)를 기록합니다.",
      path: "/measure/reach",
      done: reachDone,
      summary: reachSummary,
    },
  ];

  const go = (path) => nav(path);

  const chipStyle = (ok) => ({
    display: "inline-block",
    fontSize: 12,
    padding: "2px 8px",
    borderRadius: 999,
    border: `1px solid ${ok ? "#2ecc71" : "#777"}`,
    color: ok ? "#2ecc71" : "#aaa",
    background: ok ? "rgba(46, 204, 113, 0.12)" : "transparent",
  });

  return (
    <div style={{ color: "#fff", background: "#000", minHeight: "100vh", padding: 16 }}>
      {/* 상단 알림 */}
      {justFinished && (
        <div style={{
          marginBottom: 12, padding: "10px 12px", borderRadius: 10,
          border: "1px solid #2a4c8f", background: "#112244",
          color: "#9fc3ff", fontSize: 14
        }}>
          ✅ <b>{labelOf(justFinished.test)}</b> 측정이 완료되었습니다
          {justFinished.summary ? ` (${justFinished.summary})` : ""}.
        </div>
      )}

      <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 20, fontWeight: 700 }}>
        종목 선택
      </h2>
      <p style={{ marginTop: 0, marginBottom: 16, fontSize: 13, color: "#aaa", lineHeight: 1.4 }}>
        각 항목을 측정하면 카드에 <b>완료</b> 표시와 <b>간단 결과</b>가 나타납니다.
        세 종목 모두 완료되면 아래의 <b>운동처방 받기</b> 버튼이 활성화됩니다.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
        }}
      >
        {tests.map((t) => (
          <div
            key={t.id}
            style={{
              background: "#1a1a2a",
              border: "1px solid #333",
              borderRadius: 12,
              padding: "12px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{t.title}</div>
              <span style={chipStyle(t.done)}>{t.done ? "완료" : "미완료"}</span>
            </div>

            <div style={{ fontSize: 12, color: "#7aa8ff" }}>{t.desc}</div>
            <div style={{ fontSize: 13, color: "#ccc" }}>{t.guide}</div>

            <div style={{
              marginTop: 6, fontSize: 13, color: t.done ? "#9fe6b8" : "#aaa",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
              padding: "8px 10px", borderRadius: 8
            }}>
              결과: {t.summary}
            </div>

            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button
                style={btnStyle("#444")}
                onClick={() => go(t.path)}
              >
                측정하기
              </button>
              {t.done && (
                <button
                  style={btnStyle("#2a72c6")}
                  onClick={() => go(t.path)} // 필요하면 '다시 측정' 라우트/리셋 로직으로 변경
                >
                  다시 측정
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 하단 진행 요약 + 운동처방 버튼 */}
      <div style={{
        marginTop: 20,
        background: "#0b0b0b",
        border: "1px solid #222",
        borderRadius: 12,
        padding: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}>
        <div style={{ fontSize: 14, color: "#ddd" }}>
          진행: {situpDone ? "●" : "○"} 윗몸 · {reachDone ? "●" : "○"} 좌전굴 · {stepDone ? "●" : "○"} 스텝
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={btnStyle("#0b5cab", !allDone)}
            onClick={() => {
              if (!allDone) return;
              markSessionReady(); // Results에서 전송 버튼 노출
              nav("/results");
            }}
            disabled={!allDone}
          >
            운동처방 받기
          </button>
          <button
            style={btnStyle("#555")}
            onClick={() => nav("/")}
          >
            뒤로
          </button>
        </div>
      </div>
    </div>
  );
}

function labelOf(testKey) {
  if (testKey === "situp") return "윗몸말아올리기";
  if (testKey === "reach") return "앉아윗몸앞으로굽히기";
  if (testKey === "step") return "스텝검사";
  return String(testKey ?? "");
}

function btnStyle(bg, disabled = false) {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    minWidth: 120,
  };
}
