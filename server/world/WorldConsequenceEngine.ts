export class WorldConsequenceEngine {
  private readonly config: any;
  constructor(config: any = {}) {
    this.config = config || {};
  }
  normalize(raw: any, fallback: any) {
    return { ...fallback, ...(raw && typeof raw === "object" ? raw : {}) };
  }
  profile(eventId: string, outcome: string) {
    const defaults = this.config.defaults || {};
    const base = defaults[outcome] || defaults.recovering || {};
    const specific =
      this.config.events?.[eventId]?.[outcome] ||
      this.config.events?.[eventId]?.[
        outcome === "completed"
          ? "completion"
          : outcome === "failed"
            ? "failure"
            : outcome
      ] ||
      {};
    return this.normalize(specific, base);
  }
  regionalWorld(effect: any, outcome: string, phase: string = "opening") {
    const rw = effect?.regionalWorld || {};
    const activity = { ...(rw.activity || {}) };
    const activityState = rw.activityState || {};
    const phaseLabels = activity.phaseLabels || {};
    return {
      activityId: activity.id || null,
      activityName: activity.name || null,
      activityKind: activity.kind || null,
      poiId: activity.poiId || activityState.poiId || null,
      phaseLabel: phaseLabels[phase] || phaseLabels.opening || null,
      phaseLabels: { ...phaseLabels },
      playerFacing: Boolean(activity.playerFacing),
      activityState: activityState.state || null,
      activityStateLabel: activityState.label || null,
      spawnPlan: { ...(rw.spawnPlan || {}) },
    };
  }
  poiState(effect: any, outcome: string, phase: string = "calm") {
    const raw = effect?.poiStates || {};
    const out: any = {};
    for (const [id, v] of Object.entries(raw)) {
      if (v && typeof v === "object") out[id] = { ...v };
    }
    return out;
  }
  apply(regionState: any, event: any, outcome: string, now = Date.now()) {
    const effect = this.profile(event.defId || event.id, outcome);
    regionState.worldState = {
      version: 2,
      eventId: event.id,
      defId: event.defId || event.id,
      kind: event.kind,
      zone: event.zone,
      outcome: outcome,
      lastOutcome:
        outcome === "recovering"
          ? regionState.worldState?.lastOutcome ||
            regionState.lastOutcome ||
            null
          : outcome,
      regionalPressure: Number(effect.regionalPressure ?? 1),
      travelMultiplier: Number(effect.travelMultiplier ?? 1),
      resourceMultiplier: Number(effect.resourceMultiplier ?? 1),
      mobDamageMultiplier: Number(effect.mobDamageMultiplier ?? 1),
      mobAggroMultiplier: Number(effect.mobAggroMultiplier ?? 1),
      settlementState: String(effect.settlementState || "calm"),
      npcAlert: Boolean(effect.npcAlert),
      worldPhase: String(effect.worldPhase || effect.settlementState || "calm"),
      poiStates: this.poiState(effect, outcome, "calm"),
      regionalWorld: this.regionalWorld(effect, outcome, "calm"),
      updatedAt: now,
      history: Array.isArray(regionState.worldState?.history)
        ? regionState.worldState.history.slice(-9)
        : [],
    };
    regionState.worldState.history.push({
      eventId: event.id,
      defId: event.defId || event.id,
      outcome,
      at: now,
    });
    return regionState.worldState;
  }
  active(regionState, event, now = Date.now()) {
    const effect = this.profile(event.defId || event.id, "active");
    const current = regionState.worldState || {};
    regionState.worldState = {
      ...current,
      version: 2,
      eventId: event.id,
      defId: event.defId || event.id,
      kind: event.kind,
      zone: event.zone,
      outcome: "active",
      lastOutcome: current.lastOutcome || null,
      regionalPressure: Number(effect.regionalPressure ?? 1),
      travelMultiplier: Number(effect.travelMultiplier ?? 1),
      resourceMultiplier: Number(effect.resourceMultiplier ?? 1),
      mobDamageMultiplier: Number(effect.mobDamageMultiplier ?? 1),
      mobAggroMultiplier: Number(effect.mobAggroMultiplier ?? 1),
      settlementState: String(effect.settlementState || "alert"),
      npcAlert: Boolean(effect.npcAlert),
      worldPhase: String(
        this.regionalWorld(effect, "active", event.phase || "opening")
          .phaseLabel ||
          effect.worldPhase ||
          effect.settlementState ||
          "alert",
      ),
      poiStates: this.poiState(effect, "active", event.phase || "opening"),
      regionalWorld: this.regionalWorld(
        effect,
        "active",
        event.phase || "opening",
      ),
      phase: event.phase || "opening",
      updatedAt: now,
    };
    return regionState.worldState;
  }
  updateActivePhase(
    regionState: any,
    event: any,
    phase: string,
    now = Date.now(),
  ) {
    const effect = this.profile(event.defId || event.id, "active");
    const rw = this.regionalWorld(effect, "active", phase);
    const current = regionState.worldState || {};
    regionState.worldState = {
      ...current,
      version: 2,
      phase,
      worldPhase: String(rw.phaseLabel || effect.worldPhase || phase),
      regionalWorld: rw,
      updatedAt: now,
      poiStates: this.poiState(effect, "active", phase),
    };
    return regionState.worldState;
  }
  snapshot(state: any) {
    if (!state)
      return {
        outcome: "calm",
        lastOutcome: null,
        regionalPressure: 1,
        travelMultiplier: 1,
        resourceMultiplier: 1,
        mobDamageMultiplier: 1,
        mobAggroMultiplier: 1,
        settlementState: "calm",
        npcAlert: false,
      };
    return {
      ...state,
      history: Array.isArray(state.history) ? state.history.slice(-10) : [],
    };
  }
}
