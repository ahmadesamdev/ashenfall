import fs from "node:fs";
import path from "node:path";
import { assertUniqueIds } from "../shared/Hardening.js";

export interface GameCatalog {
  abilities: any;
  enemies: any;
  items: any;
  classes: any;
  zones: any[];
  exploration: any;
  worldMobDefs: any[];
  mobBehaviorProfiles: any;
  quests: any[];
  guildProgression: any;
  classStories: any;
  storyChoices: any;
  lore: any;
  npcDialogue: any;
  npcScheduleProfiles: any;
  dungeons: any[];
  dungeonDefaults: any;
  storyline: any;
  worldStory: any;
  storyIntro: any;
  shops: any;
  npcs: any[];
  recipes: any[];
  classBuilds: any;
  buildEncounterProfiles: any;
  worldEventConsequences: any;
  combatSynergies: any;
  combatResources: any;
  combatRotations: any;
  combatGearSynergies: any;
  itemization: any;
  talentTrees: any;
  talentTransformations: any;
  gates: any;
  talents: any;
  worldLayout: any;
  worldRegions: any;
  worldPoi: any;
  worldZoneProgression: any;
  regionTraversalProfiles: any;
  mmoSystems: any;
}

const byId = (a: any[]) =>
  Object.assign(
    Object.create(null),
    Object.fromEntries(a.map((x) => [x.id || x.type, x])),
  );
const normalizeCombatFeel = (a: any) => {
  const range = Number(a?.range || 0);
  const melee = range > 0 && range <= 24 && !a?.scaling;
  const spell = String(a?.scaling || "") === "spell";
  return {
    ...a,
    combatFeel: {
      hitStopMs: Number(
        a?.combatFeel?.hitStopMs ??
          (a?.power > 2.4 ? 65 : a?.power > 1.5 ? 48 : 36),
      ),
      cancelWindowMs: Number(
        a?.combatFeel?.cancelWindowMs ??
          Math.round(Math.max(90, Number(a?.gcd || 1.2) * 1000 * 0.28)),
      ),
      recoveryMs: Number(
        a?.combatFeel?.recoveryMs ??
          Math.round(Math.max(60, Number(a?.gcd || 0) * 1000 * 0.18)),
      ),
      projectile:
        a?.combatFeel?.projectile ??
        (!melee && range >= 30 && (spell || Number(a?.power || 0) > 0)),
      projectileTravelMs: Number(
        a?.combatFeel?.projectileTravelMs ?? (range >= 72 ? 260 : 180),
      ),
      projectileAvoidable: Boolean(a?.combatFeel?.projectileAvoidable ?? false),
      projectileHoming: Boolean(
        a?.combatFeel?.projectileHoming ??
        !Boolean(a?.combatFeel?.projectileAvoidable),
      ),
      projectileSpeedMetersPerSecond: Number(
        a?.combatFeel?.projectileSpeedMetersPerSecond ??
          (range >= 72 ? 115 : 95),
      ),
      projectileKind: String(
        a?.combatFeel?.projectileKind ??
          (spell ? "orb" : !melee && range >= 30 ? "arrow" : "bolt"),
      ),
      projectileTrail: Boolean(a?.combatFeel?.projectileTrail ?? true),
      projectileCollisionRadiusMeters: Number(
        a?.combatFeel?.projectileCollisionRadiusMeters ?? 1.25,
      ),
      priority: Number(
        a?.combatFeel?.priority ??
          (a?.tags?.includes?.("interrupt")
            ? 100
            : a?.tags?.includes?.("defensive")
              ? 80
              : a?.power >= 2.5
                ? 70
                : 50),
      ),
      facing: Boolean(a?.combatFeel?.facing ?? true),
      movementWhileCasting: Boolean(
        a?.combatFeel?.movementWhileCasting ?? true,
      ),
      movementInterrupts: Boolean(a?.combatFeel?.movementInterrupts ?? false),
      impactFamily: String(
        a?.combatFeel?.impactFamily ??
          (spell
            ? a?.tags?.includes?.("shadowblade")
              ? "shadow"
              : "spell"
            : !melee && range >= 30
              ? "ranged"
              : a?.tags?.includes?.("nature")
                ? "nature"
                : "weapon"),
      ),
    },
  };
};

const normalizeClassBuilds = (value: any) => {
  if (value && !Array.isArray(value) && typeof value === "object") return value;
  if (Array.isArray(value))
    return Object.fromEntries(value.map((x: any) => [x.id || x.classId, x]));
  return {};
};

export function loadGameCatalog(root: string): GameCatalog {
  const load = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const catalog: GameCatalog = {
    abilities: byId(
      load("game-data/abilities/abilities.json").map(normalizeCombatFeel),
    ),
    enemies: byId(load("game-data/enemies/enemies.json")),
    items: byId(load("game-data/items/items.json")),
    classes: byId(load("game-data/classes/classes.json")),
    zones: load("game-data/zones/zones.json"),
    exploration: load("game-data/exploration.json"),
    worldMobDefs: load("game-data/world-mobs.json"),
    mobBehaviorProfiles: load("game-data/mob-behavior-profiles.json"),
    quests: load("game-data/quests/quests.json"),
    guildProgression: load("game-data/guild-progression.json"),
    dungeons: load("game-data/dungeons.json"),
    dungeonDefaults: load("game-data/dungeon-defaults.json"),
    storyline: load("game-data/storyline.json"),
    classStories: load("game-data/class-stories.json"),
    storyChoices: load("game-data/story-choices.json"),
    lore: load("game-data/lore.json").entries || [],
    worldStory: load("game-data/world-story.json"),
    storyIntro: load("game-data/story-intro.json"),
    npcDialogue: load("game-data/npc-dialogue.json"),
    shops: load("game-data/shops.json"),
    npcs: load("game-data/npcs.json"),
    npcScheduleProfiles: load("game-data/npc-schedule-profiles.json"),
    recipes: load("game-data/recipes.json"),
    classBuilds: normalizeClassBuilds(load("game-data/class-builds.json")),
    worldEventConsequences: load("game-data/world-event-consequences.json"),
    buildEncounterProfiles: load("game-data/build-encounter-profiles.json"),
    combatSynergies: load("game-data/combat-synergies.json"),
    combatResources: load("game-data/combat-resources.json"),
    combatRotations: load("game-data/combat-rotations.json"),
    combatGearSynergies: load("game-data/combat-gear-synergies.json"),
    itemization: load("game-data/items/itemization.json"),
    talentTrees: load("game-data/talent-trees.json"),
    talentTransformations: load("game-data/talent-transformations.json"),
    gates: load("game-data/gates.json"),
    talents: load("game-data/talents.json"),
    worldLayout: load("game-data/world-layout.json"),
    worldRegions: load("game-data/world-regions.json"),
    worldPoi: load("game-data/worldPoi.json"),
    worldZoneProgression: load("game-data/worldZoneProgression.json"),
    regionTraversalProfiles: load("game-data/region-traversal-profiles.json"),
    mmoSystems: Object.fromEntries(
      Object.entries({
        worldZoneProgression: load("game-data/worldZoneProgression.json"),
        regionTraversalProfiles: load(
          "game-data/region-traversal-profiles.json",
        ),
        exploration: load("game-data/exploration.json"),
        dungeonProgression: load("game-data/dungeonProgression.json"),
        socialGuilds: load("game-data/socialGuilds.json"),
        professions: load("game-data/professions.json"),
        economy: load("game-data/economy.json"),
        endgameProgression: load("game-data/endgameProgression.json"),
        pvp: load("game-data/pvp.json"),
        worldEvents: load("game-data/worldEvents.json"),
        achievementsCollections: load("game-data/achievementsCollections.json"),
        uiUx: load("game-data/uiUx.json"),
        productionReadiness: load("game-data/productionReadiness.json"),
      }),
    ),
  };
  for (const [label, data] of Object.entries({
    zones: catalog.zones,
    quests: catalog.quests,
    worldMobDefs: catalog.worldMobDefs,
    npcs: catalog.npcs,
    gates: catalog.gates,
    talents: catalog.talents,
    worldStory: catalog.worldStory,
    worldRegions: catalog.worldRegions,
    worldPoi: Object.values(catalog.worldPoi?.zones || {}).flat(),
    classBuilds: Object.values(catalog.classBuilds),
    buildEncounterProfiles: Object.values(
      catalog.buildEncounterProfiles.classes || {},
    ),
    classes: Object.values(catalog.classes),
    abilities: Object.values(catalog.abilities),
    enemies: Object.values(catalog.enemies),
    items: Object.values(catalog.items),
    recipes: catalog.recipes,
    lore: catalog.lore,
    npcDialogue: catalog.npcDialogue?.nodes || [],
  }))
    assertUniqueIds(data as any[], label);
  return catalog;
}
