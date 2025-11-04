// src/pages/Survey1.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState"; // 👈 추가 (전역 상태 접근)

/**
 * Survey1 – 사전신체상태설문지(PAR-Q)
 * - 7개 문항, 각 예/아니오 단일선택 (모두 필수)
 * - 하나라도 '예'가 있으면 high_risk = true
 *
 * 저장: localStorage("survey") + AppProvider.surveys
 * 이동: 다음 → /survey2
 */

const QUESTIONS = [
  "의사에게 심장질환 진단을 받았거나, 신체활동/운동 삼가에 대한 말을 들은 적이 있습니까?",
  "운동을 할 때 가슴에 통증이 있습니까?",
  "지난달 휴식 시에도 가슴에 통증을 느낀 적이 있습니까?",
  "어지럼증으로 쓰러졌거나 의식을 잃은 적이 있습니까?",
  "운동할 때 심해질 수 있는 관절이나 뼈의 문제(예: 허리, 무릎 또는 고관절)가 있습니까?",
  "심장질환 등으로 의사에게 처방받아 복용하는 약이 있습니까?",
  "신체활동/운동을 해서는 안되는 다른 이유가 있습니까?",
];

export default function Survey1() {
  const navigate = useNavigate();
  const { setSurveys } = useApp(); // 👈 전역 상태 가져오기

  const [answers, setAnswers] = useState(Array(QUESTIONS.length).fill(""));
  const [touched, setTouched] = useState(false);

  const allAnswered = useMemo(
    () => answers.every((a) => a === "예" || a === "아니오"),
    [answers]
  );
  const hasAnyYes = useMemo(() => answers.includes("예"), [answers]);

  const setAnswer = (idx, val) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = val;
      return next;
    });
  };

  const handlePrev = () => navigate("/");

  const handleNext = () => {
    setTouched(true);
    if (!allAnswered) return;

    // 📦 설문 결과 payload 구성
    const payload = {
      items: QUESTIONS.map((q, i) => ({
        no: i + 1,
        question: q,
        answer: answers[i],
      })),
      high_risk: hasAnyYes,
    };

    // 🧠 localStorage에도 저장 (기존 기능 유지)
    const prevLocal = JSON.parse(localStorage.getItem("survey") || "{}");
    localStorage.setItem(
      "survey",
      JSON.stringify({ ...prevLocal, survey1: payload })
    );

    // 🧩 AppProvider에도 저장 (새 기능)
    setSurveys((prev) => ({
      ...prev,
      survey1: payload,
    }));

    // 다음 페이지로 이동
    navigate("/survey2");
  };

  // 스타일 (그대로 유지)
  const wrap = { maxWidth: 980, margin: "40px auto", padding: "0 16px" };
  const card = {
    border: "1px solid #c9d4ff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };
  const header = { background: "#f7f8fb", padding: "14px 18px", fontWeight: 800 };
  const row = { padding: "16px 18px", borderTop: "1px solid #e6e9f3" };
  const grid = {
    display: "grid",
    gridTemplateColumns: "60px 1fr 220px",
    gap: 16,
    alignItems: "center",
  };
  const radioLabel = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginRight: 12,
  };
  const warn = {
    marginTop: 12,
    background: "#fff6f6",
    border: "1px solid #f5c2c7",
    color: "#b4232c",
    padding: "10px 12px",
    borderRadius: 10,
    fontSize: 14,
  };

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
        1단계. 사전신체상태설문지(PAR-Q) (1/4)
      </h1>

      <div style={card}>
        <div style={header}>문항</div>

        {QUESTIONS.map((q, i) => (
          <div key={i} style={row}>
            <div style={grid}>
              <div style={{ fontWeight: 700 }}>{i + 1}</div>
              <div>{q}</div>
              <div style={{ display: "flex", alignItems: "center" }}>
                <label style={radioLabel}>
                  <input
                    type="radio"
                    name={`q${i}`}
                    value="예"
                    checked={answers[i] === "예"}
                    onChange={(e) => setAnswer(i, e.target.value)}
                  />
                  <span>예</span>
                </label>
                <label style={radioLabel}>
                  <input
                    type="radio"
                    name={`q${i}`}
                    value="아니오"
                    checked={answers[i] === "아니오"}
                    onChange={(e) => setAnswer(i, e.target.value)}
                  />
                  <span>아니오</span>
                </label>
              </div>
            </div>
            {touched && !answers[i] && (
              <div style={{ color: "#d33", fontSize: 13, marginTop: 6 }}>
                문항 {i + 1}에 응답해주세요.
              </div>
            )}
          </div>
        ))}
      </div>

      {hasAnyYes && (
        <div style={warn}>
          ⚠️ 하나 이상의 문항에서 <strong>“예”</strong>가 선택되었습니다. 체력측정/운동이
          위험할 수 있으니 <strong>전문가 상담 후 진행</strong>을 권장합니다.
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
        <button
          type="button"
          onClick={handlePrev}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
          }}
        >
          이전
        </button>

        <button
          type="button"
          onClick={handleNext}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: 0,
            background: "#2f5aff",
            color: "#fff",
          }}
        >
          다음
        </button>
      </div>

      <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>
        ※ 각 문항에 대해 ‘예’ 또는 ‘아니오’를 선택해주세요. 1개 이상 ‘예’인 경우에는 전문가 상담 후 진행하세요.
      </p>
    </div>
  );
}
