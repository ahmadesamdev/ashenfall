export interface ClientMotionState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  inputX: number;
  inputY: number;
  targetX: number | null;
  targetY: number | null;
  mode: "idle" | "walk" | "run";
  lastAt: number;
  serverX: number;
  serverY: number;
  serverVx: number;
  serverVy: number;
  serverState: string;
  serverMovementIntent: string;
  serverSequence: number;
  serverTargetX: number | null;
  serverTargetY: number | null;
  serverApproachSatisfied: boolean;
  serverAutoApproach: boolean;
  serverNow: number;
  zone: string | null;
  effectiveSpeedMeters: number;
  serverIdleSince: number;
  localIntentKind: "none" | "input" | "target";
  localIntentSource: "none" | "manual" | "combat";
  localIntentStartedAt: number;
  intentEndedAt: number;
  awaitingServerStop: boolean;
}

export interface ClientMotionDependencies {
  getPlayer: () => any;
  getClockOffset: () => number;
  getWorldMeters: () => number;
  getRegionalSpeed?: () => number;
  getRttMs?: () => number;
  isBlocked?: (x: number, y: number) => boolean;
}

export class ClientMotionController {
  state: ClientMotionState;
  private correctionStartedAt = 0;
  private correctionUntil = 0;
  private correctionFrom = { x: 0, y: 0 };
  private correctionTo = { x: 0, y: 0 };
  private serverStoppedObservedAt = 0;
  private approachSide = 1;
  private manualIntentAwaitingAuthority = false;

  constructor(private readonly deps: ClientMotionDependencies) {
    this.state = this.createState(0.5, 0.5, null);
  }

  private createState(
    x: number,
    y: number,
    zone: string | null,
  ): ClientMotionState {
    return {
      x: Number.isFinite(x) ? x : 0.5,
      y: Number.isFinite(y) ? y : 0.5,
      vx: 0,
      vy: 0,
      inputX: 0,
      inputY: 0,
      targetX: null,
      targetY: null,
      mode: "idle",
      lastAt: performance.now(),
      serverX: Number.isFinite(x) ? x : 0.5,
      serverY: Number.isFinite(y) ? y : 0.5,
      serverVx: 0,
      serverVy: 0,
      serverState: "idle",
      serverMovementIntent: "none",
      serverTargetX: null,
      serverTargetY: null,
      serverApproachSatisfied: false,
      serverAutoApproach: false,
      serverNow: Date.now(),
      serverSequence: -1,
      zone,
      effectiveSpeedMeters: 45,
      serverIdleSince: 0,
      localIntentKind: "none",
      localIntentSource: "none",
      localIntentStartedAt: 0,
      intentEndedAt: 0,
      awaitingServerStop: false,
    };
  }

  reset(x = 0.5, y = 0.5, zone: string | null = null) {
    this.state = this.createState(x, y, zone);
    this.correctionStartedAt = 0;
    this.correctionUntil = 0;
    this.serverStoppedObservedAt = 0;
    this.approachSide = 1;
    this.manualIntentAwaitingAuthority = false;
  }

  setMode(mode: string) {
    this.state.mode = mode === "run" ? "run" : "walk";
  }

  isManualOverrideActive() {
    return (
      this.manualIntentAwaitingAuthority ||
      this.state.localIntentSource === "manual"
    );
  }

  clearManualOverride() {
    this.manualIntentAwaitingAuthority = false;
  }

  sync(sample: any) {
    if (!sample) return;
    const sampleZone = sample.zone == null ? null : String(sample.zone);
    const sampleX = Number(sample.x),
      sampleY = Number(sample.y);
    if (!this.state.zone && sampleZone) {
      this.state.zone = sampleZone;
      if (Number.isFinite(sampleX) && Number.isFinite(sampleY)) {
        this.state.x = sampleX;
        this.state.y = sampleY;
      }
      this.state.vx = 0;
      this.state.vy = 0;
    } else if (
      this.state.zone &&
      sampleZone &&
      this.state.zone !== sampleZone
    ) {
      this.reset(sampleX, sampleY, sampleZone);
      return;
    }
    const sampleNow = Number(sample.serverNow || Date.now());
    const sampleSequence = Number(sample.sequence);
    if (Number.isFinite(sampleSequence) && sampleSequence >= 0) {
      if (sampleSequence <= this.state.serverSequence) return;
      this.state.serverSequence = sampleSequence;
    }
    if (sampleNow < this.state.serverNow - 250) return;

    this.state.serverX = Number.isFinite(sampleX)
      ? sampleX
      : this.state.serverX;
    this.state.serverY = Number.isFinite(sampleY)
      ? sampleY
      : this.state.serverY;
    this.state.serverVx = Number(sample.vx || 0);
    this.state.serverVy = Number(sample.vy || 0);
    this.state.serverState = String(sample.state || "idle");
    this.state.serverMovementIntent = String(sample.movementIntent || "none");
    const rawTargetX = sample.targetX,
      rawTargetY = sample.targetY;
    this.state.serverTargetX =
      rawTargetX != null && Number.isFinite(Number(rawTargetX))
        ? Number(rawTargetX)
        : null;
    this.state.serverTargetY =
      rawTargetY != null && Number.isFinite(Number(rawTargetY))
        ? Number(rawTargetY)
        : null;
    this.state.serverApproachSatisfied = Boolean(sample.approachSatisfied);
    this.state.serverAutoApproach = Boolean(sample.autoApproach);
    this.state.serverNow = sampleNow;
    if (
      this.manualIntentAwaitingAuthority &&
      (this.state.serverMovementIntent === "manual" ||
        (this.state.serverState === "moving" &&
          (Math.abs(this.state.serverVx) > 0.00001 ||
            Math.abs(this.state.serverVy) > 0.00001)))
    )
      this.manualIntentAwaitingAuthority = false;
    if (
      !this.manualIntentAwaitingAuthority &&
      this.state.localIntentSource === "manual" &&
      this.state.localIntentKind === "none" &&
      this.state.serverMovementIntent !== "manual"
    )
      this.state.localIntentSource = "none";
    if (
      this.state.serverState === "idle" &&
      Math.abs(this.state.serverVx) < 0.0001 &&
      Math.abs(this.state.serverVy) < 0.0001
    ) {
      if (!this.state.serverIdleSince)
        this.state.serverIdleSince = performance.now();
      if (!this.serverStoppedObservedAt)
        this.serverStoppedObservedAt = performance.now();
    } else {
      this.state.serverIdleSince = 0;
      this.serverStoppedObservedAt = 0;
    }

    if (sample.movementMode === "run" || sample.movementMode === "walk")
      this.state.mode = sample.movementMode;
    const serverSpeed = Number(sample.speedMeters);
    if (Number.isFinite(serverSpeed) && serverSpeed > 0)
      this.state.effectiveSpeedMeters = serverSpeed;
    else {
      const p = this.deps.getPlayer();
      const fallback =
        Number(this.state.mode === "run" ? p?.runSpeed : p?.speed) || 45;
      this.state.effectiveSpeedMeters = Math.max(
        1,
        fallback * Number(this.deps.getRegionalSpeed?.() || 1),
      );
    }
    if (!Number.isFinite(this.state.serverX)) this.state.serverX = this.state.x;
    if (!Number.isFinite(this.state.serverY)) this.state.serverY = this.state.y;
  }

  private anchorBeforeManualIntent() {
    if (
      this.state.localIntentKind !== "none" ||
      this.state.serverState !== "idle"
    )
      return;
    const wm = Math.max(1, this.deps.getWorldMeters());
    const a = this.authoritativeNowPosition();
    const error = Math.hypot(a.x - this.state.x, a.y - this.state.y) * wm;
    if (error > 0.75) {
      this.state.x = a.x;
      this.state.y = a.y;
      this.state.vx = 0;
      this.state.vy = 0;
    }
  }

  beginTarget(
    x: number,
    y: number,
    mode: "walk" | "run" = "run",
    source: "manual" | "combat" = "manual",
  ) {
    if (source === "manual") this.anchorBeforeManualIntent();
    const tx = Number(x),
      ty = Number(y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    this.state.mode = mode;
    this.state.inputX = 0;
    this.state.inputY = 0;
    this.state.targetX = Math.max(0.01, Math.min(0.99, tx));
    this.state.targetY = Math.max(0.01, Math.min(0.99, ty));
    this.state.localIntentKind = "target";
    this.state.localIntentSource = source;
    this.state.localIntentStartedAt = performance.now();
    this.state.intentEndedAt = 0;
    if (source === "manual") this.manualIntentAwaitingAuthority = true;
    else this.manualIntentAwaitingAuthority = false;
    this.state.awaitingServerStop = false;
    this.correctionStartedAt = 0;
    this.correctionUntil = 0;
  }

  updateTarget(x: number, y: number) {
    const tx = Number(x),
      ty = Number(y);
    if (!Number.isFinite(tx) || !Number.isFinite(ty)) return;
    this.state.targetX = Math.max(0.01, Math.min(0.99, tx));
    this.state.targetY = Math.max(0.01, Math.min(0.99, ty));
    if (this.state.localIntentKind === "none") {
      this.state.localIntentKind = "target";
      this.state.localIntentSource = "combat";
      this.state.localIntentStartedAt = performance.now();
    }
  }

  setInput(dx: number, dy: number, mode: "walk" | "run" = "run") {
    this.anchorBeforeManualIntent();
    const length = Math.hypot(Number(dx) || 0, Number(dy) || 0);
    if (length < 0.001) {
      this.stop();
      return;
    }
    this.state.inputX = Number(dx) / length;
    this.state.inputY = Number(dy) / length;
    this.state.targetX = null;
    this.state.targetY = null;
    this.state.mode = mode;
    this.state.localIntentKind = "input";
    this.state.localIntentSource = "manual";
    this.state.localIntentStartedAt = performance.now();
    this.state.intentEndedAt = 0;
    this.manualIntentAwaitingAuthority = true;
    this.state.awaitingServerStop = false;
    this.correctionStartedAt = 0;
    this.correctionUntil = 0;
  }

  stop() {
    this.state.inputX = 0;
    this.state.inputY = 0;
    this.state.targetX = null;
    this.state.targetY = null;
    this.state.mode = "idle";
    this.state.vx = 0;
    this.state.vy = 0;
    this.state.localIntentKind = "none";
    this.state.localIntentSource = "none";
    this.state.intentEndedAt = performance.now();
    this.state.localIntentStartedAt = 0;
    this.state.awaitingServerStop = true;
    this.correctionStartedAt = 0;
    this.correctionUntil = 0;
    this.serverStoppedObservedAt = 0;
  }

  private lastSampleAgeMs = 0;

  private latencySeconds() {
    const rtt = Number(this.deps.getRttMs?.() || 0);
    const measured = Number.isFinite(rtt) ? Math.max(0, Math.min(800, rtt)) : 0;
    const inferred = Math.max(0, Math.min(400, this.lastSampleAgeMs)) * 2;
    return Math.max(measured, inferred) / 1000;
  }

  private expectedAuthoritativePosition() {
    const a = this.authoritativeNowPosition();
    if (this.state.serverState !== "moving") return a;
    const lead = Math.min(0.4, this.latencySeconds() / 2);
    return {
      x: a.x + this.state.serverVx * lead,
      y: a.y + this.state.serverVy * lead,
    };
  }

  private reconcileToleranceMeters(baseMeters: number, marginSeconds: number) {
    const speed = Math.max(1, Number(this.state.effectiveSpeedMeters) || 45);
    return Math.max(
      baseMeters,
      speed * (this.latencySeconds() + marginSeconds),
    );
  }

  private correctionDurationMs(errorMeters: number, minMs: number) {
    const speed = Math.max(1, Number(this.state.effectiveSpeedMeters) || 45);
    return Math.min(700, Math.max(minMs, (errorMeters / speed) * 1000 * 0.85));
  }

  private authoritativeNowPosition() {
    const offset = Number(this.deps.getClockOffset?.() || 0);
    const ageMs = Math.max(
      0,
      Math.min(
        180,
        Date.now() + offset - Number(this.state.serverNow || Date.now()),
      ),
    );
    const age = ageMs / 1000;
    return {
      x: this.state.serverX + this.state.serverVx * age,
      y: this.state.serverY + this.state.serverVy * age,
    };
  }

  private beginCorrection(to: { x: number; y: number }, duration = 180) {
    this.correctionFrom = { x: this.state.x, y: this.state.y };
    this.correctionTo = to;
    this.correctionStartedAt = performance.now();
    this.correctionUntil = this.correctionStartedAt + duration;
  }

  private finishStopReconciliation() {
    const wm = Math.max(1, this.deps.getWorldMeters());
    const a = this.authoritativeNowPosition();
    const error = Math.hypot(a.x - this.state.x, a.y - this.state.y) * wm;
    if (error <= 0.65) {
      this.state.x = a.x;
      this.state.y = a.y;
      this.state.vx = 0;
      this.state.vy = 0;
      return;
    }
    this.beginCorrection(
      a,
      this.correctionDurationMs(error, error > 8 ? 260 : 220),
    );
  }

  tick(t: number) {
    const p = this.deps.getPlayer();
    if (!p?.hasCharacter)
      return { x: Number(p?.x || 0.5), y: Number(p?.y || 0.5) };
    if (this.state.zone !== p.zone) {
      this.reset(p.x, p.y, p.zone);
      return { x: this.state.x, y: this.state.y };
    }
    const dt = Math.min(0.25, Math.max(0.001, (t - this.state.lastAt) / 1000));
    this.state.lastAt = t;
    const wm = Math.max(1, this.deps.getWorldMeters());

    if (this.correctionUntil > 0) {
      const start = this.correctionStartedAt,
        end = this.correctionUntil,
        alpha = Math.max(
          0,
          Math.min(1, (t - start) / Math.max(1, end - start)),
        );
      const eased = alpha * alpha * (3 - 2 * alpha);
      const from = this.correctionFrom,
        to = this.correctionTo;
      this.state.x = from.x + (to.x - from.x) * eased;
      this.state.y = from.y + (to.y - from.y) * eased;
      this.state.vx = 0;
      this.state.vy = 0;
      if (t >= end) {
        this.correctionStartedAt = 0;
        this.correctionUntil = 0;
        this.state.x = to.x;
        this.state.y = to.y;
      }
      return {
        x: Math.max(0.005, Math.min(0.995, this.state.x)),
        y: Math.max(0.005, Math.min(0.995, this.state.y)),
      };
    }

    const baseSpeed = Math.max(
      1,
      Number(this.state.effectiveSpeedMeters) ||
        Number(this.state.mode === "run" ? p.runSpeed : p.speed) ||
        45,
    );
    const stepNorm = (baseSpeed / wm) * dt;
    const hasInput = Math.hypot(this.state.inputX, this.state.inputY) > 0.001;
    const hasTarget = this.state.targetX != null && this.state.targetY != null;
    const localIntent = hasInput || hasTarget;
    const authoritativeCombatApproach =
      this.state.localIntentSource === "combat" &&
      this.state.serverMovementIntent === "combat" &&
      this.state.serverAutoApproach &&
      !this.state.serverApproachSatisfied;
    let dirX = this.state.inputX,
      dirY = this.state.inputY;

    if (hasTarget && !authoritativeCombatApproach) {
      const dx = Number(this.state.targetX) - this.state.x,
        dy = Number(this.state.targetY) - this.state.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.000001) {
        dirX = dx / d;
        dirY = dy / d;
      } else {
        dirX = 0;
        dirY = 0;
      }
    }

    if (authoritativeCombatApproach) {
      const svx = Number(this.state.serverVx) || 0,
        svy = Number(this.state.serverVy) || 0;
      const serverSpeedNorm = Math.hypot(svx, svy);
      if (serverSpeedNorm > 0.000001) {
        dirX = svx / serverSpeedNorm;
        dirY = svy / serverSpeedNorm;
        const moveNorm = serverSpeedNorm * dt;
        this.state.x += dirX * moveNorm;
        this.state.y += dirY * moveNorm;
      } else if (hasTarget) {
        const dx = Number(this.state.targetX) - this.state.x,
          dy = Number(this.state.targetY) - this.state.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.000001) {
          dirX = dx / d;
          dirY = dy / d;
          const move = Math.min(stepNorm, d);
          this.state.x += dirX * move;
          this.state.y += dirY * move;
        } else {
          dirX = 0;
          dirY = 0;
        }
      } else {
        dirX = 0;
        dirY = 0;
      }
      const auth = this.authoritativeNowPosition();
      const combatErrorMeters =
        Math.hypot(auth.x - this.state.x, auth.y - this.state.y) * wm;
      if (combatErrorMeters > 10) {
        const combatBlend = 1 - Math.exp(-3.5 * dt);
        this.state.x += (auth.x - this.state.x) * combatBlend;
        this.state.y += (auth.y - this.state.y) * combatBlend;
      }
      this.state.vx = svx;
      this.state.vy = svy;
      if (this.state.targetX == null || this.state.targetY == null) {
        this.state.targetX = this.state.serverTargetX;
        this.state.targetY = this.state.serverTargetY;
      }
      this.state.localIntentKind = "target";
      this.state.localIntentSource = "combat";
    } else if (localIntent && Math.abs(dirX) + Math.abs(dirY) > 0) {
      if (hasTarget) {
        const dx = Number(this.state.targetX) - this.state.x,
          dy = Number(this.state.targetY) - this.state.y,
          d = Math.hypot(dx, dy);
        if (d <= stepNorm) {
          this.state.x = Number(this.state.targetX);
          this.state.y = Number(this.state.targetY);
          this.state.targetX = null;
          this.state.targetY = null;
          this.state.localIntentKind = "none";
          if (this.state.localIntentSource !== "manual")
            this.state.localIntentSource = "none";
          this.state.intentEndedAt = performance.now();
          this.state.awaitingServerStop = true;
        } else {
          const nx = this.state.x + dirX * stepNorm,
            ny = this.state.y + dirY * stepNorm;
          this.state.x = nx;
          this.state.y = ny;
        }
      } else {
        const nx = this.state.x + dirX * stepNorm,
          ny = this.state.y + dirY * stepNorm;
        this.state.x = nx;
        this.state.y = ny;
      }
    }

    const sampleAgeMs = Math.max(
      0,
      Date.now() +
        Number(this.deps.getClockOffset?.() || 0) -
        Number(this.state.serverNow || Date.now()),
    );
    this.lastSampleAgeMs = sampleAgeMs;
    const auth = this.authoritativeNowPosition();
    const errorMeters =
      Math.hypot(auth.x - this.state.x, auth.y - this.state.y) * wm;
    const expected = this.expectedAuthoritativePosition();
    const expectedErrorMeters =
      Math.hypot(expected.x - this.state.x, expected.y - this.state.y) * wm;

    if (authoritativeCombatApproach) {
      this.correctionStartedAt = 0;
      this.correctionUntil = 0;
    } else if (localIntent) {
      if (this.state.serverState === "idle" && (hasInput || hasTarget)) {
        if (!this.serverStoppedObservedAt)
          this.serverStoppedObservedAt = performance.now();
      }
      const awaitingServerGraceMs = Math.max(
        700,
        this.latencySeconds() * 2500 + 300,
      );
      const waitingForServer =
        this.manualIntentAwaitingAuthority &&
        performance.now() - this.state.localIntentStartedAt <
          awaitingServerGraceMs;
      const idleTolerance = this.reconcileToleranceMeters(18, 0.25);
      const movingTolerance = this.reconcileToleranceMeters(30, 0.35);
      const combatLike =
        this.state.localIntentSource === "combat" ||
        this.state.serverMovementIntent === "combat";
      if (
        !waitingForServer &&
        sampleAgeMs < 260 &&
        this.state.serverState === "idle" &&
        errorMeters > idleTolerance &&
        performance.now() -
          (this.serverStoppedObservedAt || performance.now()) >
          220
      ) {
        this.beginCorrection(
          auth,
          combatLike ? 360 : this.correctionDurationMs(errorMeters, 180),
        );
      } else if (
        sampleAgeMs < 260 &&
        this.state.serverState === "moving" &&
        expectedErrorMeters > movingTolerance
      ) {
        this.beginCorrection(
          expected,
          combatLike
            ? 360
            : this.correctionDurationMs(expectedErrorMeters, 200),
        );
      }
    } else if (this.state.awaitingServerStop) {
      if (
        this.state.serverState === "idle" &&
        performance.now() - this.state.intentEndedAt >= 45
      ) {
        this.state.awaitingServerStop = false;
        this.finishStopReconciliation();
      }
    } else if (this.state.serverState === "idle") {
      if (errorMeters > 0.05) {
        if (errorMeters > 24) {
          this.state.x = auth.x;
          this.state.y = auth.y;
        } else {
          const blend =
            1 - Math.exp(-Math.min(24, Math.max(8, errorMeters * 2.2)) * dt);
          this.state.x += (auth.x - this.state.x) * blend;
          this.state.y += (auth.y - this.state.y) * blend;
        }
      } else {
        this.state.x = auth.x;
        this.state.y = auth.y;
      }
    }

    this.state.vx = localIntent ? (dirX * baseSpeed) / wm : 0;
    this.state.vy = localIntent ? (dirY * baseSpeed) / wm : 0;
    return {
      x: Math.max(0.005, Math.min(0.995, this.state.x)),
      y: Math.max(0.005, Math.min(0.995, this.state.y)),
    };
  }
}
