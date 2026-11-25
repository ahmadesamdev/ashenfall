import {
  CHARACTER_PROGRESSION,
  clampLevel,
  progressionBand,
  storyChapterForLevel,
  xpToNextCharacterLevel,
} from "./CharacterProgression.js";

export const JOURNEY_BANDS = Object.freeze([
  {
    id: "initiate",
    min: 1,
    max: 4,
    focus: "Learn your class core",
    zones: ["stonehold", "gloamwood"],
    dungeons: [],
    goal: "Learn the three starter skills, complete the opening story and establish your first gear set.",
  },
  {
    id: "adventurer",
    min: 5,
    max: 9,
    focus: "Become a complete adventurer",
    zones: ["gloamwood", "marches_of_dawn", "eastern_reach", "briarfen"],
    dungeons: ["sunken_catacombs", "black_citadel", "dreadvault"],
    goal: "Unlock dungeon play, build your first real rotation and start grouping.",
  },
  {
    id: "veteran",
    min: 10,
    max: 15,
    focus: "Choose your identity",
    zones: [
      "eastern_reach",
      "gloamwood",
      "briarfen",
      "sunscar_steppe",
      "old_kingdom",
    ],
    dungeons: ["watcher_hollow", "royal_catacombs"],
    goal: "Choose a specialization, build talents around your skills and prepare for the Heroic band.",
  },
  {
    id: "heroic",
    min: 16,
    max: 25,
    focus: "Build mastery",
    zones: [
      "eastern_reach",
      "briarfen",
      "sunscar_steppe",
      "ashen_wastes",
      "old_kingdom",
    ],
    dungeons: ["sunken_catacombs", "watcher_hollow", "royal_catacombs"],
    goal: "Expand your rotation, acquire meaningful gear upgrades and start specializing for group content.",
  },
  {
    id: "mythic",
    min: 26,
    max: 40,
    focus: "Define your build",
    zones: [
      "sunscar_steppe",
      "ashen_wastes",
      "old_kingdom",
      "crownfall_expanse",
    ],
    dungeons: ["dreadvault", "watcher_hollow", "royal_catacombs"],
    goal: "Complete your core talent package, learn encounter mechanics and transition into endgame-oriented builds.",
  },
  {
    id: "apex",
    min: 41,
    max: 60,
    focus: "Master the endgame",
    zones: [
      "crownfall_expanse",
      "old_kingdom",
      "black_citadel",
      "veilscar_highlands",
      "nightveil_coast",
      "hollow_expanse",
    ],
    dungeons: ["dreadvault", "black_citadel", "royal_catacombs"],
    goal: "Finish the class kit, optimize talents and gear, and prepare for Apex encounters and PvP.",
  },
]);

export function journeyBand(level: number) {
  const l = clampLevel(level);
  return (
    JOURNEY_BANDS.find((b) => l >= b.min && l <= b.max) ||
    JOURNEY_BANDS[JOURNEY_BANDS.length - 1]
  );
}

function contentZoneMap(zones: any[]) {
  return Object.fromEntries((zones || []).map((z) => [z.id, z]));
}

function nextSkillForLevel(player: any, classes: any, level: number) {
  const c = classes?.[player?.classId];
  const unlocks = c?.abilityUnlocks || {};
  const learned = new Set(player?.abilityIds || player?.learnedSkills || []);
  const entries = Object.entries(unlocks)
    .map(([id, lvl]) => ({ id, level: Number(lvl) }))
    .filter((x) => x.level > level && !learned.has(x.id))
    .sort((a, b) => a.level - b.level);
  return entries[0] || null;
}

export function levelingJourneyForPlayer(
  player: any,
  classes: any,
  zones: any[] = [],
  dungeons: any[] = [],
) {
  const level = clampLevel(player?.level);
  const band = journeyBand(level);
  const zmap = contentZoneMap(zones);
  const recommendedZones = band.zones
    .map((id) => zmap[id])
    .filter(Boolean)
    .map((z) => ({
      id: z.id,
      name: z.name,
      minLevel: Number(zmap[z.id]?.minLevel || 0),
      maxLevel: Number(zmap[z.id]?.maxLevel || 0),
      city: !!z.city,
    }));
  const recommendedDungeons = (dungeons || [])
    .filter((d) => band.dungeons.includes(d.id))
    .map((d) => ({
      id: d.id,
      name: d.name,
      minLevel: Number(d.level || 1),
      storyChapter: Number(d.requiresStoryChapter || 0),
    }));
  const nextSkill = nextSkillForLevel(player, classes, level);
  const nextStory = storyChapterForLevel(level);
  const nextBand = JOURNEY_BANDS.find((x) => x.min > level) || null;
  const nextLevel = level >= CHARACTER_PROGRESSION.maxLevel ? null : level + 1;
  return {
    level,
    maxLevel: CHARACTER_PROGRESSION.maxLevel,
    bandId: band.id,
    bandName: band.id[0].toUpperCase() + band.id.slice(1),
    focus: band.focus,
    goal: band.goal,
    storyChapter: Number(player?.storyChapter || 0),
    recommendedStoryChapter: nextStory,
    recommendedZones,
    recommendedDungeons,
    nextSkill: nextSkill ? { id: nextSkill.id, level: nextSkill.level } : null,
    nextLevel,
    nextLevelXp: nextLevel ? xpToNextCharacterLevel(level) : 0,
    nextBand: nextBand
      ? {
          id: nextBand.id,
          level: nextBand.min,
          name: nextBand.id[0].toUpperCase() + nextBand.id.slice(1),
        }
      : null,
    talentPoints: Number(player?.talentPoints || 0),
    skillCount: (player?.abilityIds || player?.learnedSkills || []).length,
    totalSkillCount: Object.keys(
      classes?.[player?.classId]?.abilityUnlocks || {},
    ).length,
  };
}
