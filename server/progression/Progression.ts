import {
  CHARACTER_PROGRESSION,
  xpToNextCharacterLevel,
} from "./CharacterProgression.js";

export const PROGRESSION = Object.freeze({
  ...CHARACTER_PROGRESSION,
  partyXpBonusPerMember: 0.08,
  partyXpBonusCap: 0.32,
  questXpMultiplier: 1,
  questOverlevelGrace: 1,
  questXpFloor: 0.25,
  earlyGameTargetLevel: 5,
  earlyGameTargetHours: 4,
});

export function xpToNextLevel(level = 1): number {
  return xpToNextCharacterLevel(level);
}

export function levelAdjustedXp(
  baseXp: number,
  playerLevel: number,
  enemyLevel: number,
): number {
  const base = Math.max(1, Number(baseXp) || 1);
  const delta = Number(enemyLevel || 1) - Number(playerLevel || 1);
  if (delta <= -6) return Math.max(1, Math.round(base * 0.15));
  if (delta === -5) return Math.max(1, Math.round(base * 0.3));
  if (delta === -4) return Math.max(1, Math.round(base * 0.5));
  if (delta === -3) return Math.max(1, Math.round(base * 0.7));
  if (delta === -2) return Math.max(1, Math.round(base * 0.85));
  if (delta >= 5) return Math.round(base * 1.15);
  return base;
}

export function questAdjustedXp(
  baseXp: number,
  playerLevel: number,
  questLevel = 1,
): number {
  const base = Math.max(0, Number(baseXp) || 0);
  if (base <= 0) return 0;
  const delta = Number(playerLevel || 1) - Number(questLevel || 1);
  if (delta <= 1) return Math.round(base * PROGRESSION.questXpMultiplier);
  if (delta === 2) return Math.round(base * 0.85);
  if (delta === 3) return Math.round(base * 0.7);
  if (delta === 4) return Math.round(base * 0.5);
  if (delta === 5) return Math.round(base * 0.35);
  return Math.max(1, Math.round(base * PROGRESSION.questXpFloor));
}

export function partyXpMultiplier(size: number): number {
  const members = Math.max(1, Number(size) || 1);
  return (
    1 +
    Math.min(
      PROGRESSION.partyXpBonusCap,
      (members - 1) * PROGRESSION.partyXpBonusPerMember,
    )
  );
}
