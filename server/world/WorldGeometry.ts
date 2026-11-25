export function pointNearPolyline(
  x: number,
  y: number,
  points: number[][],
  threshold: number,
): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    const denominator = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / denominator),
    );
    const px = a[0] + dx * t,
      py = a[1] + dy * t;
    if (Math.hypot(x - px, y - py) < threshold) return true;
  }
  return false;
}

export function pointInRect(
  x: number,
  y: number,
  rect: number[],
  padding = 0,
): boolean {
  return (
    x >= rect[0] - padding &&
    x <= rect[0] + rect[2] + padding &&
    y >= rect[1] - padding &&
    y <= rect[1] + rect[3] + padding
  );
}

export function worldMeters(worldMetersValue: unknown): number {
  return Math.max(1, Number(worldMetersValue) || 10000);
}

export function normalizedMeters(
  meters: number,
  worldMetersValue: unknown,
): number {
  return Number(meters) / worldMeters(worldMetersValue);
}
