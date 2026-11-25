export class MotionInterpolator {
  private samples = new Map<string, any[]>();
  private lastSeenSequence = new Map<string, number>();
  private zoneId: string | null = null;
  private sequence = -1;
  private clockOffset = 0;
  private clockInitialized = false;
  private worldMeters = 1000;
  constructor(
    private readonly interpolationMs = 85,
    private readonly extrapolationMs = 120,
    private readonly onClockOffset?: (offset: number) => void,
  ) {}
  reset() {
    this.samples.clear();
    this.lastSeenSequence.clear();
    this.zoneId = null;
    this.sequence = -1;
  }
  ingest(next: any) {
    if (!next) return;
    if (this.zoneId !== next.zone) {
      this.samples.clear();
      this.lastSeenSequence.clear();
      this.zoneId = next.zone;
      this.sequence = -1;
    }
    this.worldMeters = Math.max(
      1,
      Number(next.worldMeters) || this.worldMeters || 1000,
    );
    const seq = Number(next.sequence ?? -1);
    if (seq >= 0 && seq <= this.sequence) return;
    if (seq >= 0) this.sequence = seq;
    if (next.serverNow) {
      const raw = Number(next.serverNow) - Date.now();
      if (!this.clockInitialized) {
        this.clockOffset = raw;
        this.clockInitialized = true;
      } else this.clockOffset += (raw - this.clockOffset) * 0.08;
      this.onClockOffset?.(this.clockOffset);
    }
    const seen = new Set<string>();
    const add = (e: any, id: string) => {
      if (!e?.id) return;
      const k = id || e.id;
      seen.add(k);
      if (seq >= 0) this.lastSeenSequence.set(k, seq);
      const l = this.samples.get(k) || [];
      const sample = {
        serverNow: Number(next.serverNow || Date.now()),
        receivedAt: performance.now(),
        x: Number(e.x || 0),
        y: Number(e.y || 0),
        vx: Number(e.vx || 0),
        vy: Number(e.vy || 0),
        zone: e.zone || next.zone,
      };
      const last = l.at(-1);
      if (last && sample.serverNow <= last.serverNow) return;
      l.push(sample);
      while (l.length > 8) l.shift();
      this.samples.set(k, l);
    };
    add(next.player, "me");
    for (const x of next.players || []) add(x, `p:${x.id}`);
    for (const m of next.mobs || []) add(m, `m:${m.id}`);

    if (seq >= 0) {
      for (const [k, last] of this.lastSeenSequence) {
        if (seq - last > 6) {
          this.lastSeenSequence.delete(k);
          this.samples.delete(k);
        }
      }
    }
  }
  has(key: string) {
    return this.samples.has(key);
  }
  position(
    key: string,
    fx: number,
    fy: number,
    _offset: number,
    interpolationMsOverride?: number,
    extrapolationMsOverride?: number,
  ) {
    const fallback = { x: Number(fx || 0), y: Number(fy || 0), vx: 0, vy: 0 };
    const l = this.samples.get(key);
    if (!l?.length) return fallback;
    const lastSeen = this.lastSeenSequence.get(key);
    if (
      this.sequence >= 0 &&
      lastSeen != null &&
      this.sequence - lastSeen > 6
    ) {
      this.samples.delete(key);
      this.lastSeenSequence.delete(key);
      return fallback;
    }
    const im = Math.max(
      0,
      Number(interpolationMsOverride ?? this.interpolationMs),
    );
    const em = Math.max(
      0,
      Number(extrapolationMsOverride ?? this.extrapolationMs),
    );
    const renderNow = Date.now() + this.clockOffset - im;
    if (l.length === 1) {
      const a = l[0],
        age = Math.max(0, Math.min(em, renderNow - a.serverNow)) / 1000;
      return { x: a.x + a.vx * age, y: a.y + a.vy * age, vx: a.vx, vy: a.vy };
    }
    for (let i = 1; i < l.length; i++) {
      const a = l[i - 1],
        b = l[i];
      if (renderNow <= b.serverNow) {
        const span = Math.max(1, b.serverNow - a.serverNow);
        const t = Math.max(0, Math.min(1, (renderNow - a.serverNow) / span));
        return {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          vx: a.vx + (b.vx - a.vx) * t,
          vy: a.vy + (b.vy - a.vy) * t,
        };
      }
    }
    const q = l[l.length - 1];
    const age = Math.max(0, Math.min(em, renderNow - q.serverNow)) / 1000;
    return { x: q.x + q.vx * age, y: q.y + q.vy * age, vx: q.vx, vy: q.vy };
  }
}
