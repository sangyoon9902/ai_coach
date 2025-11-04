// src/pages/Survey3.jsx
import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../state/AppState"; // ✅ 추가

/**
 * Survey3 – 국제신체활동설문지(IPAQ) 요약형 (3/4)
 * 저장:
 *   1) localStorage("survey").survey3 로 저장
 *   2) AppProvider.surveys.survey3 로 저장
 *
 * 이동: 이전 → /survey2, 다음 → /survey4
 */
export default function Survey3() {
  const navigate = useNavigate();
  const { setSurveys } = useApp(); // ✅ 전역 setter

  const dayOptions = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);
  const hourOptions = useMemo(() => Array.from({ length: 25 }, (_, i) => i), []);
  const minOptions = useMemo(() => Array.from({ length: 12 }, (_, i) => i * 5), []);

  const [jobType, setJobType] = useState("");
  const [jobEtc, setJobEtc] = useState("");

  const [vigDays, setVigDays] = useState(0);
  const [vigNone, setVigNone] = useState(false);
  const [vigHour, setVigHour] = useState(0);
  const [vigMin, setVigMin] = useState(0);

  const [modDays, setModDays] = useState(0);
  const [modNone, setModNone] = useState(false);
  const [modHour, setModHour] = useState(0);
  const [modMin, setModMin] = useState(0);

  const [walkDays, setWalkDays] = useState(0);
  const [walkNone, setWalkNone] = useState(false);
  const [walkHour, setWalkHour] = useState(0);
  const [walkMin, setWalkMin] = useState(0);

  const [sitHour, setSitHour] = useState(0);
  const [sitMin, setSitMin] = useState(0);
  const [place, setPlace] = useState("");

  const [touched, setTouched] = useState(false);

  // 공통 스타일 (TimePicker, Row 등에서 씀)
  const wrap = { maxWidth: 980, margin: "40px auto", padding: "0 16px" };
  const card = {
    border: "1px solid #c9d4ff",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  };
  const header = { background: "#f7f8fb", padding: "14px 18px", fontWeight: 800 };
  const selStyle = {
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    padding: "8px 10px",
    minWidth: 80,
  };

  // 유효성 검사
  const isValid = useMemo(() => {
    // 직업
    if (!jobType) return false;
    if (jobType === "기타" && !jobEtc.trim()) return false;

    // 고강도
    if (!vigNone && (vigDays <= 0 || vigHour + vigMin === 0)) return false;
    // 중강도
    if (!modNone && (modDays <= 0 || modHour + modMin === 0)) return false;
    // 걷기
    if (!walkNone && (walkDays <= 0 || walkHour + walkMin === 0)) return false;

    return true;
  }, [
    jobType,
    jobEtc,
    vigNone,
    vigDays,
    vigHour,
    vigMin,
    modNone,
    modDays,
    modHour,
    modMin,
    walkNone,
    walkDays,
    walkHour,
    walkMin,
  ]);

  // "안한다" 체크 시 값 리셋
  const handleNoneToggle = (which, checked) => {
    if (which === "vig") {
      setVigNone(checked);
      if (checked) {
        setVigDays(0);
        setVigHour(0);
        setVigMin(0);
      }
    } else if (which === "mod") {
      setModNone(checked);
      if (checked) {
        setModDays(0);
        setModHour(0);
        setModMin(0);
      }
    } else if (which === "walk") {
      setWalkNone(checked);
      if (checked) {
        setWalkDays(0);
        setWalkHour(0);
        setWalkMin(0);
      }
    }
  };

  // 공용 컴포넌트들
  const Error = ({ show, children }) =>
    show ? (
      <div style={{ color: "#d33", fontSize: 13, marginTop: 6 }}>{children}</div>
    ) : null;

  const TimePicker = ({ hour, setHour, min, setMin, disabled }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <select
        value={hour}
        onChange={(e) => setHour(Number(e.target.value))}
        disabled={disabled}
        style={selStyle}
      >
        {hourOptions.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <span>시간</span>
      <select
        value={min}
        onChange={(e) => setMin(Number(e.target.value))}
        disabled={disabled}
        style={selStyle}
      >
        {minOptions.map((m) => (
          <option key={m} value={m}>
            {m.toString().padStart(2, "0")}
          </option>
        ))}
      </select>
      <span>분</span>
    </div>
  );

  const Row = ({ no, title, right }) => (
    <div style={{ padding: "16px 18px", borderTop: "1px solid #e6e9f3" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "60px 1fr 1fr",
          gap: 16,
        }}
      >
        <div style={{ fontWeight: 700 }}>{no}</div>
        <div>{title}</div>
        <div>{right}</div>
      </div>
    </div>
  );

  // 다음 버튼 핸들러
  const handleNext = () => {
    setTouched(true);
    if (!isValid) return;

    // 이 설문 페이지의 결과를 payload로 정리
    const payload = {
      job_type: jobType === "기타" ? jobEtc.trim() : jobType,
      vigorous: {
        days: vigNone ? 0 : vigDays,
        min_per_day: vigNone ? 0 : vigHour * 60 + vigMin,
        none: vigNone,
      },
      moderate: {
        days: modNone ? 0 : modDays,
        min_per_day: modNone ? 0 : modHour * 60 + modMin,
        none: modNone,
      },
      walking: {
        days: walkNone ? 0 : walkDays,
        min_per_day: walkNone ? 0 : walkHour * 60 + walkMin,
        none: walkNone,
      },
      sitting_min_per_day: sitHour * 60 + sitMin,
      main_place: place.trim(),
    };

    // 1) localStorage에도 계속 쌓아주기 (기존 호환성 유지)
    const prev = JSON.parse(localStorage.getItem("survey") || "{}");
    localStorage.setItem(
      "survey",
      JSON.stringify({ ...prev, survey3: payload })
    );

    // 2) 전역(AppProvider.surveys)에도 저장
    setSurveys((prevAll) => ({
      ...prevAll,
      survey3: payload,
    }));

    // 3) 다음 페이지로 이동
    navigate("/survey4");
  };

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 16 }}>
        3단계. 국제신체활동설문지(IPAQ) (3/4)
      </h1>

      <div style={card}>
        <div style={header}>문항</div>

        {/* 1) 직업 특성 */}
        <Row
          no="1"
          title="본인의 직업 특성은 어떠합니까?"
          right={
            <div
              style={{
                display: "flex",
                gap: 16,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {["활동적", "비활동적", "기타"].map((opt) => (
                <label
                  key={opt}
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <input
                    type="radio"
                    name="jobType"
                    value={opt}
                    checked={jobType === opt}
                    onChange={(e) => setJobType(e.target.value)}
                  />
                  <span>{opt}</span>
                </label>
              ))}

              {jobType === "기타" && (
                <input
                  value={jobEtc}
                  onChange={(e) => setJobEtc(e.target.value)}
                  placeholder="예: 주부, 학생, 무직 등"
                  style={{ ...selStyle, minWidth: 220 }}
                />
              )}
            </div>
          }
        />
        <Error
          show={
            touched &&
            (!jobType || (jobType === "기타" && !jobEtc.trim()))
          }
        >
          직업 특성을 선택해주세요. (기타 선택 시 내용 입력)
        </Error>

        {/* 2) 고강도 */}
        <Row
          no="2-1"
          title="지난 7일 동안, 무거운 물건 나르기, 달리기, 에어로빅, 빠른 속도로 자전거 타기 등과 같은 고강도 신체활동을 며칠간 하셨습니까?"
          right={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>주</span>
              <select
                value={vigDays}
                onChange={(e) => setVigDays(Number(e.target.value))}
                disabled={vigNone}
                style={selStyle}
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span>일</span>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={vigNone}
                  onChange={(e) =>
                    handleNoneToggle("vig", e.target.checked)
                  }
                />
                <span>안한다</span>
              </label>
            </div>
          }
        />
        <Row
          no="2-2"
          title="위 운동의 평균 시간은 어떻게 됩니까?"
          right={
            <TimePicker
              hour={vigHour}
              setHour={setVigHour}
              min={vigMin}
              setMin={setVigMin}
              disabled={vigNone}
            />
          }
        />
        <Error
          show={
            touched &&
            !vigNone &&
            (vigDays <= 0 || vigHour + vigMin === 0)
          }
        >
          고강도 활동의 일수와 시간을 입력해주세요. (안한다면 체크)
        </Error>

        {/* 3) 중강도 */}
        <Row
          no="3-1"
          title="지난 7일 동안, 보통 속도로 자전거 타기, 복식 테니스 등과 같은 중강도 신체활동을 며칠간 하셨습니까?"
          right={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>주</span>
              <select
                value={modDays}
                onChange={(e) => setModDays(Number(e.target.value))}
                disabled={modNone}
                style={selStyle}
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span>일</span>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={modNone}
                  onChange={(e) =>
                    handleNoneToggle("mod", e.target.checked)
                  }
                />
                <span>안한다</span>
              </label>
            </div>
          }
        />
        <Row
          no="3-2"
          title="위 운동의 평균 시간은 어떻게 됩니까?"
          right={
            <TimePicker
              hour={modHour}
              setHour={setModHour}
              min={modMin}
              setMin={setModMin}
              disabled={modNone}
            />
          }
        />
        <Error
          show={
            touched &&
            !modNone &&
            (modDays <= 0 || modHour + modMin === 0)
          }
        >
          중강도 활동의 일수와 시간을 입력해주세요. (안한다면 체크)
        </Error>

        {/* 4) 걷기 */}
        <Row
          no="4-1"
          title="지난 7일간, 한 번에 적어도 10분 이상 걸은 날은 며칠입니까?"
          right={
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <span>주</span>
              <select
                value={walkDays}
                onChange={(e) =>
                  setWalkDays(Number(e.target.value))
                }
                disabled={walkNone}
                style={selStyle}
              >
                {dayOptions.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <span>일</span>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={walkNone}
                  onChange={(e) =>
                    handleNoneToggle("walk", e.target.checked)
                  }
                />
                <span>안한다</span>
              </label>
            </div>
          }
        />
        <Row
          no="4-2"
          title="위 운동의 평균 시간은 어떻게 됩니까?"
          right={
            <TimePicker
              hour={walkHour}
              setHour={setWalkHour}
              min={walkMin}
              setMin={setWalkMin}
              disabled={walkNone}
            />
          }
        />
        <Error
          show={
            touched &&
            !walkNone &&
            (walkDays <= 0 || walkHour + walkMin === 0)
          }
        >
          걷기의 일수와 시간을 입력해주세요. (안한다면 체크)
        </Error>

        {/* 5) 앉아있던 시간 */}
        <Row
          no="5"
          title="지난 7일간, 주중에 앉아서 보낸 시간이 보통 얼마나 됩니까?"
          right={
            <TimePicker
              hour={sitHour}
              setHour={setSitHour}
              min={sitMin}
              setMin={setSitMin}
              disabled={false}
            />
          }
        />

        {/* 6) 운동 장소 */}
        <Row
          no="6"
          title="주로 운동하는 장소는 어디입니까?"
          right={
            <input
              value={place}
              onChange={(e) => setPlace(e.target.value)}
              placeholder="예: 공원, 헬스장, 학교 체육관 등"
              style={{ ...selStyle, width: "100%" }}
            />
          }
        />
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
          onClick={() => navigate("/survey2")}
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

      <p style={{ marginTop: 10, color: "#6b7280", fontSize: 13 }}>
        ※ 각 항목은 지난 7일 기준으로 응답해주세요. ‘안한다’를 선택하면 해당 항목의
        일수/시간 입력은 비활성화됩니다.
      </p>
    </div>
  );
}
