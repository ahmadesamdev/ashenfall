import { emitAudioCue } from "./AudioPlaceholders.js";
class CombatPredictionController {
  predictedAbilities = new Map<string, any>();
  predictedCooldowns = new Map<string, number>();
  predictedInputQueue: any[] = [];
  predictedGcdUntil = 0;
  constructor(private readonly deps: any) {}
  combatPriority(a: any) {
    return Number(
      a?.combatFeel?.priority ??
        (a?.tags?.includes?.("interrupt")
          ? 100
          : a?.tags?.includes?.("defensive")
            ? 80
            : a?.power >= 2.5
              ? 70
              : 50),
    );
  }
  queuePredictedInput(abilityId: string, requestId: string) {
    const a = this.deps.getAbility(abilityId);
    if (!a?.queueable) return;
    this.predictedInputQueue = [
      {
        abilityId,
        requestId,
        queuedAt: performance.now(),
        expiresAt: performance.now() + 3500,
      },
    ];
  }
  removePredictedInput(id: string) {
    const i = this.predictedInputQueue.findIndex((x) => x.requestId === id);
    if (i >= 0) this.predictedInputQueue.splice(i, 1);
  }
  triggerHitStop(ms: number) {
    if (this.deps.reduceMotion()) return;
    this.deps.setHitStop(Math.max(0, Math.min(90, ms)));
  }
  start(abilityId: string, targetIds: string[], requestId: string) {
    const a = this.deps.getAbility(abilityId),
      p = this.deps.getPlayer();
    if (!a || !requestId) return;
    const existing = [...this.predictedAbilities.entries()].find(
      ([, x]: any) =>
        x.abilityId === abilityId &&
        ["pending", "buffered", "queued", "approaching"].includes(x.status),
    );
    if (existing) return;
    const startedAt = performance.now(),
      targets = targetIds.length
        ? targetIds.slice(0, 12)
        : [p?.id].filter(Boolean),
      n = this.deps.now(),
      queued =
        n < Number(p?.combat?.gcdReadyAt || 0) || this.predictedGcdUntil > n;
    emitAudioCue("ability_press", abilityId);
    emitAudioCue("ability_cast", abilityId);
    this.predictedAbilities.set(requestId, {
      abilityId,
      targetIds: targets,
      startedAt,
      status: queued ? "buffered" : "pending",
      visualOnly: true,
      priority: this.combatPriority(a),
      accepted: false,
    });
    if (queued) this.queuePredictedInput(abilityId, requestId);
    const fx = this.deps.getLocalFx();
    const casting = Number(a.castTime) > 0;
    if (!casting)
      fx.push(
        ...targets.map((id) => ({
          type: "predicted_skill",
          target: id,
          abilityId,
          requestId,
          at: Date.now(),
          expiresAt: Date.now() + 380,
        })),
      );
    if (
      !casting &&
      a.combatFeel?.projectile &&
      targets.length &&
      targets[0] !== p?.id
    ) {
      const origin = p || { x: 0.5, y: 0.5 },
        target = this.deps.findTarget(targets[0]);
      fx.push({
        type: "projectile",
        target: targets[0],
        abilityId,
        requestId,
        at: Date.now(),
        expiresAt: Date.now() + Number(a.combatFeel.projectileTravelMs || 200),
        durationMs: Number(a.combatFeel.projectileTravelMs || 200),
        startX: Number(origin.x),
        startY: Number(origin.y),
        targetX: Number(target?.x ?? origin.x),
        targetY: Number(target?.y ?? origin.y),
        projectileKind: a.combatFeel.projectileKind || "bolt",
        projectileHoming: a.combatFeel.projectileHoming !== false,
        trail: a.combatFeel.projectileTrail !== false,
      });
    }
    if (!casting && targets.includes(p?.id))
      fx.push({
        type: "predicted_cast",
        target: p.id,
        abilityId,
        requestId,
        at: Date.now(),
        expiresAt: Date.now() + 500,
      });
    if (a.cooldown && !queued && !casting)
      this.predictedCooldowns.set(
        a.id,
        Math.max(
          this.predictedCooldowns.get(a.id) || 0,
          n + Number(a.cooldown) * 1000,
        ),
      );
    if (a.gcd && !queued)
      this.predictedGcdUntil = Math.max(
        this.predictedGcdUntil,
        n + Number(a.gcd) * 1000,
      );
    this.deps.markUiDirty();
  }
  settle(id: string, ok: boolean, detail: any) {
    const pred = this.predictedAbilities.get(id);
    if (!pred) return;
    const fx = this.deps.getLocalFx();
    if (ok && detail?.casting) {
      pred.status = "casting";
      pred.accepted = true;
      this.removePredictedInput(id);
      this.deps.setLocalFx(fx.filter((f: any) => f.requestId !== id));
      setTimeout(() => this.predictedAbilities.delete(id), 400);
      this.deps.markUiDirty();
      return;
    }
    if (ok && (detail?.executed || detail?.killed)) {
      pred.status = "confirmed";
      pred.accepted = true;
      this.removePredictedInput(id);
      emitAudioCue("ability_confirmed", pred.abilityId);
      if (Number(detail?.damage || detail?.heal || 0) > 0) {
        fx.push({
          type: "hit_reaction",
          target: pred.targetIds?.[0],
          abilityId: pred.abilityId,
          requestId: id,
          at: Date.now(),
          expiresAt: Date.now() + 260,
        });
        this.triggerHitStop(
          Number(
            this.deps.getAbility(pred.abilityId)?.combatFeel?.hitStopMs || 42,
          ),
        );
      }
      pred.confirmedAt = performance.now();
      pred.serverDetail = detail;
    } else if (ok && (detail?.approaching || detail?.queued)) {
      pred.status = detail.approaching ? "approaching" : "queued";
      pred.accepted = true;
      pred.acceptedAt = performance.now();
      this.removePredictedInput(id);
      if (detail?.replacedRequestId) {
        const replaced = this.predictedAbilities.get(
          String(detail.replacedRequestId),
        );
        if (replaced) {
          replaced.status = "replaced";
          this.predictedCooldowns.delete(replaced.abilityId);
          this.predictedAbilities.delete(String(detail.replacedRequestId));
        }
      }
    } else if (!ok) {
      pred.status = "rejected";
      this.removePredictedInput(id);
      emitAudioCue("ability_rejected", pred.abilityId);
      this.deps.setLocalFx(fx.filter((f: any) => f.requestId !== id));
      this.predictedCooldowns.delete(pred.abilityId);
      if (
        [...this.predictedAbilities.values()].every(
          (x: any) => x.status === "rejected",
        )
      )
        this.predictedGcdUntil = 0;
      setTimeout(() => this.predictedAbilities.delete(id), 120);
    }
    this.deps.markUiDirty();
  }
  reconcile() {
    const p = this.deps.getPlayer();
    if (!p) return;
    const n = this.deps.now();
    const nowPerf = performance.now();
    this.predictedInputQueue = this.predictedInputQueue.filter(
      (x) => nowPerf - Number(x.queuedAt || 0) <= 3500,
    );
    for (const [id, pred] of [...this.predictedAbilities.entries()]) {
      if (pred.status === "confirmed") {
        const cd = Number(p.cooldowns?.[pred.abilityId] || 0),
          gcd = Number(p.combat?.gcdReadyAt || 0);
        if (cd > n) {
          this.predictedCooldowns.delete(pred.abilityId);
          this.predictedGcdUntil = Math.max(this.predictedGcdUntil, gcd);
          this.predictedAbilities.delete(id);
          continue;
        }
        if (nowPerf - Number(pred.confirmedAt || 0) > 1800) {
          this.predictedCooldowns.delete(pred.abilityId);
          this.predictedAbilities.delete(id);
        }
      } else if (
        (pred.status === "queued" || pred.status === "approaching") &&
        nowPerf - Number(pred.acceptedAt || pred.startedAt || 0) > 5500
      ) {
        this.predictedCooldowns.delete(pred.abilityId);
        this.predictedAbilities.delete(id);
      }
    }
    if (this.predictedGcdUntil && this.predictedGcdUntil < n)
      this.predictedGcdUntil = 0;
  }
  expire() {
    const cutoff = performance.now() - 6000;
    for (const [id, p] of this.predictedAbilities) {
      if (Number(p.startedAt || 0) < cutoff) {
        this.predictedAbilities.delete(id);
        this.deps.setLocalFx(
          this.deps.getLocalFx().filter((f: any) => f.requestId !== id),
        );
        this.predictedCooldowns.delete(p.abilityId);
      }
    }
    this.reconcile();
  }
}
export { CombatPredictionController };
