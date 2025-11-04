// src/pages/Survey2.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState"; // ✅ 추가

/**
 * Survey2 – 운동 동기/분야 설문 (2/4)
 * - Q1: 상담 목적(단일선택 + 기타)
 * - Q2: 과거 운동/스포츠 참여 경험(있다/없다 + 기간)
 * - Q3: 운동 시작/지속 어려움(복수선택 + 기타)
 *
 * 저장:
 *   1) localStorage("survey").survey2 에 저장
 *   2) AppProvider.surveys.survey2 에도 저장
 *
 * 이동: 이전 → /survey1, 다음 → /survey3
 */
export default function Survey2() {
  const navigate = useNavigate();
  const { setSurveys } = useApp(); // ✅ 전역 상태 setter

  const q1Options = useMemo(
    () => ["다이어트", "체형관리", "질환예방", "체력측정(채용용)", "기타"],
    []
  );

  const q3Options = useMemo(
    () => [
      "시간부족",
      "과도한업무",
      "경제적비용",
      "효과의 불확실성",
      "운동방법의 어려움",
      "흥미의 부재",
      "부상이나 통증",
      "환경문제(미세먼지, 황사 등)",
      "기타",
    ],
    []
  );

  // 상태
  const [q1, setQ1] = useState("");
  const [q1Etc, setQ1Etc] = useState("");

  const [q2HasExp, setQ2HasExp] = useState(""); // "있다" | "없다" | ""
  const [q2Duration, setQ2Duration] = useState("");
  const [q2Unit, setQ2Unit] = useState("개월");

  const [q3, setQ3] = useState([]); // 배열
  const [q3Etc, setQ3Etc] = useState("");

  const [touched, setTouched] = useState(false);

  // 유효성
  const isValid = useMemo(() => {
    if (!q1) return false;
    if (q1 === "기타" && !q1Etc.trim()) return false;

    if (!q2HasExp) return false;
    if (q2HasExp === "있다" && (!q2Duration || Number(q2Duration) <= 0)) return false;

    if (q3.includes("기타") && !q3Etc.trim()) return false;

    return true;
  }, [q1, q1Etc, q2HasExp, q2Duration, q3, q3Etc]);

  // 체크박스 토글
  const toggleQ3 = (val) => {
    setQ3((old) => (old.includes(val) ? old.filter((x) => x !== val) : [...old, val]));
  };

  // 저장 & 다음
  const handleNext = () => {
    setTouched(true);
    if (!isValid) return;

    // 설문 응답을 payload로 정리
    const payload = {
      motive: q1 === "기타" ? q1Etc.trim() : q1,
      past_exercise: {
        has_experience: q2HasExp === "있다",
        duration: q2HasExp === "있다" ? Number(q2Duration) : 0,
        unit: q2HasExp === "있다" ? q2Unit : null,
      },
      barriers: q3.map((v) => (v === "기타" ? `기타:${q3Etc.trim()}` : v)),
    };

    // ✅ 1) localStorage에 저장 (기존 흐름 유지)
    const prev = JSON.parse(localStorage.getItem("survey") || "{}");
    localStorage.setItem("survey", JSON.stringify({ ...prev, survey2: payload }));

    // ✅ 2) AppProvider.surveys 에도 저장 (AI 처방 만들 때 서버로 같이 보낼 값)
    setSurveys((prevAll) => ({
      ...prevAll,
      survey2: payload,
    }));

    // 다음 페이지로 이동
    navigate("/survey3");
  };

  const Error = ({ show, children }) =>
    show ? <div style={{ color: "#d33", fontSize: 13, marginTop: 6 }}>{children}</div> : null;

  return (
    <div style={{ maxWidth: 880, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
        운동동기/분야 설문 (2/4)
      </h1>

      <div
        style={{
          border: "1px solid #c9d4ff",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ background: "#f7f8fb", padding: "14px 18px" }}>
          <strong>운동동기분야</strong>
        </div>

        {/* Q1 */}
        <div style={{ padding: "18px" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            1. 운동상담을 받는 목적이 무엇입니까?
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 18 }}>
            {q1Options.map((opt) => (
              <label key={opt} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input
                  type="radio"
                  name="q1"
                  value={opt}
                  checked={q1 === opt}
                  onChange={(e) => setQ1(e.target.value)}
                />
                <span>{opt}</span>
              </label>
            ))}

            {q1 === "기타" && (
              <input
                value={q1Etc}
                onChange={(e) => setQ1Etc(e.target.value)}
                placeholder="기타 내용을 입력"
                style={{
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  padding: "8px 10px",
                  minWidth: 220,
                }}
              />
            )}
          </div>

          <Error show={touched && !q1}>
            목적을 선택해주세요. (기타 선택 시 내용 입력)
          </Error>
          <hr style={{ margin: "18px 0" }} />
        </div>

        {/* Q2 */}
        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            2. 과거에 운동이나 스포츠에 참여한 경험이 있습니까?
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name="q2"
                value="있다"
                checked={q2HasExp === "있다"}
                onChange={(e) => setQ2HasExp(e.target.value)}
              />
              <span>있다</span>
            </label>

            {q2HasExp === "있다" && (
              <>
                <input
                  type="number"
                  min={1}
                  value={q2Duration}
                  onChange={(e) => setQ2Duration(e.target.value)}
                  style={{
                    width: 100,
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                  placeholder="예: 12"
                />
                <select
                  value={q2Unit}
                  onChange={(e) => setQ2Unit(e.target.value)}
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: 8,
                    padding: "8px 10px",
                  }}
                >
                  <option>개월</option>
                  <option>년</option>
                </select>
              </>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="radio"
                name="q2"
                value="없다"
                checked={q2HasExp === "없다"}
                onChange={(e) => {
                  setQ2HasExp(e.target.value);
                  setQ2Duration("");
                }}
              />
              <span>없다</span>
            </label>
          </div>

          <Error
            show={
              touched &&
              (!q2HasExp ||
                (q2HasExp === "있다" && (!q2Duration || Number(q2Duration) <= 0)))
            }
          >
            경험 유무를 선택하고, “있다”면 기간을 입력해주세요.
          </Error>
          <hr style={{ margin: "18px 0" }} />
        </div>

        {/* Q3 */}
        <div style={{ padding: "0 18px 18px" }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            3. 본인이 생각하기에 운동을 시작하거나 지속하는 데 어려운 점은 무엇입니까?
            <br />
            (중복선택 가능)
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            {q3Options.map((opt) => (
              <label
                key={opt}
                style={{ display: "flex", alignItems: "center", gap: 8 }}
              >
                <input
                  type="checkbox"
                  checked={q3.includes(opt)}
                  onChange={() => toggleQ3(opt)}
                />
                <span>{opt}</span>
              </label>
            ))}
          </div>

          {q3.includes("기타") && (
            <input
              value={q3Etc}
              onChange={(e) => setQ3Etc(e.target.value)}
              placeholder="기타 내용을 입력"
              style={{
                marginTop: 10,
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "8px 10px",
                width: "100%",
              }}
            />
          )}

          <Error show={touched && q3.includes("기타") && !q3Etc.trim()}>
            “기타”를 선택하셨다면 내용을 입력해주세요.
          </Error>
        </div>
      </div>

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
          onClick={() => navigate("/survey1")}
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
          disabled={!isValid && touched}
          style={{
            padding: "10px 16px",
            borderRadius: 10,
            border: 0,
            background: "#2f5aff",
            color: "#fff",
            opacity: isValid ? 1 : 0.95,
          }}
        >
          다음
        </button>
      </div>
    </div>
  );
}
