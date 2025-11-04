import React, { createContext, useContext, useState } from "react";

const Ctx = createContext(null);

export function AppProvider({ children }) {
  /* ───────── 사용자 기초정보 ───────── */
  const [profile, setProfile] = useState({
    name: "",
    sex: "M",   // 'M' | 'F'
    age: 25,
    height: 170, // cm
    weight: 65,  // kg
  });

  /* ───────── 현재 측정 중인/마지막으로 본 테스트 ───────── */
  const [selectedTest, setSelectedTest] = useState(null);
  // 'situp' | 'step' | 'reach'  (jump는 이제 안 씀)

  /* ───────── 측정 결과 + 전송 관련 필드 ───────── */
  const [session, setSession] = useState({
    // ⬇⬇⬇ 전송/표시용 추가 필드
    readyToSend: false, // 모든 측정/설문 완료 후 true로 → Results에서 버튼 노출
    traceId: "",
    planMd: "",

    // 윗몸일으키기
    situp: {
      reps: 0,
      maxTorsoDeg: 0,
    },

    // 스텝 테스트
    step: {
      durationSec: 180,
      bpm: 96,
      compliance: 0,     // 0~1
      recoveryAvg: null,
      vo2max: null,
    },

    // 좌전굴(유연성)
    reach: {
      bestCm: 0,
      scalePxPerCm: 0,
      baselinePx: null,
    },
  });

  /* ───────── 설문 결과 (Survey1~4 전체 누적) ───────── */
  const [surveys, setSurveys] = useState({});

  /* ───────── 전송 플로우 액션 ───────── */
  // 모든 측정/설문이 끝났을 때 호출 → Results에서 버튼이 보임
  const markSessionReady = () =>
    setSession((s) => ({ ...s, readyToSend: true, traceId: "", planMd: "" }));

  // 서버 응답 수신 후 저장 → Results에서 마크다운/trace_id 표시
  const setResultFromServer = ({ traceId, planMd }) =>
    setSession((s) => ({
      ...s,
      traceId: traceId ?? "",
      planMd: planMd ?? "",
    }));

  /* ───────── 컨텍스트 value ───────── */
  const value = {
    profile,
    setProfile,

    selectedTest,
    setSelectedTest,

    session,
    setSession,

    surveys,
    setSurveys,

    // 전송 플로우
    markSessionReady,
    setResultFromServer,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useApp = () => useContext(Ctx);
