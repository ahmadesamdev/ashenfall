import {
  progressionBand,
  availableClassSkills,
  CHARACTER_PROGRESSION,
} from "../progression/CharacterProgression.js";
import { ensureStoryState } from "../progression/StoryProgression.js";
import { ensureIntegrationState } from "../shared/IntegrationCoordinator.js";
import { normalizePlayerClassState } from "./ClassRuntimeNormalization.js";

export function createPlayerRehydrator({
  zones,
  dungeons,
  inv,
  items,
  classes,
}: any) {
  return function rehydratePlayer(loaded: any) {
    loaded.lastSeenAt = Number(loaded.lastSeenAt || 0);
    normalizePlayerClassState(loaded, classes);
    ensureIntegrationState(loaded);
    loaded.lastLoginAt = Number(loaded.lastLoginAt || 0);
    loaded.sessionEpoch = Number(loaded.sessionEpoch || 0);
    loaded.generatedItems = loaded.generatedItems || {};
    loaded.totalXp = Number.isFinite(Number(loaded.totalXp))
      ? Number(loaded.totalXp)
      : 0;
    loaded.level = Math.max(
      1,
      Math.min(
        CHARACTER_PROGRESSION.maxLevel,
        Math.floor(Number(loaded.level) || 1),
      ),
    );
    loaded.progressionBand = progressionBand(loaded.level)?.id || "initiate";
    loaded.milestoneHistory = Array.isArray(loaded.milestoneHistory)
      ? loaded.milestoneHistory
      : [];
    loaded.storyFlags =
      loaded.storyFlags && typeof loaded.storyFlags === "object"
        ? loaded.storyFlags
        : {};
    loaded.storyChapterHistory = Array.isArray(loaded.storyChapterHistory)
      ? loaded.storyChapterHistory
      : [];
    loaded.storyChapter = Math.max(
      0,
      Math.floor(Number(loaded.storyChapter) || 0),
    );
    loaded.activeQuestId =
      typeof loaded.activeQuestId === "string" ? loaded.activeQuestId : null;
    ensureStoryState(loaded);
    loaded.availableSkills = availableClassSkills(
      classes[loaded.classId],
      loaded.level,
    );
    for (const [id, definition] of Object.entries(loaded.generatedItems)) {
      if (definition && !items[id]) items[id] = definition;
    }
    loaded.online = false;
    loaded.encounterId = null;
    loaded.worldCombatMobId = null;
    loaded.targetPlayerId = null;
    loaded.targetMobId = null;
    loaded.pvpInvite = null;
    loaded.pvp = null;
    loaded.battlegroundId = null;
    loaded.pvpCombatUntil = 0;
    loaded.pvpDisengageUntil = 0;
    loaded.arenaQueueId = null;
    delete loaded.pvpRuntimeStats;
    delete loaded._pvpOriginalStats;
    loaded.mining = null;
    loaded.pendingOre = null;
    loaded.pendingGate = null;
    loaded.pendingNpc = null;
    loaded.activeNpcId = null;
    loaded.combat = {
      ...(loaded.combat || {}),
      state: "ready",
      stateSince: Date.now(),
      currentActionId: null,
      currentAbilityId: null,
      castUntil: 0,
      recoveryUntil: 0,
      cancelWindowUntil: 0,
      queuedAbilities: [],
      gcdReadyAt: 0,
      queuedAbility: null,
      queuedWorldAbility: null,
      autoAttack: false,
      autoApproach: false,
      manualMove: false,
      autoAttackNextAt: 0,
      gearEffectCooldowns: {},
      gearNextPowerPct: 0,
      gearActiveEffects: {},
    };
    loaded.statuses = Array.isArray(loaded.statuses)
      ? loaded.statuses.filter((x: any) => x?.until && x.until > Date.now())
      : [];
    loaded.cooldowns = {};
    loaded.itemCooldowns = {};
    loaded.velocityX = 0;
    loaded.velocityY = 0;
    loaded.moveState = "idle";
    loaded.movementIntent = "none";
    if (!loaded.inventory) loaded.inventory = [];
    if (!loaded.equipment) loaded.equipment = {};
    if (!("ring2" in loaded.equipment)) loaded.equipment.ring2 = null;
    if (!("relic2" in loaded.equipment)) loaded.equipment.relic2 = null;
    for (const slot of [
      "weapon",
      "shield",
      "helmet",
      "chest",
      "shoulders",
      "gloves",
      "boots",
      "neck",
      "ring",
      "ring2",
      "relic",
      "relic2",
    ])
      if (!(slot in loaded.equipment)) loaded.equipment[slot] = null;
    inv.validateEquipment(loaded);

    if (!Array.isArray(loaded.regionDiscoveries)) loaded.regionDiscoveries = [];
    if (!loaded.regionRuntime || typeof loaded.regionRuntime !== "object")
      loaded.regionRuntime = {};
    if (!loaded.exploration || typeof loaded.exploration !== "object")
      loaded.exploration = {
        version: 2,
        regions: {},
        completedRegions: [],
        milestones: [],
        lastDiscovery: null,
      };
    if (
      !loaded.exploration.regions ||
      typeof loaded.exploration.regions !== "object"
    )
      loaded.exploration.regions = {};
    if (!Array.isArray(loaded.exploration.completedRegions))
      loaded.exploration.completedRegions = [];
    if (!Array.isArray(loaded.exploration.milestones))
      loaded.exploration.milestones = [];
    if (!loaded.quests) loaded.quests = {};
    if (!loaded.profession) loaded.profession = { blacksmith: 1, mining: 1 };
    if (!loaded.professionXp)
      loaded.professionXp = { blacksmith: 0, mining: 0 };
    if (!loaded.lootPity)
      loaded.lootPity = { normal: 0, elite: 0, boss: 0, bossEpic: 0 };
    loaded.pvpStats = loaded.pvpStats || {};
    loaded.pvpStats = {
      kills: Number(loaded.pvpStats.kills || 0),
      deaths: Number(loaded.pvpStats.deaths || 0),
      duelWins: Number(loaded.pvpStats.duelWins || 0),
      duelLosses: Number(loaded.pvpStats.duelLosses || 0),
      honor: Number(loaded.pvpStats.honor || 0),
      conquest: Number(loaded.pvpStats.conquest || 0),
      battlegroundWins: Number(loaded.pvpStats.battlegroundWins || 0),
      battlegroundLosses: Number(loaded.pvpStats.battlegroundLosses || 0),
      arena: {
        "2v2": {
          rating: Number(loaded.pvpStats.arena?.["2v2"]?.rating || 0),
          mmr: Number(loaded.pvpStats.arena?.["2v2"]?.mmr || 1000),
          wins: Number(loaded.pvpStats.arena?.["2v2"]?.wins || 0),
          losses: Number(loaded.pvpStats.arena?.["2v2"]?.losses || 0),
        },
        "3v3": {
          rating: Number(loaded.pvpStats.arena?.["3v3"]?.rating || 0),
          mmr: Number(loaded.pvpStats.arena?.["3v3"]?.mmr || 1000),
          wins: Number(loaded.pvpStats.arena?.["3v3"]?.wins || 0),
          losses: Number(loaded.pvpStats.arena?.["3v3"]?.losses || 0),
        },
      },
      season: String(loaded.pvpStats.season || "season-1"),
    };
    if (!loaded.achievements || typeof loaded.achievements !== "object")
      loaded.achievements = {};
    if (!Array.isArray(loaded.friends)) loaded.friends = [];
    if (!Array.isArray(loaded.ignoredPlayers)) loaded.ignoredPlayers = [];
    if (!Array.isArray(loaded.socialNotifications))
      loaded.socialNotifications = [];
    loaded.partyAssistId = loaded.partyAssistId || null;
    if (String(loaded.zone || "").startsWith("arena_"))
      loaded.zone = loaded.homeCity || "stonehold";
    const dungeonExists =
      loaded.dungeon?.id &&
      dungeons.some((d: any) => d.id === loaded.dungeon.id);
    if (loaded.dungeon?.id) {
      loaded.dungeon.suspended = !dungeonExists;
      loaded.dungeon.suspendedAt = Date.now();
      const returnZone =
        loaded.dungeon.fromZone || loaded.homeCity || "stonehold";
      loaded.zone = returnZone;
      loaded.x = Number(loaded.dungeon.fromX ?? loaded.x ?? 0.5);
      loaded.y = Number(loaded.dungeon.fromY ?? loaded.y ?? 0.55);
      loaded.targetX = loaded.x;
      loaded.targetY = loaded.y;
    }
    return loaded;
  };
}
