// src/logic/situpCounterByBodyAngle.js
// "몸각도" 하나만으로 싯업 카운트 (초기 보정 + 지속 보정)

const state = {
  phase: "down",         // "down" | "up"
  lastChange: 0,
  refractoryUntil: 0,
  calib: { collecting: true, t0: 0, maxDown: null, minUp: null },
  yawDeg: null,          // 선택적 yaw 추적
};

const angleBuf = [];
const hist = []; // 최근 각도 히스토리 [{t, ang}]

// ===== 파라미터 =====
const HOLD_MS = 150;        // 임계 통과 후 최소 머무름
const REFRACTORY_MS = 250;  // 1회 직후 재카운트 방지

// 🔽 초기 보정: 시작 1초 동안 최대/최소 각 수집 (0이면 꺼짐)
const AUTO_CALIBRATE_MS = 1000;

// 🔽 지속 보정(롤링 윈도우): 최근 4초 퍼센타일로 임계 자동 갱신
const ROLL_WINDOW_MS = 4000;
const P_HIGH = 0.80;        // 상위 퍼센타일(다운)
const P_LOW  = 0.20;        // 하위 퍼센타일(업)

const DEFAULT_DOWN = 110;   // 누운 상태 근처(큰 각)
const DEFAULT_UP   = 70;    // 앉은 상태 근처(작은 각)
const MIN_GAP      = 20;    // UP과 DOWN 최소 이격
const MARGIN       = 5;     // 안전 여유

// (선택) yaw가 크게 바뀌면 재보정
const RECALIB_YAW_DEG = 15;
// (선택) 노이즈 급증 시 재보정
const DRIFT_STD_RECALIB = 6;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function smooth5(v) {
  if (!Number.isFinite(v)) return v;
  angleBuf.push(v);
  if (angleBuf.length > 5) angleBuf.shift();
  const s = [...angleBuf].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function pushHist(t, ang) {
  hist.push({ t, ang });
  const cutoff = t - ROLL_WINDOW_MS;
  while (hist.length && hist[0].t < cutoff) hist.shift();
}

function percentile(sortedArr, p) {
  if (!sortedArr.length) return NaN;
  const idx = Math.min(
    sortedArr.length - 1,
    Math.max(0, Math.floor(p * (sortedArr.length - 1)))
  );
  return sortedArr[idx];
}

function stdDev(arr) {
  if (arr.length < 3) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
}

export function resetSitupCounterByBodyAngle() {
  state.phase = "down";
  state.lastChange = 0;
  state.refractoryUntil = 0;
  state.calib = {
    collecting: AUTO_CALIBRATE_MS > 0,
    t0: 0,
    maxDown: null,
    minUp: null,
  };
  state.yawDeg = null;
  angleBuf.length = 0;
  hist.length = 0;
}

/**
 * bodyAngle: 화면에 띄운 그 숫자 그대로 (ex. 177)
 * repsRef: { current: number }
 * opts?: { yawDeg?: number } // 선택
 * return { phaseStr, reps, debugAngle, thresholds: {UP, DOWN}, calibrated }
 */
export function updateSitupCountByBodyAngle(bodyAngle, repsRef, opts) {
  const t = nowMs();
  if (!Number.isFinite(bodyAngle)) {
    return {
      phaseStr: state.phase,
      reps: repsRef.current,
      debugAngle: null,
      thresholds: null,
      calibrated: false,
    };
  }

  const ang = smooth5(bodyAngle);
  pushHist(t, ang);

  // (선택) yaw 변화 크면 재보정 모드 재진입
  if (opts?.yawDeg != null) {
    if (state.yawDeg == null) state.yawDeg = opts.yawDeg;
    const yawDelta = Math.abs(opts.yawDeg - state.yawDeg);
    if (yawDelta >= RECALIB_YAW_DEG && AUTO_CALIBRATE_MS > 0) {
      state.calib.collecting = true;
      state.calib.t0 = t;
      state.calib.maxDown = ang;
      state.calib.minUp = ang;
    }
    state.yawDeg = opts.yawDeg;
  }

  // ── 1) 초기 보정
  let calibrated = false;
  if (AUTO_CALIBRATE_MS > 0) {
    if (state.calib.collecting) {
      if (!state.calib.t0) state.calib.t0 = t;
      state.calib.maxDown = Math.max(state.calib.maxDown ?? ang, ang); // 큰 각(누움)
      state.calib.minUp   = Math.min(state.calib.minUp   ?? ang, ang); // 작은 각(앉음)
      if (t - state.calib.t0 >= AUTO_CALIBRATE_MS) {
        state.calib.collecting = false;
        calibrated = true;
      }
    } else {
      calibrated = true;
    }
  }

  // ── 2) 지속 보정(롤링 퍼센타일) + 초기 보정 결합
  let downTH = DEFAULT_DOWN;
  let upTH   = DEFAULT_UP;

  const recent = hist.map(h => h.ang).sort((a, b) => a - b);
  if (recent.length >= 8) {
    const pLow  = percentile(recent, P_LOW);
    const pHigh = percentile(recent, P_HIGH);

    // 드리프트/노이즈 급증 시 재보정
    const sd = stdDev(recent);
    if (sd >= DRIFT_STD_RECALIB && AUTO_CALIBRATE_MS > 0) {
      state.calib.collecting = true;
      state.calib.t0 = t;
      state.calib.maxDown = ang;
      state.calib.minUp = ang;
    }

    let candDown = (Number.isFinite(pHigh) ? pHigh : DEFAULT_DOWN) - MARGIN;
    let candUp   = (Number.isFinite(pLow)  ? pLow  : DEFAULT_UP)   + MARGIN;

    if (AUTO_CALIBRATE_MS > 0 && state.calib.maxDown != null && state.calib.minUp != null) {
      const bootDown = state.calib.maxDown - MARGIN;
      const bootUp   = state.calib.minUp   + MARGIN;
      // 보수적으로 더 엄격한 쪽 채택
      candDown = Math.max(candDown, bootDown);
      candUp   = Math.min(candUp,   bootUp);
    }

    if (candDown - candUp < MIN_GAP) {
      const mid = (candDown + candUp) / 2;
      candDown = mid + MIN_GAP / 2;
      candUp   = mid - MIN_GAP / 2;
    }
    // 합리적 범위로 클램프
    downTH = Math.min(Math.max(candDown, 80), 160);
    upTH   = Math.min(Math.max(candUp,   30), 110);
  } else if (AUTO_CALIBRATE_MS > 0 && state.calib.maxDown != null && state.calib.minUp != null) {
    downTH = state.calib.maxDown - MARGIN;
    upTH   = state.calib.minUp   + MARGIN;
    if (downTH - upTH < MIN_GAP) {
      const mid = (downTH + upTH) / 2;
      downTH = mid + MIN_GAP / 2;
      upTH   = mid - MIN_GAP / 2;
    }
  }

  // ── 3) 리프랙토리
  if (t < state.refractoryUntil) {
    return {
      phaseStr: state.phase,
      reps: repsRef.current,
      debugAngle: ang,
      thresholds: { UP: upTH, DOWN: downTH },
      calibrated,
    };
  }

  // ── 4) 상태 전이 (다운→업→다운 == 1회)
  if (state.phase === "down") {
    if (ang <= upTH && t - state.lastChange > HOLD_MS) {
      state.phase = "up";
      state.lastChange = t;
    }
  } else { // "up"
    if (ang >= downTH && t - state.lastChange > HOLD_MS) {
      state.phase = "down";
      state.lastChange = t;
      repsRef.current += 1; // ✅ 카운트
      state.refractoryUntil = t + REFRACTORY_MS;
    }
  }

  return {
    phaseStr: state.phase,
    reps: repsRef.current,
    debugAngle: ang,
    thresholds: { UP: upTH, DOWN: downTH },
    calibrated,
  };
}
