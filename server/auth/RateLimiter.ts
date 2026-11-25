export class RateLimiter {
  private buckets = new Map<string, { startedAt: number; count: number }>();
  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly maxKeys = 10_000,
  ) {}

  allow(key: string, now = Date.now()) {
    const k = String(key || "unknown").slice(0, 200);
    const existing = this.buckets.get(k);
    if (!existing || now - existing.startedAt >= this.windowMs) {
      this.buckets.set(k, { startedAt: now, count: 1 });
      this.trim(now);
      return true;
    }
    if (existing.count >= this.max) return false;
    existing.count += 1;
    return true;
  }

  retryAfterSeconds(key: string, now = Date.now()) {
    const b = this.buckets.get(String(key || "unknown").slice(0, 200));
    if (!b) return 0;
    return Math.max(1, Math.ceil((this.windowMs - (now - b.startedAt)) / 1000));
  }

  private trim(now: number) {
    if (this.buckets.size <= this.maxKeys) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
      if (this.buckets.size <= this.maxKeys) break;
    }
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest !== undefined) this.buckets.delete(oldest);
    }
  }
}
