export const CHARACTER_PROGRESSION = Object.freeze({
  maxLevel: 60,
  xpBase: 400,
  xpLevelPower: 1.5,
  xpLevelScale: 120,
  statPointsPerLevel: 4,
  talentPointsPerLevel: 1,
  bands: Object.freeze([
    { id: "initiate", min: 1, max: 4, name: "Initiate" },
    { id: "adventurer", min: 5, max: 9, name: "Adventurer" },
    { id: "veteran", min: 10, max: 15, name: "Veteran" },
    { id: "heroic", min: 16, max: 25, name: "Heroic" },
    { id: "mythic", min: 26, max: 40, name: "Mythic" },
    { id: "apex", min: 41, max: 60, name: "Apex" },
  ]),
});

export function clampLevel(level: unknown): number {
  return Math.max(
    1,
    Math.min(CHARACTER_PROGRESSION.maxLevel, Math.floor(Number(level) || 1)),
  );
}

export function xpToNextCharacterLevel(level = 1): number {
  const l = clampLevel(level);
  if (l >= CHARACTER_PROGRESSION.maxLevel) return 0;
  const base = CHARACTER_PROGRESSION.xpBase;
  const scale = CHARACTER_PROGRESSION.xpLevelScale;
  const power = CHARACTER_PROGRESSION.xpLevelPower;
  return Math.max(1, Math.round(base + scale * Math.pow(l, power)));
}

export function progressionBand(level = 1) {
  const l = clampLevel(level);
  return (
    CHARACTER_PROGRESSION.bands.find((b) => l >= b.min && l <= b.max) ||
    CHARACTER_PROGRESSION.bands.at(-1)
  );
}

export function levelMilestone(level: number) {
  const l = clampLevel(level);
  const rewards: any = {
    statPoints: CHARACTER_PROGRESSION.statPointsPerLevel,
    talentPoints: CHARACTER_PROGRESSION.talentPointsPerLevel,
  };
  if (l === 4) rewards.unlocks = ["dungeons"];
  if (l === 5) rewards.unlocks = ["advanced_professions"];
  if (l === 8) rewards.unlocks = ["open_pvp_regions"];
  if (l === 10) rewards.unlocks = ["specializations", "advanced_talents"];
  if (l === 15) rewards.unlocks = ["heroic_gear_band"];
  if (l === 25) rewards.unlocks = ["mythic_gear_band"];
  if (l === 40) rewards.unlocks = ["apex_gear_band"];
  if (l === 60) rewards.unlocks = ["level_cap"];
  return rewards;
}

export function availableClassSkills(classDef: any, level = 1): string[] {
  const unlocks = classDef?.abilityUnlocks || {};
  return Object.entries(unlocks)
    .filter(([, required]) => Number(required) <= clampLevel(level))
    .map(([id]) => id);
}

export function storyChapterForLevel(level = 1): number {
  const l = clampLevel(level);
  if (l <= 4) return 0;
  if (l <= 7) return 1;
  if (l <= 9) return 2;
  if (l <= 12) return 3;
  if (l <= 17) return 4;
  if (l <= 24) return 5;
  if (l <= 30) return 6;
  if (l <= 36) return 7;
  if (l <= 44) return 8;
  if (l <= 52) return 9;
  return 10;
}
