import { rollAvoidance } from "./CombatTable.js";
export type PartyRole = "Tank" | "Healer" | "Support" | "DPS";

export const PARTY_ROLE_PROFILES: Record<
  PartyRole,
  {
    threatMultiplier: number;
    incomingDamageMultiplier: number;
    healingThreatMultiplier: number;
  }
> = {
  Tank: {
    threatMultiplier: 1.65,
    incomingDamageMultiplier: 0.88,
    healingThreatMultiplier: 0.35,
  },
  Healer: {
    threatMultiplier: 0.7,
    incomingDamageMultiplier: 0.94,
    healingThreatMultiplier: 0.55,
  },
  Support: {
    threatMultiplier: 0.8,
    incomingDamageMultiplier: 0.92,
    healingThreatMultiplier: 0.45,
  },
  DPS: {
    threatMultiplier: 1.0,
    incomingDamageMultiplier: 1.0,
    healingThreatMultiplier: 0.45,
  },
};

export function partyRole(p: any): PartyRole {
  const explicit = String(p?.partyRole || "");
  if (
    explicit === "Tank" ||
    explicit === "Healer" ||
    explicit === "Support" ||
    explicit === "DPS"
  )
    return explicit;
  const id = String(p?.classId || "").toLowerCase();
  if (id === "vanguard") return "Tank";
  if (id === "hierophant") return "Healer";
  if (id === "warden") return "Support";
  return "DPS";
}

export function partyRoleProfile(p: any) {
  return PARTY_ROLE_PROFILES[partyRole(p)];
}
export function combatThreat(p: any, amount: number, multiplier = 1) {
  return (
    Math.max(0, Number(amount) || 0) *
    partyRoleProfile(p).threatMultiplier *
    Math.max(0, Number(multiplier) || 0) *
    (p?.combat?.guardUntil > Date.now() ? 1.15 : 1)
  );
}
export interface IncomingOptions {
  avoidable?: boolean;
  attackerLevel?: number;
}
function calculateIncomingPartyDamage(
  p: any,
  amount: number,
  now = Date.now(),
  rng = Math.random,
  options: IncomingOptions = {},
): any {
  if (options.avoidable) {
    const avoided = rollAvoidance(
      p,
      Number(options.attackerLevel || p?.level || 1),
      rng,
    );
    if (avoided) return { damage: 0, blocked: false, avoided };
  }
  const durability = Math.max(0.5, Number(p?.combatProfile?.durability || 1));
  let multiplier = partyRoleProfile(p).incomingDamageMultiplier;
  let blocked = false;
  const isVanguard = String(p?.classId || "").toLowerCase() === "vanguard";
  const hasShield = Boolean(p?.equipment?.shield);
  const profile = p?.combatProfile || {};
  const blockChance = Math.max(
    0,
    Math.min(100, Number(profile.blockChance || 0)),
  );
  let remaining = Math.max(0, Number(amount) || 0);
  for (const barrier of (p?.statuses || []).filter(
    (s: any) => s && Number(s.absorbRemaining || 0) > 0,
  )) {
    if (remaining <= 0) break;
    const absorbed = Math.min(remaining, Number(barrier.absorbRemaining || 0));
    barrier.absorbRemaining -= absorbed;
    remaining -= absorbed;
    if (barrier.absorbRemaining <= 0)
      p.statuses = p.statuses.filter((x: any) => x !== barrier);
  }
  if (remaining <= 0)
    return {
      damage: 0,
      blocked: false,
      absorbed: Math.max(0, Number(amount) || 0),
    };
  amount = remaining;
  if (isVanguard && hasShield && blockChance > 0 && rng() < blockChance / 100) {
    const blockMitigation = Math.max(
      0,
      Math.min(0.9, Number(profile.blockMitigation ?? 0.55)),
    );
    multiplier *= 1 - blockMitigation;
    blocked = true;
    const resolveGain = Math.max(0, Number(profile.resolveOnBlock || 0));
    if (resolveGain > 0)
      p.resolve = Math.min(
        Number(p.maxResolve || p.resolve || 0),
        Number(p.resolve || 0) + resolveGain,
      );
    p.combat = p.combat || {};
    p.combat.revengeUntil = Math.max(
      Number(p.combat.revengeUntil || 0),
      now + 4000,
    );
    p.combat.lastBlockAt = now;
    p.combat.lastBlockAmount = Math.max(0, Number(amount) || 0);
  }
  return {
    damage: Math.max(
      1,
      Math.round(((Number(amount) || 0) * multiplier) / durability),
    ),
    blocked,
  };
}
export function incomingPartyDamage(p: any, amount: number) {
  return calculateIncomingPartyDamage(p, amount).damage;
}
export function applyIncomingPartyDamage(
  p: any,
  amount: number,
  now = Date.now(),
  rng = Math.random,
  options: IncomingOptions = {},
) {
  return calculateIncomingPartyDamage(p, amount, now, rng, options);
}
export function healingThreat(p: any, amount: number) {
  return (
    Math.max(0, Number(amount) || 0) *
    partyRoleProfile(p).healingThreatMultiplier
  );
}
