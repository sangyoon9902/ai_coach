// src/logic/sitAndReachLogic.js

// Mediapipe pose indices
export const IDX = {
  NOSE: 0,
  L_SH: 11,
  R_SH: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_INDEX: 19,   // 손끝(검지)
  R_INDEX: 20,   // 손끝(검지)
  L_HIP: 23,
  R_HIP: 24,
  L_ANK: 27,     // 발목
  R_ANK: 28,
  L_FOOT: 31,    // 발끝
  R_FOOT: 32,    // 발끝
};

// ─────────────────────────────────────────────────────────────
// Yaw 계산 (정면≈0°, 측면≈90°)
// ─────────────────────────────────────────────────────────────
export function estimateYawDeg(lms) {
  const Ls = lms?.[IDX.L_SH], Rs = lms?.[IDX.R_SH];
  const Lh = lms?.[IDX.L_HIP], Rh = lms?.[IDX.R_HIP];
  const useShoulder = Ls && Rs && (Ls.visibility ?? 0) + (Rs.visibility ?? 0) >= 0.8;
  const A = useShoulder ? Ls : Lh;
  const B = useShoulder ? Rs : Rh;
  if (!A || !B) return NaN;
  const dx = Math.abs((B.x ?? 0) - (A.x ?? 0));
  const dz = Math.abs((B.z ?? 0) - (A.z ?? 0));
  return (Math.atan2(dz, Math.max(1e-6, dx)) * 180) / Math.PI;
}

// 각도만 엄격: 85~95°
export function angleOKForReach(yaw, yawMin = 85, yawMax = 95) {
  return Number.isFinite(yaw) && yaw >= yawMin && yaw <= yawMax;
}

// ─────────────────────────────────────────────────────────────
// 사이드(Left/Right) 선택: 가시성 점수로 자동 선택
// ─────────────────────────────────────────────────────────────
function vis(p) { return (p?.visibility ?? 0); }

export function chooseDominantSide(lms) {
  if (!lms?.length) return { side: null, scoreL: 0, scoreR: 0 };

  const scoreL = vis(lms[IDX.L_INDEX]) + vis(lms[IDX.L_WRIST]) +
                 vis(lms[IDX.L_FOOT])  + vis(lms[IDX.L_ANK])   +
                 vis(lms[IDX.L_HIP]);
  const scoreR = vis(lms[IDX.R_INDEX]) + vis(lms[IDX.R_WRIST]) +
                 vis(lms[IDX.R_FOOT])  + vis(lms[IDX.R_ANK])   +
                 vis(lms[IDX.R_HIP]);

  const side = (scoreL === 0 && scoreR === 0) ? null : (scoreL >= scoreR ? "L" : "R");
  return { side, scoreL, scoreR };
}

// 내부 헬퍼: 보이는 포인트의 x, 안 보이면 대체 포인트 x
function pickX(p, alt, visTh = 0.35) {
  if (p && (p.visibility ?? 0) >= visTh) return p.x;
  if (alt && (alt.visibility ?? 0) >= visTh) return alt.x;
  return null;
}

// ─────────────────────────────────────────────────────────────
/**
 * [한쪽 사이드만] 좌전굴 "전방 X 성분"(부호 포함, cm) 계산
 *  + : 손끝이 발끝 "넘김", 0 : "닿음", - : "못 미침"
 *  - 출력: { cm, side, ok }
 */
// ─────────────────────────────────────────────────────────────
export function estimateForwardReachSignedCmX_oneSide(lms, userHeightCm = 170) {
  if (!lms?.length || !Number.isFinite(userHeightCm) || userHeightCm <= 0) {
    return { cm: 0, side: null, ok: false };
  }

  const { side } = chooseDominantSide(lms);
  if (!side) return { cm: 0, side: null, ok: false };

  const HAND = (side === "L") ? IDX.L_INDEX : IDX.R_INDEX;
  const WRIST = (side === "L") ? IDX.L_WRIST : IDX.R_WRIST;
  const FOOT = (side === "L") ? IDX.L_FOOT  : IDX.R_FOOT;
  const ANK  = (side === "L") ? IDX.L_ANK   : IDX.R_ANK;
  const HIP  = (side === "L") ? IDX.L_HIP   : IDX.R_HIP;

  const handX = pickX(lms[HAND], lms[WRIST]);
  const footX = pickX(lms[FOOT], lms[ANK]);
  const hipX  = lms[HIP]?.x ?? null;
  if (handX == null || footX == null || hipX == null) {
    return { cm: 0, side, ok: false };
  }

  const dir = Math.sign((footX - hipX) || 1e-6);       // 같은 사이드의 엉덩이→발 방향
  const forwardNormX = dir * (handX - footX);          // 부호 포함 전방 X
  const cm = forwardNormX * userHeightCm;              // 신장 기반 cm 환산

  return { cm: Math.max(-80, Math.min(cm, 80)), side, ok: true }; // 안전 클램프
}

// ─────────────────────────────────────────────────────────────
// 피크-홀드 컨트롤러 (최대치에서 needSec 유지해야 완료)
// - breakHold(): 홀드 카운트만 0으로(최대값/armed 유지)
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// 피크-홀드 컨트롤러 (최대치에서 needSec 유지해야 완료)
// - 첫 유효 샘플을 baseline으로 설정(음수도 OK)
// - baseline 대비 minIncrementToArm 만큼 개선되면 armed=true → 홀드 카운트 시작
// - 유지구간 평균으로 best를 점진적으로 상향(스파이크 억제)
// - breakHold(): 홀드 카운트만 0으로(최대값/armed 유지)
// ─────────────────────────────────────────────────────────────
export function makePeakHoldController({
  needSec = 3.0,
  fps = 30,
  tolCm = 1.0,
  minIncrementToArm = 0.5,
} = {}) {
  let best = null;        // ❗ 처음엔 미설정 (0이 아님) → 음수 baseline 허용
  let armed = false;
  let holdFrames = 0;

  // 유지구간 평균(“버틴 값”으로 best를 올림)
  let holdSum = 0;
  let holdCount = 0;

  const NEED = Math.round(needSec * fps);

  function push(currentCm) {
    // 방어
    if (!Number.isFinite(currentCm)) currentCm = 0;

    // 1) 최초 샘플을 baseline으로 설정 (음수도 OK)
    if (best === null) {
      best = currentCm;
      armed = false;      // 아직 arm 아님
      holdFrames = 0;
      holdSum = 0;
      holdCount = 0;
      return { bestCm: best, armed, holdSec: 0, done: false };
    }

    // 2) 피크 갱신 로직
    if (currentCm > best + minIncrementToArm) {
      // 충분히 개선 → arm 시작 및 홀드 초기화
      best = currentCm;
      armed = true;
      holdFrames = 0;
      holdSum = 0;
      holdCount = 0;
    } else if (currentCm > best) {
      // 미세 개선은 즉시 반영 (arm 여부는 유지)
      best = currentCm;
    }

    // 3) 홀드 판정 및 평균 기반 상향
    if (armed && currentCm >= best - tolCm) {
      holdFrames += 1;
      holdSum += currentCm;
      holdCount += 1;

      // 유지 구간의 평균값이 best보다 크면 부드럽게 상향
      const avg = holdSum / Math.max(1, holdCount);
      if (avg > best) best = avg;
    } else {
      // 피크 근처 이탈 → 홀드 카운트만 리셋 (최대값/armed 유지)
      holdFrames = 0;
      holdSum = 0;
      holdCount = 0;
    }

    const done = armed && holdFrames >= NEED;
    return { bestCm: best, armed, holdSec: holdFrames / fps, done };
  }

  function breakHold() {
    // 프레이밍 깨지면 호출: 진행 일시정지 느낌 (최대/armed 유지)
    holdFrames = 0;
    holdSum = 0;
    holdCount = 0;
  }

  function reset() {
    best = null;          // ❗ 다시 baseline부터
    armed = false;
    holdFrames = 0;
    holdSum = 0;
    holdCount = 0;
  }

  return { push, breakHold, reset };
}
