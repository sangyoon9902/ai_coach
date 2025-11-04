// src/pages/Survey4.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState"; // ✅ 추가

/**
 * Survey4 – 노쇠 설문 (4/4)
 * 1) 지난 한 달 동안 항상/대부분 피곤했는가?
 * 2) 도움 없이 쉬지 않고 10개 계단 오르기 힘든가?
 * 3) 도움 없이 300m 혼자 이동하기 힘든가?
 * 4) 1년 전 대비 체중 5% 이상 감소? (예면 감소 kg 입력)
 *
 * 저장:
 *   1) localStorage("survey").survey4 로 저장
 *   2) AppProvider.surveys.survey4 로 저장
 *
 * 이동: 이전 → /survey3, 완료 → /select
 */

const QUESTIONS = [
  "지난 한 달 동안 피곤하다고 느낀 적이 있습니까? (항상 또는 거의 대부분 피곤한 경우)",
  "도움 없이 혼자서 쉬지 않고 10개의 계단을 오르는데 힘이 듭니까?",
  "도움 없이 300미터를 혼자서 이동하는데 힘이 듭니까?",
  "1년 전과 비교해 체중이 5% 이상 감소했습니까? (예: 60kg에서 3kg 이상 감소)",
];

export default function Survey4() {
  const navigate = useNavigate();
  const { setSurveys } = useApp(); // ✅ 전역 setter

  // 응답: "예" | "아니오" | ""
  const [answers, setAnswers] = useState(Array(QUESTIONS.length).fill(""));
  const [weightLossKg, setWeightLossKg] = useState(""); // Q4 예일 때만
  const [touched, setTouched] = useState(false);

  const allAnswered = useMemo(
    () => answers.every((a) => a === "예" || a === "아니오"),
    [answers]
  );

  const yesCount = useMemo(
    () => answers.filter((a) => a === "예").length,
    [answers]
  );

  const setAnswer = (idx, val) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[idx] = val;
      // Q4가 "아니오"로 바뀌면 체중 감소량 입력 초기화
      if (idx === 3 && val !== "예") setWeightLossKg("");
      return next;
    });
  };

  const isValid = useMemo(() => {
    if (!allAnswered) return false;
    // Q4 "예"면 감소한 kg 필수
    if (answers[3] === "예" && (!weightLossKg || Number(weightLossKg) <= 0))
      return false;
    return true;
  }, [allAnswered, answers, weightLossKg]);

  const handlePrev = () => navigate("/survey3");

  const handleSubmit = () => {
    setTouched(true);
    if (!isValid) return;

    // 설문 응답을 payload로 변환
    const payload = {
      items: QUESTIONS.map((q, i) => ({
        no: i + 1,
        question: q,
        answer: answers[i],
        ...(i === 3 && answers[3] === "예"
          ? { extra: { weight_loss_kg: Number(weightLossKg) } }
          : {}),
      })),
      yes_count: yesCount,
      frailty_flag: yesCount >= 1, // 🔎 기준은 필요시 조정 가능
    };

    // 1) localStorage에도 기존대로 저장
    const prev = JSON.parse(localStorage.getItem("survey") || "{}");
    localStorage.setItem(
      "survey",
      JSON.stringify({ ...prev, survey4: payload })
    );

    // 2) AppProvider.surveys 에도 저장해서 서버 POST 때 같이 보낼 수 있게 함
    setSurveys((prevAll) => ({
      ...prevAll,
      survey4: payload,
    }));

    // 3) 다음 화면으로 이동 (결과 선택/측정 선택 화면 등)
    navigate("/select"); // 필요하면 '/results' 등으로 바꿔도 됨
  };

  // 스타일
  const wrap = {
    maxWidth: 980,
    margin: "40px auto",
    padding: "0 16px",
  };
  const card = {
    border: "1px solid #c9d4ff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };
  const header = {
    background: "#f7f8fb",
    padding: "14px 18px",
    fontWeight: 800,
  };
  const row = {
    padding: "16px 18px",
    borderTop: "1px solid #e6e9f3",
  };
  const grid = {
    display: "grid",
    gridTemplateColumns: "60px 1fr 260px",
    gap: 16,
    alignItems: "center",
  };
  const radioLabel = {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginRight: 12,
  };
  const inputStyle = {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    minWidth: 120,
  };

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
        4단계. 노쇠 설문지 (4/4)
      </h1>

      <div style={card}>
        <div style={header}>문항</div>

        {QUESTIONS.map((q, i) => (
          <div key={i} style={row}>
            <div style={grid}>
              <div style={{ fontWeight: 700 }}>{i + 1}</div>
              <div>{q}</div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
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

                {/* Q4에만 추가 정보 입력 */}
                {i === 3 && answers[3] === "예" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginLeft: 12,
                    }}
                  >
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={weightLossKg}
                      onChange={(e) => setWeightLossKg(e.target.value)}
                      placeholder="감소 체중(kg)"
                      style={inputStyle}
                    />
                    <span>kg 감소</span>
                  </div>
                )}
              </div>
            </div>

            {/* 에러 표기 */}
            {touched && !answers[i] && (
              <div
                style={{
                  color: "#d33",
                  fontSize: 13,
                  marginTop: 6,
                }}
              >
                문항 {i + 1}에 응답해주세요.
              </div>
            )}

            {touched &&
              i === 3 &&
              answers[3] === "예" &&
              (!weightLossKg || Number(weightLossKg) <= 0) && (
                <div
                  style={{
                    color: "#d33",
                    fontSize: 13,
                    marginTop: 6,
                  }}
                >
                  체중 감소량(kg)을 입력해주세요.
                </div>
              )}
          </div>
        ))}
      </div>

      {/* 요약/경고 배너 */}
      {yesCount >= 1 && (
        <div
          style={{
            marginTop: 12,
            background: "#fff6f6",
            border: "1px solid #f5c2c7",
            color: "#b4232c",
            padding: "10px 12px",
            borderRadius: 10,
            fontSize: 14,
          }}
        >
          ⚠️ 노쇠 관련 항목에서 <strong>{yesCount}</strong>건의 “예”가
          확인되었습니다. 안전을 위해 전문가 상담을 권장합니다.
        </div>
      )}

      {/* 하단 버튼 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 16,
        }}
      >
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
          onClick={handleSubmit}
          disabled={touched && !isValid}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: 0,
            background: "#2f5aff",
            color: "#fff",
          }}
        >
          설문 완료
        </button>
      </div>

      <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>
        ※ 각 문항에 ‘예’ 또는 ‘아니오’를 선택하세요. 1개 이상 ‘예’인 경우 전문가 상담을 권장합니다.
      </p>
    </div>
  );
}
