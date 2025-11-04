// src/logic/stepLogic.js
export const STEP_STEPPING_SEC = 180;
export const STEP_RECOVERY_SEC = 60;

export function calcFitnessScore(recovery1minBPM) {
  if (!Number.isFinite(recovery1minBPM)) return null;

  // (임시) 간단 등급 컷
  let out;
  if (recovery1minBPM < 90) out = { grade: 1, desc: "매우 우수" };
  else if (recovery1minBPM < 100) out = { grade: 2, desc: "우수" };
  else if (recovery1minBPM < 110) out = { grade: 3, desc: "보통" };
  else if (recovery1minBPM < 120) out = { grade: 4, desc: "보통 이하" };
  else if (recovery1minBPM < 130) out = { grade: 5, desc: "부족" };
  else out = { grade: 6, desc: "매우 부족" };

  // (임시) 단순 VO2max 추정: 낮을수록 높다고 가정
  const vo2max = Math.max(20, Math.min(70, 80 - 0.4 * recovery1minBPM));
  return { ...out, vo2max: Number(vo2max.toFixed(1)) };
}

// ─────────────────────────────────────────────
// 심박 폴링 훅 (토큰 불필요, 프록시만 호출)
// 사용법: const bpm = usePulsoidBpm(enabled, apiBase);
// ─────────────────────────────────────────────
import { useEffect, useRef, useState } from "react";

export function usePulsoidBpm(enabled, apiBase = "http://localhost:3001") {
  const [bpm, setBpm] = useState(null);
  const timerRef = useRef(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;

    if (!enabled) {
      if (timerRef.current) clearInterval(timerRef.current);
      setBpm(null);
      return () => { aliveRef.current = false; };
    }

    async function tick() {
      try {
        const res = await fetch(`${apiBase}/api/heart-rate`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();

        // 다양한 응답 키 방어적으로 처리
        const vRaw = data?.heart_rate ?? data?.bpm ?? data?.value ?? data?.data?.heart_rate ?? null;
        const v = Number(vRaw);
        if (aliveRef.current && Number.isFinite(v) && v > 0) setBpm(v);
      } catch {
        // 네트워크 오류는 다음 주기에 재시도
      }
    }

    // 즉시 1회, 이후 1초 폴링
    tick();
    timerRef.current = setInterval(tick, 1000);

    return () => {
      aliveRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, apiBase]);

  return bpm;
}
