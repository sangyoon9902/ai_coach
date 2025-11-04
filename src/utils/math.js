export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

export function angleDeg(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const m1 = Math.hypot(v1.x, v1.y) || 1e-6;
  const m2 = Math.hypot(v2.x, v2.y) || 1e-6;
  const cos = clamp(dot / (m1 * m2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}
