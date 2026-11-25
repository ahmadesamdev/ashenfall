export const INTEGRATION_STATE_VERSION = 2;

function isoWeekKey(now = Date.now()) {
  const d = new Date(now);
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${year}-W${String(week).padStart(2, "0")}`;
}

function object(value: any) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
function array(value: any) {
  return Array.isArray(value) ? value : [];
}

export function ensureIntegrationState(player: any, now = Date.now()) {
  player.integrationStateVersion = INTEGRATION_STATE_VERSION;
  player.endgame = object(player.endgame);
  player.endgame.weeklyKey = String(
    player.endgame.weeklyKey || isoWeekKey(now),
  );
  player.endgame.highestMythicKey = Math.max(
    0,
    Math.floor(Number(player.endgame.highestMythicKey) || 0),
  );
  player.endgame.weekly = object(player.endgame.weekly);

  const currentWeek = isoWeekKey(now);
  if (player.endgame.weeklyKey !== currentWeek) {
    player.endgame.weeklyKey = currentWeek;
    player.endgame.weekly = {};
  }

  const weekly = player.endgame.weekly;
  weekly.worldBosses = Math.max(0, Math.floor(Number(weekly.worldBosses) || 0));
  weekly.dungeons = Math.max(0, Math.floor(Number(weekly.dungeons) || 0));
  weekly.events = Math.max(0, Math.floor(Number(weekly.events) || 0));
  weekly.pvp = Math.max(0, Math.floor(Number(weekly.pvp) || 0));
  weekly.professionCrafts = Math.max(
    0,
    Math.floor(Number(weekly.professionCrafts) || 0),
  );
  weekly.achievements = array(weekly.achievements)
    .filter((x) => typeof x === "string")
    .slice(-100);

  player.weeklyProgress = player.endgame.weekly;
  player.achievements = array(player.achievements);
  player.loreDiscoveries = array(player.loreDiscoveries);
  player.regionDiscoveries = array(player.regionDiscoveries);
  player.exploration = object(player.exploration);
  player.exploration.version = 2;
  player.exploration.regions = object(player.exploration.regions);
  player.exploration.completedRegions = array(
    player.exploration.completedRegions,
  );
  player.exploration.milestones = array(player.exploration.milestones);
  player.pendingFriendRequests = array(player.pendingFriendRequests);
  player.socialNotifications = array(player.socialNotifications);
  player.friends = array(player.friends);
  player.ignoredPlayers = array(player.ignoredPlayers);
  player.guildChatHistory = array(player.guildChatHistory).slice(-100);
  player.chatHistory = array(player.chatHistory).slice(-100);
  player.loadouts = array(player.loadouts).slice(0, 4);
  player.dungeonRewardChests = array(player.dungeonRewardChests);
  player.professions = array(player.professions);
  player.profession = object(player.profession);
  player.professionXp = object(player.professionXp);
  player.professionSpecializations = object(player.professionSpecializations);
  player.knownRecipes = array(player.knownRecipes);

  return player;
}

export function integrationSummary(player: any, now = Date.now()) {
  ensureIntegrationState(player, now);
  return {
    version: INTEGRATION_STATE_VERSION,
    weekKey: player.endgame.weeklyKey,
    weekly: { ...player.endgame.weekly },
    highestMythicKey: player.endgame.highestMythicKey,
    persistentSystems: {
      story:
        !!player.storyChapter ||
        Object.keys(player.storyFlags || {}).length > 0,
      progression:
        Number(player.level || 1) > 1 || Number(player.totalXp || 0) > 0,
      gear: Object.values(player.equipment || {}).some(Boolean),
      professions:
        Array.isArray(player.professions) && player.professions.length > 0,
      social: Array.isArray(player.friends) && player.friends.length > 0,
      guild: !!player.guildId,
      dungeon: !!player.dungeon,
      pvp:
        Number(player.pvpStats?.kills || 0) +
          Number(player.pvpStats?.honor || 0) >
        0,
      exploration:
        Array.isArray(player.regionDiscoveries) &&
        player.regionDiscoveries.length > 0,
      economy:
        Number(player.gold || 0) !== 100 ||
        Object.keys(player.generatedItems || {}).length > 0,
    },
  };
}

export { isoWeekKey };
