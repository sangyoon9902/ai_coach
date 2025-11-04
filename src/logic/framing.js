import { IDX } from "../utils/poseIdx";
import { clamp } from "../utils/math";

export function angleRequirement(test) {
  switch (test) {
    case "situp":
      return { min: 55, max: 85, label: "측면(약 70°)" };
    case "reach":
      return { min: 75, max: 95, label: "측면(약 90°)" };
    case "step":
      return { min: 0, max: 20, label: "정면(≤20°)" };
    default:
      return { min: 0, max: 180, label: "" };
  }
}

export function estimateYawDeg(lms) {
  if (!lms) return NaN;
  const Ls = lms[IDX.L_SH];
  const Rs = lms[IDX.R_SH];
  const Lh = lms[IDX.L_HIP];
  const Rh = lms[IDX.R_HIP];
  const useShoulder =
    Ls && Rs && (Ls.visibility ?? 0) + (Rs.visibility ?? 0) >= 0.8;

  const A = useShoulder ? Ls : Lh;
  const B = useShoulder ? Rs : Rh;
  if (!A || !B) return NaN;

  const dx = Math.abs((B.x ?? 0) - (A.x ?? 0));
  const dz = Math.abs((B.z ?? 0) - (A.z ?? 0)); // 정면≈0, 측면≈90
  const yaw = (Math.atan2(dz, Math.max(1e-6, dx)) * 180) / Math.PI;
  return yaw;
}

export function angleOKForTest(test, yaw) {
  const req = angleRequirement(test);
  return Number.isFinite(yaw) && yaw >= req.min && yaw <= req.max;
}
