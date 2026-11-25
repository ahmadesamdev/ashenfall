import "./shared/LoadEnv.js";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { GAME_RUNTIME } from "./shared/GameRuntimeConfig.js";
import { GAME_VERSION } from "./shared/GameVersion.js";
import { createRepository } from "./persistence/RepositoryFactory.js";
import { createPlayer } from "./entities/Player.js";
import { CombatEngine } from "./combat/CombatEngine.js";
import { DungeonEngine } from "./world/DungeonEngine.js";
import { World } from "./world/World.js";
import { Inventory } from "./inventory/Inventory.js";
import { rollDamage } from "./combat/CombatFormula.js";
import { QuestEngine } from "./quests/QuestEngine.js";
import { Social } from "./social/Social.js";
import { Economy } from "./economy/Economy.js";
import { EventBus } from "./shared/EventBus.js";
import { dynamicItemsForPlayer } from "./content/DynamicItems.js";
import {
  COMBAT_RANGES,
  normalizeAbilityRange,
  normalizeGameDistance,
} from "./combat/CombatRanges.js";
import { MOVEMENT_SPEEDS } from "./world/Movement.js";
import {
  boundedString,
  boundedInt,
  createRequestDedupe,
  finiteNumber,
  createSerialExecutor,
  createWindowRateLimiter,
} from "./shared/Hardening.js";
import {
  xpToNextLevel,
  levelAdjustedXp,
  partyXpMultiplier,
} from "./progression/Progression.js";
import {
  progressionBand,
  storyChapterForLevel,
  availableClassSkills,
  CHARACTER_PROGRESSION,
} from "./progression/CharacterProgression.js";
import { guardPlayerRuntime } from "./shared/RuntimeGuards.js";
import { partyRole, healingThreat } from "./combat/PartyCombat.js";
import { ProfessionEngine } from "./economy/ProfessionEngine.js";
import { WorldEvents } from "./world/WorldEvents.js";
import { RegionEngine } from "./world/RegionEngine.js";
import { OpenWorldDirector } from "./world/OpenWorldDirector.js";
import { ChatService } from "./runtime/ChatService.js";
import { QueueService } from "./runtime/QueueService.js";
import { createCommandHandler } from "./runtime/CommandHandler.js";
import { loadGameCatalog } from "./data/DataCatalog.js";
import { createTradeService } from "./runtime/TradeService.js";
import { createStateService } from "./runtime/StateService.js";
import { createProgressionService } from "./runtime/ProgressionService.js";
import { pushFx } from "./runtime/CombatFx.js";
import { AuthService, assertAuthConfigured } from "./auth/AuthService.js";
import { EmailService } from "./auth/EmailService.js";
import { ensureStoryState } from "./progression/StoryProgression.js";
import { MMOSystems } from "./shared/MMOSystems.js";
import { createPlayerRehydrator } from "./runtime/PlayerRehydration.js";
import { Telemetry } from "./shared/Telemetry.js";
import { createServerRuntime } from "./runtime/ServerRuntime.js";
import { createPlayerRuntimeNormalization } from "./runtime/PlayerRuntimeNormalization.js";
import { migrateCharacterSchema } from "./shared/CharacterSchema.js";
import { WorldSimulation } from "./world/WorldSimulation.js";
import { WorldMemory } from "./world/WorldMemory.js";
import { WorldEcology } from "./world/WorldEcology.js";
import { EmergentWorldEvents } from "./world/EmergentWorldEvents.js";
import { NpcMemory } from "./world/NpcMemory.js";
import { DiscoveryEngine } from "./world/DiscoveryEngine.js";
import { Chronicle } from "./world/Chronicle.js";
import { WorldIntegration } from "./world/WorldIntegration.js";
import { FactionSimulation } from "./world/FactionSimulation.js";
import { RegionalEconomy } from "./world/RegionalEconomy.js";
import { GuildOrganizations } from "./world/GuildOrganizations.js";
import { PlayerMutationCoordinator } from "./shared/PlayerMutationCoordinator.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");
const catalog = loadGameCatalog(root);
const {
  abilities,
  enemies,
  items,
  classes,
  zones,
  worldMobDefs,
  mobBehaviorProfiles,
  quests,
  guildProgression,
  npcScheduleProfiles,
  dungeons,
  dungeonDefaults,
  storyline,
  worldStory,
  storyIntro,
  shops,
  npcs,
  recipes,
  npcDialogue,
  classStories,
  storyChoices,
  lore,
  classBuilds,
  buildEncounterProfiles,
  combatSynergies,
  combatResources,
  combatRotations,
  combatGearSynergies,
  talentTrees,
  talentTransformations,
  gates,
  talents,
  worldLayout,
  worldRegions,
  worldPoi,
  worldZoneProgression,
  regionTraversalProfiles,
  itemization,
  mmoSystems,
} = catalog;

const bus = new EventBus();
const telemetry = new Telemetry();
const mmo = new MMOSystems(mmoSystems);
let stateRevision = 0,
  uiRevision = 0;
let motionSequence = 0;
const networkMetrics: any = {
  fullPackets: 0,
  fullBytes: 0,
  motionPackets: 0,
  motionBytes: 0,
};
const tickMetrics: any = {
  lastMs: 0,
  maxMs: 0,
  avgMs: 0,
  samples: 0,
  overruns: 0,
};
const repo = await createRepository();
await repo.authInit();
const WORLD_LEASE_ID = "ashenfall:global";
assertAuthConfigured();
const worldLeaseOwnerId = crypto.randomUUID();
let worldLease = await repo.acquireWorldLease?.(
  WORLD_LEASE_ID,
  worldLeaseOwnerId,
  Date.now(),
  30_000,
);
const worldLeaseWaitDeadline = Date.now() + 45_000;
while (
  worldLease &&
  !worldLease.acquired &&
  Date.now() < worldLeaseWaitDeadline
) {
  console.warn(
    `[Ashenfall] ${WORLD_LEASE_ID} is held by another process; waiting for it to be released.`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  worldLease = await repo.acquireWorldLease?.(
    WORLD_LEASE_ID,
    worldLeaseOwnerId,
    Date.now(),
    30_000,
  );
}
if (!worldLease?.acquired)
  throw new Error(
    `Another Ashenfall process owns ${WORLD_LEASE_ID} until ${new Date(Number(worldLease?.expiresAt || 0)).toISOString()}. Refusing to start a second authoritative simulation.`,
  );
repo.setWorldLeaseContext?.(
  WORLD_LEASE_ID,
  worldLeaseOwnerId,
  Number(worldLease.fencingToken),
);
const emailService = new EmailService();
if (process.env.NODE_ENV === "production" && !emailService.configured) {
  console.warn(
    "[Ashenfall AUTH] No email provider is configured; account verification/reset email delivery is unavailable. Set SENDGRID_API_KEY (or RESEND_API_KEY) and EMAIL_FROM, or the SMTP_* variables.",
  );
}
if (emailService.configured) {
  console.log(`[Ashenfall AUTH] Email delivery via ${emailService.provider}.`);
}
const authService = new AuthService(repo, emailService);
const inv = new Inventory(items, combatGearSynergies, itemization),
  world = new World(
    zones,
    worldMobDefs,
    npcs,
    gates,
    worldLayout,
    worldZoneProgression,
    mobBehaviorProfiles,
    npcScheduleProfiles.profiles || {},
    regionTraversalProfiles,
  );
world.players = [];
const rehydratePlayer = createPlayerRehydrator({
  zones,
  dungeons,
  inv,
  items,
  classes,
});
const chatService = new ChatService(zones);
const addChat = (zoneId: string, message: any) =>
  chatService.add(zoneId, message);

for (const loaded of repo.allPlayers()) {
  rehydratePlayer(loaded);
  guardPlayerRuntime(loaded);
}
const shutdown = async () => {
  try {
    await economy?.persist?.([]);
  } catch {}
  try {
    worldSimulation?.checkpoint?.(Date.now());
    try {
      chronicle?.checkpoint?.(Date.now());
    } catch {}
    try {
      npcMemory?.persist?.(true, Date.now());
    } catch {}
  } catch {}
  try {
    worldEcology?.checkpoint?.(Date.now());
  } catch {}
  try {
    emergentWorldEvents?.checkpoint?.(Date.now());
    discoveryEngine?.checkpoint?.(Date.now());
    guildOrganizations?.checkpoint?.(Date.now());
    worldIntegration?.checkpoint?.(Date.now());
  } catch {}
  try {
    for (const c of clients) {
      if (c?.player?.hasCharacter) {
        c.player.online = false;
        c.player.lastSeenAt = Date.now();
      }
    }
  } catch {}
  try {
    await repo.checkpoint();
  } catch (error) {
    console.warn("Persistence checkpoint failed:", error);
  }
  try {
    await repo.releaseWorldLease?.(
      WORLD_LEASE_ID,
      worldLeaseOwnerId,
      Number(worldLease?.fencingToken || 0),
    );
  } catch (error) {
    console.warn("World lease release failed:", error);
  }
  try {
    await repo.close();
  } catch (error) {
    console.warn("Persistence shutdown failed:", error);
  }
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
const playerMutations = new PlayerMutationCoordinator();
world.playerMutations = playerMutations;
const profession = new ProfessionEngine(recipes, items);
const quest = new QuestEngine(quests, inv, world);
const {
  normalizeMovement,
  normalizeStoryQuest,
  reconcileTravelQuestState,
  normalizeCharacterName,
  characterNameTaken,
} = createPlayerRuntimeNormalization({ quest, repo });
const tradeService = createTradeService({
  inv,
  repo,
  world,
  quest,
  playerMutations,
});
const {
  tradeRequests,
  tradeSessions,
  tradeState,
  findTradeSession,
  tradeDistanceOk,
  tradeOffer,
  completeTrade,
} = tradeService;
const social = new Social();
social.setGuildProgression(guildProgression);
const economy = new Economy(inv, repo, items, playerMutations);
await economy.ready();
const combat = new CombatEngine({
  abilities,
  enemies,
  items,
  inv,
  world,
  combatSynergies,
  talentTransformations,
  combatResources,
  combatRotations,
});
const dungeonEngine = new DungeonEngine(
  dungeons,
  combat,
  inv,
  quest,
  dungeonDefaults,
);
const regionEngine = new RegionEngine(
  worldRegions?.regions || [],
  world,
  repo,
  worldPoi,
  catalog.exploration,
  regionTraversalProfiles,
);
const VERSION = GAME_VERSION;
const worldMemory = new WorldMemory(repo);
const npcMemory = new NpcMemory(repo, npcs);
const factionSimulation = new FactionSimulation(repo);
const worldEcology = new WorldEcology(
  repo,
  worldMobDefs,
  (worldRegions?.regions || []).map((r: any) => String(r.id)),
);
const chronicle = new Chronicle(repo);
const worldSimulation = new WorldSimulation(
  repo,
  (worldRegions?.regions || []).map((r: any) => String(r.id)),
  `ashenfall:${VERSION}`,
  worldMemory,
  factionSimulation,
  npcMemory,
);
worldSimulation.chronicle = chronicle;
const emergentWorldEvents = new EmergentWorldEvents(
  repo,
  worldSimulation,
  worldEcology,
  factionSimulation,
);
const discoveryEngine = new DiscoveryEngine(
  repo,
  world,
  worldSimulation,
  worldEcology,
  factionSimulation,
  worldRegions?.regions || [],
);
const regionalEconomy = new RegionalEconomy(repo, worldRegions?.regions || []);
const guildOrganizations = new GuildOrganizations(
  repo,
  worldSimulation,
  social,
);
const worldIntegration = new WorldIntegration(repo, {
  world,
  simulation: worldSimulation,
  factions: factionSimulation,
  ecology: worldEcology,
  emergent: emergentWorldEvents,
  discoveries: discoveryEngine,
  economy: regionalEconomy,
  guilds: guildOrganizations,
  chronicle,
  npcMemory,
  quest,
  playerMutations,
});
const worldEvents = new WorldEvents(
  world,
  repo,
  (player, xp, gold) => {
    if (xp) gainXp(player, xp);
    player.gold = (Number(player.gold) || 0) + Number(gold || 0);
    repo.savePlayer(player);
  },
  quest,
  catalog.worldEventConsequences,
  worldSimulation,
  playerMutations,
);
const openWorld = new OpenWorldDirector(world, repo, playerMutations);
for (const loaded of repo.allPlayers()) profession.ensure(loaded);
const progression = createProgressionService({
  economy,
  inv,
  items,
  itemization,
  talents,
  repo,
  social,
  quest,
  world,
  worldEvents,
  openWorld,
  classes,
  xpToNextLevel,
  levelAdjustedXp,
  partyXpMultiplier,
  enemies,
  combatGearSynergies,
  playerMutations,
});
const {
  reward,
  resolveLootRollForParty,
  resolveExpiredLootRolls,
  normalizeXpTrack,
  gainXp,
  rebuildTalents,
  applyTalent,
  createDungeonRewardChest,
  createDungeonCompletionRewards,
  claimDungeonRewardChest,
  awardEncounterLoot,
  rewardMobKill,
  makeGearInstance,
  randomAffix,
} = progression;
openWorld.rewardXp = (player: any, xp: number) => gainXp(player, xp);

for (const character of repo.allPlayers()) {
  if (migrateCharacterSchema(character, classes, inv))
    await repo.savePlayer(character);
}
const clients = new Set<any>(),
  PORT = process.env.PORT || 3000;
const activeSessions = new Map<string, any>();
const reservedCharacterNames = new Set(
  repo
    .allPlayers()
    .filter((x: any) => x?.hasCharacter)
    .map((x: any) => normalizeCharacterName(x.name)),
);
const REPOSITORY_BACKEND = String(
  process.env.ASHENFALL_REPOSITORY || "sqlite",
).toLowerCase();
function repositoryStatsSnapshot() {
  const r: any = repo.stats();
  return r && typeof r.then === "function"
    ? { backend: REPOSITORY_BACKEND, status: "async" }
    : { ...r, backend: REPOSITORY_BACKEND };
}
const SESSION_CHECKPOINT_MS = GAME_RUNTIME.sessionCheckpointMs;
let lastPersistenceCheckpointAt = Date.now();
const AUTO_TARGET_MAX_METERS = GAME_RUNTIME.autoTargetMaxMeters;
const NPC_INTERACTION_METERS = GAME_RUNTIME.npcInteractionMeters;
const NPC_STAND_METERS = GAME_RUNTIME.npcStandMeters;
const pvpZone = (p: any) => world.byId[p.zone]?.pvpEnabled === true;
const pvpAllowed = (p: any) =>
  !!p.hasCharacter &&
  !p.dead &&
  (p.pvp?.state === "arena" ||
    p.pvp?.state === "battleground" ||
    (!world.byId[p.zone]?.city &&
      pvpZone(p) &&
      Number(p.level || 1) >= (Number(world.byId[p.zone]?.pvpLevelMin) || 1)));

const socialLookup: any = (id: string) => repo.getPlayer(id);
socialLookup.__all = () => repo.allPlayers();
social.setPlayerLookup(socialLookup);
social.rehydrate(repo.allPlayers());
social.rehydrateGuilds(repo.allPlayers());
const queues = new QueueService({
  repo,
  social,
  dungeonEngine,
  dungeons,
  partyRole,
});
const dungeonQueue = queues.dungeonQueue;
const battlegroundQueue = queues.battlegroundQueue;
const battlegrounds = queues.battlegrounds;
const pvpQueueTimes = queues.pvpQueueTimes;
const arenaQueues = queues.arenaQueues;
const arenaMatches = queues.arenaMatches;
const enqueueArena = (p: any, bracket = "2v2") =>
  queues.enqueueArena(p, bracket);
const leaveArenaQueue = (p: any) => queues.leaveArenaQueue(p);
const tryMatchArena = (bracket: string) => queues.tryMatchArena(bracket);
const finishArena = (m: any, winnerTeam: any, reason = "defeat") =>
  queues.finishArena(m, winnerTeam, reason);
const dungeonQueueSnapshot = (p: any) => queues.dungeonSnapshot(p);
const dungeonQueueService = queues;
const dungeonQueueRole = (p: any, requested?: string) =>
  queues.dungeonRole(p, requested);
const enqueueDungeonQueue = (p: any, dungeonId = "random", role?: string) =>
  queues.enqueueDungeon(p, dungeonId, role);
const acceptDungeonMatch = (p: any) => queues.acceptDungeonMatch(p);
const declineDungeonMatch = (p: any) => queues.declineDungeonMatch(p);
const removeDungeonQueue = (id: string) => queues.removeDungeon(id);
const leaveDungeonPartyQueue = (p: any) => queues.leavePartyQueue(p);
const tryMatchDungeonQueue = () => queues.tryMatchDungeon();
const pvpQueueSnapshot = (p: any) => queues.pvpSnapshot(p);
const pvpStats = (p: any) => queues.pvpStats(p);
const finishDuel = (winner: any, loser: any, reason = "defeat") =>
  queues.finishDuel(winner, loser);
const battlegroundSnapshot = (bg: any) => queues.battlegroundSnapshot(bg);
const startBattleground = () => queues.startBattleground();

const wsSend = (c: any, m: any) => {
  const socket = c?.socket;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(m));
    return true;
  } catch (error) {
    console.error("ws send failed", error);
    return false;
  }
};
const stateService = createStateService({
  repo,
  world,
  worldMobDefs,
  classStories,
  lore,
  worldRegions,
  worldPoi,
  worldZoneProgression,
  mmo,
  quest,
  quests,
  social,
  economy,
  worldEvents,
  worldSimulation,
  npcMemory,
  emergentWorldEvents,
  discoveryEngine,
  regionalEconomy,
  guildOrganizations,
  worldIntegration,
  chronicle,
  regionEngine,
  openWorld,
  profession,
  zones,
  npcs,
  dungeons,
  shops,
  recipes,
  classes,
  abilities,
  items,
  itemization,
  storyline,
  worldStory,
  storyIntro,
  talents,
  talentTrees,
  talentTransformations,
  classBuilds,
  buildEncounterProfiles,
  combatResources,
  combatRotations,
  dynamicItemsForPlayer,
  pvpZone,
  pvpStats,
  dungeonQueueSnapshot,
  battlegrounds,
  battlegroundSnapshot,
  pvpQueueSnapshot,
  tradeState,
  chatService,
  clients,
  wsSend,
  networkMetrics,
  partyRole,
  combat,
  normalizeMovement,
  normalizeStoryQuest,
  stateRevisionRef: {
    get value() {
      return stateRevision;
    },
    set value(v) {
      stateRevision = v;
    },
  },
  uiRevisionRef: {
    get value() {
      return uiRevision;
    },
    set value(v) {
      uiRevision = v;
    },
  },
  motionSequenceRef: {
    get value() {
      return motionSequence;
    },
    set value(v) {
      motionSequence = v;
    },
  },
});
const {
  state,
  broadcast: stateBroadcast,
  broadcastMotion,
  partyState,
  storyProgressForPlayer,
  npcDetail,
} = stateService;

const handle = createCommandHandler({
  bus,
  repo,
  playerMutations,
  npcMemory,
  activeSessions,
  reservedCharacterNames,
  worldIntegration,
  classes,
  classBuilds,
  classStories,
  storyChoices,
  lore,
  npcDialogue,
  storyline,
  worldStory,
  zones,
  world,
  inv,
  quest,
  combat,
  dungeonEngine,
  economy,
  social,
  profession,
  abilities,
  items,
  itemization,
  dungeons,
  recipes,
  shops,
  storyIntro,
  talents,
  talentTrees,
  MOVEMENT_SPEEDS,
  COMBAT_RANGES,
  normalizeAbilityRange,
  normalizeGameDistance,
  NPC_INTERACTION_METERS,
  NPC_STAND_METERS,
  AUTO_TARGET_MAX_METERS,
  battlegroundQueue,
  battlegrounds,
  pvpQueueTimes,
  pvpZone,
  pvpAllowed,
  pvpStats,
  finishDuel,
  startBattleground,
  battlegroundSnapshot,
  arenaQueues,
  arenaMatches,
  enqueueArena,
  leaveArenaQueue,
  finishArena,
  clearPvpTemplate: (p: any) => queues.clearPvpTemplate(p),
  dungeonQueue,
  dungeonQueueService,
  dungeonQueueRole,
  dungeonQueueSnapshot,
  enqueueDungeonQueue,
  leaveDungeonPartyQueue,
  acceptDungeonMatch,
  declineDungeonMatch,
  removeDungeonQueue,
  tryMatchDungeonQueue,
  addChat,
  normalizeCharacterName,
  characterNameTaken,
  pushFx,
  rewardMobKill,
  reward,
  gainXp,
  rebuildTalents,
  partyState,
  storyProgressForPlayer,
  finiteNumber,
  rollDamage,
  normalizeXpTrack,
  repositoryStatsSnapshot,
  npcDetail,
  reconcileTravelQuestState,
  makeGearInstance,
  randomAffix,
  findTradeSession,
  tradeRequests,
  tradeDistanceOk,
  tradeSessions,
  tradeOffer,
  completeTrade,
  resolveLootRollForParty,
  claimDungeonRewardChest,
  guildOrganizations,
  partyRole,
});

createServerRuntime({
  root,
  bus,
  telemetry,
  repo,
  emailService,
  authService,
  inv,
  world,
  quest,
  combat,
  worldLease,
  worldLeaseOwnerId,
  WORLD_LEASE_ID,
  dungeonEngine,
  economy,
  profession,
  social,
  regionEngine,
  worldEvents,
  worldSimulation,
  npcMemory,
  chronicle,
  factionSimulation,
  worldEcology,
  emergentWorldEvents,
  discoveryEngine,
  regionalEconomy,
  guildOrganizations,
  worldIntegration,
  openWorld,
  clients,
  activeSessions,
  reservedCharacterNames,
  VERSION,
  REPOSITORY_BACKEND,
  SESSION_CHECKPOINT_MS,
  lastPersistenceCheckpointAtRef: {
    get value() {
      return lastPersistenceCheckpointAt;
    },
    set value(v) {
      lastPersistenceCheckpointAt = v;
    },
  },
  AUTO_TARGET_MAX_METERS,
  NPC_INTERACTION_METERS,
  NPC_STAND_METERS,
  pvpZone,
  pvpAllowed,
  queues,
  dungeonQueue,
  battlegroundQueue,
  battlegrounds,
  pvpQueueTimes,
  arenaQueues,
  arenaMatches,
  enqueueArena,
  leaveArenaQueue,
  tryMatchArena,
  finishArena,
  dungeonQueueSnapshot,
  dungeonQueueService,
  dungeonQueueRole,
  enqueueDungeonQueue,
  acceptDungeonMatch,
  declineDungeonMatch,
  removeDungeonQueue,
  leaveDungeonPartyQueue,
  tryMatchDungeonQueue,
  pvpQueueSnapshot,
  pvpStats,
  finishDuel,
  battlegroundSnapshot,
  startBattleground,
  state,
  stateBroadcast,
  broadcastMotion,
  partyState,
  storyProgressForPlayer,
  npcDetail,
  handle,
  normalizeMovement,
  normalizeStoryQuest,
  reconcileTravelQuestState,
  normalizeCharacterName,
  characterNameTaken,
  pushFx,
  rewardMobKill,
  reward,
  gainXp,
  rebuildTalents,
  normalizeXpTrack,
  repositoryStatsSnapshot,
  makeGearInstance,
  randomAffix,
  findTradeSession,
  tradeRequests,
  tradeDistanceOk,
  tradeSessions,
  tradeOffer,
  completeTrade,
  resolveLootRollForParty,
  claimDungeonRewardChest,
  partyRole,
  worldMobDefs,
  classStories,
  lore,
  worldRegions,
  worldPoi,
  worldZoneProgression,
  mmo,
  quests,
  zones,
  npcs,
  dungeons,
  shops,
  recipes,
  classes,
  abilities,
  items,
  itemization,
  storyline,
  worldStory,
  storyIntro,
  talents,
  talentTrees,
  talentTransformations,
  classBuilds,
  buildEncounterProfiles,
  combatResources,
  combatRotations,
  dynamicItemsForPlayer,
  stateRevisionRef: {
    get value() {
      return stateRevision;
    },
    set value(v) {
      stateRevision = v;
    },
  },
  uiRevisionRef: {
    get value() {
      return uiRevision;
    },
    set value(v) {
      uiRevision = v;
    },
  },
  motionSequenceRef: {
    get value() {
      return motionSequence;
    },
    set value(v) {
      motionSequence = v;
    },
  },
  networkMetrics,
  tickMetrics,
  addChat,
  chatService,
  storyChoices,
  npcDialogue,
  MOVEMENT_SPEEDS,
  COMBAT_RANGES,
  normalizeAbilityRange,
  normalizeGameDistance,
  finiteNumber,
  rollDamage,
  guardPlayerRuntime,
  healingThreat,
  awardEncounterLoot,
  createDungeonCompletionRewards,
  resolveExpiredLootRolls,
  createPlayer,
  wsSend,
  tradeState,
  playerMutations,
});
