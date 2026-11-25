import { COMBAT_RANGES, normalizeAbilityRange } from "./CombatRanges.js";

export function validateCombatActor(p: any, now = Date.now()) {
  if (!p) return [false, "Invalid combatant."];
  if (!p.online) return [false, "You are not connected."];
  if (p.dead || Number(p.hp || 0) <= 0) return [false, "You are dead."];
  if (
    (p.statuses || []).some(
      (s: any) =>
        s === "stunned" || (s?.id === "stunned" && Number(s.until || 0) > now),
    )
  )
    return [false, "You are stunned."];
  return [true];
}

export function validateAbilityOwnership(p: any, id: string, a: any) {
  if (!a) return [false, "Unknown ability."];
  if (id !== "basic_strike" && !p.abilityIds?.includes(id))
    return [false, "You have not learned that ability."];
  return [true];
}

export function validateResourceAndCooldown(
  p: any,
  a: any,
  now = Date.now(),
  effectiveCost = Number(a?.cost || 0),
) {
  if ((p.cooldowns?.[a.id] || 0) > now)
    return [false, `${a.name} is on cooldown.`];
  if (Number(p.resolve || 0) < Math.max(0, Number(effectiveCost) || 0))
    return [false, `Not enough ${p.resourceName}.`];
  if (Number(a.requiresShield || 0) && !p.equipment?.shield)
    return [false, "You need a shield equipped."];
  if (
    Number(a.requiresBlock || 0) &&
    Number(p.combat?.revengeUntil || 0) <= now
  )
    return [false, "Revenge requires a recent block."];
  return [true];
}

export function abilityRangeNormalized(a: any, world: any, zone: string) {
  const meters = Math.max(
    0,
    Number(
      world?.worldMetersFor?.(zone) ||
        world?.byId?.[zone]?.worldMeters ||
        10000,
    ),
  );
  return normalizeAbilityRange(a?.range, meters, COMBAT_RANGES.meleeMeters);
}

export function validateTargetRule(
  p: any,
  a: any,
  target: any,
  world: any,
  options: any = {},
) {
  const rule = String(
    a?.combatAudit?.targetRule ||
      (a?.heal || a?.partyBuff || a?.hot
        ? "ally"
        : a?.selfBuff
          ? "self"
          : "enemy"),
  );
  if (rule === "self") {
    if (target && target.id !== p.id)
      return [false, "That ability can only target yourself."];
    return [true, p];
  }
  if (!target)
    return [
      false,
      rule === "ally" ? "No valid ally target." : "No valid enemy target.",
    ];
  if ((target.dead || Number(target.hp || 0) <= 0) && !a?.revive)
    return [false, "That target is dead."];
  if (target.zone !== p.zone) return [false, "That target is in another zone."];
  if (rule === "ally") {
    if (
      target.id !== p.id &&
      (!p.partyId || target.partyId !== p.partyId) &&
      !options?.allowedAllyIds?.has?.(target.id)
    )
      return [false, "You can only support yourself or a party member."];
    const range = abilityRangeNormalized(a, world, p.zone);
    if (
      Number(a?.range || 0) > 0 &&
      Math.hypot(target.x - p.x, target.y - p.y) > range
    )
      return [false, `${a.name} is out of range.`];
    return [true, target];
  }
  if (rule === "enemy") {
    if (target.id === p.id)
      return [false, "That ability requires an enemy target."];
    const range = abilityRangeNormalized(a, world, p.zone);
    if (Math.hypot(target.x - p.x, target.y - p.y) > range)
      return [false, `You are out of range for ${a.name}.`];
    return [true, target];
  }
  return [false, "Invalid target rule."];
}
