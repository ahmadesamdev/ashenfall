import {
  CHARACTER_PROGRESSION,
  clampLevel,
  levelMilestone,
  progressionBand,
  storyChapterForLevel,
  xpToNextCharacterLevel,
} from "./CharacterProgression.js";

export function progressionSummary(player: any) {
  const level = clampLevel(player?.level);
  const xpNext =
    level >= CHARACTER_PROGRESSION.maxLevel ? 0 : xpToNextCharacterLevel(level);
  const xp =
    level >= CHARACTER_PROGRESSION.maxLevel
      ? 0
      : Math.max(0, Number(player?.xp || 0));
  const pct = xpNext ? Math.max(0, Math.min(1, xp / xpNext)) : 1;
  const band = progressionBand(level);
  const milestones = [4, 5, 8, 10, 15, 25, 40, 60].map((l) => ({
    level: l,
    reached: level >= l,
    ...levelMilestone(l),
  }));
  const next = milestones.find((x) => !x.reached) || null;
  return {
    level,
    maxLevel: CHARACTER_PROGRESSION.maxLevel,
    xp,
    xpNext,
    xpPercent: Number((pct * 100).toFixed(1)),
    totalXp: Number(player?.totalXp || 0),
    bandId: band?.id || "initiate",
    bandName: band?.name || "Initiate",
    storyChapter: Number(player?.storyChapter || 0),
    recommendedStoryChapter: storyChapterForLevel(level),
    statPoints: Number(player?.statPoints || 0),
    talentPoints: Number(player?.talentPoints || 0),
    nextMilestone: next,
    milestones,
    lastLevelUp: player?.lastLevelUp || null,
    lastLevelMilestone: player?.lastLevelMilestone || null,
  };
}
