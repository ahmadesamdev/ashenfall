export const COMBAT_TABLE = Object.freeze({
  enabled: true,
  missBase: 0.05,
  missPerLevelAbove: 0.01,
  missCap: 0.25,
  bossLevelBonus: 3,
  critSuppressionPerLevel: 0.5,
  critSuppressionCap: 15,
  avoidMissBase: 0.05,
  avoidMissPerLevelDelta: 0.005,
  avoidMissMin: 0.02,
  avoidMissMax: 0.1,
  dodgeBase: 3,
  dodgePerAgility: 0.05,
  avoidanceCap: 40,
});

export type AvoidOutcome = "miss" | "dodge" | null;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const num = (v: any, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function isBossLike(enemy: any): boolean {
  return !!(
    enemy?.boss ||
    enemy?.isBoss ||
    enemy?.kind === "boss" ||
    enemy?.tier === "boss"
  );
}

export function isHelpless(defender: any, now = Date.now()): boolean {
  return (
    (defender?.statuses || []).some(
      (s: any) =>
        s === "stunned" ||
        (s?.id === "stunned" && num(s.until, Infinity) > now),
    ) || num(defender?.stunnedUntil) > now
  );
}

export function levelGap(
  attacker: any,
  target: any,
  opts: { boss?: boolean } = {},
): number {
  const a = Math.max(1, num(attacker?.level, 1));
  const t =
    num(target?.level, a) +
    (opts.boss || isBossLike(target) ? COMBAT_TABLE.bossLevelBonus : 0);
  return t - a;
}

export function playerMissChance(
  player: any,
  target: any,
  opts: { boss?: boolean } = {},
): number {
  if (!COMBAT_TABLE.enabled) return 0;
  const gap = Math.max(0, levelGap(player, target, opts));
  const hit = Math.max(0, num(player?.bonuses?.hit)) / 100;
  return clamp(
    COMBAT_TABLE.missBase + gap * COMBAT_TABLE.missPerLevelAbove - hit,
    0,
    COMBAT_TABLE.missCap,
  );
}

export function critSuppression(
  player: any,
  target: any,
  opts: { boss?: boolean } = {},
): number {
  if (!COMBAT_TABLE.enabled) return 0;
  return clamp(
    Math.max(0, levelGap(player, target, opts)) *
      COMBAT_TABLE.critSuppressionPerLevel,
    0,
    COMBAT_TABLE.critSuppressionCap,
  );
}

export function attackMisses(
  player: any,
  target: any,
  opts: { boss?: boolean } = {},
  rng: () => number = Math.random,
): boolean {
  if (isHelpless(target)) return false;
  return rng() < playerMissChance(player, target, opts);
}

export function playerAvoidance(
  defender: any,
  attackerLevel: number,
): { miss: number; dodge: number } {
  if (!COMBAT_TABLE.enabled || isHelpless(defender))
    return { miss: 0, dodge: 0 };
  const delta =
    num(defender?.level, 1) - num(attackerLevel, num(defender?.level, 1));
  let miss = clamp(
    COMBAT_TABLE.avoidMissBase + delta * COMBAT_TABLE.avoidMissPerLevelDelta,
    COMBAT_TABLE.avoidMissMin,
    COMBAT_TABLE.avoidMissMax,
  );
  let dodgePct =
    COMBAT_TABLE.dodgeBase +
    Math.max(0, num(defender?.stats?.agility, 10) - 10) *
      COMBAT_TABLE.dodgePerAgility +
    Math.max(0, num(defender?.bonuses?.dodge));
  let missPct = miss * 100;
  const total = missPct + dodgePct;
  if (total > COMBAT_TABLE.avoidanceCap) {
    const scale = COMBAT_TABLE.avoidanceCap / total;
    missPct *= scale;
    dodgePct *= scale;
  }
  return { miss: missPct / 100, dodge: dodgePct / 100 };
}

export function rollAvoidance(
  defender: any,
  attackerLevel: number,
  rng: () => number = Math.random,
): AvoidOutcome {
  const { miss, dodge } = playerAvoidance(defender, attackerLevel);
  const roll = rng();
  if (roll < miss) return "miss";
  if (roll < miss + dodge) return "dodge";
  return null;
}

export const DIMINISHING_RETURNS = Object.freeze({
  steps: [1, 0.5, 0.25, 0],
  resetAfterFadeMs: 18000,
});

export function applyDiminishingReturns(
  target: any,
  category: string,
  durationSeconds: number,
  now = Date.now(),
): number {
  target.combat = target.combat || {};
  const book = (target.combat.diminishing = target.combat.diminishing || {});
  let entry = book[category];
  if (!entry || now >= num(entry.resetAt)) entry = { count: 0, resetAt: 0 };
  const factor =
    DIMINISHING_RETURNS.steps[
      Math.min(entry.count, DIMINISHING_RETURNS.steps.length - 1)
    ];
  const applied = Math.max(0, num(durationSeconds)) * factor;
  entry.count += 1;
  entry.resetAt = now + applied * 1000 + DIMINISHING_RETURNS.resetAfterFadeMs;
  book[category] = entry;
  return applied;
}

export const THREAT_OVERTAKE = Object.freeze({ melee: 1.1, ranged: 1.3 });
export function threatOvertakeFactor(challengerInMeleeRange: boolean): number {
  return challengerInMeleeRange
    ? THREAT_OVERTAKE.melee
    : THREAT_OVERTAKE.ranged;
}
