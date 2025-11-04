// src/api/buildSessionPayload.js
import { useApp } from "../state/AppState";

// BMI 계산
function calcBMI(weightKg, heightCm) {
  const w = Number(weightKg);
  const h = Number(heightCm);
  if (!w || !h) return null;
  const m = h / 100;
  const bmiVal = w / (m * m);
  return Number(bmiVal.toFixed(1));
}

function safeVo2max(stepObj) {
  if (!stepObj) return null;
  if (stepObj.vo2max == null) return null;
  return stepObj.vo2max;
}

export function useBuildSessionPayload() {
  const { profile, session, surveys } = useApp(); // ✅ AppContext에서 직접 가져오기

  const name = profile?.name ?? "";
  const sex = profile?.sex ?? "M";
  const age = Number(profile?.age ?? 0);
  const height_cm = Number(profile?.height ?? 0);
  const weight_kg = Number(profile?.weight ?? 0);
  const bmi = calcBMI(weight_kg, height_cm);

  const situp_reps = session?.situp?.reps ?? 0;
  const reach_cm = session?.reach?.bestCm ?? 0;

  const step_recovery_bpm = session?.step?.recoveryAvg ?? null;
  const step_vo2max = safeVo2max(session?.step);

  return {
    user: {
      name,
      sex,
      age,
      height_cm,
      weight_kg,
      bmi,
    },
    surveys: surveys || {}, // ✅ Context 기반 설문 데이터
    measurements: {
      situp_reps,
      reach_cm,
      step_recovery_bpm,
      step_vo2max,
    },
  };
}
