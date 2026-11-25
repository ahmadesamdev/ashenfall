export type CombatPhase = "ready" | "casting" | "recovery" | "stunned" | "dead";

export function ensureCombatState(p: any) {
  p.combat = p.combat || {};
  p.combat.state = p.combat.state || "ready";
  p.combat.stateSince = Number(p.combat.stateSince || Date.now());
  p.combat.currentActionId = p.combat.currentActionId || null;
  p.combat.currentAbilityId = p.combat.currentAbilityId || null;
  p.combat.castUntil = Number(p.combat.castUntil || 0);
  p.combat.recoveryUntil = Number(p.combat.recoveryUntil || 0);
  p.combat.cancelWindowUntil = Number(p.combat.cancelWindowUntil || 0);
  p.combat.queuedAbilities = Array.isArray(p.combat.queuedAbilities)
    ? p.combat.queuedAbilities.slice(-1)
    : [];
  if (p.combat.queuedAbilities.length > 1)
    p.combat.queuedAbilities = p.combat.queuedAbilities.slice(-1);
  return p.combat;
}

export function transitionCombat(
  p: any,
  state: CombatPhase,
  now = Date.now(),
  meta: any = {},
) {
  const c = ensureCombatState(p);
  c.state = state;
  c.stateSince = now;
  if ("actionId" in meta) c.currentActionId = meta.actionId || null;
  if ("abilityId" in meta) c.currentAbilityId = meta.abilityId || null;
  if ("castUntil" in meta) c.castUntil = Number(meta.castUntil || 0);
  if ("recoveryUntil" in meta)
    c.recoveryUntil = Number(meta.recoveryUntil || 0);
  if ("cancelWindowUntil" in meta)
    c.cancelWindowUntil = Number(meta.cancelWindowUntil || 0);
  return c;
}

export function finishRecoveryIfReady(p: any, now = Date.now()) {
  const c = ensureCombatState(p);
  if (c.state === "recovery" && now >= Number(c.recoveryUntil || 0))
    transitionCombat(p, "ready", now, { actionId: null, abilityId: null });
  if (c.state === "casting" && now >= Number(c.castUntil || 0))
    transitionCombat(p, "recovery", now, {
      recoveryUntil: Math.max(now, Number(c.recoveryUntil || 0)),
    });
  return c.state;
}

export function queueAbility(
  p: any,
  id: string,
  requestId: string,
  priority = 0,
  now = Date.now(),
  world = false,
) {
  const c = ensureCombatState(p);
  const previous = c.queuedAbilities[0] || null;
  const item = {
    abilityId: id,
    requestId,
    priority: Number(priority || 0),
    queuedAt: now,
    world: !!world,
    expiresAt: now + 3500,
  };
  c.queuedAbilities = [item];
  c.queuedAbility = world ? null : id;
  c.queuedWorldAbility = world ? id : null;
  return {
    queued: true,
    abilityId: id,
    queueDepth: 1,
    replaced: !!previous,
    replacedAbilityId: previous?.abilityId || null,
    replacedRequestId: previous?.requestId || null,
    expiresAt: item.expiresAt,
  };
}

export function popQueuedAbility(p: any, now = Date.now()) {
  const c = ensureCombatState(p);
  if (now < Number(p.combat?.gcdReadyAt || 0)) return null;
  const item = c.queuedAbilities[0] || null;
  if (!item) {
    c.queuedAbility = null;
    c.queuedWorldAbility = null;
    return null;
  }
  if (now > Number(item.expiresAt || Number(item.queuedAt || 0) + 1000)) {
    clearCombatQueue(p);
    return null;
  }
  c.queuedAbilities = [];
  c.queuedAbility = null;
  c.queuedWorldAbility = null;
  return item;
}

export function clearCombatQueue(p: any) {
  const c = ensureCombatState(p);
  c.queuedAbilities = [];
  c.queuedAbility = null;
  c.queuedWorldAbility = null;
}
