export type NpcSchedulePhase = {
  id: string;
  start: number;
  end: number;
  anchor: string;
  activity: string;
  speedMeters?: number;
  interactable?: boolean;
};
export type NpcScheduleProfile = {
  id: string;
  loopMinutes: number;
  phases: NpcSchedulePhase[];
  anchors?: Record<string, { x: number; y: number }>;
  speedMeters?: number;
  movementMode?: "scheduled" | "stationary" | "local_radius";
  wanderRadiusMeters?: number;
  wanderIntervalSeconds?: number;
};

export class NpcScheduleEngine {
  profiles: Record<string, NpcScheduleProfile>;
  constructor(profiles: Record<string, NpcScheduleProfile> = {}) {
    this.profiles = profiles || {};
  }
  phase(n: any, nowMs: number) {
    const profile = this.profiles[String(n.scheduleProfile || "")];
    if (!profile?.phases?.length) return null;
    const loop = Math.max(1, Number(profile.loopMinutes || 60));
    const minutes = (((nowMs / 60000) % loop) + loop) % loop;
    return (
      profile.phases.find(
        (p) => minutes >= Number(p.start || 0) && minutes < Number(p.end || 0),
      ) || profile.phases[profile.phases.length - 1]
    );
  }
  anchor(n: any, phase: any) {
    if (!phase) return null;
    const profile = this.profiles[String(n.scheduleProfile || "")];
    const a =
      (n.scheduleAnchors || {})[phase.anchor] ||
      profile?.anchors?.[phase.anchor];
    return a ? { x: Number(a.x), y: Number(a.y) } : null;
  }
  private seed(n: any, phaseId: string) {
    const s = `${n.id}:${phaseId}`;
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
  }
  private pickLocalTarget(
    n: any,
    anchor: any,
    profile: any,
    nowMs: number,
    world: any,
  ) {
    const radius = Math.max(0, Number(profile.wanderRadiusMeters || 0));
    if (radius <= 0) return { ...anchor };
    const interval =
      Math.max(2, Number(profile.wanderIntervalSeconds || 8)) * 1000;
    const due = Number(n._scheduleLocalTargetAt || 0) <= nowMs;
    if (!due && n._scheduleLocalTarget) return n._scheduleLocalTarget;
    const cycle = Math.floor(nowMs / interval);
    const a = this.seed(n, `${cycle}:a`) * Math.PI * 2;
    const r = Math.sqrt(this.seed(n, `${cycle}:r`)) * radius;
    const nx = anchor.x + Math.cos(a) * world.normalizedMeters(n.zone, r);
    const ny = anchor.y + Math.sin(a) * world.normalizedMeters(n.zone, r);
    return {
      x: Math.max(0.02, Math.min(0.98, nx)),
      y: Math.max(0.03, Math.min(0.97, ny)),
    };
  }
  apply(n: any, nowMs: number, dt: number, world: any) {
    const profile = this.profiles[String(n.scheduleProfile || "")];
    if (!profile) return;
    const phase = this.phase(n, nowMs);
    if (!phase) return;
    const anchor = this.anchor(n, phase);
    if (!anchor) return;
    const mode = profile.movementMode || "scheduled";
    n.scheduleState = {
      profile: profile.id,
      phase: phase.id,
      activity: phase.activity,
      interactable: phase.interactable !== false,
      updatedAt: nowMs,
      movementMode: mode,
    };

    if (mode === "stationary") {
      n.x = anchor.x;
      n.y = anchor.y;
      n.targetX = anchor.x;
      n.targetY = anchor.y;
      n.velocityX = 0;
      n.velocityY = 0;
      n.moveState = "idle";
      n._scheduleTarget = { phase: phase.id, x: anchor.x, y: anchor.y };
      n._scheduleLocalTarget = null;
      n._scheduleLocalTargetAt = 0;
      return;
    }

    let target = anchor;
    if (mode === "local_radius") {
      if (!n._scheduleTarget || n._scheduleTarget.phase !== phase.id) {
        n._scheduleTarget = { phase: phase.id, x: n.x, y: n.y };
      }
      target = this.pickLocalTarget(n, anchor, profile, nowMs, world);
      n._scheduleLocalTarget = target;
      const intervalMs =
        Math.max(2, Number(profile.wanderIntervalSeconds || 8)) * 1000;
      n._scheduleLocalTargetAt =
        (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
    } else if (
      !n._scheduleTarget ||
      n._scheduleTarget.phase !== phase.id ||
      n._scheduleTarget.x !== anchor.x ||
      n._scheduleTarget.y !== anchor.y
    ) {
      n._scheduleTarget = { phase: phase.id, x: anchor.x, y: anchor.y };
      target = anchor;
    } else target = { x: n._scheduleTarget.x, y: n._scheduleTarget.y };

    n.targetX = target.x;
    n.targetY = target.y;
    const dx = n.targetX - n.x,
      dy = n.targetY - n.y,
      d = Math.hypot(dx, dy);
    if (d <= world.normalizedMeters(n.zone, 0.15)) {
      n.x = n.targetX;
      n.y = n.targetY;
      n.velocityX = 0;
      n.velocityY = 0;
      n.moveState = "idle";
      return;
    }
    const speed = Number(phase.speedMeters ?? profile.speedMeters ?? 2.2);
    const step = world.normalizedMeters(
      n.zone,
      Math.max(0.05, speed) * Math.max(0, dt),
    );
    const ratio = Math.min(1, step / d);
    const oldX = n.x,
      oldY = n.y;
    const candidate = world.resolveWalkableStep
      ? world.resolveWalkableStep(
          n.zone,
          oldX,
          oldY,
          oldX + dx * ratio,
          oldY + dy * ratio,
          null,
        )
      : { x: oldX + dx * ratio, y: oldY + dy * ratio, blocked: false };
    n.x = candidate.x;
    n.y = candidate.y;
    n.velocityX = (n.x - oldX) / Math.max(dt, 0.001);
    n.velocityY = (n.y - oldY) / Math.max(dt, 0.001);
    n.moveState = "moving";
  }
}
