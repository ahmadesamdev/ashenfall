import { ClientMotionController } from "./runtime/ClientMotionController.js";
import { CombatPredictionController } from "./runtime/CombatPredictionController.js";
import { ClientNetworkController } from "./runtime/ClientNetworkController.js";
import { CombatHotbarController } from "./runtime/CombatHotbarController.js";
import { ClientSessionController } from "./runtime/ClientSessionController.js";
import { ClientRenderLoop } from "./runtime/ClientRenderLoop.js";
import { MotionInterpolator } from "./runtime/MotionInterpolator.js";
import { emitAudioCue } from "./runtime/AudioPlaceholders.js";
import { createWorldRenderer } from "./runtime/WorldRenderer.js";
let ws: any = null,
  state: any = null,
  hitStopUntil = 0,
  lastStateRevision = -1,
  clockOffset = 0,
  followPlayer = true,
  storyForcedClosed = false,
  questRouteVisible =
    localStorage.getItem("ashenfall.questRouteVisible") !== "0",
  camera = { x: 0.5, y: 0.5, zoom: 1 },
  zoomTarget = 1,
  lastZoneId = null,
  panning = false,
  panStart = {},
  selectedQuest = null,
  selectedStoryArcId = null,
  selectedSkill = null,
  selectedPlayerId = null,
  selectedShopId = null,
  selectedClassId = "vanguard",
  npcInteractionAnchorId = null,
  classSelectionDirty = false,
  renderPerf = { ema: 16, bad: 0, good: 0, level: 0 },
  openNpcId = null,
  trainerSignature = "",
  shopSignature = "",
  dungeonSignature = "",
  inventorySig = "",
  bagSig = "",
  questSig = "",
  npcSig = "",
  equipmentSig = "",
  npcRenderSig = "",
  partySig = "",
  uiDirty = true,
  lastUiRender = 0,
  logSig = "",
  chatSig = "",
  classChoiceSig = "",
  buildSig = "",
  travelTransitionZone = null,
  travelTransitionStartedAt = 0,
  travelTransitionMinMs = 420;
import {
  CLASS_PORTRAITS,
  CLASS_CARD_PORTRAITS,
  CLASS_SHORT_DESCRIPTIONS,
  CLASS_FALLBACK,
  BOSS_VISUALS,
  BOSS_BY_ENEMY,
} from "./config/GameClientConfig.js";
import { syncUtilityState } from "./react/UtilityOverlays.js";
import { ClientUiRenderCoordinator } from "./runtime/ClientUiRenderCoordinator.js";
import { CharacterProgressionUiController } from "./runtime/CharacterProgressionUiController.js";
import { QuestStoryUiController } from "./runtime/QuestStoryUiController.js";
import { SocialEconomyUiController } from "./runtime/SocialEconomyUiController.js";
import { CompetitiveUiController } from "./runtime/CompetitiveUiController.js";
import { WorldIntelUiController } from "./runtime/WorldIntelUiController.js";
import { WorldHudUiController } from "./runtime/WorldHudUiController.js";
import { ClientRealtimeUiController } from "./runtime/ClientRealtimeUiController.js";
import { ClientSettingsController } from "./runtime/ClientSettingsController.js";
import { ClientInteractionController } from "./runtime/ClientInteractionController.js";
import { ClientWindowController } from "./runtime/ClientWindowController.js";
import { ClientModalController } from "./runtime/ClientModalController.js";
import { AccountSessionController } from "./runtime/AccountSessionController.js";
import { ClientInputRouter } from "./runtime/ClientInputRouter.js";
import { ClientChatController } from "./runtime/ClientChatController.js";
import { ClientPresentationUtils } from "./runtime/ClientPresentationUtils.js";
import { ClientTooltipController } from "./runtime/ClientTooltipController.js";
import { ClientAuthoritativeState } from "./runtime/ClientAuthoritativeState.js";

const $ = (id: string): any => document.getElementById(id);
const tip = $("tooltip");
const now = () => Date.now() + clockOffset;
(window as any).__ashenfallClientState = null;
(window as any).__ashenfallUiSync = () =>
  window.dispatchEvent(new Event("ashenfall-ui-state"));
const gameCursorImages: Record<string, HTMLImageElement> = {};
const authoritativeState = new ClientAuthoritativeState(() =>
  performance.now(),
);
const presentationUtils = new ClientPresentationUtils(() => state);
const escapeHtml = (value: any) => presentationUtils.escapeHtml(value);
const pct = (a: number, b: number) => presentationUtils.pct(a, b);
const skillTip = (ability: any) => presentationUtils.skillTip(ability);
const roundedRectPath = (
  ctx: any,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) => presentationUtils.roundedRectPath(ctx, x, y, w, h, r);

const accountSessionController = new AccountSessionController({
  onState: (account) => syncReactUtilityState({ account }),
  reload: () => location.reload(),
});
async function loadAccountSessions() {
  return accountSessionController.load();
}
async function logoutAllAccountSessions() {
  return accountSessionController.logoutAll();
}

let commandQueue = [];
const motionInterpolator = new MotionInterpolator(100, 100, (offset) => {
  clockOffset = offset;
});
const worldRenderer = createWorldRenderer({
  $,
  getState: () => state,
  getUiSettings: () => uiSettings,
  camera,
  getZoomTarget: () => zoomTarget,
  setZoomTarget: (v) => {
    zoomTarget = v;
  },
  getFollowPlayer: () => followPlayer,
  getKeys: () => keys,
  getLocalMotion: () => motionController.state,
  getLocalFx: () => localFx,
  tickLocalMotion,
  resetLocalMotion: (x: number, y: number, zone: string | null) =>
    motionController.reset(x, y, zone),
  motionPosition: (key: string, x: number, y: number, latency = "remote") =>
    motionPosition(key, x, y, latency),
  hasMotionPosition: (key: string) => motionInterpolator.has(key),
  now,
  getActiveQuestHelper: () => activeQuestHelper,
  getQuestRouteVisible: () => questRouteVisible,
  getTravelTransitionZone: () => travelTransitionZone,
  getTravelTransitionStartedAt: () => travelTransitionStartedAt,
  getTravelTransitionMinMs: () => travelTransitionMinMs,
  clearTravelTransition: () => {
    travelTransitionZone = null;
  },
  setUiDirty: (v) => {
    uiDirty = Boolean(v);
  },
  setLastMinimapSignature: (v) => {
    lastMinimapSignature = String(v || "");
  },
  getWorldMapMode: () => worldMapMode,
  setWorldMapMode: (v) => {
    worldMapMode = v;
  },
  getWorldMapZone: () => worldMapZone,
  setWorldMapZone: (v) => {
    worldMapZone = v;
  },
  CLASS_PORTRAITS,
  BOSS_VISUALS,
  BOSS_BY_ENEMY,
  WORLD_METERS: 32000,
  VIEWPORT_WORLD_METERS: 360,
  MIN_ZOOM: 0.9,
  MAX_ZOOM: 2.4,
  MINIMAP_RANGE_METERS: 900,
  MINIMAP_MIN_ZOOM: 0.65,
  MINIMAP_MAX_ZOOM: 2.2,
  emitAudioCue,
  renderPerf,
});
const zoneWorldMeters = () => worldRenderer.zoneWorldMeters();
const isClientBlocked = (zone, x, y) =>
  worldRenderer.isClientBlocked(zone, x, y);
const worldToScreen = (x, y) => worldRenderer.worldToScreen(x, y);
const screenToWorld = (x, y) => worldRenderer.screenToWorld(x, y);
const worldMetersForRenderRange = (m) =>
  worldRenderer.worldMetersForRenderRange(m);
const minZoomForZone = () => worldRenderer.getZoomBounds().min;
const drawWorld = (t = performance.now()) => {
  ensureLocalCombatApproachIntent();
  return worldRenderer.drawWorld(t);
};
const drawMinimap = (force = false) => worldRenderer.drawMinimap(force);
const drawWorldMap = () => worldRenderer.drawWorldMap();
const resizeWorldCanvas = () => worldRenderer.resizeWorldCanvas();
const loadVisualAssets = () => worldRenderer.loadVisualAssets();
const visualAssets = worldRenderer.getVisualAssets();
const getMinimapZoom = () => worldRenderer.getMinimapZoom();
const setMinimapZoom = (v) => worldRenderer.setMinimapZoom(v);
const motionController = new ClientMotionController({
  getPlayer: () => state?.player,
  getClockOffset: () => clockOffset,
  getWorldMeters: () => zoneWorldMeters(),
  getRegionalSpeed: () => Number(state?.region?.runtime?.speedMultiplier || 1),
  getRttMs: () => Number((window as any).__ashenfallRtt || 0),
  isBlocked: (x: number, y: number) =>
    isClientBlocked(state?.player?.zone, x, y),
});
function syncLocalMotionState() {}
function tickLocalMotion(t: number) {
  return motionController.tick(t);
}
function ensureLocalCombatApproachIntent(): void {
  const p = state?.player;
  if (
    !p ||
    keys.size ||
    motionController.state.localIntentSource === "manual" ||
    motionController.isManualOverrideActive()
  )
    return;
  const localCombat = motionController.state.localIntentSource === "combat";
  const localCombatAge =
    performance.now() -
    Number(motionController.state.localIntentStartedAt || 0);
  const serverOwnsCombat =
    motionController.state.serverMovementIntent === "combat" ||
    motionController.state.serverAutoApproach ||
    Boolean(p.worldCombatMobId) ||
    Boolean(p.combat?.autoApproach) ||
    Boolean(p.combat?.queuedWorldAbility);
  if (localCombat && !serverOwnsCombat && localCombatAge > 350) {
    stopLocalMotion();
    return;
  }
  const approachActive =
    serverOwnsCombat || (localCombat && localCombatAge <= 350);
  if (!approachActive) {
    if (localCombat) stopLocalMotion();
    return;
  }
  if (!p.targetMobId) {
    if (localCombat) stopLocalMotion();
    return;
  }
  const mob = (state.mobs || []).find(
    (m: any) => String(m.id) === String(p.targetMobId),
  );
  if (
    !mob ||
    mob.state === "dead" ||
    (mob.zone != null && String(mob.zone) !== String(p.zone))
  ) {
    if (localCombat) stopLocalMotion();
    return;
  }
  const mp = motionPosition(
    `m:${mob.id}`,
    Number(mob.x),
    Number(mob.y),
    "remote",
  );
  const abilityId = p.combat?.queuedWorldAbility;
  const a = abilityId ? state.catalog?.abilities?.[abilityId] : null;
  const stopMeters = Math.max(
    1.5,
    Number(
      a?.range ||
        p.combat?.approachRangeMeters ||
        (["ranger", "arcanist", "warden", "occultist", "hierophant"].includes(
          String(p.classId),
        )
          ? 72
          : 18),
    ),
  );
  const dx = Number(mp.x) - Number(motionController.state.x),
    dy = Number(mp.y) - Number(motionController.state.y);
  const dist = Math.hypot(dx, dy) * zoneWorldMeters();
  const satisfiedByServer =
    motionController.state.serverApproachSatisfied && dist <= stopMeters + 3;
  if (satisfiedByServer || dist <= stopMeters) {
    if (localCombat) stopLocalMotion();
    return;
  }
  const ap = localApproachPoint(Number(mp.x), Number(mp.y), stopMeters);
  if (!localCombat) beginLocalMoveTarget(ap.x, ap.y, "run", "combat");
  else motionController.updateTarget(ap.x, ap.y);
}
function refreshLocalCombatApproachTarget(): void {
  const p = state?.player;
  if (
    !p ||
    !p.targetMobId ||
    keys.size ||
    motionController.isManualOverrideActive()
  )
    return;
  if (motionController.state.localIntentSource === "manual") return;
  const localCombat = motionController.state.localIntentSource === "combat";
  const localCombatAge =
    performance.now() -
    Number(motionController.state.localIntentStartedAt || 0);
  const serverOwnsCombat =
    motionController.state.serverMovementIntent === "combat" ||
    motionController.state.serverAutoApproach ||
    Boolean(p.worldCombatMobId) ||
    Boolean(p.combat?.autoApproach) ||
    Boolean(p.combat?.queuedWorldAbility);
  if (!serverOwnsCombat && !(localCombat && localCombatAge <= 350)) {
    if (localCombat) stopLocalMotion();
    return;
  }
  const mob = (state.mobs || []).find(
    (m: any) => String(m.id) === String(p.targetMobId),
  );
  if (
    !mob ||
    mob.state === "dead" ||
    (mob.zone != null && String(mob.zone) !== String(p.zone))
  ) {
    if (localCombat) stopLocalMotion();
    return;
  }
  const mp = motionPosition(
    `m:${mob.id}`,
    Number(mob.x),
    Number(mob.y),
    "remote",
  );
  const abilityId = p.combat?.queuedWorldAbility;
  const a = abilityId ? state.catalog?.abilities?.[abilityId] : null;
  const stopMeters = Math.max(
    1.5,
    Number(
      a?.range ||
        p.combat?.approachRangeMeters ||
        (["ranger", "arcanist", "warden", "occultist", "hierophant"].includes(
          String(p.classId),
        )
          ? 72
          : 18),
    ),
  );
  const dx = Number(mp.x) - Number(motionController.state.x),
    dy = Number(mp.y) - Number(motionController.state.y);
  const dist = Math.hypot(dx, dy) * zoneWorldMeters();
  if (
    (motionController.state.serverApproachSatisfied &&
      dist <= stopMeters + 3) ||
    dist <= stopMeters
  ) {
    if (motionController.state.localIntentSource === "combat")
      stopLocalMotion();
    return;
  }
  const ap = localApproachPoint(Number(mp.x), Number(mp.y), stopMeters);
  if (motionController.state.localIntentSource !== "combat")
    beginLocalMoveTarget(ap.x, ap.y, "run", "combat");
  else motionController.updateTarget(ap.x, ap.y);
}

const combatPrediction = new CombatPredictionController({
  getAbility: (id: string) => state?.catalog?.abilities?.[id],
  getPlayer: () => state?.player,
  now: () => now(),
  getLocalFx: () => localFx,
  setLocalFx: (v: any[]) => {
    localFx = v;
  },
  findTarget: (id: string) =>
    (state?.mobs || []).find((m: any) => m.id === id) ||
    (state?.nearby || []).find((m: any) => m.id === id),
  reduceMotion: () => uiSettings?.reduceMotion,
  setHitStop: (ms: number) => {
    hitStopUntil = Math.max(hitStopUntil, performance.now() + ms);
  },
  markUiDirty: () => {
    uiDirty = true;
  },
});
const combatHotbar = new CombatHotbarController({
  getState: () => state,
  onChanged: () => {
    combatHotbarSig = "";
    uiDirty = true;
    renderCombat();
  },
  notify: (message) => toast(message, true),
});
let sessionResolved = false;
const savedCharacterId = () => {
  try {
    return localStorage.getItem("ashenfall.playerId") || "";
  } catch {
    return "";
  }
};
function setSessionLoading(show: boolean, text = "Loading your character…") {
  (window as any).__ashenfallSessionLoading = { visible: show, text };
  (window as any).__ashenfallSessionLoadingRender?.();
}
function setCreatingCharacterVisible(visible: boolean) {
  (window as any).__ashenfallCreateUiState = {
    ...((window as any).__ashenfallCreateUiState || {}),
    visible,
    creating: !!(window as any).__createPending,
  };
  (window as any).__ashenfallCreateUiRender?.();
  if (visible) {
    document.body.classList.add("creating-character");
    document.body.classList.remove("game-ready");
  } else {
    document.body.classList.remove(
      "creating-character",
      "modal-open",
      "auth-gate",
    );
    document.body.classList.add("game-ready");
  }
}
const sessionController = new ClientSessionController({
  setResolved: (value) => {
    sessionResolved = value;
  },
  setLoading: setSessionLoading,
  setCreatingCharacterVisible,
});
function resolveSession(hasCharacter: boolean) {
  sessionController.resolve(hasCharacter);
}

const uiSettings = (() => {
  try {
    return Object.assign(
      {
        maxPlayers: 80,
        showNames: true,
        showMobs: true,
        showTerrain: true,
        reduceMotion: false,
      },
      JSON.parse(localStorage.getItem("ashenfall.settings") || "{}"),
    );
  } catch {
    return {
      maxPlayers: 80,
      showNames: true,
      showMobs: true,
      showTerrain: true,
      reduceMotion: false,
    };
  }
})();
const settingsController = new ClientSettingsController({
  getSettings: () => uiSettings,
  persist: (settings) =>
    localStorage.setItem("ashenfall.settings", JSON.stringify(settings)),
  markUiDirty: () => {
    uiDirty = true;
  },
  redrawWorldMap: () => drawWorldMap(),
  applyVisualSystem: () => applyUiVisualSystem(),
});

let contextTargetId = null;
let storyAdvancePending = false;
let pendingMoveIntent: any = null;
let pendingMoveTimer: any = null;
let lastMoveSentAt = 0;
let worldMapOpen = false;
let lastWorldMapDraw = 0;
let worldMapMode = "zone";
let worldMapZone = null;
let mailRenderSig = "",
  auctionRenderSig = "";
let auctionMarket = null;
let auctionStats = null;
let auctionSellerHistory = null;
let partyRenderSig = "";
let professionRenderSig = "";
let dungeonRenderSig = "";
let worldMapRenderSig = "";
let reconnectAttempt = 0;
let localFx = [];
let clientRequestSeq = 0;
let lastMinimapSignature = "";
async function loadWorldLayout() {
  try {
    const r = await fetch("/game-data/world-layout.json", {
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`World layout request failed (${r.status})`);
    const data = await r.json();
    if (!data || typeof data !== "object")
      throw new Error("World layout is invalid.");
    worldRenderer.setWorldLayout(data);
    drawMinimap(true);
  } catch (err) {
    console.error("Ashenfall world layout failed to load:", err);
    toast("World layout failed to load; using safe terrain mode.", false);
    worldRenderer.setWorldLayout({});
  }
}

const RECONNECT_REPLAY_SAFE_COMMANDS = new Set([
  "resume_character",
  "create_character",
]);
const TRANSIENT_GAMEPLAY_COMMANDS = new Set([
  "move",
  "stop",
  "attack_mob",
  "cast_ability",
  "interact_npc",
  "interact_portal",
  "loot_pickup",
  "gather_start",
  "craft_recipe",
  "pvp_arena_queue",
  "pvp_queue",
]);
function shouldQueueAfterDisconnect(action) {
  return RECONNECT_REPLAY_SAFE_COMMANDS.has(String(action || ""));
}
function toast(msg, ok = true) {
  const text = String(msg ?? "").trim();
  if (!text) return;
  console.info(`[Ashenfall] ${text}`);
  const el = $("toast");
  if (!el) return;
  const anchor = $("bottomMenu");
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
    el.style.bottom = `${Math.max(8, window.innerHeight - r.top + 8)}px`;
    el.style.left = "auto";
  } else {
    el.style.right = "12px";
    el.style.bottom = "12px";
    el.style.left = "auto";
  }
  el.textContent = text;
  el.className = `toast ${ok ? "ok" : "bad"} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
  }, 3200);
}
function pushSystemMessage(text: string) {
  chatController.addSystemMessage(text);
}
function shouldSystemNotify(action: string, ok: boolean) {
  if (!ok) return false;
  return new Set([
    "create_character",
    "resume_character",
    "learn_skill",
    "learn_talent",
    "accept_quest",
    "turnin_quest",
    "equip",
    "unequip",
    "use_hearthstone",
    "use_item",
    "buy_shop",
    "sell_shop",
    "buyback_shop",
    "craft_recipe",
    "craft_blacksmith",
    "mine_ore",
    "select_profession",
    "drop_profession",
    "dungeon_queue",
    "dungeon_queue_party",
    "dungeon_accept_match",
    "dungeon_decline_match",
    "pvp_arena_queue",
    "pvp_arena_leave_queue",
    "pvp_queue",
    "pvp_leave_queue",
    "pvp_invite",
    "pvp_accept",
    "pvp_decline",
    "party_invite",
    "party_accept",
    "party_decline",
    "friend_add",
    "friend_accept",
    "guild_create",
    "guild_accept",
    "guild_decline",
    "trade_confirm",
    "auction_buy",
    "auction_bid",
    "auction_list",
    "claim_mail",
    "claim_all_mail",
    "open_story",
    "advance_story",
    "respawn",
  ]).has(String(action || ""));
}

function scheduleReconnect() {
  networkController.scheduleReconnect();
}
const motionPosition = (key, fallbackX, fallbackY, latency = "remote") =>
  motionInterpolator.position(
    key,
    fallbackX,
    fallbackY,
    clockOffset,
    latency === "local" ? 55 : 100,
    latency === "local" ? 90 : 100,
  );

let localArenaQueue: {
  queued: boolean;
  bracket: string;
  queuedAt: number;
  position: number;
} | null = null;
let progressionSig = "";
let loadoutSig = "";
let lastLevelUpSeen = Number(
  localStorage.getItem("ashenfall.lastLevelUpSeen") || 0,
);
function applyAuthoritative(next: any): boolean {
  const applied = authoritativeState.apply(next);
  if (!applied) return false;
  state = authoritativeState.get();
  (window as any).__ashenfallClientState = state;
  const reactUi = (window as any).__ashenfallReactUi || {};
  (window as any).__ashenfallReactUi = {
    ...reactUi,
    selectedShopId,
    openNpcId,
  };
  (window as any).__ashenfallUiSync?.();
  const player = state?.player;
  if (
    player &&
    (!motionController.state.zone ||
      motionController.state.zone !== player.zone)
  ) {
    syncLocalMotionFromServer(player);
  }
  uiDirty = true;
  return true;
}
function syncLocalMotionFromServer(player: any, sequence?: number): void {
  if (!player) return;
  motionController.sync(sequence == null ? player : { ...player, sequence });
  syncLocalMotionState();
}
function beginLocalMoveTarget(
  x: number,
  y: number,
  mode: "walk" | "run" = "run",
  source: "manual" | "combat" = "manual",
): void {
  motionController.beginTarget(x, y, mode, source);
  syncLocalMotionState();
}
function setLocalMoveInput(
  dx: number,
  dy: number,
  mode: "walk" | "run" = "run",
): void {
  motionController.setInput(dx, dy, mode);
  syncLocalMotionState();
}
function stopLocalMotion(): void {
  motionController.stop();
  syncLocalMotionState();
}
function triggerAbilityById(abilityId: string): any {
  if (!abilityId || !state?.player?.hasCharacter) return false;
  const a = state.catalog?.abilities?.[abilityId];
  if (!a) return false;
  const p = state.player;
  if (state.encounter) {
    const requestId = send("cast_ability", {
      abilityId,
      targetPlayerId: p.targetPlayerId || selectedPlayerId || null,
    });
    if (requestId)
      combatPrediction.start(
        abilityId,
        p.targetPlayerId ? [String(p.targetPlayerId)] : [],
        String(requestId),
      );
    return requestId;
  }
  if (state.pvp) {
    const requestId = send("pvp_cast", { abilityId });
    if (requestId)
      combatPrediction.start(
        abilityId,
        p.targetPlayerId ? [String(p.targetPlayerId)] : [],
        String(requestId),
      );
    return requestId;
  }
  if (a.selfBuff) {
    const requestId = send("use_world_ability", {
      abilityId,
      targetPlayerId: p.id,
    });
    if (requestId)
      combatPrediction.start(abilityId, [String(p.id)], String(requestId));
    return requestId;
  }
  if (a.heal || a.partyBuff || a.hot) {
    const targetPlayerId = p.targetPlayerId || selectedPlayerId || p.id;
    const requestId = send("use_world_ability", { abilityId, targetPlayerId });
    if (requestId)
      combatPrediction.start(
        abilityId,
        [String(targetPlayerId)],
        String(requestId),
      );
    return requestId;
  }
  if (a.aoe?.center === "self") {
    const requestId = send("use_world_ability", { abilityId });
    if (requestId) combatPrediction.start(abilityId, [], String(requestId));
    return requestId;
  }
  const targetId = p.targetMobId || state.targetMob?.id || nearestMob()?.id;
  if (!targetId) return toast("No nearby creature to target.", false);
  const mob = (state.mobs || []).find(
    (m: any) => String(m.id) === String(targetId),
  );
  if (!mob) return toast("That creature is no longer available.", false);
  if (p.targetMobId !== mob.id) {
    send("target_mob", { mobId: mob.id });
    p.targetMobId = mob.id;
  }
  if (!keys.size) {
    if (pendingMoveTimer) {
      clearTimeout(pendingMoveTimer);
      pendingMoveTimer = null;
    }
    pendingMoveIntent = null;
  }
  const rangeMeters = Math.max(
    1.5,
    Number(a.range || p.combat?.approachRangeMeters || 8),
  );
  const local = motionController.state;
  const localX = Number.isFinite(local.x) ? local.x : Number(p.x);
  const localY = Number.isFinite(local.y) ? local.y : Number(p.y);
  const renderedMob = motionPosition(
    `m:${mob.id}`,
    Number(mob.x),
    Number(mob.y),
    "remote",
  );
  const distMeters =
    Math.hypot(localX - Number(renderedMob.x), localY - Number(renderedMob.y)) *
    zoneWorldMeters();
  if (distMeters > rangeMeters && !keys.size) {
    const ap = localApproachPoint(
      Number(renderedMob.x),
      Number(renderedMob.y),
      rangeMeters,
    );
    if (
      motionController.state.localIntentSource === "combat" &&
      motionController.state.localIntentKind === "target"
    )
      motionController.updateTarget(ap.x, ap.y);
    else beginLocalMoveTarget(ap.x, ap.y, "run", "combat");
  }
  const requestId = send("use_world_ability", {
    abilityId,
    mobId: mob.id,
    targetPlayerId: p.targetPlayerId || selectedPlayerId || null,
  });
  if (requestId)
    combatPrediction.start(abilityId, [String(mob.id)], String(requestId));
  return requestId;
}

const networkController = new ClientNetworkController({
  getSocket: () => ws,
  setSocket: (value) => {
    ws = value;
  },
  getSavedCharacterId: savedCharacterId,
  getReconnectAttempt: () => reconnectAttempt,
  setReconnectAttempt: (value) => {
    reconnectAttempt = value;
  },
  getCommandQueue: () => commandQueue,
  setCommandQueue: (value) => {
    commandQueue = value;
  },
  shouldQueueAfterDisconnect,
  onMotion: (motion) => {
    try {
      motionInterpolator.ingest(motion);
      const mp = motion?.player || motion;
      if (mp) {
        syncLocalMotionFromServer(
          {
            ...mp,
            movementMode: mp.movementMode,
            serverNow: motion?.serverNow || mp.serverNow,
          },
          Number(motion?.sequence),
        );
        refreshLocalCombatApproachTarget();
        if (state?.player) {
          const wasDead = Boolean(state.player.dead);
          const isDead = Boolean(mp.dead);
          state.player.dead = isDead;
          if (mp.respawnAt != null)
            state.player.respawnAt = Number(mp.respawnAt || 0);
          state.player.respawnReady = !!mp.respawnReady;
          if (mp.respawnMessage)
            state.player.respawnMessage = mp.respawnMessage;
          if (wasDead && !isDead) {
            motionController.reset(
              Number(mp.x),
              Number(mp.y),
              String(mp.zone || state.player.zone || ""),
            );
            stopLocalMotion();
          }
          if (wasDead !== state.player.dead) uiDirty = true;
          renderDeath();
        }
      }
    } catch (error) {
      console.warn("Motion sample ingest failed", error);
    }
  },
  onStateMessage: (data) => {
    if (data?.worldEvent?.id && state?.worldEvent?.id !== data.worldEvent.id)
      pushSystemMessage(`⚔ World event: ${data.worldEvent.name}`);
    if (data?.stateRevision != null && data.stateRevision < lastStateRevision)
      return;
    const wasInitialized = authoritativeState.getRevision() >= 0;
    const applied = applyAuthoritative(data);
    if (applied && data?.catalog?.classes) fillClasses();
    if (applied && data?.stateRevision != null)
      lastStateRevision = Math.max(
        lastStateRevision,
        Number(data.stateRevision),
      );
    if (state?.player?.zone && state.player.zone !== lastKnownPlayerZone) {
      lastKnownPlayerZone = state.player.zone;
      lastMoveSentAt = 0;
      if (pendingMoveTimer) {
        clearTimeout(pendingMoveTimer);
        pendingMoveTimer = null;
      }
      pendingMoveIntent = null;
    }
    if (
      state?.player?.hasCharacter &&
      state.player.id &&
      systemMessages.length === 0
    ) {
      pushSystemMessage(
        `Welcome to ${state.zoneInfo?.name || "Ashenfall"}. Your journey begins.`,
      );
      if (state.player.storyDialogueOpen)
        pushSystemMessage(
          "A new story objective is available. Follow the quest tracker.",
        );
    }
    if (applied) {
      if (!wasInitialized) {
        try {
          renderAll();
        } catch (err) {
          console.error("Initial authoritative state render failed", err);
          uiDirty = true;
        }
      } else uiDirty = true;
    }
    if ($("dialogueNext") && !storyAdvancePending) {
      $("dialogueNext").disabled = false;
      $("dialogueNext").style.cursor = "pointer";
    }
    if (state?.player?.hasCharacter && state.player.classId) {
      selectedClassId = state.player.classId;
      classSelectionDirty = false;
    } else if (!classSelectionDirty && state?.player?.classId)
      selectedClassId = state.player.classId;
    if (state?.player?.hasCharacter && state.player.id) {
      localStorage.setItem("ashenfall.playerId", state.player.id);
      resolveSession(true);
    } else if (!sessionResolved) resolveSession(false);
    window.__createPending = false;
    const cb = document.querySelector('[data-action="create-character"]');
    if (cb) {
      cb.disabled = false;
      const span = cb.querySelector("span");
      if (span) span.textContent = "Enter the World";
      else cb.textContent = "Enter the World";
    }
    if (state?.player?.storyIntroSeen) {
      storyForcedClosed = true;
      closeModal("storyModal");
    } else if (state?.player?.storyDialogueOpen) {
      storyForcedClosed = false;
      syncStoryModal();
    }
  },
  onCommandResult: (d) => handleNetworkCommandResult(d),
  onError: (message) => {
    if (
      String(message || "")
        .toLowerCase()
        .includes("saved character")
    ) {
      localStorage.removeItem("ashenfall.playerId");
      resolveSession(false);
    }
    toast(message, false);
  },
  onConnected: () => {
    $("conn").textContent = "● Connected";
    $("conn").className = "connected";
    uiDirty = true;
    if (!sessionResolved) setSessionLoading(true, "Connecting to Ashenfall…");
  },
  onDisconnected: () => {
    $("conn").textContent = "Disconnected  - reconnecting…";
    $("conn").className = "disconnected";
    motionInterpolator.reset();
    motionController.reset(
      Number(state?.player?.x || 0.5),
      Number(state?.player?.y || 0.5),
      state?.player?.zone || null,
    );
  },
  onConnectionError: () => {
    $("conn").textContent = "Connection error";
    $("conn").className = "disconnected";
  },
  onPing: (rtt) => {
    const prev = Number((window as any).__ashenfallRtt || 0);
    (window as any).__ashenfallRtt = Math.round(
      prev > 0 ? prev * 0.6 + rtt * 0.4 : rtt,
    );
  },
  onRefreshAuth: async () => {
    try {
      await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
    } catch {}
  },
});
window.addEventListener("ashenfall-create-class-selected", (e: any) => {
  const id = String(e.detail?.id || "");
  if (!id) return;
  selectedClassId = id;
  classSelectionDirty = true;
  buildSig = "";
});
function send(action, data = {}) {
  return networkController.send(action, data);
}
function connect() {
  networkController.connect();
}

function handleNetworkCommandResult(d) {
  clearCommandButtons(String(d.action || ""));
  if (d.requestId)
    combatPrediction.settle(String(d.requestId), !!d.ok, d.detail || {});
  if (
    d.ok &&
    d.action === "allocate_stat" &&
    d.detail?.build &&
    state?.player
  ) {
    const b = d.detail.build;
    state.player.stats = { ...(state.player.stats || {}), ...(b.stats || {}) };
    state.player.statPoints = Number(
      b.statPoints ?? state.player.statPoints ?? 0,
    );
    state.player.lastBuildChange = b;
    characterModalSig = "";
    uiDirty = true;
    try {
      if (!$("characterModal")?.classList.contains("hidden"))
        renderCharacterModalContents();
    } catch (err) {
      console.warn("Character stat immediate reconciliation failed", err);
    }
  }
  if (
    d.ok &&
    d.detail &&
    Object.prototype.hasOwnProperty.call(d.detail, "party")
  ) {
    if (!state) state = {};
    state.party = d.detail.party || null;
    state.player = state.player || {};
    state.player.partyId = d.detail.party?.id || d.detail.partyId || null;
    state.player.partyLeaderId = d.detail.party?.leader || null;
    partyRenderSig = "";
    partyHudSig = "";
    uiDirty = true;
    lastUiRender = 0;
    try {
      if (!$("partyModal")?.classList.contains("hidden")) renderParty();
    } catch (err) {
      console.warn("Party modal immediate reconciliation failed", err);
    }
  }
  if (d.ok && !TRANSIENT_GAMEPLAY_COMMANDS.has(String(d.action || ""))) {
    partyRenderSig = "";
    partyHudSig = "";
    socialRenderSig = "";
    professionRenderSig = "";
    dungeonRenderSig = "";
    worldMapRenderSig = "";
    mailRenderSig = "";
    auctionRenderSig = "";
    tradeRenderSig = "";
    inventorySig = "";
    bagSig = "";
    equipmentSig = "";
    shopSignature = "";
    npcRenderSig = "";
    playersRenderSig = "";
    questSig = "";
    buildSig = "";
    combatHotbarSig = "";
    pvpRenderSig = "";
    uiDirty = true;
    setTimeout(() => {
      try {
        if (state && getOpenModals().length) renderAll();
      } catch (err) {
        console.warn("Open modal reconciliation failed", err);
      }
    }, 0);
  }
  if (d.action === "auction_search" && d.ok) {
    auctionMarket = d.market || null;
    auctionRenderSig = "";
    syncAuctionReactUi();
    setTimeout(openAuctionHouse, 0);
  }
  if (d.action === "social_search" && d.ok) {
    socialSearchResults = d.results || [];
    socialRenderSig = "";
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      socialSearchResults,
    };
    window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
    uiDirty = true;
  }
  if (d.action === "market_stats" && d.ok) {
    auctionStats = d;
    auctionRenderSig = "";
    syncAuctionReactUi();
    setTimeout(openAuctionHouse, 0);
  }
  if (d.action === "auction_seller_history" && d.ok) {
    auctionSellerHistory = d.history || [];
    auctionRenderSig = "";
    syncAuctionReactUi();
    setTimeout(openAuctionHouse, 0);
  }
  if (d.state) {
    let applied = applyAuthoritative(d.state);
    if (
      d.ok &&
      d.detail &&
      Object.prototype.hasOwnProperty.call(d.detail, "party")
    )
      applied = true;
    if (
      applied &&
      ![
        "move",
        "move_input",
        "stop",
        "select_player",
        "target_mob",
        "select_mob",
      ].includes(String(d.action || ""))
    ) {
      uiDirty = true;
    }
  }
  if (state?.player?.storyIntroSeen) {
    storyForcedClosed = true;
    closeModal("storyModal");
  } else if (state?.player?.storyDialogueOpen) {
    storyForcedClosed = false;
  }
  storyAdvancePending = false;
  if ($("dialogueNext")) {
    $("dialogueNext").disabled = false;
    $("dialogueNext").removeAttribute("aria-busy");
    $("dialogueNext").style.cursor = "pointer";
    $("dialogueNext").textContent = "Continue";
  }
  if (d.action === "auction_list" && d.ok) {
    window.__auctionTab = "My Listings";
    window.__auctionCategory = "All";
    auctionRenderSig = "";
    setTimeout(() => {
      const item = $("auctionItem"),
        qty = $("auctionQty"),
        price = $("auctionPrice");
      if (item) item.value = "";
      if (qty) qty.value = "1";
      if (price) price.value = "10";
    }, 0);
  }
  if (d.ok) {
    if (d.action === "party_create") {
      partyRenderSig = "";
      partyHudSig = "";
      uiDirty = true;
    }
    if (d.action === "pvp_arena_queue") {
      const bracket = String(
        (d.detail && d.detail.bracket) ||
          state?.pvpQueue?.arena?.bracket ||
          "2v2",
      );
      localArenaQueue = {
        queued: true,
        bracket,
        queuedAt: Date.now(),
        position: 1,
      };
      pvpRenderSig = "";
      uiDirty = true;
      try {
        if (!$("pvpModal")?.classList.contains("hidden")) renderPvp();
      } catch (err) {
        console.warn("Arena queue immediate reconciliation failed", err);
      }
    }
    if (d.action === "pvp_arena_leave_queue") {
      localArenaQueue = null;
      pvpRenderSig = "";
      uiDirty = true;
      try {
        if (!$("pvpModal")?.classList.contains("hidden")) renderPvp();
      } catch (err) {
        console.warn("Arena leave immediate reconciliation failed", err);
      }
    }
    if (shouldSystemNotify(d.action, true))
      pushSystemMessage(d.message || "Action completed.");
  } else if (d.action === "pvp_arena_queue") {
    localArenaQueue = null;
    if (d.message) toast(d.message, false);
  } else if (d.message) toast(d.message, false);
  if (
    String(d.action || "").startsWith("guild_") ||
    String(d.action || "").startsWith("friend_") ||
    String(d.action || "").startsWith("ignore_")
  ) {
    socialRenderSig = "";
    uiDirty = true;
  }
  if (d.createCharacter && d.ok) {
    window.__createPending = false;
    classSelectionDirty = false;
    storyForcedClosed = false;
    sessionResolved = true;
    setSessionLoading(false);
    setCreatingCharacterVisible(false);
    resizeWorldCanvas();
    if (state?.player?.id)
      localStorage.setItem("ashenfall.playerId", state.player.id);
    resolveSession(true);
    if (state?.player?.storyDialogueOpen && !state.player.storyIntroSeen)
      showStoryStep(
        state.catalog.storyIntro.steps[state.player.storyDialogueStep || 0],
        state.player.storyDialogueStep || 0,
      );
  }
  if (d.createCharacter && !d.ok) {
    window.__createPending = false;
    (window as any).__ashenfallCreateUiState = {
      ...((window as any).__ashenfallCreateUiState || {}),
      creating: false,
    };
    (window as any).__ashenfallCreateUiRender?.();
  }
  if (d.detail?.lootPile) showLoot(d.detail.lootPile);
  if (d.detail?.service) {
    npcInteractionAnchorId = d.detail.npc?.id || d.detail.id || null;
    openNpcService(d.detail);
  } else if (d.detail?.npc) {
    npcInteractionAnchorId = d.detail.npc.id;
    openNpcId = d.detail.npc.id;
    npcRenderSig = "";
    openNpcOverlay(d.detail);
  }
  if (d.detail?.reward) pushSystemMessage(`🎁 ${d.message}`);
  if (d.detail?.inspect) showInspectModal(d.detail.inspect);
  if (!$("shopModal").classList.contains("hidden")) {
    shopSignature = "";
    openShop(selectedShopId);
  }
  if (!$("auctionModal").classList.contains("hidden")) openAuctionHouse();
  if (state?.trade?.session || state?.trade?.pending) renderTrade();
  if (d.detail?.offeredQuest) {
    npcInteractionAnchorId = d.detail.npc?.id || npcInteractionAnchorId;
    openQuestJournal(d.detail.offeredQuest);
  }
  if (d.detail?.story && d.detail?.dialogue)
    showStoryStep(d.detail.dialogue, d.detail.step);
  uiDirty = true;
  if (d.detail?.chatMessage) {
    state = state || {};
    state.chat = state.chat || [];
    const msg = d.detail.chatMessage;
    if (
      !state.chat.some(
        (x) =>
          (msg.id && x.id === msg.id) ||
          (!msg.id &&
            x.from === msg.from &&
            x.text === msg.text &&
            Math.abs((x.ts || 0) - (msg.ts || 0)) < 3000),
      )
    )
      state.chat.push(msg);
    state.chat = state.chat.slice(-80);
    chatSig = "";
    renderChat();
  }
  if (d.detail?.questAccepted) {
    refreshNpcModal();
    renderQuests();
    renderQuestJournalContents();
  }
  if (d.detail?.dungeon) {
    pushSystemMessage(
      `🏰 ${d.detail.dungeon} stage ${d.detail.stage}/${d.detail.total}`,
    );
    if (d.detail.zoneId) {
      followPlayer = true;
      camera.x = state?.player?.x || 0.5;
      camera.y = state?.player?.y || 0.5;
    }
  }
  if (d.detail?.closed) {
    storyForcedClosed = true;
    $("storyModal").classList.add("hidden");
  }
  uiDirty = true;
}
let characterModalSig = "";
let lastKnownPlayerZone: string | null = null;
let mobHitGridSource: any = null;
let mobHitGrid = new Map<string, any[]>();
const mobHitCell = 0.02;
let toastTimer: any = null;
let lastBossCastKey = "";
let lastCombatImpactAt = 0;
let chatChannel = "say";
let chatWhisperTargetId = null;
let systemMessages: any[] = [];
const chatController = new ClientChatController({
  getState: () => state,
  getSelectedPlayerId: () => selectedPlayerId,
  send: (action, data) => send(action, data),
  toast: (message, ok) => toast(message, ok),
  getElement: $,
  getSystemMessages: () => systemMessages,
  setSystemMessages: (v) => {
    systemMessages = v;
  },
  markDirty: () => {
    chatSig = "";
    uiDirty = true;
  },
});
const tooltipController = new ClientTooltipController({
  getElement: $,
  getState: () => state,
  getTip: () => tip,
  getItemTooltip: (item) => itemTooltipHtml(item),
});
function setChatChannel(channel, targetId = null) {
  chatChannel = chatController.setChannel(channel, targetId);
  chatWhisperTargetId = chatController.whisperTargetId;
}
function sendChat() {
  chatController.send();
  chatChannel = chatController.channel;
  chatWhisperTargetId = chatController.whisperTargetId;
}
function syncReactUtilityState(patch: any) {
  (window as any).__ashenfallReactUtilityState = {
    ...((window as any).__ashenfallReactUtilityState || {}),
    ...patch,
  };
  syncUtilityState(patch);
}
function reactUtilityMounted() {
  return Boolean((window as any).__ashenfallReactUtilityMounted);
}
window.addEventListener("ashenfall-react-utility-mounted", () => {
  (window as any).__ashenfallStoryAdvance = () => {
    if (storyAdvancePending) return;
    if (!state?.player?.storyDialogueOpen)
      return toast("The prologue is not currently open.", false);
    if (!ws || ws.readyState !== WebSocket.OPEN)
      return toast("Still connecting to Ashenfall…", false);
    storyAdvancePending = true;
    send("advance_story");
  };
  (window as any).__ashenfallRespawn = () => send("respawn");
  (window as any).__ashenfallSettingsChange = (key: string, value: any) =>
    settingsController.set(key, value);
  if (state?.player) {
    renderDeath();
    renderStory();
    renderLog();
  }
  loadSettingsUi();
});

function showTipFor(el, e) {
  tooltipController.show(el, e);
}
let lootRollSig = "";
let partyHudSig = "";
let socialInviteSig = "";
let pvpRenderSig = "";
let tradeRenderSig = "";
let arenaQueueHudSig = "";
let dungeonQueueHudSig = "";
function renderLootRolls() {
  const box = $("lootRollPanel");
  if (!box || !state) return;
  const rolls = state.lootRolls || [];
  const sig = JSON.stringify(
    rolls.map((r) => [r.id, r.itemId, r.expiresAt, r.choice]),
  );
  if (sig === lootRollSig) return;
  lootRollSig = sig;
  if (!rolls.length) {
    box.classList.add("hidden");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("hidden");
  box.innerHTML = rolls
    .map((r) => {
      const it = state.catalog.items[r.itemId] || {};
      const left = Math.max(0, Math.ceil((r.expiresAt - Date.now()) / 1000));
      return `<div class="loot-roll"><div><b>${it.icon || "🎁"} ${escapeHtml(it.name || r.itemId)}</b><div class=muted>${escapeHtml(r.source || "Dungeon drop")} • ${left}s</div></div><div class=actions-inline><button class=primary data-cmd=loot_roll data-roll-id="${r.id}" data-choice="need" ${r.choice || r.canNeed === false ? "disabled" : ""}>Need</button><button data-cmd=loot_roll data-roll-id="${r.id}" data-choice="greed" ${r.choice ? "disabled" : ""}>Greed</button><button data-cmd=loot_roll data-roll-id="${r.id}" data-choice="pass" ${r.choice ? "disabled" : ""}>Pass</button></div></div>`;
    })
    .join("");
}
function renderSocialInvite() {
  const _sig = JSON.stringify({
    pi: state?.pendingPartyInvite,
    gi: state?.pendingGuildInvite,
    pv: state?.pendingPvpInvite,
  });
  if (_sig === socialInviteSig) return;
  if (reactWindowsMounted()) {
    if (
      state?.pendingPartyInvite ||
      state?.pendingGuildInvite ||
      state?.pendingPvpInvite
    )
      openModal("socialInviteModal");
    else closeModal("socialInviteModal");
    refreshReactWindows();
    return;
  }
  socialInviteSig = _sig;
  const modal = $("socialInviteModal"),
    box = $("socialInviteContent");
  if (!modal || !box || !state) return;
  const pi = state.pendingPartyInvite,
    gi = state.pendingGuildInvite,
    pv = state.pendingPvpInvite;
  if (!pi && !gi && !pv) {
    modal.classList.add("hidden");
    return;
  }
  let html = "";
  if (pi) {
    html += `<div class="social-invite-card"><div class="social-invite-icon">👥</div><div class="social-invite-main"><h3>${escapeHtml(pi.fromName)} invited you to a party</h3><p class=muted>Join their party and play together.</p><div class=actions-inline><button class=primary data-cmd=party_accept data-party-id="${pi.partyId}">Accept</button><button data-cmd=party_decline data-party-id="${pi.partyId}">Decline</button></div></div></div>`;
  }
  if (gi) {
    html += `<div class="social-invite-card guild"><div class="social-invite-icon">⚔️</div><div class="social-invite-main"><h3>${escapeHtml(gi.fromName)} invited you to a guild</h3><p class=muted>Join ${escapeHtml(gi.guildName || "their guild")}.</p><div class=actions-inline><button class=primary data-cmd=guild_accept data-guild-id="${escapeHtml(gi.guildId)}">Accept</button><button data-cmd=guild_decline>Decline</button></div></div></div>`;
  }
  if (pv) {
    html += `<div class="social-invite-card pvp"><div class="social-invite-icon">⚔️</div><div class="social-invite-main"><h3>${escapeHtml(pv.fromName)} challenged you to PvP</h3><p class=muted>Accept to begin a duel in your current zone.</p><div class=actions-inline><button class=primary data-cmd=pvp_accept data-from-id="${pv.fromId}">Accept Duel</button><button data-cmd=pvp_decline>Decline</button></div></div></div>`;
  }
  box.innerHTML = html;
  openModal("socialInviteModal");
}

function renderPartyHud() {
  const box = $("partyHud");
  if (!box || !state) return;
  const rawParty = state.party;
  const party =
    rawParty ||
    (state.player?.partyId
      ? {
          id: state.player.partyId,
          leader: state.player.partyLeaderId || state.player.id,
          members: [state.player],
          assistId: state.player.id,
          chat: [],
        }
      : null);
  if (!party) {
    box.classList.add("hidden");
    box.innerHTML = "";
    partyHudSig = "";
    return;
  }
  box.classList.remove("hidden");
  const members = party.members || [];
  const sig = JSON.stringify({
    members: members.map((m) => [
      m.id,
      m.name,
      m.hp,
      m.maxHp,
      m.resolve,
      m.maxResolve,
      m.dead,
      m.online,
      m.x,
      m.y,
      m.target?.id,
      m.combat?.threat,
      m.incomingHealPerSecond,
      m.statuses,
    ]),
    statusTick: Math.floor(now() / 250),
  });
  if (sig === partyHudSig) return;
  partyHudSig = sig;
  box.innerHTML = members
    .map((m) => {
      const online = !!m.online;
      const hp = Math.max(
        0,
        Math.min(
          100,
          (100 * Number(m.hp || 0)) / Math.max(1, Number(m.maxHp || 1)),
        ),
      );
      const res = Math.max(
        0,
        Math.min(
          100,
          (100 * Number(m.resolve || 0)) /
            Math.max(1, Number(m.maxResolve || 1)),
        ),
      );
      const target = m.target?.name
        ? `Target: ${escapeHtml(m.target.name)}`
        : "No target";
      const threat = m.combat?.threat
        ? ` • Threat ${Math.round(m.combat.threat)}`
        : "";
      const incoming = m.incomingHealPerSecond
        ? ` • +${Number(m.incomingHealPerSecond).toFixed(1)} HPS`
        : "";
      const statusNow = now();
      const statuses = (m.statuses || [])
        .filter((st) => Number(st.until || 0) > statusNow)
        .slice(0, 6)
        .map((st) => {
          const rem = Math.max(0, (Number(st.until) - statusNow) / 1000);
          const label = st.name || st.id || "Status";
          const effect = st.effect || st.description || "Active status effect";
          const amount =
            Number(st.tickHeal || 0) > 0
              ? ` • Healing ${Number(st.tickHeal).toFixed(1)}/s`
              : "";
          return `<span class=party-status data-tip="${escapeHtml(label + " • " + effect + amount + " • " + rem.toFixed(1) + "s remaining")}" title="${escapeHtml(label)}">${st.icon || "•"}</span>`;
        })
        .join("");
      const vp = worldToScreen(Number(m.x || 0), Number(m.y || 0));
      const c = $("worldCanvas");
      const inViewport =
        !!c &&
        vp.x >= -20 &&
        vp.x <= c.width + 20 &&
        vp.y >= -20 &&
        vp.y <= c.height + 20;
      const range =
        m.id === state.player.id
          ? "YOU"
          : m.zone !== state.player.zone
            ? "OUT OF ZONE"
            : inViewport
              ? "IN VIEW"
              : "OUT OF VIEW";
      return `<div class="party-frame ${m.id === state.player.id ? "self " : ""}${m.dead ? "dead " : ""}${online ? "" : "offline"}" data-player-id="${m.id}"><div class="party-icon">${m.icon || "👤"}</div><div class="party-frame-main"><div class="party-name"><b>${escapeHtml(m.name)}</b> <span class="party-meta">Lv ${m.level} • ${escapeHtml(m.role || "")} • ${online ? "Online" : "Offline"}</span></div><div class="party-bar hp"><i style="width:${hp}%"></i></div><div class="party-bar res"><i style="width:${res}%"></i></div><div class="party-meta party-range">${range}</div><div class="party-meta party-combat-info">${target}${threat}${incoming}</div><div class="party-statuses">${statuses || '<span class="party-status-empty">No active effects</span>'}</div></div></div>`;
    })
    .join("");
}
let socialRenderSig = "";
let socialTab = "friends",
  socialSearchResults: any[] = [],
  socialWhisperTargetId = null;
function renderSocial() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("socialList");
  if (!box || !state) return;
  const social = state.social || {},
    guild = state.guild || null,
    friends = social.friends || [],
    ignored = social.ignored || [],
    nearby = state.nearby || [],
    whispers = social.whispers || [],
    guildChat = social.guildChat || [];
  const req = state.pendingFriendRequests || [];
  const sig = JSON.stringify({
    guild,
    friends,
    ignored,
    req,
    nearby: nearby.map((x) => [x.id, x.name, x.online, x.guildId]),
    whispers,
    guildChat,
    tab: socialTab,
    search: socialSearchResults,
  });
  if (sig === socialRenderSig) return;
  socialRenderSig = sig;
  const tabs = [
    ["friends", "Friends"],
    ["requests", `Requests${req.length ? ` (${req.length})` : ""}`],
    ["guild", "Guild"],
    ["ignore", "Ignored"],
  ];
  let html = `<div class="social-tabs">${tabs.map(([id, label]) => `<button type="button" class="${socialTab === id ? "active" : ""}" data-action="social-tab" data-social-tab="${id}">${label}</button>`).join("")}</div>`;
  html += `<div class="social-search"><input id="socialSearchInput" maxlength="20" placeholder="Find a player by name…"><button class="primary" data-cmd="social_search" data-query-input="socialSearchInput">Search</button></div>`;
  if (socialSearchResults.length) {
    html += `<div class="social-search-results"><div class="social-section-title">Search Results</div>${socialSearchResults
      .map((x) => {
        const status = x.online
          ? "Online"
          : `Offline • ${escapeHtml(x.zone || "Unknown")}`;
        let action = x.friend
          ? "✓ Friends"
          : x.pending
            ? "Request Sent"
            : x.ignored
              ? "Ignored"
              : `<button class="primary" data-cmd="friend_add" data-target-id="${x.id}">Add Friend</button>`;
        return `<div class="social-result"><span class="social-avatar">${x.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(x.name)}</b><div class="muted">Lv ${x.level || "?"} • ${escapeHtml(x.role || "Adventurer")} • ${status}</div></div><div class="actions-inline"><button data-action="player-inspect" data-player-id="${x.id}">Inspect</button><button data-action="player-whisper" data-player-id="${x.id}" ${x.online ? "" : "disabled"}>Whisper</button>${action}</div></div>`;
      })
      .join("")}</div>`;
  }
  if (socialTab === "friends") {
    html += `<div class="social-section-head"><div><h3>Friends</h3><span class="muted">${friends.filter((f) => f.online).length} online • ${friends.length} total</span></div></div>`;
    html += friends.length
      ? friends
          .map(
            (f) =>
              `<div class="social-friend-row ${f.online ? "" : "offline"}"><span class="presence ${f.online ? "online" : "offline"}"></span><span class="social-avatar">${f.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(f.name)}</b><div class="muted">Lv ${f.level || "?"} • ${escapeHtml(f.role || "Adventurer")} • ${f.online ? escapeHtml(f.zone || "Online") : "Offline"}</div></div><div class="actions-inline"><button data-action="player-inspect" data-player-id="${f.id}">Inspect</button><button data-action="player-whisper" data-player-id="${f.id}" ${f.online ? "" : "disabled"}>Whisper</button><button data-cmd="friend_remove" data-target-id="${f.id}">Remove</button></div></div>`,
          )
          .join("")
      : '<div class="social-empty"><b>No friends yet.</b><span>Search for a player above or right-click someone in the world.</span></div>';
    html += `<div class="social-section-head"><div><h3>Nearby Players</h3><span class="muted">Players in your current area</span></div></div>`;
    const candidates = nearby.filter((x) => x.id !== state.player.id);
    html += candidates.length
      ? candidates
          .map((x) => {
            const already = friends.some((f) => f.id === x.id);
            const pending = req.some((r) => r.fromId === x.id);
            const friendAction = already
              ? "✓ Friends"
              : pending
                ? "Request Sent"
                : `<button data-cmd="friend_add" data-target-id="${x.id}">Add Friend</button>`;
            return `<div class="social-friend-row"><span class="presence online"></span><span class="social-avatar">${x.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(x.name)}</b><div class="muted">Lv ${x.level || "?"} • ${escapeHtml(x.role || "Adventurer")}</div></div><div class="actions-inline"><button data-action="player-inspect" data-player-id="${x.id}">Inspect</button><button data-action="player-whisper" data-player-id="${x.id}">Whisper</button>${friendAction}<button data-action="player-invite" data-player-id="${x.id}">Party</button>${guild && guild.leader === state.player.id && !x.guildId ? `<button data-action="player-guild-invite" data-player-id="${x.id}">Guild</button>` : ""}</div></div>`;
          })
          .join("")
      : '<div class="social-empty"><span>No other players nearby.</span></div>';
  } else if (socialTab === "requests") {
    html += `<div class="social-section-head"><div><h3>Friend Requests</h3><span class="muted">Requests expire after 7 days.</span></div></div>`;
    html += req.length
      ? req
          .map(
            (n) =>
              `<div class="social-request"><span class="social-avatar">🤝</span><div class="player-main"><b>${escapeHtml(n.fromName || "Player")}</b><div class="muted">Wants to add you as a friend.</div></div><div class="actions-inline"><button class="primary" data-cmd="friend_accept" data-target-id="${n.fromId}">Accept</button><button data-cmd="friend_decline" data-target-id="${n.fromId}">Decline</button><button data-action="player-inspect" data-player-id="${n.fromId}">Inspect</button></div></div>`,
          )
          .join("")
      : '<div class="social-empty"><b>All clear.</b><span>You have no pending friend requests.</span></div>';
  } else if (socialTab === "guild") {
    if (!guild) {
      html += `<div class="guild-hero"><div class="social-avatar guild-avatar">⚔️</div><div><h3>Create your guild</h3><div class="muted">Build a home for your group. Creation costs <b>1,000 gold</b>.</div></div></div><div class="guild-create-form"><input id="guildNameInput" maxlength="32" placeholder="Guild name…"><button class="primary" data-action="guild-create">Create Guild</button></div>`;
    } else {
      const me = guild.members.find((m) => m.id === state.player.id),
        leader = guild.leader === state.player.id,
        officer = me?.guildRank === "officer";
      html += `<div class="guild-hero"><div class="social-avatar guild-avatar">⚔️</div><div class="player-main"><h3>${escapeHtml(guild.name)}</h3><div class="muted">${guild.onlineCount || 0} online • ${guild.members.length}/50 members • ${leader ? "Guild Leader" : escapeHtml(me?.guildRank || "Member")}</div><p class="guild-motd">${escapeHtml(guild.motd || "No message of the day.")}</p><p class="muted">${escapeHtml(guild.description || "No guild description yet.")}</p></div></div>`;
      if (leader || officer)
        html += `<div class="guild-edit-grid"><label>Guild description<input id="guildDescriptionInput" maxlength="240" value="${escapeHtml(guild.description || "")}"></label><button data-action="guild-save-description">Save</button><label>Message of the day<input id="guildMotdInput" maxlength="180" value="${escapeHtml(guild.motd || "")}"></label><button data-action="guild-save-motd">Save</button></div>`;
      html += `<div class="social-section-head"><div><h3>Roster</h3><span class="muted">${guild.members.length} members</span></div></div>`;
      html += guild.members
        .map((m) => {
          const canManage = leader || officer;
          const targetRank = m.guildRank || "member";
          const controls =
            m.id === state.player.id
              ? ""
              : `<button data-action="player-inspect" data-player-id="${m.id}">Inspect</button><button data-action="player-whisper" data-player-id="${m.id}" ${m.online ? "" : "disabled"}>Whisper</button>${canManage && m.online ? `<button data-cmd="guild_kick" data-target-id="${m.id}">Remove</button>` : ""}${leader && m.id !== guild.leader ? `<button data-cmd="guild_transfer_leader" data-target-id="${m.id}">Make Leader</button><button data-cmd="guild_promote" data-target-id="${m.id}" data-rank="${targetRank === "officer" ? "member" : "officer"}">${targetRank === "officer" ? "Demote" : "Promote"}</button>` : ""}`;
          return `<div class="social-friend-row ${m.online ? "" : "offline"}"><span class="presence ${m.online ? "online" : "offline"}"></span><span class="social-avatar">${m.id === guild.leader ? "👑" : "🛡️"}</span><div class="player-main"><b>${escapeHtml(m.name)}</b><div class="muted">Lv ${m.level || "?"} • ${escapeHtml(targetRank)} • ${m.online ? "Online" : "Offline"}</div></div><div class="actions-inline">${controls}</div></div>`;
        })
        .join("");
      const inviteCandidates = nearby.filter(
        (x) => x.id !== state.player.id && !x.guildId,
      );
      if (leader || officer)
        html += `<div class="social-section-head"><div><h3>Invite Nearby</h3><span class="muted">Invite players in your current area.</span></div></div>${inviteCandidates.map((x) => `<div class="social-friend-row"><span class="social-avatar">${x.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(x.name)}</b><div class="muted">Lv ${x.level || "?"} • ${escapeHtml(x.role || "Adventurer")}</div></div><button data-cmd="guild_invite" data-target-id="${x.id}">Invite</button></div>`).join("") || '<div class="social-empty">No eligible nearby players.</div>'}`;
      html += `<div class="guild-chat"><div class="social-section-head"><div><h3>Guild Chat</h3><span class="muted">Only guild members can see this channel.</span></div></div><div class="guild-chat-log">${guildChat.length ? guildChat.map((m) => `<div class="guild-chat-row"><b>${escapeHtml(m.fromName)}</b><span>${escapeHtml(m.text)}</span><time>${new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>`).join("") : '<div class="social-empty">No guild messages yet.</div>'}</div><div class="social-chat-input"><input id="guildChatInput" maxlength="240" placeholder="Message your guild…"><button class="primary" data-action="guild-chat-send">Send</button></div></div>`;
      html += `<div class="social-danger-row"><button data-cmd="guild_leave">Leave Guild</button>${leader ? '<button class="danger" data-action="guild-disband">Disband Guild</button>' : ""}</div>`;
    }
  } else if (socialTab === "whispers") {
    const target = socialWhisperTargetId
      ? friends.find((f) => f.id === socialWhisperTargetId) ||
        socialSearchResults.find((f) => f.id === socialWhisperTargetId)
      : null;
    html += `<div class="social-section-head"><div><h3>Whispers</h3><span class="muted">Private conversations with other players.</span></div></div>`;
    html += whispers.length
      ? whispers
          .map(
            (m) =>
              `<div class="whisper-row ${m.direction === "out" ? "out" : "in"}"><div><b>${m.direction === "out" ? "You" : escapeHtml(m.from || "Player")}</b> <span class="muted">${escapeHtml(m.t || "")}</span></div><div>${escapeHtml(m.text || "")}</div></div>`,
          )
          .join("")
      : '<div class="social-empty">No whisper history yet.</div>';
    html += `<div class="social-empty">Whispers are sent from the chat channel selector. Click a whisper in chat to reply.</div>`;
  } else {
    html += `<div class="social-section-head"><div><h3>Ignored Players</h3><span class="muted">Ignored players cannot whisper or send social requests.</span></div></div>`;
    html += ignored.length
      ? ignored
          .map(
            (f) =>
              `<div class="social-friend-row"><span class="social-avatar">🚫</span><div class="player-main"><b>${escapeHtml(f.name)}</b><div class="muted">${f.online ? "Online" : "Offline"}</div></div><button data-cmd="ignore_remove" data-target-id="${f.id}">Unignore</button></div>`,
          )
          .join("")
      : '<div class="social-empty">No ignored players.</div>';
  }
  box.innerHTML = html;
}
function renderParty() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("partyList");
  if (!box || !state) return;
  const party =
    state.party ||
    (state.player?.partyId
      ? {
          id: state.player.partyId,
          leader: state.player.partyLeaderId || state.player.id,
          members: [state.player],
        }
      : null);
  const sig = JSON.stringify({
    party,
    nearby: (state.nearby || []).map((x) => [
      x.id,
      x.name,
      x.partyId,
      x.online,
    ]),
  });
  if (sig === partyRenderSig) return;
  partyRenderSig = sig;
  if (!party) {
    const candidates = (state.nearby || []).filter(
      (x) => x.id !== state.player.id && !x.partyId,
    );
    box.innerHTML = `<div class="party-empty-hero"><div class="social-avatar guild-avatar">👥</div><div><h3>Create a party</h3><div class="muted">Build a group of up to five adventurers for quests, dungeons and combat.</div></div></div><div class="actions-inline"><button class="primary" data-cmd="party_create">Create Party</button></div><div class="social-section-head"><div><h3>Invite Nearby</h3><span class="muted">Players in your current area.</span></div></div>${candidates.map((x) => `<div class="social-friend-row"><span class="presence online"></span><span class="social-avatar">${x.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(x.name)}</b><div class="muted">Lv ${x.level || "?"} • ${escapeHtml(x.role || "Adventurer")}</div></div><div class="actions-inline"><button data-action="player-inspect" data-player-id="${x.id}">Inspect</button><button data-action="player-invite" data-player-id="${x.id}">Invite</button></div></div>`).join("") || '<div class="social-empty">No eligible nearby players.</div>'}`;
    return;
  }
  const leader = party.leader === state.player.id;
  const me = party.members.find((m) => m.id === state.player.id);
  let html = `<div class="party-empty-hero"><div class="social-avatar guild-avatar">👥</div><div class="player-main"><h3>${leader ? "Party Leader" : "Party"}</h3><div class="muted">${party.members.filter((m) => m.online).length}/${party.members.length} online • ${party.members.length}/5 members</div></div><div class="party-role-pill">${escapeHtml(me?.partyRole || me?.role || "DPS")}</div></div>`;
  html += party.members
    .map((m) => {
      const online = !!m.online,
        hp = Math.max(0, Math.min(100, (100 * m.hp) / Math.max(1, m.maxHp)));
      const res = Math.max(
        0,
        Math.min(100, (100 * m.resolve) / Math.max(1, m.maxResolve)),
      );
      const actions =
        online && m.id !== state.player.id
          ? `<button data-action="party-target" data-player-id="${m.id}">Target</button><button data-cmd="party_set_assist" data-target-id="${m.id}">Assist</button><button data-cmd="party_assist" data-target-id="${m.id}">Follow</button><button data-cmd="inspect_player" data-target-id="${m.id}">Inspect</button><button data-action="player-whisper" data-player-id="${m.id}">Whisper</button>`
          : "";
      const leaderActions =
        leader && m.id !== state.player.id && online
          ? `<button data-cmd="party_kick" data-target-id="${m.id}">Remove</button><button data-cmd="party_transfer_leader" data-target-id="${m.id}">Make Leader</button>`
          : "";
      return `<div class="party-member-card ${online ? "" : "offline"}"><span class="presence ${online ? "online" : "offline"}"></span><span class="social-avatar">${m.id === party.leader ? "👑" : m.icon || "👤"}</span><div class="player-main"><div><b>${escapeHtml(m.name)}</b> <span class="muted">Lv ${m.level} • ${escapeHtml(m.partyRole || m.role || "DPS")} ${m.id === party.leader ? "• Leader" : ""}</span></div><div class="party-mini-bars"><i class="hp" style="width:${hp}%"></i></div><div class="party-mini-bars"><i class="res" style="width:${res}%"></i></div><div class="muted">${online ? (m.zone === state.player.zone ? `${Number(m.rangeMeters || 0).toFixed(0)}m away` : "Different zone") : "Offline"}${m.target?.name ? ` • Target: ${escapeHtml(m.target.name)}` : ""}</div><div class="actions-inline">${actions}${leaderActions}</div></div></div>`;
    })
    .join("");
  const candidates = (state.nearby || []).filter(
    (x) => x.id !== state.player.id && !x.partyId,
  );
  if (leader)
    html += `<div class="social-section-head"><div><h3>Invite Nearby</h3><span class="muted">Party invitations expire after one minute.</span></div></div>${candidates.map((x) => `<div class="social-friend-row"><span class="social-avatar">${x.icon || "👤"}</span><div class="player-main"><b>${escapeHtml(x.name)}</b><div class="muted">Lv ${x.level || "?"} • ${escapeHtml(x.role || "Adventurer")}</div></div><button data-action="player-invite" data-player-id="${x.id}">Invite</button></div>`).join("") || '<div class="social-empty">No eligible nearby players.</div>'}`;
  html += `<div class="actions-inline party-footer"><button data-cmd="party_assist">Assist Selected</button><button data-cmd="party_leave">Leave Party</button>${leader ? '<button class="danger" data-cmd="party_disband">Disband Party</button>' : ""}</div>`;
  box.innerHTML = html;
}
function renderPvp() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("pvpList");
  if (!box || !state) return;
  const bg = state.battleground,
    ps = state.pvpStats || {},
    arena = ps.arena || {},
    q = state.pvpQueue || {};
  const party = state.party;
  const partySize = Number(party?.members?.length || 0);
  const sig = JSON.stringify({
    pvp: state.pvp,
    bg,
    ps,
    q,
    last: state.lastPvpResult,
    zone: state.player.zone,
    party: party?.members,
    localArenaQueue,
  });
  if (sig === pvpRenderSig && !box.dataset.forceRender) return;
  pvpRenderSig = sig;
  box.dataset.forceRender = "";
  const rank = (r) =>
    Number(r || 0) >= 2400
      ? "Gladiator"
      : Number(r || 0) >= 2100
        ? "Duelist"
        : Number(r || 0) >= 1800
          ? "Rival"
          : Number(r || 0) >= 1600
            ? "Challenger"
            : Number(r || 0) >= 1400
              ? "Combatant"
              : "Unranked";
  const arenaButton = (bracket: number) => {
    const size = bracket === 3 ? 3 : 2;
    const key = bracket === 3 ? "3v3" : "2v2";
    const queued =
      !!(q.arena?.queued && q.arena?.bracket === key) ||
      localArenaQueue?.bracket === key;
    const isLeader = !party || party.leader === state.player.id;
    const leaving = isCommandPending("pvp_arena_leave_queue");
    const soloButton = queued
      ? `<button class="primary" data-cmd="pvp_arena_leave_queue" ${leaving ? 'disabled aria-busy="true"' : ""}>${leaving ? "Cancelling…" : `Leave ${key} Queue`}</button>`
      : `<button class="primary" data-cmd="pvp_arena_queue" data-bracket="${key}" data-solo="true">Solo Queue ${key}</button>`;
    const partyButton = party
      ? party.members?.length === size && isLeader
        ? `<button data-cmd="pvp_arena_queue" data-bracket="${key}">Queue Party ${key}</button>`
        : `<button disabled>Need ${size}-player party</button>`
      : "";
    return `<div class="arena-actions">${soloButton}${partyButton}</div>`;
  };
  let html = `<div class=menu-hero><div class=menu-icon>⚔️</div><div><h3>Player vs Player</h3><p class=muted>Honor, rated Arenas, Battlegrounds and open-world PvP. Solo queue fills the other side; a premade party queues only at the exact bracket size.</p></div></div>`;
  html += `<div class=party-summary><b>Honor & Season</b><div class=muted>Honor ${ps.honor || 0} • Conquest ${ps.conquest || 0} • K/D ${ps.kills || 0}/${ps.deaths || 0}</div><div class=muted>Battlegrounds ${ps.battlegroundWins || 0}W / ${ps.battlegroundLosses || 0}L</div></div>`;
  html += `<div class=party-summary><b>Rated Arena</b><div class=muted>2v2: ${rank(arena["2v2"]?.rating)} • ${arena["2v2"]?.rating || 0} rating • ${arena["2v2"]?.mmr || 1000} MMR • ${arena["2v2"]?.wins || 0}-${arena["2v2"]?.losses || 0}</div><div class=muted>3v3: ${rank(arena["3v3"]?.rating)} • ${arena["3v3"]?.rating || 0} rating • ${arena["3v3"]?.mmr || 1000} MMR • ${arena["3v3"]?.wins || 0}-${arena["3v3"]?.losses || 0}</div>${q.arena?.queued || localArenaQueue?.queued ? `<div class=muted>Queued for rated ${escapeHtml(q.arena?.bracket || localArenaQueue?.bracket || "2v2")} • searching for opponents</div>` : `<div class="arena-queue-help">${party ? `Party: ${partySize} player(s) • 2v2 needs 2, 3v3 needs 3.` : "No party • solo queue is available."}</div><div class=actions-inline>${arenaButton(2)}${arenaButton(3)}</div>`}</div>`;
  if (bg?.state === "active") {
    html += `<div class=party-summary><b>🏳️ Battleground • ${escapeHtml(bg.bracket || "level bracket")}</b><div class=muted>Red ${bg.score.red} - Blue ${bg.score.blue} • Ends in ${Math.max(0, Math.ceil((bg.endsAt - Date.now()) / 1000))}s</div><div class=actions-inline><button class=primary data-cmd=pvp_capture>Capture Objective</button><button data-cmd=pvp_battleground_attack>Attack Enemy</button><button data-cmd=pvp_leave_battleground>Leave Battleground</button></div></div>`;
  } else {
    html += `<div class=party-summary><b>Unrated Battleground</b><p class=muted>Queue for a 10-player battleground. Players are matched inside level brackets, with five per team.</p>${q.queued ? `<div class=muted>Queued • position ${q.position || 1} • ${Math.max(0, Math.floor((Date.now() - Number(q.queuedAt || Date.now())) / 1000))}s</div><div class=actions-inline><button data-cmd=pvp_leave_queue>Leave Queue</button></div>` : `<div class=actions-inline><button class=primary data-cmd=pvp_queue>Queue Battleground</button></div>`}</div>`;
  }
  if (state.lastPvpResult)
    html += `<div class=party-summary><b>Last Match</b><div class=muted>${escapeHtml(state.lastPvpResult.mode || "PvP")} • ${escapeHtml(state.lastPvpResult.result || "complete")} • Rating ${state.lastPvpResult.rating ?? "-"} • Honor ${state.lastPvpResult.honor ?? ps.honor ?? 0} • Conquest ${state.lastPvpResult.conquest ?? ps.conquest ?? 0}</div></div>`;
  html += `<div class=party-summary><b>World PvP</b><div class=muted>${state.pvp?.zoneEnabled ? "PvP is enabled in this zone." : "This is a safe zone."}</div></div>`;
  box.innerHTML = html;
}
function renderProfessions() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("professionList");
  if (!box || !state) return;
  const p = state.professions?.levels || state.player.profession || {};
  const xp = state.professions?.xp || state.player.professionXp || {};
  const known = state.player.professions || [];
  const recipes = state.professions?.recipes || [];
  const specs =
    state.professions?.specializations ||
    state.player.professionSpecializations ||
    {};
  const icons = {
    mining: "⛏️",
    blacksmith: "⚒️",
    skinning: "🪶",
    alchemy: "⚗️",
    cooking: "🍲",
  };
  const names = {
    mining: "Mining",
    blacksmith: "Blacksmithing",
    skinning: "Skinning",
    alchemy: "Alchemy",
    cooking: "Cooking",
  };
  const sig = JSON.stringify({
    p,
    xp,
    known,
    recipes: recipes.length,
    specs,
    inv: state.player.inventory,
  });
  if (sig === professionRenderSig) return;
  professionRenderSig = sig;
  const mats = (r) =>
    r.materials
      .map((m) => {
        const it = state.catalog.items[m.itemId] || {};
        const have =
          state.player.inventory.find((x) => x.itemId === m.itemId)?.qty || 0;
        return `${it.icon || "📦"} ${m.qty} ${escapeHtml(it.name || m.itemId)} (${have}/${m.qty})`;
      })
      .join(" • ");
  const specOptions = {
    mining: {
      prospector: "Prospector  -  extra ore chance",
      veinwalker: "Veinwalker  -  faster respawns",
      deepDelver: "Deep Delver  -  high-tier ore bonus",
    },
    blacksmith: {
      weaponsmith: "Weaponsmith  -  stronger weapon quality",
      armorsmith: "Armorsmith  -  stronger armor quality",
      efficientSmith: "Efficient Smith  -  material savings",
    },
    skinning: {
      hideworker: "Hideworker  -  extra hide yield",
      trophyHunter: "Trophy Hunter  -  rare trophy chance",
      fieldDresser: "Field Dresser  -  more skinning XP",
    },
    alchemy: {
      distiller: "Distiller  -  better quality odds",
      reagentSaver: "Reagent Saver  -  material savings",
      battleBrewer: "Battle Brewer  -  stronger consumables",
    },
    cooking: {
      campfireChef: "Campfire Chef  -  better quality odds",
      heartyMeals: "Hearty Meals  -  stronger meals",
      efficientCook: "Efficient Cook  -  material savings",
    },
  };
  const cards = Object.keys(names)
    .map((id) => {
      const level = p[id] || 1,
        learned = known.includes(id),
        cur = specs[id];
      const options = specOptions[id] || {};
      const spec = learned
        ? level >= 5
          ? Object.entries<any>(options)
              .map(
                ([k, d]) =>
                  `<button data-cmd="set_profession_specialization" data-profession="${id}" data-specialization="${k}" ${cur ? "disabled" : ""}>${cur === k ? "✓ " : ""}${escapeHtml(d)}</button>`,
              )
              .join("")
          : '<span class="muted">Specialization unlocks at level 5.</span>'
        : "";
      const rows = learned
        ? recipes
            .filter((r) => r.profession === id)
            .map((r) => {
              const can =
                level >= Number(r.level || 1) &&
                r.materials.every(
                  (m) =>
                    (state.player.inventory.find((x) => x.itemId === m.itemId)
                      ?.qty || 0) >= m.qty,
                );
              return `<div class="profession-recipe"><div><b>${icons[id]} ${escapeHtml(r.name)}</b><div class="muted">${names[id]} ${r.level} • ${mats(r)}</div></div><button data-cmd="craft_recipe" data-recipe-id="${r.id}" ${can ? "" : "disabled"}>${id === "blacksmith" ? "Forge" : "Craft"}</button></div>`;
            })
            .join("")
        : '<span class="muted">Learn this profession from its trainer to unlock its recipes.</span>';
      return `<section class="profession-card"><div class="profession-card-head"><div><h3>${icons[id]} ${names[id]}</h3><div class="muted">${learned ? `Level ${level} • XP ${xp[id] || 0}/${Math.max(80, level * 100)}` : "Not learned"}</div></div>${learned ? "" : '<span class="profession-locked">Visit a trainer</span>'}</div>${learned ? `<div class="profession-spec"><b>Specialization</b><div class="muted">${cur ? `Current: ${escapeHtml(cur)}` : "Choose one at profession level 5."}</div><div class="actions-inline">${spec}</div></div><div class="profession-recipes">${rows || '<span class="muted">No recipes discovered yet.</span>'}</div>` : ""}</section>`;
    })
    .join("");
  box.innerHTML = `<div class="profession-hero"><div class="menu-icon">🛠️</div><div><h3>Professions</h3><p class="muted">Choose two professions. Gather, craft, specialize and feed the player economy.</p></div><span class="profession-slots">${known.length}/2 slots</span></div>${cards}<div class="profession-note">Crafting quality ranges from Poor → Standard → Fine → Masterwork. Higher profession skill improves difficult recipe quality. Materials are consumed server-side and every craft is persisted.</div>`;
}

function renderArenaQueueHud() {
  const box = $("arenaQueueHud");
  if (!box || !state) return;
  const serverQ = state.pvpQueue?.arena;
  const q = serverQ?.queued
    ? serverQ
    : localArenaQueue?.queued
      ? localArenaQueue
      : null;
  if (state.pvp?.state === "arena" || serverQ?.matched) {
    if (arenaQueueHudSig !== "hidden:match") {
      arenaQueueHudSig = "hidden:match";
      box.classList.add("hidden");
      box.innerHTML = "";
    }
    return;
  }
  if (!q) {
    if (arenaQueueHudSig !== "hidden") {
      arenaQueueHudSig = "hidden";
      box.classList.add("hidden");
      box.innerHTML = "";
    }
    return;
  }
  const elapsed = Math.max(
    0,
    Math.floor((Date.now() - Number(q.queuedAt || Date.now())) / 1000),
  );
  const bracket = q.bracket || localArenaQueue?.bracket || "2v2";
  const position = Number(q.position || 1);
  const sig = `${bracket}:${position}:${elapsed}`;
  box.classList.remove("hidden");
  if (sig === arenaQueueHudSig) return;
  arenaQueueHudSig = sig;
  box.innerHTML = `<div class="aq-icon">⚔️</div><div class="aq-main"><b>Rated Arena Queue</b><span>${escapeHtml(bracket)} • ${position === 1 ? "Searching" : "Position " + position} • ${elapsed}s</span></div><button type="button" data-cmd="pvp_arena_leave_queue">Cancel</button>`;
}
function renderDungeonQueueHud() {
  const box = $("dungeonQueueHud");
  if (!box || !state) return;
  const q = state.dungeonQueue,
    m = state.dungeonMatch;
  if (!q?.queued && !m) {
    if (dungeonQueueHudSig !== "hidden") {
      dungeonQueueHudSig = "hidden";
      box.classList.add("hidden");
      box.innerHTML = "";
    }
    return;
  }
  box.classList.remove("hidden");
  if (m) {
    const left = Math.max(
      0,
      Math.ceil((Number(m.expiresAt || 0) - Date.now()) / 1000),
    );
    const sig = `match:${m.id}:${left}`;
    if (sig === dungeonQueueHudSig) return;
    dungeonQueueHudSig = sig;
    box.innerHTML = `<div class="dq-icon">🏰</div><div class="dq-main"><b>Dungeon Ready</b><span>${escapeHtml(m.dungeonName || "Dungeon")} • ${left}s to confirm</span></div><button type="button" class="primary" data-action="open-dungeon-match">View</button>`;
    return;
  }
  const elapsed = Number(
    q.elapsedSeconds ||
      Math.floor((Date.now() - Number(q.queuedAt || Date.now())) / 1000),
  );
  const sig = `queue:${q.role || "DPS"}:${q.position || 1}:${elapsed}`;
  if (sig === dungeonQueueHudSig) return;
  dungeonQueueHudSig = sig;
  box.innerHTML = `<div class="dq-icon">🏰</div><div class="dq-main"><b>Dungeon Finder</b><span>Queued as ${escapeHtml(q.role || "DPS")} • Position ${q.position || 1} • ${elapsed}s</span></div><button type="button" data-cmd="dungeon_leave_queue">Cancel</button>`;
}
function renderDungeonMatch() {
  if (reactWindowsMounted()) {
    if (state?.dungeonMatch) openModal("dungeonMatchModal");
    else closeModal("dungeonMatchModal");
    refreshReactWindows();
    return;
  }
  const modal = $("dungeonMatchModal"),
    box = $("dungeonMatchContent");
  if (!modal || !box || !state) return;
  const m = state.dungeonMatch;
  if (!m) {
    modal.classList.add("hidden");
    return;
  }
  const left = Math.max(
    0,
    Math.ceil((Number(m.expiresAt || 0) - Date.now()) / 1000),
  );
  const players = (m.playerIds || []).map((id) => {
    const x = (state.party?.members || []).find((y) => y.id === id);
    return x || { id, name: id, role: m.roles?.[id] || "DPS" };
  });
  box.innerHTML = `<div class="dungeon-ready-head"><div class="dungeon-ready-icon">🏰</div><div><h3>${escapeHtml(m.dungeonName || "Dungeon")}</h3><p class="muted">A full party has been found. Confirm within <b>${left}s</b>.</p></div></div><div class="ready-group">${players.map((x) => `<div class="ready-player"><span>${escapeHtml(x.name || "Player")}</span><b>${escapeHtml(m.roles?.[x.id] || x.role || "DPS")}</b><span class="ready-state ${x.id === state.player.id && m.accepted ? "ready" : ""}">${x.id === state.player.id ? (m.accepted ? "READY" : "WAITING") : "GROUP"}</span></div>`).join("")}</div><div class="actions-inline ready-actions">${m.accepted ? '<button class="primary" disabled>✓ Ready</button>' : '<button class="primary" data-cmd="dungeon_accept_match">Accept</button>'}<button data-cmd="dungeon_decline_match">Decline</button></div>`;
  openModal("dungeonMatchModal");
}
function renderDungeon() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("dungeonList");
  if (!box || !state) return;
  const ds = state.catalog?.dungeons || [];
  const party = state.party;
  const p = state.player;
  const q = state.dungeonQueue || {};
  const m = state.dungeonMatch;
  const sig = JSON.stringify({
    dungeon: p.dungeon,
    party,
    ds: ds.map((d) => [
      d.id,
      d.level,
      d.name,
      d.routeChoices?.length,
      d.optionalRooms?.length,
      d.patrols?.length,
      d.events?.length,
    ]),
    q,
    m,
    chests: (state.dungeonRewardChests || []).map((c) => [c.id, c.claimedAt]),
  });
  if (sig === dungeonRenderSig) return;
  dungeonRenderSig = sig;
  const roles = ["TANK", "HEALER", "DPS"];
  const selectedRole = String(q.role || p.partyRole || "DPS").toUpperCase();
  const dungeonOptions = ds.filter(
    (d) =>
      Number(p.level || 1) >= Number(d.level || 1) &&
      Number(p.storyChapter || 0) >= Number(d.requiresStoryChapter || 0),
  );
  const roleButtons = roles
    .map(
      (r) =>
        `<button class="role-pick ${selectedRole === r ? "active" : ""}" data-cmd="dungeon_set_role" data-role="${r}">${r === "TANK" ? "🛡️" : r === "HEALER" ? "💚" : "⚔️"} ${r}</button>`,
    )
    .join("");
  const leader = party?.leader === p.id;
  const partyRoles = party?.members?.reduce(
    (a, m) => {
      const r = String(m.partyRole || m.role || "DPS").toUpperCase();
      a[r] = Number(a[r] || 0) + 1;
      return a;
    },
    { TANK: 0, HEALER: 0, DPS: 0 },
  );
  const dungeonUnlocked = dungeonOptions.length > 0;
  const finder = `<div class="dungeon-finder-card dungeon-finder-v2"><div class="df-main"><div class="eyebrow">MATCHMAKING</div><h3>🧭 Dungeon Finder</h3><p class="muted">Queue solo or as a premade party. Pick your role, find five players, confirm the ready check, then enter the right dungeon for your level.</p><div class="df-controls"><label>Dungeon<select id="dungeonSelect"><option value="random" ${dungeonUnlocked ? "" : "disabled"}>${dungeonUnlocked ? "Random Dungeon" : "Unlocks at level 4"}</option>${dungeonOptions
    .map((d) => {
      const range = d.levelRange || { min: d.level, max: 60 };
      return `<option value="${d.id}">${escapeHtml(d.name)} • Lv ${range.min}-${range.max}</option>`;
    })
    .join(
      "",
    )}</select></label><div><span class="muted">Your role</span><div class="role-picks">${roleButtons}</div></div></div><div class="role-coverage"><span>Queue: ${q.roles?.TANK || 0} Tank</span><span>${q.roles?.HEALER || 0} Healer</span><span>${q.roles?.DPS || 0} DPS</span></div>${party ? `<div class="role-coverage"><span>Party: ${partyRoles.TANK} Tank</span><span>${partyRoles.HEALER} Healer</span><span>${partyRoles.DPS} DPS</span></div>` : ""}</div><div class="actions-inline">${q.queued ? `<button data-cmd="dungeon_leave_queue">Leave Queue</button>` : party && leader ? `<button class="primary" data-cmd="dungeon_queue_party" data-dungeon-id="random" ${dungeonUnlocked ? "" : "disabled"}>Queue Party</button>` : `<button class="primary" data-cmd="dungeon_queue" data-dungeon-id="random" data-role="${selectedRole}" ${dungeonUnlocked ? "" : "disabled"}>${dungeonUnlocked ? "Find Group" : "Unlocks at level 4"}</button>`}</div></div>`;
  const chests = (state.dungeonRewardChests || []).filter((c) => !c.claimedAt);
  const chestCard = chests.length
    ? `<div class="dungeon-finder-card"><div><b>🎁 Unclaimed Dungeon Rewards</b><div class=muted>${chests.map((c) => `${escapeHtml(c.dungeonName || "Completed Dungeon")} • ${Number(c.rewards?.xp || 0)} XP • ${Number(c.rewards?.gold || 0)}g`).join("<br>")}</div></div><div class=actions-inline>${chests.map((c) => `<button class="primary" data-cmd="claim_dungeon_reward" data-chest-id="${escapeHtml(c.id)}">Open Chest</button>`).join("")}</div></div>`
    : "";
  let html = finder + chestCard;
  if (p.dungeon) {
    const d = ds.find((x) => x.id === p.dungeon.id) || {};
    const stage = Number(p.dungeon.stage || 0);
    const room =
      d.rooms?.find((r) => Number(r.id) === Number(p.dungeon.roomId)) ||
      d.rooms?.[Math.min(stage, (d.rooms?.length || 1) - 1)];
    const leader = party?.leader === p.id;
    const availableRoutes = p.dungeon.roomCleared
      ? (d.routeChoices || []).filter(
          (r) =>
            Number(r.afterRoom) === Number(room?.id) &&
            (!p.dungeon.availableRoutes?.length ||
              p.dungeon.availableRoutes.includes(r.id)),
        )
      : [];
    const optional = p.dungeon.roomCleared
      ? (d.optionalRooms || []).filter(
          (r) =>
            Number(r.requiresRoom) === Number(room?.id) &&
            !(p.dungeon.optionalCleared || []).includes(r.id),
        )
      : [];
    const shortcuts = p.dungeon.roomCleared
      ? (d.shortcuts || []).filter(
          (r) =>
            Number(r.afterRoom) === Number(room?.id) &&
            !(p.dungeon.shortcutsUnlocked || []).includes(r.id),
        )
      : [];
    const event = state.dungeon?.activeEvent;
    html += `<div class="dungeon-active-hero"><div><div class="eyebrow">CURRENT DUNGEON</div><h3>${d.icon || "🏰"} ${escapeHtml(d.name)}</h3><p class="muted">Stage ${stage + 1}/${d.stages?.length || 0} • ${escapeHtml(room?.name || "Unknown")}</p></div><div class="actions-inline"><button class="primary" data-action="open-world-map">🗺️ Map</button><button data-cmd="abandon_dungeon">Leave</button></div></div><div class="dungeon-run-grid"><div class="dungeon-room-card"><b>${escapeHtml(room?.name || "Current Area")}</b><div class="muted">${p.dungeon.roomCleared ? "Area cleared  -  choose your next route." : event ? `Event active: ${escapeHtml(event.name)}` : "Objective active"}</div><p>${escapeHtml((d.mechanics && Object.values<any>(d.mechanics)[0]?.[0]) || "Control threat, interrupt dangerous casts, follow telegraphs and use your route choices.")}</p>${event ? `<div class="dungeon-event-callout">⚠️ <b>${escapeHtml(event.name)}</b><span>${escapeHtml(event.message || "A dungeon event is active.")}</span></div>` : ""}${availableRoutes.length ? `<div class="eyebrow">ROUTE CHOICE</div><div class="dungeon-choice-grid">${availableRoutes.map((r) => `<button class="wide" data-cmd="dungeon_choose_route" data-route-id="${r.id}"><b>${escapeHtml(r.label)}</b><small>${escapeHtml(r.description || "")}</small></button>`).join("")}</div>` : ""}${optional.length ? `<div class="eyebrow">OPTIONAL AREA</div>${optional.map((r) => `<button class="wide" data-cmd="dungeon_enter_optional" data-room-id="${r.id}">🔎 ${escapeHtml(r.name)} <small>Bonus ${Number(r.reward?.xp || 0)} XP / ${Number(r.reward?.gold || 0)}g</small></button>`).join("")}` : ""}${shortcuts.length ? `<div class="eyebrow">SHORTCUT</div>${shortcuts.map((r) => `<button class="wide primary" data-cmd="dungeon_unlock_shortcut" data-shortcut-id="${r.id}">↗ ${escapeHtml(r.label)} <small>${escapeHtml(r.description || "")}</small></button>`).join("")}` : ""}</div><div class="dungeon-run-sidebar"><div class="dungeon-summary-box"><b>Party</b>${(party?.members || []).map((x) => `<div class="dungeon-party-line"><span>${escapeHtml(x.name)}</span><span>${escapeHtml(x.role || "DPS")} • Lv ${x.level}</span></div>`).join("") || "<span class=muted>Solo</span>"}</div><div class="dungeon-summary-box"><b>Encounter structure</b><div class=muted>${d.stages?.length || 0} encounters • ${d.rooms?.length || 0} rooms</div><div class=muted>${d.patrols?.length || 0} patrols • ${d.events?.length || 0} event</div><div class=muted>${d.optionalRooms?.length || 0} optional • ${d.shortcuts?.length || 0} shortcut</div></div><div class="dungeon-summary-box"><b>Final rewards</b><div class=muted>+${Number(d.reward?.xp || 0)} XP • +${Number(d.reward?.gold || 0)} gold</div><div>${escapeHtml(state.catalog?.items?.[d.reward?.item]?.name || d.reward?.item || "Gear reward")}</div></div></div></div>`;
  }
  html +=
    '<div class="dungeon-directory">' +
    ds
      .map((d) => {
        const range = d.levelRange || { min: d.level, max: 60 };
        const locked =
          Number(p.level || 1) < Number(range.min || d.level || 1) ||
          Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0);
        const bossArt = BOSS_VISUALS[d.baseDungeonId || d.id];
        const active = p.dungeon?.id === d.id;
        return `<div class="dungeon-card ${locked ? "locked" : ""}"><div class="dungeon-card-head"><b>${d.icon || "🏰"} ${escapeHtml(d.name)}</b><span>Lv ${range.min}-${range.max}</span></div>${bossArt ? `<img class="dungeon-boss-art" src="/assets/ashenfall/bosses/${bossArt}" alt="" loading="lazy">` : ""}<p>${escapeHtml(d.description || "A dangerous party dungeon.")}</p><div class="dungeon-meta"><span>⚔️ ${d.stages?.length || 0} encounters</span><span>🗺️ ${d.rooms?.length || 0} rooms</span><span>🔀 ${(d.routeChoices || []).length} routes</span><span>✨ ${(d.optionalRooms || []).length} optional</span></div><div class="muted dungeon-mechanics">${escapeHtml((d.mechanics && Object.values<any>(d.mechanics)[0]?.slice?.(0, 2)?.join(" • ")) || "Party mechanics, telegraphs and coordinated execution.")}</div>${locked ? `<div class="dungeon-lock">🔒 Unlocks at level ${d.level}${Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0) ? ` • Story Chapter ${d.requiresStoryChapter}` : ""}</div>` : active ? '<div class="dungeon-active-label">IN PROGRESS</div>' : party ? `<button class="wide" data-cmd="start_dungeon" data-dungeon-id="${d.id}" ${party.leader === p.id ? "" : "disabled"}>${party.leader === p.id ? "Enter Dungeon" : "Party leader enters"}</button>` : `<div class="muted">Use Dungeon Finder above for a 5-player group.</div>`}</div>`;
      })
      .join("") +
    "</div>";
  box.innerHTML = html;
}
function renderMail() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("mailList");
  if (!box || !state) return;
  const mail = state.mail || [],
    unread = Number(
      state.mailSummary?.unread ?? mail.filter((m) => !m.read).length,
    );
  (window as any).__ashenfallUnreadMail = unread;
  (window as any).__ashenfallUiSync?.();
  const sig = JSON.stringify(
    mail.map((m) => [
      m.id,
      m.read,
      m.subject,
      m.body,
      m.createdAt,
      m.expiresAt,
      m.payload,
    ]),
  );
  if (sig === mailRenderSig) {
    return;
  }
  mailRenderSig = sig;
  const rows =
    mail
      .map((m) => {
        const gold = Math.max(0, Number(m.payload?.gold || 0));
        const items = Array.isArray(m.payload?.items) ? m.payload.items : [];
        const hasAttachments = gold > 0 || items.length > 0;
        const age = Math.max(
          0,
          Math.floor(
            (Number(m.expiresAt || Date.now()) - Date.now()) / 86400000,
          ),
        );
        const itemText = items
          .map(
            (x) =>
              `${escapeHtml(state.catalog?.items?.[x.itemId]?.name || x.itemId)} ×${Number(x.qty || 1)}`,
          )
          .join(" • ");
        return `<div class="mail-row ${m.read ? "read" : "unread"}"><div class="mail-icon">✉️</div><div class="mail-main"><div class="mail-head"><b>${escapeHtml(m.subject || "Ashenfall Mail")}</b><span class="muted">${age}d left</span></div><div class="muted mail-body">${escapeHtml(m.body || "")}</div>${gold ? `<div class="mail-attachment">🪙 ${gold} gold</div>` : ""}${itemText ? `<div class="mail-attachment">📦 ${itemText}</div>` : ""}</div><div class="mail-actions">${!m.read ? `<button data-cmd="mail_read" data-mail-id="${m.id}">Read</button>` : `<button data-cmd="mail_unread" data-mail-id="${m.id}">Unread</button>`}${hasAttachments ? `<button class="primary" data-cmd="claim_mail" data-mail-id="${m.id}">Claim</button>` : `<button data-cmd="delete_mail" data-mail-id="${m.id}">Delete</button>`}</div></div>`;
      })
      .join("") || '<div class="muted mail-empty">Your mailbox is empty.</div>';
  box.innerHTML = `<div class="mail-toolbar"><div><b>${mail.length}/100</b> messages • <b>${unread}</b> unread</div><div class="actions-inline">${mail.some((m) => m.payload?.items?.length || m.payload?.gold) ? `<button class="primary" data-cmd="claim_all_mail">Claim All Attachments</button>` : ""}</div></div>${rows}`;
}
function openMail() {
  mailRenderSig = "";
  send("mail_state");
  openModal("mailModal");
}
function syncAuctionReactUi() {
  (window as any).__ashenfallAuctionUi = {
    tab: window.__auctionTab || "Market",
    category: window.__auctionCategory || "All",
    query: window.__auctionQuery || "",
    rarity: window.__auctionRarity || "",
    minLevel: window.__auctionMinLevel || "",
    sort: $("auctionSort")?.value || window.__auctionSort || "newest",
    market: auctionMarket,
    stats: auctionStats,
    sellerHistory: auctionSellerHistory,
  };
  window.dispatchEvent(new Event("ashenfall-auction-refresh"));
  window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
}
function openAuctionHouse() {
  const box = $("auctionList");
  if (!box || !state) return;
  syncAuctionReactUi();
  if (box.dataset.reactOwned === "1") {
    openModal("auctionModal");
    return;
  }
  const tab = window.__auctionTab || "Market",
    cat = window.__auctionCategory || "All";
  const market = auctionMarket?.listings ? auctionMarket : null;
  const all = market ? market.listings : state.auctions || [],
    mine = state.myAuctions || [],
    mail = state.mail || [];
  const typeFor = (it) =>
    [
      "weapon",
      "shield",
      "helmet",
      "chest",
      "shoulders",
      "gloves",
      "boots",
      "neck",
      "ring",
      "relic",
    ].includes(it.type)
      ? "Equipment"
      : it.type === "consumable"
        ? "Consumables"
        : it.type === "material"
          ? "Materials"
          : "Misc";
  const filtered = all.filter((a) => {
    const it = state.catalog.items[a.itemId] || {};
    return cat === "All" || typeFor(it) === cat;
  });
  const sig = JSON.stringify({
    tab,
    cat,
    market,
    stats: auctionStats,
    seller: auctionSellerHistory,
    all: filtered.map((a) => [
      a.id,
      a.itemId,
      a.price,
      a.currentBid,
      a.currentBidder,
      a.buyout,
      a.qty,
      a.expiresAt,
    ]),
    mine: mine.map((a) => [a.id, a.itemId, a.currentBid, a.buyout, a.qty]),
    mail: mail.map((m) => [m.id, m.read, m.payload]),
  });
  if (sig === auctionRenderSig) {
    openModal("auctionModal");
    return;
  }
  auctionRenderSig = sig;
  const rows =
    filtered
      .map((a) => {
        const it = state.catalog.items[a.itemId] || {};
        const own = a.seller === state.player.id;
        const bid = Number(a.currentBid || a.startPrice || 0),
          bo = Number(a.buyout || 0);
        const ends = Math.max(
          0,
          Math.floor((Number(a.expiresAt || 0) - Date.now()) / 60000),
        );
        return `<div class="auction-row"><div class="auction-item-icon">${it.icon || "📦"}</div><div class="auction-item-main"><b>${escapeHtml(a.itemName || it.name || a.itemId)}</b><span class="muted">${typeFor(it)} • Qty ${Number(a.qty || 1)} • ${own ? "You" : `Seller: ${escapeHtml(a.sellerName || "Player")}`} • ${ends}m left</span><span class="muted">Bid: 🪙 ${bid}${a.currentBidder ? " • Highest bidder set" : ""}${bo ? ` • Buyout: 🪙 ${bo}` : ""}</span></div>${own ? `<button data-cmd=auction_cancel data-auction-id="${a.id}">Cancel</button>` : `<button data-cmd=auction_bid data-auction-id="${a.id}" data-amount="${bid + 1}">Bid +1</button>${bo ? `<button class=primary data-cmd=auction_buy data-auction-id="${a.id}">Buyout</button>` : ""}<button data-action=auction-history data-item-id="${a.itemId}">Market</button>`}</div>`;
      })
      .join("") ||
    '<div class="muted">There are no listings matching these filters.</div>';
  const mineRows =
    mine
      .map((a) => {
        const it = state.catalog.items[a.itemId] || {};
        return `<div class="auction-row"><div class="auction-item-icon">${it.icon || "📦"}</div><div class="auction-item-main"><b>${escapeHtml(it.name || a.itemId)}</b><span class="muted">${typeFor(it)} • Qty ${Number(a.qty || 1)} • Bid ${Number(a.currentBid || a.startPrice || 0)} • Buyout ${Number(a.buyout || 0)}</span></div><button data-cmd=auction_cancel data-auction-id="${a.id}">Cancel</button></div>`;
      })
      .join("") || '<div class="muted">You have no active listings.</div>';
  const options = (state.player.inventory || [])
    .filter(
      (x) =>
        x.qty > 0 &&
        !Object.values<any>(state.player.equipment || {}).includes(x.itemId),
    )
    .map((x) => {
      const it = state.catalog.items[x.itemId] || {};
      return `<option value="${escapeHtml(x.itemId)}">${escapeHtml(it.name || x.itemId)} • ${x.qty} available</option>`;
    })
    .join("");
  const categories = ["All", "Equipment", "Consumables", "Materials", "Misc"];
  const mailRows =
    mail
      .map((m) => {
        const gold = Number(m.payload?.gold || 0),
          items = m.payload?.items || [];
        return `<div class="auction-row"><div class="auction-item-icon">✉️</div><div class="auction-item-main"><b>${escapeHtml(m.subject || "Ashenfall Mail")}</b><span class="muted">${escapeHtml(m.body || "")}${gold ? ` • 🪙 ${gold} gold` : ""}${items.length ? ` • ${items.map((x) => `${escapeHtml(state.catalog.items[x.itemId]?.name || x.itemId)} ×${x.qty}`).join(", ")}` : ""}</span></div><button class=primary data-cmd=claim_mail data-mail-id="${m.id}">Claim</button></div>`;
      })
      .join("") || '<div class="muted">Your mailbox is empty.</div>';
  const stats = auctionStats?.stats;
  const statsPanel = stats
    ? `<div class="auction-preview"><b>${escapeHtml(state.catalog.items[stats.itemId]?.name || stats.itemId)}</b> • ${stats.days}d • Avg 🪙 ${stats.average ?? " - "} • Low ${stats.lowest ?? " - "} • High ${stats.highest ?? " - "} • Volume ${stats.volume} • Sales ${stats.salesCount}</div>`
    : "";
  const historyRows =
    (auctionSellerHistory || [])
      .map(
        (x) =>
          `<div class="auction-row"><div class="auction-item-icon">📈</div><div class="auction-item-main"><b>${escapeHtml(state.catalog.items[x.itemId]?.name || x.itemId)}</b><span class="muted">Qty ${x.qty} • Gross 🪙 ${x.price} • Tax 🪙 ${x.tax} • Net 🪙 ${x.proceeds}</span></div><span class="muted">${new Date(x.soldAt).toLocaleDateString()}</span></div>`,
      )
      .join("") ||
    '<div class="muted">No completed sales in the selected history window.</div>';
  box.innerHTML = `<div class="auction-shell"><div class="auction-tabs">${["Market", "My Listings", "Sell", "Sales History", "Mailbox"].map((x) => `<button type=button class="${tab === x ? "active" : ""}" data-action=auction-tab data-tab="${x}">${x}</button>`).join("")}</div>${tab === "Market" ? `<div class="auction-subtabs">${categories.map((x) => `<button type=button class="${cat === x ? "active" : ""}" data-action=auction-category data-category="${x}">${x}</button>`).join("")}</div><div class="auction-create"><div><label class=muted>Search</label><input id=auctionSearch type=text placeholder="Item name…" value="${escapeHtml(window.__auctionQuery || "")}"></div><div><label class=muted>Rarity</label><select id=auctionRarity><option value="">Any rarity</option>${["common", "uncommon", "rare", "epic", "legendary"].map((r) => `<option value="${r}" ${window.__auctionRarity === r ? "selected" : ""}>${r}</option>`).join("")}</select></div><div><label class=muted>Level</label><input id=auctionMinLevel type=number min=0 placeholder="Min" value="${window.__auctionMinLevel || ""}"></div><div><label class=muted>Sort</label><select id=auctionSort><option value="newest">Newest</option><option value="price_asc">Lowest price</option><option value="price_desc">Highest price</option><option value="level_asc">Lowest level</option><option value="level_desc">Highest level</option><option value="ending">Ending soon</option></select></div><button class=primary data-action=auction-search>Search</button></div>${statsPanel}<div class=auction-section><div class=auction-section-head><h3>Market</h3><span class=muted>${market?.total ?? filtered.length} listings</span></div>${rows}</div>` : tab === "My Listings" ? `<div class=auction-section><div class=auction-section-head><h3>My Listings</h3><span class=muted>${mine.length} active</span></div>${mineRows}</div>` : tab === "Sales History" ? `<div class=auction-section><div class=auction-section-head><h3>Completed Sales</h3><button data-action=auction-sales-refresh>Refresh</button></div>${historyRows}</div>` : tab === "Mailbox" ? `<div class=auction-section><div class=auction-section-head><h3>Mailbox</h3><span class=muted>${mail.length} messages</span></div>${mailRows}</div>` : `<div class=auction-section><div class=auction-section-head><h3>List an Item</h3></div><div class=auction-create><div><label class=muted>Item</label><select id=auctionItem><option value="">Choose item</option>${options}</select></div><div><label class=muted>Quantity <span class=muted>(split stack)</span></label><input id=auctionQty type=number min=1 value=1></div><div><label class=muted>Starting Bid</label><input id=auctionPrice type=number min=1 value=10></div><div><label class=muted>Buyout</label><input id=auctionBuyout type=number min=1 value=""></div><button class=primary data-action=auction-submit>List Item</button></div><div class="auction-preview">Choose a stack and set the quantity you want to sell. The remainder stays in your bag.</div></div>`}</div>`;
  openModal("auctionModal");
}

function openForge(shopId = null) {
  selectedShopId = shopId || selectedShopId;
  openShop(selectedShopId);
}
const MODAL_IDS = [
  "npcModal",
  "teleportModal",
  "bagModal",
  "questModal",
  "skillModal",
  "characterModal",
  "buildModal",
  "trainerModal",
  "shopModal",
  "mailModal",
  "auctionModal",
  "lootModal",
  "storyModal",
  "partyModal",
  "pvpModal",
  "socialModal",
  "socialInviteModal",
  "professionModal",
  "dungeonModal",
  "worldMapModal",
  "worldIntelModal",
  "settingsModal",
  "tradeModal",
];
const modalController = new ClientModalController({
  getElement: (id) => $(id),
  modalIds: MODAL_IDS,
  getInteractionAnchorId: () => npcInteractionAnchorId,
  clearInteractionAnchor: () => {
    npcInteractionAnchorId = null;
  },
  setWorldMapOpen: (open) => {
    worldMapOpen = open;
  },
});
let modalStack: string[] = [];
function getOpenModals() {
  return modalController.getOpenModals();
}
function syncModalZOrder() {
  modalController.syncZOrder();
}
function bringModalToFront(id: string) {
  modalController.bringToFront(id);
}
function openModal(id: string) {
  return modalController.open(id);
}
function closeModal(id: string) {
  modalController.close(id);
}
function closeTopModal() {
  return modalController.closeTop();
}
function closeAllModals() {
  modalController.closeAll();
  modalStack = [];
}
document.addEventListener(
  "pointerdown",
  (e: any) => {
    const card = e.target?.closest?.(".modal-card");
    if (!card) return;
    const modal = card.closest(".modal");
    if (!modal || modal.classList.contains("hidden")) return;
    modalController.bringToFront(modal.id);
  },
  true,
);
function resetModalPosition(card: HTMLElement | null) {
  modalController.resetPosition(card);
}
function bindMovableWindows() {
  modalController.bindMovableWindows();
}

function bindCriticalControls() {
  const next = $("dialogueNext");
  if (next && !next.dataset.bound) {
    next.dataset.bound = "1";
    next.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (storyAdvancePending) return;
      const step = Number(state?.player?.storyDialogueStep || 0),
        total = Number(state?.catalog?.storyIntro?.steps?.length || 0);
      if (!state?.player?.storyDialogueOpen)
        return toast("The prologue is not currently open.", false);
      if (!ws || ws.readyState !== WebSocket.OPEN)
        return toast("Still connecting to Ashenfall…", false);
      storyAdvancePending = true;
      next.disabled = false;
      next.setAttribute("aria-busy", "true");
      next.style.cursor = "pointer";
      next.textContent = "Continuing…";
      send("advance_story");
    });
  }
}

let worldEventSig = "";
function renderWorldEvent() {
  const e = state?.worldEvent,
    el = $("worldEventHud");
  if (!el) return;
  if (!e) {
    el.classList.add("hidden");
    worldEventSig = "";
    return;
  }
  const region = e.region || {};
  const active = !!e.id;
  const visible =
    active || region.status === "recovering" || region.status === "active";
  if (!visible) {
    el.classList.add("hidden");
    worldEventSig = "";
    return;
  }
  const sig = JSON.stringify([
    e.id,
    e.progress,
    e.goal,
    e.endsAt,
    e.completed,
    region.status,
    region.lastOutcome,
    region.completedCount,
    Math.floor(Date.now() / 1000),
  ]);
  if (sig === worldEventSig) return;
  worldEventSig = sig;
  el.classList.remove("hidden");
  if (!active) {
    const outcome =
      region.lastOutcome === "completed"
        ? "The region has recovered from a successful event."
        : "The region is recovering after the last world event.";
    el.innerHTML = `<div class="world-event-title">⚔ ${escapeHtml(outcome)}</div><div class="world-event-desc">Completed events are remembered by the world. New events will return when the region is ready.</div><div class="world-event-meta"><span>${Number(region.completedCount || 0)} completed</span><span>Recovering</span></div>`;
    return;
  }
  const pct = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (Number(e.progress || 0) / Math.max(1, Number(e.goal || 1))) * 100,
      ),
    ),
  );
  el.innerHTML = `<div class="world-event-title">⚔ ${escapeHtml(e.name)}${e.completed ? "  -  Complete" : ""}</div><div class="world-event-desc">${escapeHtml(e.description || "A world event is active in this region.")}</div><div class="world-event-progress"><i style="width:${pct}%"></i></div><div class="world-event-meta"><span>${e.progress}/${e.goal} • Your contribution: ${e.contribution || 0}</span><span>${e.completed ? "Rewarded" : Math.max(0, Math.ceil((Number(e.endsAt) - now()) / 1000)) + "s"}</span></div>`;
}

function renderBuild() {
  const root = $("buildModal");
  if (!root || !state?.player) return;
  const p = state.player,
    cls = (state.catalog?.classes || {})[p.classId] || {};
  const builds = (state.catalog?.classBuilds || {})[p.classId]?.builds || [];
  const talents = (state.catalog?.talents || {})[p.classId] || [];
  const trees = (state.catalog?.talentTrees?.builds || {})[p.classId] || {};
  const active = String(p.activeBuildId || "");
  const level = Number(p.level || 1);
  const reset = $("buildResetSection"),
    list = $("talentList");
  const buildRenderKey = JSON.stringify({
    classId: p.classId,
    level,
    talentPoints: Number(p.talentPoints || 0),
    activeBuildId: active,
    talents: (p.talents || [])
      .map((x: any) => [x.id, Number(x.rank || 0)])
      .sort(),
    abilityIds: p.abilityIds || [],
    builds: builds.map((b: any) => b.id),
    tree: Object.keys(trees).sort(),
  });
  if (buildRenderKey === buildSig) return;
  buildSig = buildRenderKey;
  const abilityEntries = Object.entries<any>(cls.abilityUnlocks || {})
    .map(([id, lvl]: any) => ({
      id,
      level: Number(lvl || 1),
      ability: state.catalog?.abilities?.[id],
    }))
    .filter((x) => x.ability)
    .sort((a, b) => a.level - b.level);
  const journey = [
    {
      min: 1,
      max: 9,
      title: "FOUNDATION",
      label: "Learn your core kit",
      desc: "Learn the first abilities that teach your class resource, movement, damage, healing or threat.",
      tone: "foundation",
    },
    {
      min: 10,
      max: 19,
      title: "SPECIALIZATION",
      label: "Choose your path",
      desc: "Choose one of three specializations. Your talent tree opens here and your skill journey continues independently.",
      tone: "specialization",
    },
    {
      min: 20,
      max: 39,
      title: "BUILD SHAPING",
      label: "Deepen your specialization",
      desc: "New skills arrive while your talents add meaningful choices to the way those skills work together.",
      tone: "build",
    },
    {
      min: 40,
      max: 60,
      title: "ENDGAME BUILD",
      label: "Finish your toolkit",
      desc: "Complete the final skill unlocks, finish your specialization tree and tune your gear for dungeons, open world and PvP.",
      tone: "endgame",
    },
  ];
  const talentTierMeta: any = {
    1: {
      title: "FOUNDATION",
      rule: "Start here",
      desc: "Your first specialization talent.",
    },
    2: {
      title: "PATH CHOICE",
      rule: "Choose one branch",
      desc: "Pick the side that matches your preferred playstyle.",
    },
    3: {
      title: "CORE IMPROVEMENT",
      rule: "Build on your choice",
      desc: "Strengthen the foundation of the specialization.",
    },
    4: {
      title: "BUILD DEPTH",
      rule: "Develop your path",
      desc: "Add another layer of specialization identity.",
    },
    5: {
      title: "SPECIALIZATION KEYSTONE",
      rule: "Defining choice",
      desc: "This keystone changes an important class interaction.",
    },
    6: {
      title: "SIGNATURE SKILL I",
      rule: "Choose one",
      desc: "Improve a specific late-game class ability.",
    },
    7: {
      title: "BUILD AMPLIFIER",
      rule: "Connect the path",
      desc: "A shared talent that benefits from your chosen signature branch.",
    },
    8: {
      title: "SIGNATURE SKILL II",
      rule: "Choose one",
      desc: "Make another explicit skill-focused choice.",
    },
    9: {
      title: "CAPSTONE",
      rule: "Final talent",
      desc: "The last specialization talent. It empowers a defining ability.",
    },
  };
  const currentStage =
    journey.find((x) => level >= x.min && level <= x.max) ||
    journey[journey.length - 1];
  const nextSkill = abilityEntries.find((x) => x.level > level);
  const currentSkills = abilityEntries
    .filter((x) => x.level <= level)
    .slice(-3);
  if (reset) {
    const buildCards = builds.length
      ? builds
          .map((b: any) => {
            const locked =
              level <
              Number(
                state.catalog?.classBuilds?.[p.classId]?.buildUnlockLevel || 10,
              );
            const selected = b.id === active;
            const blocked =
              locked ||
              (!selected &&
                (p.talents || []).some((x: any) => Number(x.rank || 0) > 0));
            return `<button type="button" class="build-choice ${selected ? "selected" : ""}" data-cmd="choose_build" data-build-id="${escapeHtml(b.id)}" ${blocked ? "disabled" : ""}><b>${escapeHtml(b.name)}</b><span>${escapeHtml(b.description || "")}</span><small>${selected ? "Active" : locked ? "Unlocks at level " + (state.catalog.classBuilds[p.classId].buildUnlockLevel || 10) : "Choose specialization"}</small></button>`;
          })
          .join("")
      : '<div class="muted">No specialization builds are available.</div>';
    reset.innerHTML = `<div class="build-choice-head"><div><div class="eyebrow">TALENTS & SPECIALIZATION</div><h3>${escapeHtml(cls.name || p.classId)} Talents</h3><span class="muted">Choose a specialization at level 10, then spend one talent point at a time as you level.</span></div><button type="button" data-cmd="reset_talents" ${p.encounterId || p.worldCombatMobId ? "disabled" : ""}>Reset Talents</button></div><div class="build-choice-grid">${buildCards}</div>`;
  }
  const activeNodes = active ? trees[active] || [] : [];
  const nodeById = new Map<string, any>(
    activeNodes.map((n: any): [string, any] => [String(n.talentId), n]),
  );
  const visible = activeNodes.length
    ? activeNodes
        .map((n: any) => talents.find((t: any) => t.id === n.talentId))
        .filter(Boolean)
    : talents;
  const grouped = new Map<number, any[]>();
  for (const t of visible) {
    const n = nodeById.get(String(t.id)),
      tier = Number(
        n?.tier || Math.max(1, Math.ceil(Number(t.minLevel || 1) / 5)),
      );
    if (!grouped.has(tier)) grouped.set(tier, []);
    grouped.get(tier)!.push({ t, n });
  }
  const tierEntries = [...grouped.entries()].sort((a, b) => a[0] - b[0]);
  const tierRows = tierEntries
    .map(([tier, entries], idx) => {
      const minLevel = Math.min(
        ...entries.map(({ t }: any) => Number(t.minLevel || 1)),
      );
      const unlocked = level >= minLevel;
      const branchOrder = ["path_a", "core", "path_b", "keystone"];
      const ordered = [...entries].sort(
        (a: any, b: any) =>
          branchOrder.indexOf(a.n?.branch || "core") -
          branchOrder.indexOf(b.n?.branch || "core"),
      );
      const meta = talentTierMeta[tier] || {
        title: "TALENT TIER " + tier,
        rule: "Progression",
        desc: "Continue down the tree.",
      };
      return `<section class="talent-tier ${unlocked ? "unlocked" : "locked"}"><div class="talent-tier-head"><div><span class="talent-tier-label">${meta.title}</span><span class="talent-tier-desc">${meta.desc}</span></div><span class="talent-tier-rule">${unlocked ? meta.rule : "Unlocks at level " + minLevel}</span></div><div class="talent-tier-grid">${ordered
        .map(({ t, n }: any) => {
          const rank = Number(
            (p.talents || []).find((x: any) => x.id === t.id)?.rank || 0,
          );
          const cap = Math.min(
            Number(n?.rankCap || t.maxRank || 1),
            Number(t.maxRank || 99),
          );
          const levelLocked = level < Number(t.minLevel || 1);
          const prereq = n?.requires || [];
          const anyReq = n?.requiresAny || [];
          const missing =
            prereq.some(
              (id: any) =>
                !Number(
                  (p.talents || []).find((x: any) => x.id === id)?.rank || 0,
                ),
            ) ||
            (anyReq.length &&
              !anyReq.some(
                (id: any) =>
                  Number(
                    (p.talents || []).find((x: any) => x.id === id)?.rank || 0,
                  ) > 0,
              ));
          const disabled =
            levelLocked ||
            rank >= cap ||
            missing ||
            (p.talentPoints || 0) < Number(t.cost || 1) ||
            !!p.encounterId ||
            !!p.worldCombatMobId;
          const status =
            rank >= cap
              ? "MAX"
              : levelLocked
                ? "Lv " + t.minLevel
                : missing
                  ? "LOCKED"
                  : `${rank}/${cap}`;
          const branch = (n?.branch || "core")
            .replace("path_a", "CHOICE A")
            .replace("path_b", "CHOICE B")
            .replace("keystone", "KEYSTONE")
            .replace("capstone", "CAPSTONE")
            .toUpperCase();
          const affects =
            t.abilityId && state.catalog?.abilities?.[t.abilityId]
              ? `Affects ${state.catalog.abilities[t.abilityId].name}`
              : "";
          return `<div class="talent-node-wrap"><button type="button" class="talent-node ${rank ? "learned" : ""} ${n?.keystone ? "keystone" : ""} ${n?.capstone ? "capstone" : ""}" data-cmd="learn_talent" data-talent-id="${escapeHtml(t.id)}" data-tip="${escapeHtml(`${t.name}\n${t.description || "No additional description."}\n\nRank: ${status}\nCost: ${t.cost || 1} point${Number(t.cost || 1) === 1 ? "" : "s"}\nUnlocks: level ${t.minLevel || 1}${affects ? "\n" + affects : ""}${missing ? "\nPrerequisites not met." : ""}`)}" ${disabled ? "disabled" : ""}><span class="talent-icon">${t.icon || "✦"}</span><span class="talent-node-main"><b>${escapeHtml(t.name)}</b><small>${escapeHtml(affects || status)}</small></span></button><span class="talent-branch-label">${escapeHtml(branch)}</span></div>`;
        })
        .join(
          "",
        )}</div>${idx < tierEntries.length - 1 ? '<div class="talent-flow" aria-hidden="true"><i></i><span>↓</span></div>' : ""}</section>`;
    })
    .join("");
  const skillChips =
    abilityEntries
      .map(
        (x) =>
          `<span class="talent-skill-chip ${x.level <= level ? "reached" : ""} ${x.level === nextSkill?.level ? "next" : ""}" title="${escapeHtml(x.ability.description || x.ability.name)}"><span>${x.ability.icon || "✦"}</span><b>${escapeHtml(x.ability.name)}</b><small>Lv ${x.level}</small></span>`,
      )
      .join("") ||
    '<span class="muted">Your class skill journey is loading.</span>';
  const nextChip = nextSkill
    ? `<span class="talent-next-skill"><span>${nextSkill.ability.icon || "✦"}</span><div><b>Next skill: ${escapeHtml(nextSkill.ability.name)}</b><small>Unlocks at level ${nextSkill.level}</small></div></span>`
    : '<span class="talent-next-skill complete"><span>✦</span><div><b>Skill journey complete</b><small>You have reached the final class ability.</small></div></span>';
  const journeyRail = journey
    .map(
      (x, i) =>
        `<div class="talent-journey-step ${x === currentStage ? "current" : ""} ${level >= x.min ? "reached" : ""}"><span class="talent-journey-dot">${level >= x.min ? "✓" : i + 1}</span><div><b>${x.title}</b><small>Lv ${x.min}-${x.max}</small></div></div>`,
    )
    .join("");
  list.innerHTML = `<div class="talent-header"><div><b>${active ? `Specialization: ${escapeHtml(builds.find((b: any) => b.id === active)?.name || active)}` : "Core talents"}</b><div class="muted">${p.talentPoints || 0} talent point(s) available • Talents modify your class; skills are learned separately at their listed levels. Hover a talent for the exact effect.</div></div></div><div class="talent-explainer"><div class="talent-explainer-copy"><span class="eyebrow">YOUR BUILD JOURNEY</span><h3>${currentStage.title} — ${currentStage.label}</h3><p>${currentStage.desc}</p><div class="talent-skill-strip"><span class="talent-strip-label">SKILL JOURNEY</span><span class="talent-strip-help">Skills are learned at their listed levels. Talents below modify how your specialization uses them.</span><div class="talent-skill-track">${skillChips}</div></div>${nextChip}</div><div class="talent-journey-rail">${journeyRail}</div></div>${tierRows || '<div class="muted talent-tree-empty">Choose a specialization at level 10 to unlock the full talent tree.</div>'}`;
}
function renderProgressionPanel() {
  const box = $("characterProgressionPanel");
  if (!box || !state?.progression) return;
  const p = state.progression,
    n = p.nextMilestone,
    j = p.journey || {};
  const milestones = p.milestones || [];
  const sig = JSON.stringify([
    p.level,
    p.xp,
    p.xpNext,
    p.statPoints,
    p.talentPoints,
    p.bandId,
    n?.level,
    p.lastLevelUp?.at,
    p.loadouts,
    j.bandId,
    j.nextSkill?.id,
    j.nextSkill?.level,
    j.recommendedZones?.map((x: any) => x.id),
  ]);
  if (sig === progressionSig) return;
  progressionSig = sig;
  const unlocks = n?.unlocks?.length
    ? n.unlocks
        .map(
          (x: any) =>
            `<span class="unlock-chip">${escapeHtml(String(x).replace(/_/g, " "))}</span>`,
        )
        .join("")
    : '<span class="unlock-chip">Level cap reached</span>';
  const zones = (j.recommendedZones || [])
    .filter((x: any) => !x.city)
    .slice(0, 3)
    .map(
      (x: any) =>
        `<span class="journey-chip">${escapeHtml(x.name)} <small>Lv ${x.minLevel}-${x.maxLevel}</small></span>`,
    )
    .join("");
  const dungeons = (j.recommendedDungeons || [])
    .slice(0, 3)
    .map(
      (x: any) =>
        `<span class="journey-chip dungeon">🏰 ${escapeHtml(x.name)} <small>Lv ${x.minLevel}+</small></span>`,
    )
    .join("");
  const nextSkill = j.nextSkill
    ? state.catalog?.abilities?.[j.nextSkill.id]
    : null;
  const level = Number(p.level || 1);
  const journeyStages: any[] = [
    {
      max: 9,
      focus: "Begin the Journey",
      goal: "Learn your class, follow the opening story and master your first abilities.",
      group: "Your first dungeon unlocks at level 4.",
    },
    {
      max: 19,
      focus: "Choose Your Path",
      goal: "Reach level 10, choose a specialization and build your first real rotation.",
      group:
        "Run early dungeons to learn group roles and earn your first upgrades.",
    },
    {
      max: 29,
      focus: "Master Your Build",
      goal: "Expand your skill kit, invest in talents and push into the next regions.",
      group:
        "Use Dungeon Finder to turn new skills and gear into stronger group play.",
    },
    {
      max: 39,
      focus: "Veteran Adventure",
      goal: "Complete regional stories, improve your gear and prepare for harder dungeon tiers.",
      group:
        "Veteran and Heroic dungeons become an important part of your progression.",
    },
    {
      max: 49,
      focus: "Endgame Approach",
      goal: "Finish the world journey, refine your build and prepare for high-level content.",
      group: "Heroic and Mythic dungeons provide the next major gear steps.",
    },
    {
      max: 59,
      focus: "Prepare for Endgame",
      goal: "Finish your level-60 skill journey, optimize gear and master your specialization.",
      group:
        "Mythic dungeons, PvP and high-level world activities now drive progression.",
    },
    {
      max: 60,
      focus: "Endgame",
      goal: "Master your completed build and pursue the highest dungeon, world and PvP rewards.",
      group:
        "Apex dungeons, rated PvP, world events and long-term gear progression.",
    },
  ];
  const stage =
    journeyStages.find((x) => level <= x.max) ||
    journeyStages[journeyStages.length - 1];
  const focus =
    j.focus && j.focus !== "endgame activity" && j.focus !== "Endgame activity"
      ? j.focus
      : stage.focus;
  const goal =
    j.goal && !/endgame activity/i.test(String(j.goal)) ? j.goal : stage.goal;
  const groupFallback = stage.group;
  const exploreFallback =
    level < 10
      ? "Explore Stonehold and Gloamwood."
      : level < 20
        ? "Explore the next story regions and discover your specialization path."
        : level < 30
          ? "Explore new regions and continue the class story."
          : level < 40
            ? "Push into veteran regions and tougher world encounters."
            : level < 50
              ? "Explore high-level wilderness and regional activities."
              : level < 60
                ? "Finish the frontier and prepare for level 60."
                : "Master the endgame world.";
  box.innerHTML = `<div class="progression-overview"><div class="progression-level"><div class="progression-level-badge">${p.level}</div><div class="progression-level-copy"><b>${escapeHtml(p.bandName)}</b><span>Character Level • ${p.maxLevel} cap</span></div></div><div class="progression-xp"><div class="progression-xp-head"><b>Experience</b><span>${p.level >= p.maxLevel ? "MAX LEVEL" : `${Number(p.xp || 0).toLocaleString()} / ${Number(p.xpNext || 0).toLocaleString()} XP`}</span></div><div class="progression-xp-bar"><i style="width:${p.xpPercent || 0}%"></i></div><div class="progression-xp-foot"><span>Total XP ${Number(p.totalXp || 0).toLocaleString()}</span><span>${p.xpPercent || 0}%</span></div></div><div class="progression-next"><b>${n ? `Next milestone: Level ${n.level}` : "Endgame progression"}</b><div class="muted">${n ? "Unlocks and rewards" : "You have reached the level cap."}</div><div class="unlock-list">${unlocks}</div></div></div><div class="journey-card"><div class="journey-head"><div><b>Journey: ${escapeHtml(focus)}</b><span>${escapeHtml(goal)}</span></div>${j.nextSkill ? `<div class="journey-next-skill">Next skill <strong>Lv ${j.nextSkill.level}</strong><small>${escapeHtml(nextSkill?.name || j.nextSkill.id)}</small></div>` : ""}</div><div class="journey-row"><div><label>Explore</label><div class="journey-chips">${zones || `<span class="journey-fallback">${escapeHtml(exploreFallback)}</span>`}</div></div><div><label>Group</label><div class="journey-chips">${dungeons || `<span class="journey-fallback">${escapeHtml(groupFallback)}</span>`}</div></div></div></div><div class="progression-milestones">${milestones.map((m: any) => `<div class="milestone-dot ${m.reached ? "reached" : ""} ${n?.level === m.level ? "next" : ""}"><b>${m.level}</b><span>${m.reached ? "Unlocked" : "Locked"}</span></div>`).join("")}</div>`;
}
function renderLoadouts() {
  const box = $("loadoutList");
  if (!box || !state?.progression) return;
  const loads = state.progression.loadouts || [];
  const sig = JSON.stringify(loads);
  if (sig === loadoutSig) return;
  loadoutSig = sig;
  const slots = ["leveling", "dungeon", "boss", "pvp"];
  const names: any = {
    leveling: "Leveling",
    dungeon: "Dungeon",
    boss: "Boss",
    pvp: "PvP",
  };
  box.innerHTML = slots
    .map((slot) => {
      const l = loads.find((x: any) => x.slot === slot);
      if (!l)
        return `<div class="loadout-card"><h4>${names[slot]}</h4><div class="loadout-empty">No saved loadout.</div><div class="loadout-actions"><button data-action="save-loadout" data-slot="${slot}">Save Current</button></div></div>`;
      return `<div class="loadout-card ${l.active ? "active" : ""}"><h4>${escapeHtml(l.name)}</h4><div class="loadout-meta">${names[slot]} ${l.active ? "• Active" : ""}</div><div class="muted">${escapeHtml(l.buildId || "No specialization")} • Saved ${new Date(l.savedAt || Date.now()).toLocaleDateString()}</div><div class="loadout-actions"><button class="primary" data-action="apply-loadout" data-loadout-id="${l.id}" ${l.active ? "disabled" : ""}>${l.active ? "Active" : "Apply"}</button><button data-action="save-loadout" data-slot="${slot}">Overwrite</button><button data-action="delete-loadout" data-loadout-id="${l.id}" data-slot="${slot}">Delete</button></div></div>`;
    })
    .join("");
}
function maybeShowLevelUp() {
  const lu = state?.progression?.lastLevelUp;
  if (!lu?.at || Number(lu.at) <= lastLevelUpSeen) return;
  if (!state?.player?.id) return;
  lastLevelUpSeen = Number(lu.at);
  localStorage.setItem("ashenfall.lastLevelUpSeen", String(lastLevelUpSeen));
  const levels = (lu.levels || [lu.level]).filter(Boolean);
  const rewards: any[] = [];
  for (const level of levels) {
    const m = (state.progression.milestones || []).find(
      (x: any) => x.level === level,
    );
    if (m) {
      rewards.push({
        title: `Level ${level}`,
        detail: `+${m.statPoints || 0} stat point(s) • +${m.talentPoints || 0} talent point(s)`,
      });
      for (const u of m.unlocks || [])
        rewards.push({
          title: "Unlocked",
          detail: String(u).replace(/_/g, " "),
        });
    }
  }
  if (reactWindowsMounted()) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      levelUp: {
        levels,
        summary: `${state.player.name} has reached a new stage of progression.`,
        rewards,
      },
    };
    refreshReactWindows();
    openModal("levelUpModal");
    return;
  }
  if (!$("levelUpTitle")) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      levelUp: {
        levels,
        summary: `${state.player.name} has reached a new stage of progression.`,
        rewards,
      },
    };
    window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
    openModal("levelUpModal");
    return;
  }
  $("levelUpTitle").textContent =
    levels.length > 1
      ? `Levels ${levels[0]}–${levels.at(-1)}!`
      : `Level ${levels[0]}!`;
  $("levelUpSummary").textContent =
    `${state.player.name} has reached a new stage of progression.`;
  $("levelUpRewards").innerHTML = rewards
    .map(
      (r) =>
        `<div class="reward"><b>${escapeHtml(r.title)}</b><span>${escapeHtml(r.detail)}</span></div>`,
    )
    .join("");
  openModal("levelUpModal");
}
const characterUiController = new CharacterProgressionUiController({
  progression: renderProgressionPanel,
  loadouts: renderLoadouts,
  inventory: renderInventory,
  equipment: renderEquipment,
  characterModal: renderCharacterModalContents,
  build: renderBuild,
  trainer: renderTrainer,
  skills: renderSkills,
  skillBar: updateSkillBar,
});
const questStoryUiController = new QuestStoryUiController({
  quests: renderQuests,
  story: renderStory,
  syncStory: syncStoryModal,
  questJournal: renderQuestJournalContents,
  questDetail: renderQuestDetail,
  npc: refreshNpcModal,
  worldEvent: renderWorldEvent,
  isQuestModalOpen: () => !$("questModal")?.classList.contains("hidden"),
  questTab: () => questJournalTab,
});
const socialEconomyUiController = new SocialEconomyUiController({
  chat: renderChat,
  log: renderLog,
  trade: renderTrade,
  mail: renderMail,
  party: renderParty,
  social: renderSocial,
  professions: renderProfessions,
  auction: openAuctionHouse,
});
const competitiveUiController = new CompetitiveUiController({
  pvp: renderPvp,
  dungeon: renderDungeon,
  partyHud: renderPartyHud,
  combat: renderCombat,
  target: renderTarget,
  death: renderDeath,
});
const worldHudUiController = new WorldHudUiController({
  header: renderHeader,
  players: renderPlayers,
  zones: renderZones,
  questHelper: renderQuestHelper,
});
const worldIntelUiController = new WorldIntelUiController({
  worldMap: drawWorldMap,
  isWorldMapOpen: () => worldMapOpen,
});
const uiRenderCoordinator = new ClientUiRenderCoordinator({
  getState: () => state,
  safeRender: (name, fn) => {
    try {
      fn();
    } catch (err) {
      console.error(`Ashenfall UI section render failed [${name}]`, err);
    }
  },
  isModalOpen: (id) => !$(id)?.classList.contains("hidden"),
  getQuestJournalTab: () => questJournalTab,
  getOpenNpcId: () => openNpcId,
  character: characterUiController,
  questStory: questStoryUiController,
  socialEconomy: socialEconomyUiController,
  competitive: competitiveUiController,
  worldHud: worldHudUiController,
  worldIntel: worldIntelUiController,
  renderMail,
  renderWorldEvent,
  renderTrade,
  renderCombat,
  renderLevelUp: maybeShowLevelUp,
  renderShop: () => openShop(selectedShopId),
  renderNpcModal: refreshNpcModal,
  updateSkillBar,
});
function renderAll() {
  uiRenderCoordinator.renderAll();
}
function refreshWorldMapZoneSelect() {
  syncReactWorldMap();
}
function renderHeader() {
  const p = state?.player;
  if (!p) return;
  const zones = Array.isArray(state?.zones) ? state.zones : [];
  const classes = state?.catalog?.classes;
  const c =
    (classes && classes[p.classId]) ||
    (Array.isArray(classes) ? classes : []).find(
      (x: any) => String(x?.id) === String(p.classId),
    ) ||
    {};
  const resolvedClassId = String(p.classId || "");
  const hasResolvedClass = !!(resolvedClassId && Object.keys(c).length);
  if (hasResolvedClass) {
    p.icon = c.icon || p.icon;
    p.role = c.role || p.role || "Adventurer";
    p.resourceName = c.resource || p.resourceName || "Resource";
    p.resourceIcon = c.resourceIcon || p.resourceIcon || "🔥";
  }
  refreshWorldMapZoneSelect();
  const safeInventory = Array.isArray(p.inventory) ? p.inventory : [],
    achievements = Array.isArray(p.achievements) ? p.achievements : [];
  const zoneInfo = state?.zoneInfo || {};
  if (lastZoneId !== p.zone) {
    lastZoneId = p.zone;
    if (worldMapMode === "zone") worldMapZone = p.zone;
    camera.zoom = minZoomForZone();
    zoomTarget = camera.zoom;
    camera.x = Number(p.x) || 0.5;
    camera.y = Number(p.y) || 0.5;
    worldRenderer.invalidate();
    lastMinimapSignature = "";
  }
  const setText = (id: string, value: any) => {
    const el = $(id);
    if (el) el.textContent = String(value ?? "");
  };
  const hasCharacter = Boolean(p.hasCharacter);
  setText(
    "icon",
    hasResolvedClass
      ? c.icon || p.icon || "🧙"
      : p.icon || (hasCharacter ? "🧙" : "—"),
  );
  setText(
    "name",
    hasCharacter ? p.name || "Unnamed Adventurer" : "Loading character…",
  );
  setText(
    "role",
    hasResolvedClass
      ? c.role || "Adventurer"
      : p.role || (hasCharacter ? "Adventurer" : "Loading class…"),
  );
  setText("level", `Lv ${Number(p.level || 1)}`);
  setText(
    "meta",
    `${Number(p.xp || 0)}/${Number(p.xpNext || 1)} XP • ${zoneInfo.name || p.zone || "Unknown"} • ${p.homeCity ? `Home: ${zones.find((z: any) => z.id === p.homeCity)?.name || p.homeCity}` : ""}`,
  );
  setText(
    "xpText",
    `${Math.max(0, Math.floor(Number(p.xp || 0)))} / ${Math.max(1, Math.floor(Number(p.xpNext || 1)))}`,
  );
  const xpFill = $("xpFill");
  if (xpFill)
    xpFill.style.width = `${Math.max(0, Math.min(100, (Number(p.xp || 0) / Math.max(1, Number(p.xpNext || 1))) * 100))}%`;
  setText("gold", p.gold || 0);
  setText("momentum", p.resolve || 0);
  setText("achievementCount", achievements.length);
  const hpMax = Math.max(
    1,
    Math.round(
      Number.isFinite(Number(p.maxHp))
        ? Number(p.maxHp)
        : Number(c.baseHp || 1),
    ),
  );
  const resMax = Math.max(
    1,
    Math.round(
      Number.isFinite(Number(p.maxResolve))
        ? Number(p.maxResolve)
        : Number(c.baseResolve || 1),
    ),
  );
  const hp = Math.max(
    0,
    Math.min(
      hpMax,
      Math.round(Number.isFinite(Number(p.hp)) ? Number(p.hp) : 0),
    ),
  );
  const res = Math.max(
    0,
    Math.min(
      resMax,
      Math.round(Number.isFinite(Number(p.resolve)) ? Number(p.resolve) : 0),
    ),
  );
  const hpBar = $("hp"),
    resBar = $("res");
  if (hpBar)
    hpBar.style.width = `${Math.max(0, Math.min(100, (hp / hpMax) * 100))}%`;
  if (resBar)
    resBar.style.width = `${Math.max(0, Math.min(100, (res / resMax) * 100))}%`;
  setText("hpText", `${hp}/${hpMax}`);
  setText("resTextName", c.resource || p.resourceName || "Resource");
  setText("resText", `${res}/${resMax}`);
  const run = $("runBtn");
  if (run) run.textContent = p.movementMode === "run" ? "🏃 Run" : "🚶 Walk";
  const br = $("bottomRunBtn");
  if (br) {
    const span = br.querySelector("span");
    if (span) span.textContent = p.movementMode === "run" ? "Run" : "Walk";
    if (br.firstChild)
      br.firstChild.textContent = p.movementMode === "run" ? "🏃" : "🚶";
  }
  setText("zoneTitle", zoneInfo.name || p.zone);
  setText("zoneSubtitle", zoneInfo.city ? "• Safe city" : "• Wilderness");
  setText("worldTitle", zoneInfo.name || p.zone);
  setText(
    "worldHint",
    zoneInfo.city
      ? "Safe City • Walk to the gates to leave"
      : "Wilderness • Shared mobs",
  );
  setText(
    "bagCount",
    safeInventory.reduce((n: any, x: any) => n + Number(x?.qty || 0), 0),
  );
  const mapIcon = $("mapHudIcon");
  if (mapIcon) {
    const mapImg = visualAssets.playerPortraits[p.classId];
    mapIcon.textContent = mapImg ? "" : p.icon || c.icon || "🧙";
    mapIcon.style.backgroundImage = mapImg
      ? `url('/assets/ashenfall/classes/${CLASS_PORTRAITS[p.classId] || ""}')`
      : "none";
    mapIcon.style.backgroundSize = "contain";
    mapIcon.style.backgroundPosition = "center";
    mapIcon.style.backgroundRepeat = "no-repeat";
  }
  setText(
    "mapHudName",
    hasCharacter ? p.name || "Unnamed Adventurer" : "Loading character…",
  );
  setText("mapHudLevel", `Lv ${Number(p.level || 1)}`);
  setText(
    "mapHudRole",
    hasResolvedClass ? c.role || "Adventurer" : p.role || "Adventurer",
  );
  const mh = $("mapHudHp"),
    mr = $("mapHudRes");
  if (mh) mh.style.width = pct(hp, hpMax);
  if (mr) mr.style.width = pct(res, resMax);
  setText(
    "mapHudResource",
    `${c.resource || p.resourceName || "Resource"} ${Math.max(0, res)}/${resMax}`,
  );
}
let zonesRenderSig = "";
function renderZones() {
  const root = $("zones");
  if (!root) return;
  const gates = state.gates || [];
  const sig = JSON.stringify({
    z: state.zoneInfo.id,
    g: gates.map((x) => [x.id, x.to, x.x, x.y]),
  });
  if (sig === zonesRenderSig) return;
  zonesRenderSig = sig;
  root.innerHTML =
    `<div class="zone"><b>${state.zoneInfo.icon} ${state.zoneInfo.name}</b><div class="muted">${state.zoneInfo.city ? "City" : "Wilderness"} • Danger ${state.zoneInfo.danger}</div></div>` +
    (gates.length
      ? gates
          .map(
            (g) =>
              `<div class="zone"><button type="button" data-cmd="use_gate" data-gate-id="${g.id}" title="Walk to ${escapeHtml(g.name)}">🚪 ${escapeHtml(g.name)}</button><div class="muted">Road to ${escapeHtml(state.zones.find((z) => z.id === g.to)?.name || g.to)}</div></div>`,
          )
          .join("")
      : '<div class="muted">No roads nearby.</div>');
}
function hotbarLoadout() {
  return combatHotbar.loadout();
}
function saveHotbar(v) {
  combatHotbar.save(v);
}
function clearHotbarSlot(slot) {
  combatHotbar.clear(slot);
}
function assignHotbar(kind, id, slot) {
  combatHotbar.assign(kind, id, slot);
}
let combatPresentationSig = "";

function renderCombatPresentation() {
  const banner = $("combatPhaseBanner"),
    feedback = $("combatFeedback"),
    vignette = $("combatVignette");
  if (!state) {
    banner?.classList.add("hidden");
    if (feedback) feedback.innerHTML = "";
    if (vignette) vignette.className = "combat-vignette";
    return;
  }
  const e = state.encounter,
    p = state.player || {};
  const phase = Number(e?.phase || 1);
  const phaseKey = e?.id ? `${e.id}:${phase}` : "";
  if (banner) {
    if (e?.enemy?.ai === "boss" && e?.state === "running" && phase > 1) {
      const sig = `${phaseKey}:${e.enemy.id}`;
      if (sig !== combatPresentationSig) {
        banner.textContent = `${e.enemy.name || "Boss"} • Phase ${phase}`;
        banner.classList.remove("hidden");
        banner.classList.remove("pulse");
        void banner.offsetWidth;
        banner.classList.add("pulse");
        setTimeout(() => banner.classList.add("hidden"), 1800);
        combatPresentationSig = sig;
        toast(`⚔ ${e.enemy.name || "Boss"} enters Phase ${phase}.`, true);
      }
    } else if (!e) {
      banner.classList.add("hidden");
      combatPresentationSig = "";
      lastBossCastKey = "";
    }
  }
  if (e?.enemy?.ai === "boss" && e.cast) {
    const castKey = `${e.id}:${e.cast.name}:${e.cast.startedAt}`;
    if (castKey !== lastBossCastKey) {
      lastBossCastKey = castKey;
      const kind = String(e.cast.kind || "single");
      const hint =
        e.cast.interruptible &&
        ["single", "stun", "tank_buster", "interrupt"].includes(kind)
          ? "Interrupt it."
          : ["gaze", "movement", "frontal", "cone"].includes(kind)
            ? "Move or face away."
            : ["ground", "aoe", "spread"].includes(kind)
              ? "Move out of the danger area."
              : ["stack", "soak"].includes(kind)
                ? "Stack or soak."
                : "React to the mechanic.";
      toast(`⚠ ${e.cast.name || "Boss mechanic"} — ${hint}`, false);
    }
  }
  if (feedback) {
    const fx = (p.combatFx || [])
      .filter((x: any) => Number(x.expiresAt || 0) > Date.now())
      .slice(-4);
    feedback.innerHTML = fx
      .map((x: any) => {
        const amount = x.meta?.amount ?? x.amount;
        const label =
          x.kind === "damage"
            ? (x.meta?.crit ? "CRITICAL " : "") + "-" + (amount ?? "")
            : x.kind === "heal"
              ? `+${amount ?? ""}`
              : x.kind === "skill"
                ? state.catalog?.abilities?.[x.abilityId]?.name || "Skill"
                : x.kind === "status"
                  ? x.statusName || "Status"
                  : "";
        return label
          ? `<span class="combat-feedback-item ${x.kind || ""}">${escapeHtml(String(label))}</span>`
          : "";
      })
      .join("");
  }
  if (vignette) {
    const hp = Number(p.hp || 0),
      max = Math.max(1, Number(p.maxHp || 1));
    vignette.classList.toggle("danger", hp / max <= 0.25 && !p.dead);
    vignette.classList.toggle("hidden", hp / max > 0.25 || !!p.dead);
  }
  lastCombatImpactAt = Number(
    (p.combatFx || [])
      .slice()
      .reverse()
      .find((x: any) => Number(x.at || 0) > lastCombatImpactAt)?.at ||
      lastCombatImpactAt,
  );
}
let combatHotbarSig = "";

function renderCombat() {
  const p = state?.player;
  if (!p) return;
  const e = state.encounter;
  $("combatHud").classList.remove("hidden");
  const target = p.targetMobId
    ? state.mobs.find((m) => m.id === p.targetMobId) || state.targetMob || null
    : null;
  const h = hotbarLoadout();
  const hotSig = JSON.stringify(h);
  if (hotSig === combatHotbarSig) {
    updateSkillBar();
    return;
  }
  combatHotbarSig = hotSig;
  const make = (list, offset) =>
    list
      .map((slot, i) => {
        const n = offset + i,
          key = offset ? `⇧${i + 1}` : `${i + 1}`;
        if (!slot)
          return `<button type="button" class="skill empty-slot" data-drag-kind="empty" data-drag-id="${n}" data-hotbar-slot="${n}" title="Drag a skill or item here"><span class="key">${key}</span><span class="icon">＋</span></button>`;
        if (slot.kind === "item") {
          const it = state.catalog.items[slot.id] || {};
          return `<button type="button" class="skill hotbar-item" data-drag-kind="item" data-drag-id="${slot.id}" data-hotbar-slot="${n}" data-hotbar-kind="item" data-item-id="${slot.id}" data-item-tip="${slot.id}" data-tip="${escapeHtml(itemDescription(it))}"><span class="key">${key}</span><span class="icon">${it.icon || "📦"}</span><span class="num"></span><span class="hotbar-qty"></span><i class="shade"></i></button>`;
        }
        const a = state.catalog.abilities[slot.id];
        if (!a)
          return `<button type="button" class="skill empty-slot" data-hotbar-slot="${n}"><span class="key">${key}</span><span class="icon">＋</span></button>`;
        return `<button type="button" class="skill" data-cmd="cast_ability" data-drag-kind="ability" data-drag-id="${a.id}" data-ability-id="${a.id}" data-hotbar-slot="${n}" data-hotbar-kind="ability" data-tip="${escapeHtml(skillTip(a))}"><span class="key">${key}</span><span class="icon">${a.icon}</span><span class="num"></span><i class="shade"></i></button>`;
      })
      .join("");
  $("actions").innerHTML = make(h.slice(0, 9), 0);
  $("actions2").innerHTML = make(h.slice(9, 18), 9);
  updateSkillBar();
}
function updateCastBar(p: any, n: number) {
  const cast = p?.combat?.casting;
  let bar = document.getElementById("castBar") as HTMLElement | null;
  if (cast && Number(cast.endsAt) > 0) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "castBar";
      bar.className = "cast-bar";
      bar.innerHTML =
        '<div class="cast-fill"></div><span class="cast-label"></span>';
      (document.querySelector(".viewport-wrap") || document.body).appendChild(
        bar,
      );
    }
    const total = Math.max(1, Number(cast.endsAt) - Number(cast.startedAt));
    const pct = Math.max(
      0,
      Math.min(100, ((n - Number(cast.startedAt)) / total) * 100),
    );
    bar.style.display = "block";
    (bar.querySelector(".cast-fill") as HTMLElement).style.width = pct + "%";
    (bar.querySelector(".cast-label") as HTMLElement).textContent =
      `${cast.icon || ""} ${cast.name || "Casting"}  ${(Math.max(0, Number(cast.endsAt) - n) / 1000).toFixed(1)}s`;
  } else if (bar) {
    bar.style.display = "none";
  }
}
window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (e.key === "Escape" && state?.player?.combat?.casting)
    send("cancel_cast", {});
});
function updateSkillBar() {
  if (!state) return;
  const p = state.player;
  const n = now();
  updateCastBar(p, n);
  const serverGcd = Math.max(0, Number(p.combat?.gcdReadyAt || 0) - n);
  const predictedGcd = Math.max(
    0,
    Number(combatPrediction.predictedGcdUntil || 0) - n,
  );
  const gcd = Math.max(serverGcd, predictedGcd);
  const serverQueued =
    p.combat?.queuedWorldAbility || p.combat?.queuedAbility || null;
  const queued =
    serverQueued ||
    combatPrediction.predictedInputQueue[0]?.abilityId ||
    [...combatPrediction.predictedAbilities.values()].find((x: any) =>
      ["queued", "buffered"].includes(x.status),
    )?.abilityId ||
    null;
  document
    .querySelectorAll(
      "#actions [data-hotbar-kind],#actions2 [data-hotbar-kind]",
    )
    .forEach((btn: any) => {
      const kind = btn.dataset.hotbarKind;
      const id = btn.dataset.abilityId || btn.dataset.itemId;
      if (kind === "item") {
        const cd = Math.max(0, Number(p.itemCooldowns?.[id] || 0) - n);
        const qty = p.inventory.find((x: any) => x.itemId === id)?.qty || 0;
        const ready = cd <= 0 && qty > 0;
        btn.disabled = !ready;
        btn.classList.toggle("empty-resource", qty <= 0);
        if (btn.querySelector(".hotbar-qty"))
          btn.querySelector(".hotbar-qty").textContent = qty > 0 ? qty : "";
        btn.classList.toggle("ready", ready);
        btn.querySelector(".num").textContent =
          cd > 0 ? Math.ceil(cd / 1000) : "";
        const it = state.catalog.items[id] || {};
        btn.querySelector(".shade").style.height =
          cd > 0
            ? Math.min(100, (cd / ((it.cooldown || 1) * 1000)) * 100) + "%"
            : "0%";
        return;
      }
      const a = state.catalog.abilities[id];
      if (!a) return;
      const rem = Math.max(
        0,
        Math.max(
          Number(p.cooldowns[id] || 0),
          Number(combatPrediction.predictedCooldowns.get(id) || 0),
        ) - n,
      );
      const pending = [...combatPrediction.predictedAbilities.values()].some(
        (x: any) =>
          x.abilityId === id && ["pending", "confirmed"].includes(x.status),
      );
      const queueable = !!a.queueable && gcd > 0 && rem <= 0;
      const resourceReady = Number(p.resolve || 0) >= Number(a.cost || 0);
      const ready = rem <= 0 && resourceReady && (gcd <= 0 || queueable);
      btn.disabled = false;
      btn.setAttribute("aria-disabled", ready ? "false" : "true");
      btn.classList.toggle("ready", ready);
      btn.classList.toggle("queued", queued === id);
      btn.classList.toggle("predicted-pending", pending);
      btn.querySelector(".num").textContent =
        rem > 0 ? Math.ceil(rem / 1000) : "";
      btn.querySelector(".shade").style.height =
        rem > 0
          ? Math.min(100, (rem / ((a.cooldown || 1) * 1000)) * 100) + "%"
          : "0%";
    });
  if ($("gcdText")) {
    $("gcdText").textContent =
      gcd > 0
        ? "GCD " + (gcd / 1000).toFixed(1) + "s" + (queued ? " • Queued" : "")
        : "Ready";
  }
  if ($("gcdBar")) {
    const started = Number(p.combat?.gcdStartedAt || 0);
    const readyAt = Number(p.combat?.gcdReadyAt || 0);
    const base = Math.max(1000, readyAt - started);
    $("gcdBar").style.width =
      gcd > 0 ? Math.min(100, Math.max(0, (1 - gcd / base) * 100)) + "%" : "0%";
  }
  $("queueText").textContent = queued
    ? "Next: " + (state.catalog.abilities[queued]?.name || "Skill")
    : "";
}

function statusMeta(st) {
  const id = String(st?.id || "").toLowerCase();
  const map = {
    rend: ["🩸", "Rend"],
    shadow_rend: ["🌑", "Shadow Rend"],
    bleeding: ["🩸", "Bleeding"],
    burning: ["🔥", "Burning"],
    poisoned: ["☣️", "Poisoned"],
    cursed: ["☠️", "Cursed"],
    chilled: ["❄️", "Chilled"],
    stunned: ["💫", "Stunned"],
    guard: ["🛡️", "Guard"],
    shield_wall: ["🏰", "Shield Wall"],
    barrier: ["🔷", "Barrier"],
    arcane_surge: ["✨", "Arcane Surge"],
    hot_renew: ["💚", "Renew"],
  };
  if (id.startsWith("hot_"))
    return [
      st?.icon || "💚",
      st?.name || "Renew",
      st?.effect || st?.description || "Restores health over time.",
    ];
  const base = map[id] || [
    st?.icon || "✦",
    st?.name || st?.id || "Status",
    st?.effect || st?.description || "Temporary status effect.",
  ];
  return [base[0], base[1], st?.effect || st?.description || base[2]];
}
function renderStatusIcons(statuses = []) {
  const t = now();
  return statuses
    .filter((s) => (s.until || 0) > t)
    .map((s) => {
      const [icon, name, desc] = statusMeta(s);
      const rem = Math.max(0, (s.until - t) / 1000);
      const tick = Number(s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0);
      const taken = Number(s.modifiers?.damageTaken || 0);
      const healing = Number(s.tickHeal || 0);
      const details = [desc];
      if (tick > 0) details.push(`Damage: ${tick} per tick.`);
      if (healing > 0) details.push(`Healing: ${healing.toFixed(1)}/s.`);
      if (taken)
        details.push(`Damage taken: ${taken > 0 ? "+" : ""}${taken}%.`);
      if (Number(s.duration || 0) > 0)
        details.push(`Duration: ${Number(s.duration).toFixed(1)}s.`);
      details.push(`Remaining: ${rem.toFixed(1)}s.`);
      return `<span class="status-icon ${["guard", "shield_wall", "barrier", "arcane_surge"].includes(String(s.id)) ? "buff" : "debuff"}" data-tip="${escapeHtml(`${name}\n${details.join("\n")}`)}" aria-label="${escapeHtml(name)}">${icon}</span>`;
    })
    .join("");
}
let targetRenderSig = "";
let targetSnapshotCache: any = null;
function renderTarget() {
  const p = state?.player;
  if (!p) return;
  const mobId = p.targetMobId || null;
  const liveMob = mobId
    ? state.mobs.find((x) => x.id === mobId) || state.targetMob || null
    : null;
  const pl = p.targetPlayerId
    ? state.nearby.find((x) => x.id === p.targetPlayerId)
    : null;
  if (liveMob) targetSnapshotCache = { ...targetSnapshotCache, ...liveMob };
  else if (!mobId && pl) targetSnapshotCache = null;
  const target =
    liveMob ||
    pl ||
    (mobId && targetSnapshotCache?.id === mobId ? targetSnapshotCache : null);
  const hud = $("targetHud");
  if (!target) {
    hud?.classList.add("hidden");
    targetRenderSig = "";
    return;
  }
  const targetSig = JSON.stringify({
    id: target.id,
    hp: target.hp,
    max: target.maxHp,
    status: (target.statuses || []).map((s) => [s.id, s.until || 0]),
    statusTick: Math.floor(now() / 250),
  });
  if (targetSig === targetRenderSig) return;
  targetRenderSig = targetSig;
  hud?.classList.remove("hidden");
  const hp = Number(target.hp ?? 0),
    max = Number(target.maxHp || target.maxHP || 1);
  const encounterEnemyId = state.encounter?.enemy?.id;
  const bossKey =
    target.id && BOSS_BY_ENEMY[target.id]
      ? target.id
      : encounterEnemyId && state.encounter?.enemy?.name === target.name
        ? encounterEnemyId
        : null;
  const bossImg = bossKey
    ? visualAssets.bosses[BOSS_BY_ENEMY[bossKey].replace(".png", "")]
    : null;
  const targetIcon = $("targetHudIcon");
  if (targetIcon) {
    targetIcon.textContent = bossImg ? "" : target.icon || "👹";
    targetIcon.style.backgroundImage = bossImg
      ? `url('/assets/ashenfall/bosses/${BOSS_BY_ENEMY[bossKey]}')`
      : "none";
    targetIcon.style.backgroundSize = "contain";
    targetIcon.style.backgroundPosition = "center";
    targetIcon.style.backgroundRepeat = "no-repeat";
  }
  $("targetHudName").textContent = target.name || "Target";
  $("targetHudLevel").textContent = `Lv ${target.level || 1}`;
  $("targetHudRole").textContent = target.role || target.temper || "";
  $("targetHudHp").style.width = pct(hp, max);
  $("targetHudHpText").textContent = `${Math.max(0, hp)}/${max}`;
  $("targetHudStatuses").innerHTML = renderStatusIcons(target.statuses || []);
}

function itemDescription(it) {
  if (!it) return "Unknown item.";
  const lines = [String(it.name || "Unknown item.")];
  if (it.level) lines.push(`Required level: ${it.level}`);
  if (it.itemLevel || it.level)
    lines.push(`Item level: ${it.itemLevel || it.level}`);
  if (it.type) lines.push(`Type: ${String(it.type).replace(/_/g, " ")}`);
  if (it.power) lines.push(`Weapon Power: +${it.power}`);
  if (it.armor) lines.push(`Armor: +${it.armor}`);
  for (const a of it.affixes || []) {
    if (a?.name) lines.push(a.name);
  }
  const description = String(it.description || "")
    .replace(/^Use this consumable for its listed effect\.\s*/i, "")
    .trim();
  if (description) lines.push(`Effect: ${description}`);
  if (it.setName) lines.push(`Set: ${it.setName}`);
  if (it.setBonusSummary) lines.push(`Set bonuses: ${it.setBonusSummary}`);
  if (Array.isArray(it.buildIds) && it.buildIds.length)
    lines.push(`Designed for: ${it.buildIds.join(", ")}`);
  if (it.uniqueGroup) lines.push(`Unique group: ${it.uniqueGroup}`);
  if (it.cooldown) lines.push(`Cooldown: ${it.cooldown}s`);
  return lines.join("\n");
}
function itemTooltipHtml(it) {
  if (!it) return "<b>Unknown item</b>";
  const p = state?.player || {};
  const req = Number(it.level || 0),
    over = req > Number(p.level || 0);
  const rarity = String(it.rarity || "common").toLowerCase();
  const classAllowed =
    !Array.isArray(it.class) ||
    !it.class.length ||
    it.class.includes(p.classId);
  const aff = (it.affixes || []).map((a) => a?.name).filter(Boolean);
  const statLines = [];
  if (it.power)
    statLines.push(
      `<div class="tt-stat">Weapon Power <b>+${it.power}</b></div>`,
    );
  if (it.armor)
    statLines.push(`<div class="tt-stat">Armor <b>+${it.armor}</b></div>`);
  for (const a of aff)
    statLines.push(`<div class="tt-stat">${escapeHtml(a)}</div>`);
  const desc = String(it.description || "")
    .replace(/^Use this consumable for its listed effect\.\s*/i, "")
    .trim();
  const gearSummary = state?.progression?.gearInventory?.find(
    (x: any) => String(x.id) === String(it.id),
  );
  const upgradeMax = Number(it.upgrade?.maxLevel || it.level || 0),
    currentItemLevel = Number(it.itemLevel || it.level || 0),
    upgradeLevel = Number(it.upgradeLevel || 0);
  const upgradeInfo =
    it.upgrade && upgradeMax > currentItemLevel
      ? `<div class="tt-subtle">Upgrade ${currentItemLevel} → ${currentItemLevel + 1} • Cap ${upgradeMax}</div>`
      : "";

  const equippedId = it.type
    ? Object.entries<any>(p.equipment || {}).find(
        ([slot, id]) => slot === it.type,
      )?.[1]
    : null;
  const equipped = equippedId
    ? state?.catalog?.items?.[String(equippedId)]
    : null;
  let compare = "";
  if (equipped && String(equippedId) !== String(it.id)) {
    const statMap: any = {};
    const add = (x: any, sign: number) => {
      for (const a of x?.affixes || []) {
        if (a?.stat)
          statMap[a.stat] =
            (statMap[a.stat] || 0) + sign * Number(a.value || 0);
      }
    };
    add(it, 1);
    add(equipped, -1);
    if (it.power || equipped.power)
      statMap.weaponPower = Number(it.power || 0) - Number(equipped.power || 0);
    if (it.armor || equipped.armor)
      statMap.armor = Number(it.armor || 0) - Number(equipped.armor || 0);
    const rows = Object.entries<any>(statMap)
      .filter(([, v]: any) => Number(v) !== 0)
      .map(
        ([k, v]: any) =>
          `<div class="tt-compare-row ${Number(v) > 0 ? "better" : "worse"}">${Number(v) > 0 ? "▲" : "▼"} ${escapeHtml(k.replace(/([A-Z])/g, " $1"))}: ${Number(v) > 0 ? "+" : ""}${v}</div>`,
      )
      .join("");
    if (rows)
      compare = `<div class="tt-section"><div class="tt-section-title">Compared to Equipped</div>${rows}</div>`;
  }
  return `<div class="item-tooltip ${over ? "over-level" : ""}"><div class="tt-name rarity-${rarity}">${escapeHtml(it.name || "Unknown item")}</div>${req ? `<div class="tt-required ${over ? "over" : ""}">Required Level ${req}</div>` : ""}${it.class?.length ? `<div class="tt-required ${classAllowed ? "" : "over"}">Class: ${escapeHtml((it.class || []).join(", "))}${classAllowed ? "" : " • Cannot equip as " + escapeHtml(p.classId)}</div>` : ""}${it.itemLevel || it.level ? `<div class="tt-subtle">Item Level ${it.itemLevel || it.level}</div>` : ""}${gearSummary ? `<div class="tt-subtle">Gear Score ${Number(gearSummary.gearScore || 0).toFixed(1)}</div>` : ""}${upgradeInfo}${it.type ? `<div class="tt-subtle">${escapeHtml(String(it.type).replace(/_/g, " "))}</div>` : ""}${statLines.length ? `<div class="tt-section"><div class="tt-section-title">Stats</div>${statLines.join("")}</div>` : ""}${compare}${desc ? `<div class="tt-section"><div class="tt-section-title">Effect</div><div class="tt-effect">${escapeHtml(desc)}</div></div>` : ""}${it.cooldown ? `<div class="tt-subtle">Cooldown ${it.cooldown}s</div>` : ""}</div>`;
}

function inventoryRow(x, bag = false) {
  const it = state.catalog.items[x.itemId] || {},
    p = state.player,
    eqSlot = Object.entries<any>(p.equipment || {}).find(
      ([slot, id]) => id === x.itemId,
    )?.[0],
    eq = !!eqSlot,
    canEq = [
      "weapon",
      "shield",
      "helmet",
      "chest",
      "shoulders",
      "gloves",
      "boots",
      "neck",
      "ring",
      "relic",
    ].includes(it.type),
    aff = (it.affixes || []).map((a) => a.name).join(" • "),
    cd = Math.max(0, (p.itemCooldowns?.[x.itemId] || 0) - now()),
    tipText = itemDescription(it);
  const rarityClass =
    "rarity-" +
    String(it.rarity || "common")
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-");
  if (bag)
    return `<div data-drag-kind="item" data-drag-id="${x.itemId}" data-bag-item="${x.itemId}" class="bag-row bag-slot ${rarityClass}" data-item-tip="${escapeHtml(x.itemId)}" data-tip="${escapeHtml(tipText)}" data-item-type="${it.type}" data-equipped="${eq ? "1" : "0"}"><span class="bag-icon">${it.icon || "📦"}</span><span class="bag-count">${x.qty > 1 ? x.qty : ""}</span>${cd > 0 ? `<span class="bag-cooldown">${Math.ceil(cd / 1000)}</span>` : ""}</div>`;
  return `<div data-drag-kind="item" data-drag-id="${x.itemId}" class="item" data-item-tip="${escapeHtml(x.itemId)}" data-tip="${escapeHtml(tipText)}"><span class="bag-icon">${it.icon || "📦"}</span><div class="bag-main"><b>${escapeHtml(it.name || x.itemId)}</b><div class="muted">×${x.qty} • ${it.rarity || "common"}${it.generated ? " • randomized" : ""}</div></div><span class="spacer"></span>${canEq ? `<button type="button" data-cmd="equip" data-item-id="${x.itemId}" ${it.class?.length && !it.class.includes(p.classId) ? 'disabled title="Not usable by your class"' : ""}>${it.class?.length && !it.class.includes(p.classId) ? "Class Restricted" : "Equip"}</button>` : ""}${it.generated ? `<button type="button" data-cmd="reroll_gear" data-item-id="${x.itemId}" ${!state.player.inventory.some((i) => i.itemId === "veilglass_prism" && i.qty > 0) ? "disabled" : ""}>Roll</button>` : ""}${it.upgrade && Number(it.level || 1) < Number(it.upgrade.maxLevel || it.level || 1) ? `<button type="button" data-cmd="upgrade_gear" data-item-id="${x.itemId}">Upgrade</button>` : ""}${it.type === "consumable" && it.effect !== "reroll_gear" ? `<button type="button" data-cmd="use_item" data-item-id="${x.itemId}" ${cd > 0 ? "disabled" : ""}>Use</button>` : ""}</div>`;
}
function updateInventoryCooldownText() {
  const box = $("inventory");
  const p = state?.player;
  if (!box || !p) return;
  (box.querySelectorAll("[data-drag-id]") as NodeListOf<HTMLElement>).forEach(
    (row) => {
      const id = row.dataset.dragId;
      if (!id) return;
      const left = Math.max(0, Number(p.itemCooldowns?.[id] || 0) - now());
      let node = row.querySelector(".inventory-cooldown") as HTMLElement | null;
      if (left > 0) {
        if (!node) {
          node = document.createElement("span");
          node.className = "inventory-cooldown";
          row.appendChild(node);
        }
        node.textContent = `${Math.ceil(left / 1000)}`;
        node.classList.remove("hidden");
      } else if (node) {
        node.remove();
      }
    },
  );
}
function renderInventory() {
  const box = $("inventory");
  if (!box || !state?.player) return;
  const p = state.player;
  const sig = JSON.stringify({ inv: p.inventory, e: p.equipment });
  if (sig !== inventorySig) {
    inventorySig = sig;
    box.innerHTML =
      p.inventory
        .filter((x) => x.qty > 0)
        .map((x) => inventoryRow(x, false))
        .join("") || "<span class=muted>Empty</span>";
  }
  updateInventoryCooldownText();
}
function renderBagContents() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const p = state.player;
  const sig = JSON.stringify({
    inv: p.inventory,
    eq: p.equipment,
    cd: p.itemCooldowns,
  });
  if (sig === bagSig) return;
  bagSig = sig;
  const items = p.inventory.filter((x) => x.qty > 0);
  const list = $("bagList");
  if (!list) return;
  const slots = Array.from({ length: 30 }, (_, i) => items[i] || null);
  list.style.gridTemplateColumns = "repeat(6,64px)";
  list.innerHTML = slots
    .map((x) =>
      x
        ? inventoryRow(x, true)
        : '<div class="bag-row bag-slot empty-bag-slot" data-drag-kind="empty" aria-hidden="true"></div>',
    )
    .join("");
}
function renderEquipment() {
  if (!$("equipment")) return;
  const sig = JSON.stringify(state.player.equipment);
  if (sig === equipmentSig) return;
  equipmentSig = sig;
  const p = state.player,
    items = state.catalog.items,
    slots = [
      ["weapon", "⚔️"],
      ["shield", "🛡️"],
      ["helmet", "⛑️"],
      ["chest", "🧥"],
      ["shoulders", "🪖"],
      ["gloves", "🧤"],
      ["boots", "🥾"],
      ["neck", "📿"],
      ["ring", "💍"],
      ["ring2", "💍"],
      ["relic", "🔮"],
      ["relic2", "🔮"],
    ];
  $("equipment").innerHTML = slots
    .map(([slot, icon]) => {
      const id = p.equipment[slot],
        it = id ? items[id] : null;
      return `<div class=item><span>${icon}</span><div><b>${escapeHtml(it?.name || "Empty")}</b><div class=muted>${escapeHtml(slot)}</div></div><span class=spacer></span>${id ? `<button type="button" data-cmd="unequip" data-slot="${slot}" title="Unequip ${escapeHtml(it.name)}">Unequip</button>` : ""}</div>`;
    })
    .join("");
}
let playersRenderSig = "";
function renderPlayers() {
  const playersEl = $("players");
  if (!playersEl || !state?.player) return;
  const sig = JSON.stringify(
    (state.nearby || []).map((x) => [x.id, x.name, x.level, x.partyId]),
  );
  if (sig === playersRenderSig) return;
  playersRenderSig = sig;
  playersEl.innerHTML =
    (state.nearby || [])
      .map(
        (x) =>
          `<div class=player-card title="${escapeHtml(x.role || "Player")}"><span>${x.icon}</span><div class=player-main><b>${escapeHtml(x.name)}</b><div class=muted>Lv ${x.level} • ${escapeHtml(x.role || "")}</div><div class=actions-inline><button type=button data-action=player-target data-player-id="${x.id}">Target</button><button type=button data-action=player-whisper data-player-id="${x.id}">Whisper</button><button type=button data-cmd=friend_add data-target-id="${x.id}">Friend</button><button type=button data-action=player-invite data-player-id="${x.id}">Party</button>${state.guild?.leader === state.player.id && !x.guildId ? `<button type=button data-action=player-guild-invite data-player-id="${x.id}">Guild</button>` : ""}</div></div></div>`,
      )
      .join("") || "<span class=muted>No other players nearby.</span>";
}

function openQuestJournal(offeredId = null) {
  if (offeredId) selectedQuest = offeredId;
  questSig = "";
  (window as any).__ashenfallReactUi = {
    questJournalTab,
    selectedQuest,
    selectedStoryArcId,
    selectedSkill,
  };
  openModal("questModal");
  window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
}
function renderBagModal() {
  bagSig = "";
  openModal("bagModal");
  try {
    renderBagContents();
  } catch (err) {
    console.error("Bag render failed", err);
    $("bagList").textContent = "Bag unavailable.";
  }
}

let questsRenderSig = "";
function renderQuests() {
  const dynamic = (state.worldIntegration?.contracts || [])
    .filter((c: any) => c.status === "active")
    .map((c: any) => [
      c.id,
      {
        dynamic: true,
        accepted: true,
        complete: false,
        progress: Number(c.objectiveIndex || 0),
        amount: Number((c.objectives || []).length || 3),
        title: c.title,
        description: c.description,
      },
    ]);
  const qlist = [
    ...dynamic,
    ...Object.entries<any>(state.player.quests || {}).filter(
      ([id, q]) =>
        q.visible !== false &&
        !q.claimed &&
        (q.accepted || q.complete || q.visible),
    ),
  ];
  const sig = JSON.stringify(qlist);
  if (sig === questsRenderSig) return;
  questsRenderSig = sig;
  $("quests").innerHTML =
    qlist
      .slice(0, 4)
      .map(([id, q]) => {
        const d = state.catalog.quests.find((x) => x.id === id) || {};
        const dynamic = String(id).startsWith("wc:");
        const name = dynamic ? q.title || "Dynamic World Quest" : d.name;
        const description = dynamic
          ? q.description || "Respond to a changing world situation."
          : d.description ||
            d.story ||
            "Follow the objective marker on the map.";
        const status = q.complete
          ? "✅ Completed"
          : q.accepted
            ? "⏳ Active"
            : "❗ Available";
        return `<div class=zone><b>${escapeHtml(name || id)}</b><div class=muted>${q.progress || 0}/${dynamic ? q.amount || 3 : d.amount || 1} ${status}</div><div class=muted>${escapeHtml(description)}</div><button type="button" data-action=select-quest data-quest-id="${id}">Inspect</button></div>`;
      })
      .join("") || "<div class=muted>No current objectives.</div>";
}
function renderQuestDetail() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const box = $("questDetail");
  if (!box || !state) return;
  const id = selectedQuest;
  if (!id) {
    box.innerHTML = '<div class="muted">Select a quest.</div>';
    return;
  }
  if (String(id).startsWith("wc:")) {
    const c = (state.worldIntegration?.contracts || []).find(
      (x: any) => String(x.id) === String(id),
    );
    if (!c) {
      box.innerHTML =
        '<div class="muted">This world quest is no longer active.</div>';
      return;
    }
    const steps = c.objectives || [];
    const idx = Math.min(Number(c.objectiveIndex || 0), steps.length);
    const pct = steps.length ? Math.round((idx / steps.length) * 100) : 0;
    box.innerHTML = `<div class="quest-detail-head"><div class="eyebrow">WORLD QUEST • ${escapeHtml(String(c.kind || "world").replace(/_/g, " "))}</div><h2>${escapeHtml(c.title || "Dynamic World Quest")}</h2><div class="muted quest-status-line">${idx >= steps.length ? "✓ Completed" : "Active"} • ${idx}/${steps.length} objectives</div></div><div class="quest-lore"><b>Situation</b><p>${escapeHtml(c.description || "The world has changed and is asking for a response.")}</p></div><div class="quest-lore"><b>Objectives</b>${steps.map((x: any, i: number) => `<div class="story-codex-quest"><div class="story-quest-name"><b>${i < idx ? "✓" : i === idx ? "→" : "○"} ${escapeHtml(x)}</b></div><div class="muted">${i < idx ? "Completed" : i === idx ? "Current objective" : "Upcoming"}</div></div>`).join("")}</div><div class="quest-lore"><b>Location</b><p>📍 ${escapeHtml(state.zoneInfo?.name || c.regionId || "Unknown region")}</p></div>${idx < steps.length ? `<div class="actions-inline"><button class="primary" data-action="world-contract-action" data-contract-id="${escapeHtml(c.id)}">${escapeHtml(c.label || "Continue World Quest")}</button></div>` : `<div class="reward"><b>Reward</b><div>✨ XP +${Math.max(50, Number(state.player.level || 1) * 25)} • 🪙 Gold +${Math.max(10, Number(state.player.level || 1) * 3)}</div></div>`}`;
    return;
  }
  const d = state.catalog.quests.find((x) => x.id === id);
  const q = state.player.quests?.[id] || {};
  if (!d) {
    box.innerHTML = '<div class="muted">Quest data unavailable.</div>';
    return;
  }
  const status = q.claimed
    ? "Completed"
    : q.complete
      ? "Ready to turn in"
      : q.accepted
        ? "Active"
        : "Not yet discovered";
  const targetZone = d.target
    ? state.zones?.find((z) => z.id === d.target)?.name ||
      String(d.target).replace(/_/g, " ")
    : state.zoneInfo?.name;
  const objective = d.description || d.story || "Follow the quest objective.";
  const reward = d.reward || {};
  const rewardText =
    [
      reward.xp ? `✨ ${reward.xp} XP` : "",
      reward.gold ? `🪙 ${reward.gold} gold` : "",
      reward.item
        ? `📦 ${escapeHtml(state.catalog.items?.[reward.item]?.name || reward.item)}`
        : "",
    ]
      .filter(Boolean)
      .join(" • ") || "See the quest reward on turn-in.";
  box.innerHTML = `<div class="quest-detail-head"><div class="eyebrow">${escapeHtml(d.chapter || "Quest")}</div><h2>${escapeHtml(d.name || id)}</h2><div class="muted quest-status-line">${status} • ${Number(q.progress || 0)}/${Number(d.amount || 1)}</div></div><div class="quest-lore"><b>Objective</b><p>${escapeHtml(objective)}</p></div><div class="quest-lore"><b>Location</b><p>📍 ${escapeHtml(targetZone || "Unknown")}</p></div>${d.story ? `<div class="quest-lore"><b>Story</b><p>${escapeHtml(d.story)}</p></div>` : ""}<div class="quest-lore"><b>Reward</b><p>${rewardText}</p></div><div class="actions-inline"><button type="button" class="${String(state.player.activeQuestId || "") === String(id) ? "primary" : ""}" data-action="set-active-quest" data-quest-id="${escapeHtml(id)}">${String(state.player.activeQuestId || "") === String(id) ? "✓ Active Quest Helper" : "Set Active Quest Helper"}</button>${q.complete && !q.claimed ? `<button class="primary" data-cmd="turnin_quest" data-quest-id="${escapeHtml(id)}">Turn In Quest</button>` : ""}</div>`;
}
let questJournalTab = "current";
(window as any).__ashenfallReactUi = {
  questJournalTab,
  selectedQuest,
  selectedStoryArcId,
  selectedSkill,
};
function updateQuestJournalSummary() {
  const box = $("questJournalSummary");
  if (!box || !state) return;
  const entries = Object.entries<any>(state.player.quests || {});
  const active = entries.filter(([_, q]) => q?.accepted && !q?.claimed).length;
  const ready = entries.filter(([_, q]) => q?.complete && !q?.claimed).length;
  const done = entries.filter(([_, q]) => q?.claimed).length;
  box.innerHTML = `<div><div class=eyebrow>QUEST HUB</div><h3>Adventures & Objectives</h3></div><div class=summary-stats><span><b>${active}</b> Active</span><span><b>${ready}</b> Ready</span><span><b>${done}</b> Done</span></div>`;
}
function renderQuestJournalContents() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const p = state.player;
  updateQuestJournalSummary();
  if (questJournalTab === "story") {
    const arcs = state.storyProgress?.arcs || [];
    const current =
      arcs.find((a) => a.id === selectedStoryArcId) ||
      arcs.find((a) => a.id === state.storyProgress?.currentArcId) ||
      arcs[0];
    if (current && selectedStoryArcId !== current.id)
      selectedStoryArcId = current.id;
    const sig = JSON.stringify({
      tab: questJournalTab,
      selectedStoryArcId,
      arcs,
    });
    if (sig === questSig) return;
    questSig = sig;
    document
      .querySelectorAll(".quest-tabs button")
      .forEach((x) =>
        x.classList.toggle("active", x.dataset.tab === questJournalTab),
      );
    $("questList").innerHTML =
      arcs
        .map(
          (a, i) =>
            `<button type="button" class="journal-entry ${selectedStoryArcId === a.id ? "selected" : ""}" data-action="story-arc" data-story-arc-id="${escapeHtml(a.id)}"><b>Arc ${i + 1}  -  ${escapeHtml(a.name)}</b><div class="muted">${a.completed}/${a.total} quests completed${a.active ? " • " + a.active + " active" : ""}</div><div class="muted">${escapeHtml((a.zones || []).map((id) => state.zones.find((z) => z.id === id)?.name || String(id).replace(/_/g, " ")).join(" • "))}</div></button>`,
        )
        .join("") || '<div class="muted">The story records are empty.</div>';
    const storyCurrent = current;
    if (storyCurrent) {
      $("questDetail").innerHTML =
        `<div class="story-codex"><div class="eyebrow">STORY ARC ${Number(storyCurrent.index) + 1}</div><h2>${escapeHtml(storyCurrent.name)}</h2><div class="muted">${storyCurrent.completed}/${storyCurrent.total} quests completed</div><div class="quest-lore"><b>Purpose</b><p>${escapeHtml(storyCurrent.purpose || "")}</p></div><div class="quest-lore"><b>Regions</b><p>${escapeHtml((storyCurrent.zones || []).map((id) => state.zones.find((z) => z.id === id)?.name || String(id).replace(/_/g, " ")).join(" • "))}</p></div><div class="quest-lore"><b>Story quests</b>${(
          storyCurrent.quests || []
        )
          .map((id) => {
            const q = state.catalog.quests.find((x) => x.id === id);
            const st = p.quests[id] || {};
            return `<div class="story-codex-quest"><div class="story-quest-name"><b>${escapeHtml(q?.name || id)}</b></div><div class="story-quest-status ${st.claimed ? "completed" : st.accepted ? (st.complete ? "ready" : "active") : "locked"}">${st.claimed ? "✓ Completed" : st.accepted ? (st.complete ? "✓ Ready to turn in" : "Active") : "Not yet discovered"}</div></div>`;
          })
          .join("")}</div></div>`;
    }
    return;
  }
  const dynamicContracts = (state.worldIntegration?.contracts || [])
    .filter((c: any) => c.status === "active")
    .map((c: any) => [
      c.id,
      {
        dynamic: true,
        accepted: true,
        claimed: false,
        complete: false,
        progress: Number(c.objectiveIndex || 0),
        amount: Number((c.objectives || []).length || 3),
        title: c.title,
      },
    ]);
  const list = [
    ...dynamicContracts,
    ...Object.entries<any>(p.quests || {})
      .filter(([id, q]) => q.accepted || q.claimed || q.complete)
      .filter(([id, q]) =>
        questJournalTab === "current" ? !q.claimed : q.claimed,
      ),
  ];
  const sig = JSON.stringify({ tab: questJournalTab, list, selectedQuest });
  if (sig === questSig) return;
  questSig = sig;
  document
    .querySelectorAll(".quest-tabs button")
    .forEach((x) =>
      x.classList.toggle("active", x.dataset.tab === questJournalTab),
    );
  $("questList").innerHTML =
    list
      .map(([id, q]) => {
        const d = state.catalog.quests.find((x) => x.id === id) || {};
        const dynamic = String(id).startsWith("wc:");
        const name = dynamic ? q.title || "Dynamic World Quest" : d.name;
        const category = dynamic ? "world quest" : d.category || "world";
        const amount = dynamic ? q.amount || 3 : d.amount || 1;
        return `<button type="button" class="journal-entry ${selectedQuest === id ? "selected" : ""}" data-action=select-quest data-quest-id="${escapeHtml(id)}"><b>${escapeHtml(name)}</b><div class=muted>${escapeHtml(category).replace("_", " ")} • ${q.progress || 0}/${amount} ${q.complete ? "✓ Completed" : q.accepted ? "Active" : "Available"}</div></button>`;
      })
      .join("") ||
    `<div class="muted">${questJournalTab === "completed" ? "No completed quests yet." : "No accepted quests yet."}</div>`;
  if (!selectedQuest && list[0]) selectedQuest = list[0][0];
  renderQuestDetail();
}
function renderSkillList() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const cls = state.catalog.classes[state.player.classId],
    ids = state.player.abilityIds || [],
    all = Object.entries<any>(cls.abilityUnlocks || {});
  if (!selectedSkill || !all.some(([id]) => id === selectedSkill))
    selectedSkill = all[0]?.[0] || null;
  $("skillList").innerHTML = all
    .map(([id, lvl]) => {
      const a = state.catalog.abilities[id],
        learned = ids.includes(id);
      return `<button type="button" draggable="false" data-drag-kind="${learned ? "ability" : "locked"}" data-drag-id="${id}" class="skill-entry ${selectedSkill === id ? "selected" : ""}" data-tip="${escapeHtml(skillTip(a))}" data-action=select-skill data-skill-id="${id}"><span class=icon>${a.icon}</span><div><b>${escapeHtml(a.name)}</b><div class=muted>${learned ? "✅ Learned" : "🔒 Level " + lvl}</div></div><span class=spacer></span>${learned ? "" : "🔒"}</button>`;
    })
    .join("");
  renderSkillDetail();
}
function renderSkills() {
  openModal("skillModal");
}
function renderSkillDetail() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const a = state.catalog.abilities[selectedSkill],
    lvl =
      state.catalog.classes[state.player.classId]?.abilityUnlocks?.[
        selectedSkill
      ];
  if (!a) {
    $("skillDetail").textContent = "Select a skill.";
    return;
  }
  const scaling =
    a.scaling === "spell" ? "Spell Power" : a.power ? "Attack" : "Utility";
  const detail = [
    a.power ? `Damage: ${Number(a.power).toFixed(2)}× ${scaling}` : null,
    a.heal ? `Healing: ${(Number(a.heal) * 100).toFixed(0)}% max health` : null,
    a.hot
      ? `HoT: ${(Number(a.hot.tickHeal || 0) * 100).toFixed(1)}% max health/sec for ${a.hot.duration}s`
      : null,
    a.status
      ? `${String(a.status.id).replace(/_/g, " ")}: ${a.status.damage || 0} damage/sec for ${a.status.duration}s`
      : null,
    a.debuff
      ? `Debuff: ${String(a.debuff.id).replace(/_/g, " ")} for ${a.debuff.duration}s`
      : null,
    a.stun ? `Stun: ${a.stun}s` : null,
    a.executeThreshold
      ? `Execute: ${Math.round((Number(a.executeMultiplier || 1) - 1) * 100)}% bonus power below ${Math.round(Number(a.executeThreshold) * 100)}% HP`
      : null,
    a.aoe
      ? `Area: ${a.aoe.radius}m radius, up to ${a.aoe.maxTargets || 6} targets`
      : null,
    a.partyBuff
      ? `Party buff: ${Object.entries<any>(a.partyBuff.modifiers || {})
          .map(([k, v]) => `${k} +${v}%`)
          .join(", ")} for ${a.partyBuff.duration}s`
      : null,
  ].filter(Boolean);
  $("skillDetail").innerHTML =
    `<div class=skill-detail-grid><div class=skill-big>${a.icon}</div><div><h2>${escapeHtml(a.name)}</h2><div class=muted>${state.player.abilityIds.includes(selectedSkill) ? "✅ Learned" : "🔒 Not learned"} • Unlock level ${lvl || 1}</div><p>${escapeHtml(a.description || "")}</p></div></div><div class=reward><b>Combat Details</b>${detail.map((x) => `<div>${escapeHtml(x)}</div>`).join("")}<div>${Number(a.castTime) > 0 ? `Cast: ${Number(a.castTime)}s · ` : "Instant · "}Cooldown: ${a.cooldown || 0}s</div><div>Resource: ${a.cost || 0} ${escapeHtml(state.player.resourceName)}</div><div>GCD: ${a.gcd || 0}s</div><div>${a.aoe?.center === "self" ? `Radius: ${a.aoe.radius}m • centered on you` : `Range: ${a.range || 0}m`}</div></div><div class=muted style="margin-top:8px">${escapeHtml(skillTip(a))}</div>`;
}
let activeQuestHelper = null;
let questHelperSig = "";
function questTrackerEntries() {
  if (!state?.player) return [];
  const quests = Array.isArray(state.catalog?.quests)
    ? state.catalog.quests
    : Object.values(state.catalog?.quests || {});
  const zones = Array.isArray(state.zones) ? state.zones : [];
  const npcs = [
    ...(Array.isArray(state.npcs) ? state.npcs : []),
    ...(Array.isArray(state.catalog?.npcs) ? state.catalog.npcs : []),
  ];
  const mobs = Array.isArray(state.mobs) ? state.mobs : [];
  const mobDefs = Array.isArray(state.catalog?.worldMobDefs)
    ? state.catalog.worldMobDefs
    : [];
  const dungeons = Array.isArray(state.catalog?.dungeons)
    ? state.catalog.dungeons
    : [];
  const poisByZone = state.catalog?.worldPoi?.zones || {};
  const entries: any[] = [];
  for (const [id, qs] of Object.entries<any>(state.player.quests || {})) {
    if (!qs || qs.claimed || (!qs.accepted && !qs.complete)) continue;
    const d: any = quests.find((x: any) => x.id === id);
    if (!d) continue;
    entries.push({ id, qs, def: d, dynamic: false });
  }
  for (const c of state.worldIntegration?.contracts || []) {
    if (c?.status !== "active") continue;
    const steps = Array.isArray(c.objectives) ? c.objectives : [];
    const idx = Math.min(
      Number(c.objectiveIndex || 0),
      Math.max(0, steps.length - 1),
    );
    entries.push({
      id: String(c.id),
      qs: { accepted: true, complete: false, progress: idx },
      def: {
        id: String(c.id),
        name: c.title || "World Contract",
        description: c.description || "",
        type: "world_contract",
        amount: steps.length || 3,
        target: c.targetZoneId || c.regionId,
        objective:
          steps[idx] || c.label || c.description || "Continue the situation.",
      },
      dynamic: true,
      contract: c,
    });
  }
  entries.sort(
    (a, b) =>
      Number(b.qs.accepted && !b.qs.complete) -
        Number(a.qs.accepted && !a.qs.complete) ||
      Number(b.qs.complete) - Number(a.qs.complete) ||
      String(a.def.name).localeCompare(String(b.def.name)),
  );
  const gateForZone = (zoneId: string) => {
    const gs = Array.isArray(state.gates) ? state.gates : [];
    return (
      gs.find((g: any) => g.to === zoneId) ||
      Object.values<any>(state.catalog?.gates || {})
        .flat()
        .find((g: any) => g.to === zoneId) ||
      null
    );
  };
  const poiForDungeon = (id: string) => {
    const base = String(id).replace(/_(?:veteran|heroic|mythic|apex)$/, "");
    const all: any[] = [];
    for (const arr of Object.values<any>(poisByZone))
      if (Array.isArray(arr)) all.push(...arr);
    return all.find(
      (v: any) =>
        v.type === "dungeon_entrance" &&
        (String(v.id).startsWith(base) ||
          String(v.name || "")
            .toLowerCase()
            .includes(base.replace(/_/g, " ").toLowerCase())),
    );
  };
  return entries.slice(0, 8).map((x) => {
    const d = x.def,
      qs = x.qs;
    let targetName = "",
      targetX: any,
      targetY: any,
      zoneId = String(d.zone || d.target || state.player.zone);
    if (d.type === "talk") {
      const n = npcs.find((n: any) => n.id === d.target);
      if (n) {
        targetName = n.name;
        targetX = n.x;
        targetY = n.y;
        zoneId = n.zone;
      }
    } else if (d.type === "travel") {
      const z = zones.find((z: any) => z.id === d.target);
      targetName = z?.name || String(d.target || "");
      zoneId = String(d.target || state.player.zone);
      const g = gateForZone(zoneId);
      if (g) {
        targetX = g.x;
        targetY = g.y;
      }
    } else if (d.type === "kill") {
      const m = mobs.find(
        (m: any) =>
          m.type === String(d.enemy || d.target) && m.state !== "dead",
      );
      if (m) {
        targetName = m.name || d.targetName || d.enemy;
        targetX = m.x;
        targetY = m.y;
        zoneId = m.zone;
      } else {
        const def = mobDefs.find(
          (m: any) =>
            m.type === String(d.enemy || d.target) ||
            m.id === String(d.enemy || d.target),
        );
        targetName = def?.name || d.targetName || d.enemy || d.target;
        zoneId = String(def?.zones?.[0] || zoneId);
        const g = gateForZone(zoneId);
        if (g && zoneId !== state.player.zone) {
          targetX = g.x;
          targetY = g.y;
        }
      }
    } else if (d.type === "mine") {
      const o = (state.ores || []).find(
        (o: any) => o.type === d.target && o.state !== "depleted",
      );
      if (o) {
        targetName = o.name || d.target;
        targetX = o.x;
        targetY = o.y;
        zoneId = o.zone;
      } else {
        targetName = d.targetName || d.target || "ore";
        const g = gateForZone(zoneId);
        if (g && zoneId !== state.player.zone) {
          targetX = g.x;
          targetY = g.y;
        }
      }
    } else if (d.type === "dungeon") {
      const dungeon =
        dungeons.find((v: any) => v.id === d.target) ||
        dungeons.find((v: any) => v.baseDungeonId === d.target);
      targetName =
        dungeon?.name || String(d.target || "Dungeon").replace(/_/g, " ");
      const poi = poiForDungeon(String(dungeon?.baseDungeonId || d.target));
      if (poi) {
        targetX = poi.x;
        targetY = poi.y;
        const found = Object.entries<any>(poisByZone).find(
          ([, arr]) =>
            Array.isArray(arr) && arr.some((v: any) => v.id === poi.id),
        );
        if (found) zoneId = String(found[0]);
      }
    } else if (d.type === "world_event") {
      targetName = String(d.target || "event").replace(/_/g, " ");
      const site = (
        Array.isArray(poisByZone[zoneId]) ? poisByZone[zoneId] : []
      ).find((p: any) => p.type === "event_site");
      if (site) {
        targetX = site.x;
        targetY = site.y;
      } else {
        const g = gateForZone(zoneId);
        if (g && zoneId !== state.player.zone) {
          targetX = g.x;
          targetY = g.y;
        }
      }
    } else if (x.dynamic) {
      targetName = d.targetName || d.target || "";
      targetX = x.contract?.targetX;
      targetY = x.contract?.targetY;
      zoneId = String(d.target || state.player.zone);
    }
    if (!x.dynamic && qs.complete && d.giver) {
      const giver = npcs.find((n: any) => n.id === d.giver);
      if (giver) {
        targetName = giver.name;
        targetX = giver.x;
        targetY = giver.y;
        zoneId = giver.zone;
      }
    }
    if (!x.dynamic && targetX == null && d.giver) {
      const giver = npcs.find((n: any) => n.id === d.giver);
      if (giver) {
        targetName = giver.name;
        targetX = giver.x;
        targetY = giver.y;
        zoneId = giver.zone;
      }
    }
    let text = "";
    if (x.dynamic)
      text = d.objective || d.description || "Continue the world situation.";
    else if (d.type === "kill")
      text = `Defeat ${Math.max(0, Number(d.amount || 1) - Number(qs.progress || 0))} more ${targetName}.`;
    else if (d.type === "collect")
      text = `Collect ${Math.max(0, Number(d.amount || 1) - Number(qs.progress || 0))} more ${targetName}.`;
    else if (d.type === "mine")
      text = `Gather ${Math.max(0, Number(d.amount || 1) - Number(qs.progress || 0))} more ${targetName}.`;
    else if (d.type === "travel")
      text = qs.complete
        ? "Return to the quest giver."
        : `Travel to ${targetName || "the marked area"}.`;
    else if (d.type === "dungeon")
      text = `Enter ${targetName || "the dungeon"} and complete the objective.`;
    else if (d.type === "world_event") text = `Participate in ${targetName}.`;
    else if (d.type === "talk")
      text = `Speak with ${targetName || "the marked character"}.`;
    else text = d.description || d.story || "Continue the quest objective.";
    const zone = zones.find((z: any) => z.id === zoneId);
    const authoritativeHelper =
      state.questHelper && String(state.questHelper.id) === String(x.id)
        ? state.questHelper
        : null;
    if (authoritativeHelper) {
      targetX = authoritativeHelper.targetX ?? targetX;
      targetY = authoritativeHelper.targetY ?? targetY;
      zoneId =
        authoritativeHelper.routeZoneId || authoritativeHelper.zoneId || zoneId;
      if (authoritativeHelper.targetName)
        targetName = authoritativeHelper.targetName;
    }
    return {
      id: x.id,
      name: d.name || x.id,
      type: d.type,
      text,
      progress: Number(qs.progress || 0),
      amount: Number(d.amount || 1),
      complete: !!qs.complete,
      zoneName:
        zone?.name || targetName || state.zoneInfo?.name || "Current Area",
      targetX,
      targetY,
      zoneId,
      routeZoneId: zoneId,
    };
  });
}
function renderQuestHelper() {
  const h = $("questHelper");
  if (!h || !state?.player) return;
  let entries = questTrackerEntries();
  const authoritative = state.questHelper;
  if (
    authoritative?.id != null &&
    !entries.some((q: any) => String(q.id) === String(authoritative.id))
  ) {
    const quests = Array.isArray(state.catalog?.quests)
      ? state.catalog.quests
      : Object.values(state.catalog?.quests || {});
    const d: any = quests.find(
      (q: any) => String(q.id) === String(authoritative.id),
    );
    const qs: any = state.player?.quests?.[authoritative.id] || {};
    entries = [
      {
        id: String(authoritative.id),
        name: authoritative.name || d?.name || String(authoritative.id),
        type: authoritative.type || d?.type || "talk",
        text:
          authoritative.objective ||
          authoritative.description ||
          d?.description ||
          d?.story ||
          "Continue the quest objective.",
        progress: Number(authoritative.progress ?? qs.progress ?? 0),
        amount: Number(authoritative.amount ?? d?.amount ?? 1),
        complete: Boolean(authoritative.complete ?? qs.complete),
        zoneName:
          (state.zones || []).find(
            (z: any) =>
              String(z.id) ===
              String(authoritative.routeZoneId || authoritative.zoneId),
          )?.name ||
          authoritative.targetName ||
          state.zoneInfo?.name ||
          "Current Area",
        targetX: authoritative.targetX,
        targetY: authoritative.targetY,
        zoneId: authoritative.zoneId || state.player.zone,
        routeZoneId:
          authoritative.routeZoneId ||
          authoritative.zoneId ||
          state.player.zone,
      },
      ...entries,
    ];
  }
  if (!entries.length) {
    activeQuestHelper = null;
    h.classList.add("hidden");
    questHelperSig = "";
    return;
  }
  const preferredId = authoritative?.id ?? state?.player?.activeQuestId;
  activeQuestHelper =
    entries.find((q: any) => String(q.id) === String(preferredId)) ||
    entries[0];
  const sig = JSON.stringify({
    entries,
    questRouteVisible,
    authoritativeId: authoritative?.id,
    authoritativeTarget: [authoritative?.targetX, authoritative?.targetY],
  });
  if (sig === questHelperSig) return;
  questHelperSig = sig;
  h.classList.remove("hidden");
  h.innerHTML = `<div class="qh-head"><span>QUESTS</span><b>${entries.length}</b></div>${entries.map((q: any, i: number) => `<div class="qh-entry ${String(q.id) === String(activeQuestHelper?.id) ? "active" : ""}"><div class="qh-title"><span>${q.complete ? "✓" : "◆"}</span><b>${escapeHtml(q.name)}</b><em>${q.complete ? "READY" : `${q.progress}/${q.amount}`}</em></div><div class="qh-text">${escapeHtml(q.text)}</div><div class="qh-route">${escapeHtml(q.zoneName)}${i === 0 ? ` <button type="button" class="quest-route-toggle" data-action="toggle-quest-route" aria-pressed="${questRouteVisible ? "true" : "false"}">${questRouteVisible ? "Hide arrow" : "Show arrow"}</button>` : ""}</div></div>`).join("")}`;
}
let storyRenderSig = "";
function renderStory() {
  const entries = Object.entries<any>(state.player.quests || {}).filter(
    ([id, q]) =>
      q &&
      q.visible !== false &&
      !q.claimed &&
      (q.accepted || q.complete || q.visible),
  );
  const active =
    entries.find(([id, q]) => q.accepted || q.complete) || entries[0];
  const storySig = JSON.stringify({
    entries,
    active,
    storyProgress: state.storyProgress,
  });
  if (storySig === storyRenderSig) return;
  storyRenderSig = storySig;
  const qd = active
    ? state.catalog.quests.find((x) => x.id === active[0])
    : state.catalog.quests.find((x) => x.id === "call_of_ashenfall");
  if (!qd) {
    $("story").innerHTML = "<div class=muted>No active story objective.</div>";
    return;
  }
  const qs = active?.[1] || {};
  const status = qs.complete
    ? "Ready to turn in"
    : qs.accepted
      ? "Accepted"
      : "Available";
  let objective =
    qd.description || qd.story || "Follow the quest helper on the map.";
  if (qd.id === "call_of_ashenfall")
    objective = qs.accepted
      ? "Leave Stonehold through the Gloam Gate and find the missing patrol in Gloamwood."
      : "Speak with Captain Aric to receive the assignment.";
  $("story").innerHTML =
    `<div class=story-current><b>${escapeHtml(qd.chapter || "Story")}</b><h3>${escapeHtml(qd.name || qd.id)}</h3><div class=muted>${status} • ${qs.progress || 0}/${qd.amount || 1}</div>${state.storyProgress?.currentArcName ? `<div class=story-arc-line>Current arc: <b>${escapeHtml(state.storyProgress.currentArcName)}</b> • ${state.storyProgress.completedQuests || 0} completed</div>` : ""}<p>${escapeHtml(objective)}</p><p class=muted>${escapeHtml(qd.story || "")}</p></div>`;
}
function showInspectModal(x) {
  let modal = $("inspectModal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "inspectModal";
    modal.className = "modal hidden";
    modal.innerHTML =
      '<div class="modal-card"><div class="modal-head"><h2>👤 Inspect Player</h2><button type="button" data-action="close-modal" data-modal="inspectModal">×</button></div><div id="inspectBody" class="detail-panel"></div></div>';
    document.body.appendChild(modal);
    bindMovableWindows();
  }
  const body = $("inspectBody");
  if (!body) return;
  const gear =
    Object.entries<any>(x.equipment || {})
      .map(([slot, id]) => {
        const it = state.catalog.items[id] || {};
        return `<div class="item"><span>${it.icon || "⚔️"}</span><div><b>${escapeHtml(it.name || id)}</b><div class="muted">${escapeHtml(slot)}</div></div></div>`;
      })
      .join("") || '<div class="muted">No equipment visible.</div>';
  const stats = Object.entries<any>(x.stats || {})
    .map(([k, v]) => `<span class="tag">${escapeHtml(k)} ${v}</span>`)
    .join("");
  body.innerHTML = `<div class="character-sheet-head"><div class="avatar">${x.icon || "👤"}</div><div><h2>${escapeHtml(x.name || "Player")}</h2><div class="muted">Lv ${x.level || 1} • ${escapeHtml(x.role || "Adventurer")} • ${x.online ? "Online" : "Offline"}</div></div></div><div class="detail-panel"><b>Stats</b><div class="tags">${stats || '<span class="muted">No public stats.</span>'}</div></div><h3>Equipment</h3>${gear}<div class="actions-inline"><button class="primary" data-action="player-whisper" data-player-id="${escapeHtml(x.id)}">Whisper</button><button data-action="close-modal" data-modal="inspectModal">Close</button></div>`;
  openModal("inspectModal");
}

function syncStoryModal() {
  if (!state?.player) return;
  const open =
    Boolean(state.player.storyDialogueOpen) &&
    !Boolean(state.player.storyIntroSeen) &&
    !storyForcedClosed;
  if (reactUtilityMounted()) {
    const steps = state.catalog?.storyIntro?.steps || [];
    const step = Math.max(0, Number(state.player.storyDialogueStep || 0));
    const d = steps[step] || {};
    syncReactUtilityState({
      story: {
        open,
        step,
        total: steps.length,
        title:
          typeof d === "string"
            ? "Ashes of the Past"
            : d.title || "The Breaking Veil",
        speaker:
          typeof d === "string"
            ? state.catalog.storyIntro?.speaker || "Captain Aric"
            : d.speaker || "Captain Aric",
        text: typeof d === "string" ? d : d.text || d.body || "",
        button: step + 1 >= steps.length ? "Begin" : "Continue",
      },
    });
    const modal = $("storyModal");
    if (modal) {
      modal.classList.toggle("hidden", !open);
      modal.setAttribute("aria-hidden", open ? "false" : "true");
    }
    return;
  }
  const modal = $("storyModal");
  if (!modal) return;
  if (open) {
    const steps = state.catalog?.storyIntro?.steps || [];
    const step = Math.max(0, Number(state.player.storyDialogueStep || 0));
    if (steps.length)
      showStoryStep(steps[Math.min(step, steps.length - 1)], step);
  } else {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
}
function showStoryStep(d, step = 0) {
  if (d == null) return;
  if (reactUtilityMounted()) {
    syncStoryModal();
    return;
  }
  const text = typeof d === "string" ? d : d.text || d.body || "";
  const title =
    typeof d === "string"
      ? "Ashes of the Past"
      : d.title || "The Breaking Veil";
  const speaker =
    typeof d === "string"
      ? state.catalog.storyIntro?.speaker || "Captain Aric"
      : d.speaker || "Captain Aric";
  $("dialogueStep").textContent = `Prologue • ${Number(step) + 1}`;
  $("dialogueTitle").textContent = escapeHtml(title);
  $("dialogueSpeaker").textContent = escapeHtml(speaker);
  $("dialogueText").textContent = text;
  $("dialogueNext").textContent =
    Number(step) + 1 >= (state.catalog.storyIntro?.steps?.length || 99)
      ? "Begin"
      : "Continue";
  openModal("storyModal");
}
function renderLog() {
  const p = state.player,
    e = state.encounter,
    log = e?.log || p.worldCombatLog || p.lastCombat?.log || [],
    sig = JSON.stringify(log.slice(-100));
  if (sig === logSig) return;
  logSig = sig;
  if (reactUtilityMounted()) {
    syncReactUtilityState({ combatLog: log.slice(-100) });
    return;
  }
  $("log").innerHTML = log
    .slice(-100)
    .map(
      (x) =>
        `<div class=row><span class=muted>${x.t || ""}</span> ${escapeHtml(x.msg || "")}</div>`,
    )
    .join("");
  $("log").scrollTop = $("log").scrollHeight;
}
function renderRegionHud() {
  const h = $("regionHud");
  if (!h) return;
  const r = state?.region;
  if (!r) {
    h.classList.add("hidden");
    return;
  }
  h.classList.remove("hidden");
  $("regionHudIcon").textContent = state.zoneInfo?.icon || "🌲";
  $("regionHudName").textContent = r.name || state.zoneInfo?.name || "Region";
  const band =
    (state.catalog?.worldZoneProgression?.zones || []).find(
      (z: any) => z.id === r.id,
    )?.band || "Region";
  $("regionHudBand").textContent = String(band).replace(/_/g, " ");
  const danger = Number(state.zoneInfo?.danger || 0);
  $("regionHudDanger").textContent = `DANGER ${danger}`;
  const ex = r.exploration || {};
  const discovered = Number(ex.discoveredCount || 0);
  const total = Number(ex.totalDiscoveries || r.pois?.length || 0);
  const pct = Number(
    ex.completionPercent ?? (total ? (discovered / total) * 100 : 0),
  );
  $("regionProgressFill").style.width = `${Math.round(pct)}%`;
  $("regionHudDiscovery").textContent =
    `${discovered} / ${total} discoveries${ex.completed ? " • COMPLETE" : ""}`;
  const ow = state.openWorld;
  const activity = $("regionHudActivity");
  const wes = r.worldEventState || r.runtime?.worldEvent || null;
  if (activity) {
    if (wes?.outcome === "active") {
      const phase = String(wes.phase || "opening").replace(/_/g, " ");
      const rw = wes.regionalWorld || {};
      const label = rw.phaseLabel || wes.worldPhase || "Under Pressure";
      const kind = rw.activityKind
        ? String(rw.activityKind).replace(/_/g, " ")
        : "world event";
      activity.innerHTML = `<b>Regional Event</b><span>⚔ ${escapeHtml(label)} • ${escapeHtml(phase)}</span><small>${escapeHtml(kind)} activity at ${escapeHtml(rw.activityName || "the event site")}</small>`;
    } else if (wes?.outcome === "failed") {
      activity.innerHTML = `<b>Regional Event</b><span>⚠ Region threatened</span><small>Enemies and travel remain dangerous</small>`;
    } else if (wes?.outcome === "completed") {
      activity.innerHTML = `<b>Regional Event</b><span>✓ Region recovered</span><small>Players changed this region</small>`;
    } else if (wes?.outcome === "recovering") {
      activity.innerHTML = `<b>Regional Event</b><span>◌ Recovery underway</span><small>Last outcome: ${escapeHtml(String(wes.lastOutcome || "unknown"))}</small>`;
    } else if (ow?.contract) {
      const left = Math.max(
        0,
        Math.ceil((Number(ow.contract.endsAt) - now()) / 1000),
      );
      activity.innerHTML = `<b>Regional Activity</b><span>⚔ ${escapeHtml(ow.contract.name)} • ${ow.contract.progress}/${ow.contract.goal}</span><small>${left}s • ${escapeHtml(ow.factionTier || "neutral")} standing</small>`;
    } else {
      activity.innerHTML = `<b>Regional Activity</b><span>No active contract</span>`;
    }
  }
  const cond = r.runtime?.condition || "normal";
  const labels: any = {
    normal: "Normal travel",
    "lantern-trail": "Lantern trail • +10% movement",
    "caravan-lane": "Caravan lane • +15% movement",
    "royal-road": "Royal road • +8% movement",
    "root-snare": "Root snare • movement hindered",
    "veil-storm": "VEIL STORM • dangerous conditions",
    "hollow-wind": "Hollow wind • +5% movement",
  };
  $("regionHudCondition").textContent =
    labels[cond] || String(cond).replace(/-/g, " ");
}
function reactWindowsMounted() {
  return Boolean((window as any).__ashenfallReactWindowsMounted);
}
function refreshReactWindows() {
  window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
}
function renderChat() {
  const world = (state.chat || []).map((x) => ({
    ...x,
    channel: x.kind === "system" ? "system" : "say",
  }));
  const party = (state.party?.chat || []).map((x) => ({
    ...x,
    channel: "party",
  }));
  const whispers = (state.social?.whispers || []).map((x) => ({
    ...x,
    channel: "whisper",
  }));
  const system = systemMessages.map((x) => ({ ...x, channel: "system" }));
  const msgs = [...world, ...party, ...whispers, ...system]
    .sort((a, b) => Number(a.ts || a.at || 0) - Number(b.ts || b.at || 0))
    .slice(-100);
  const sig = JSON.stringify({ msgs, chatChannel, chatWhisperTargetId });
  if ($("chatZone"))
    $("chatZone").textContent =
      state.zoneInfo?.name || state.player?.zone || "";
  if (sig === chatSig) return;
  chatSig = sig;
  const html = msgs
    .map((x) => {
      const t =
        x.t || new Date(x.ts || x.at || Date.now()).toLocaleTimeString();
      const cls =
        x.channel === "whisper"
          ? "chat-whisper"
          : x.channel === "party"
            ? "chat-party"
            : x.channel === "system"
              ? "chat-system"
              : "chat-say";
      const label =
        x.channel === "whisper"
          ? "[Whisper]"
          : x.channel === "party"
            ? "[Party]"
            : x.channel === "system"
              ? "[System]"
              : "";
      const reply =
        x.channel === "whisper"
          ? ` data-action="whisper-reply" data-player-id="${escapeHtml(x.direction === "out" ? x.toId || "" : x.fromId || "")}"`
          : "";
      return `<div class="chat-line ${cls}"${reply}><span class=muted>${escapeHtml(t)}</span> <b>${escapeHtml(label)} ${escapeHtml(x.channel === "system" ? "" : x.direction === "out" ? "You" : x.from || x.fromName || "Ashenfall")}:</b> ${escapeHtml(x.text || "")}</div>`;
    })
    .join("");
  if ($("chatLog")) $("chatLog").innerHTML = html;
  if ($("mapChatLog")) {
    $("mapChatLog").innerHTML = html;
    $("mapChatLog").scrollTop = $("mapChatLog").scrollHeight;
  }
}
function renderDeath() {
  const p = state?.player;
  if (!p) return;
  if (reactUtilityMounted()) {
    const open = !!p.dead;
    const rem = open ? Math.max(0, p.respawnAt - now()) : 0;
    syncReactUtilityState({
      death: {
        open,
        message: p.respawnMessage || "You have fallen.",
        remainingMs: rem,
        ready: !!p.respawnReady,
      },
    });
    const modal = $("deathModal");
    if (modal) {
      modal.classList.toggle("hidden", !open);
      modal.setAttribute("aria-hidden", open ? "false" : "true");
    }
    return;
  }
  if (p.dead) {
    $("deathModal").classList.remove("hidden");
    $("deathText").textContent = p.respawnMessage || "You have fallen.";
    const rem = Math.max(0, p.respawnAt - now());
    $("respawnTimer").textContent =
      rem > 0 ? `Respawn in ${(rem / 1000).toFixed(1)}s` : "Ready";
    $("respawnBtn").disabled = rem > 0 || !p.respawnReady;
  } else $("deathModal").classList.add("hidden");
}
function showLoot(pile) {
  if (reactWindowsMounted()) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      lootPile: pile,
    };
    refreshReactWindows();
    openModal("lootModal");
    return;
  }
  if (!$("lootText")) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      lootPile: pile,
    };
    openModal("lootModal");
    return;
  }
  $("lootText").innerHTML =
    `<h3>${escapeHtml(pile.name)}</h3><p>🪙 ${pile.gold} gold</p><p>${(pile.items || []).map((i) => `${state.catalog.items[i.itemId]?.icon || "📦"} ${escapeHtml(state.catalog.items[i.itemId]?.name || i.itemId)} ×${i.qty}`).join("<br>") || "No extra items"}</p>`;
  openModal("lootModal");
}
function renderTrainer() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    openModal("trainerModal");
    return;
  }
  const box = $("trainerList");
  if (!box) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      openNpcId,
    };
    window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
    openModal("trainerModal");
    return;
  }
  if (!state) return;
  const cls = state.catalog?.classes?.[state.player.classId] || {};
  const ids = new Set(state.player.abilityIds || []);
  const trainer = (state.npcs || []).find(
    (n: any) => n.kind === "trainer" && n.classId === state.player.classId,
  );
  const near =
    trainer &&
    Math.hypot(
      Number(state.player.x) - Number(trainer.x),
      Number(state.player.y) - Number(trainer.y),
    ) <= 12;
  const entries = Object.entries<any>(cls.abilityUnlocks || {})
    .map(([id, lvl]: any) => {
      const a = state.catalog.abilities[id] || {};
      const learned = ids.has(id),
        req = Number(lvl || 1),
        can = near && state.player.level >= req && !learned;
      return `<div class="trainer-skill-row ${learned ? "learned" : ""}"><span class="trainer-skill-icon">${a.icon || "✦"}</span><div class="trainer-skill-main"><b>${escapeHtml(a.name || id)}</b><span>${learned ? "Learned" : `Unlocks at level ${req}`}</span><small>${escapeHtml(a.description || "")}</small></div>${learned ? "✓" : can ? `<button class="primary" data-cmd="learn_skill" data-ability-id="${escapeHtml(id)}">Learn</button>` : `<span class="muted">${state.player.level < req ? "🔒" : "Visit trainer"}</span>`}</div>`;
    })
    .join("");
  box.innerHTML = `<div class="trainer-hero"><div><div class="eyebrow">CLASS TRAINER</div><h3>${escapeHtml(cls.name || state.player.classId)} Training</h3><p class="muted">Learn your class abilities as they unlock. ${trainer ? (near ? "You are within training range." : "Move to " + escapeHtml(trainer.name || "your class trainer") + " to learn abilities.") : "Your class trainer is not in this zone."}</p></div></div><div class="trainer-skill-list">${entries || '<div class="muted">No class abilities are currently defined.</div>'}</div>`;
  openModal("trainerModal");
}

function openTeleporter(teleports: any[] = []) {
  const list = $("teleportList");
  if (!list) return;
  const destinations = (Array.isArray(teleports) ? teleports : []).filter(
    (z: any) => z?.id && z?.city,
  );
  list.innerHTML = destinations.length
    ? destinations
        .map(
          (z: any) =>
            `<button class=journal-row data-teleport-zone="${escapeHtml(String(z.id))}"><div><b>🌀 ${escapeHtml(String(z.name || z.id))}</b><div class=muted>Travel to this city.</div></div><span>Travel</span></button>`,
        )
        .join("")
    : "<div class=muted>No destinations are available.</div>";
  list.querySelectorAll("[data-teleport-zone]").forEach((button: Element) =>
    button.addEventListener("click", () => {
      const zoneId = (button as HTMLElement).dataset.teleportZone;
      if (!zoneId) return;
      send("travel", { zoneId });
    }),
  );
  openModal("teleportModal");
}
function openNpcService(detail) {
  const n = detail.npc || detail;
  openNpcId = n.id;
  npcSig = "";
  if (detail.service === "teleporter") {
    closeModal("npcModal");
    openTeleporter(detail.teleports || []);
    return;
  }
  if (detail.service === "trainer") {
    if (
      detail.isYourClass === true &&
      detail.classId === state.player.classId
    ) {
      closeModal("npcModal");
      renderTrainer();
      openModal("trainerModal");
    } else {
      openNpcOverlay({ ...detail, trainerMismatch: true });
    }
    return;
  }
  openNpcOverlay(detail);
}
function qClassAllowedClient(q) {
  const c = String(state.player.classId || "");
  const d = q.classIds || q.classes || q.class;
  if (Array.isArray(d) && d.length) return d.map(String).includes(c);
  if (typeof q.classId === "string" && q.classId) return q.classId === c;
  return true;
}
function refreshNpcModal() {
  if (!openNpcId) return;
  const n = (state.npcs || []).find((x) => x.id === openNpcId);
  if (!n) return;
  const offers = (n.questIds || [])
    .map((id) => state.catalog.quests.find((q) => q.id === id))
    .filter(Boolean)
    .map((q) => ({
      quest: q,
      requirementsMet:
        qRequiresMet(q) &&
        qClassAllowedClient(q) &&
        (!q.minLevel || state.player.level >= q.minLevel),
    }))
    .filter((x) => {
      const s = state.player.quests[x.quest.id] || {};
      return (
        !s.claimed &&
        !s.accepted &&
        qClassAllowedClient(x.quest) &&
        (!x.quest.minLevel || state.player.level >= x.quest.minLevel)
      );
    });
  const active = (n.questIds || [])
    .map((id) => state.catalog.quests.find((q) => q.id === id))
    .filter(Boolean)
    .map((q) => ({ quest: q, state: state.player.quests[q.id] || {} }))
    .filter((x) => x.state.accepted && !x.state.claimed);
  const turnins = (n.questIds || [])
    .map((id) => state.catalog.quests.find((q) => q.id === id))
    .filter(Boolean)
    .map((q) => ({ quest: q }))
    .filter((x) => {
      const st = state.player.quests[x.quest.id] || {};
      return st.accepted && !st.claimed && st.complete;
    });
  const sig = JSON.stringify({
    id: n.id,
    offers: offers.map((x) => [x.quest.id, state.player.quests[x.quest.id]]),
    active: active.map((x) => [x.quest.id, state.player.quests[x.quest.id]]),
    turnins: turnins.map((x) => [x.quest.id, state.player.quests[x.quest.id]]),
    service: n.kind,
    classId: n.classId,
    playerClass: state.player.classId,
  });
  if (sig === npcRenderSig) return;
  npcRenderSig = sig;
  openNpcOverlay({
    npc: n,
    offers,
    activeQuests: active,
    turnins,
    service: n.kind,
    shopId: n.shopId,
    teleports: state.zones.filter((z) => z.city && z.id !== state.player.zone),
    classId: n.classId,
    isYourClass: n.classId === state.player.classId,
  });
}
function qRequiresMet(q) {
  return (q.requires || []).every((id) => state.player.quests[id]?.claimed);
}
function openNpcOverlay(detail) {
  const n = detail.npc || detail;
  if (reactWindowsMounted()) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      openNpcId: n.id,
      npcService:
        detail.service === "profession_trainer"
          ? {
              id: detail.profession,
              level: detail.professionLevel || 0,
              known: !!detail.professionKnown,
            }
          : null,
    };
    refreshReactWindows();
    openModal("npcModal");
    return;
  }
  if (!$("npcBody")) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      openNpcId: n.id,
      npcService:
        detail.service === "profession_trainer"
          ? {
              id: detail.profession,
              level: detail.professionLevel || 0,
              known: !!detail.professionKnown,
            }
          : null,
    };
    window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
    openModal("npcModal");
    return;
  }
  $("npcTitle").textContent = `${n.icon || "👤"} ${escapeHtml(n.name)}`;
  $("npcSubtitle").textContent = escapeHtml(n.title || n.kind || "NPC");
  let html = `<p>${escapeHtml(n.title || "A citizen of Ashenfall.")}</p>`;
  if (detail.service === "trainer") {
    const cid = detail.classId;
    const cls = state.catalog.classes[cid] || {};
    const playerCls = state.catalog.classes[state.player.classId] || {};
    const ids = state.player.abilityIds || [];
    if (detail.trainerMismatch || cid !== state.player.classId) {
      html += `<div class="trainer-note"><b>Sorry, ${escapeHtml(n.name)} only trains ${escapeHtml(cls.name || "this class")} adventurers.</b><p class=muted>You are a ${escapeHtml(playerCls.name || state.player.classId)}. Seek your own class trainer.</p></div>`;
    } else {
      html += `<h3>${escapeHtml(cls.name || "Class")} Training</h3><div class="trainer-note">Your class trainer.</div>`;
      if (cid === state.player.classId)
        html += Object.entries<any>(cls.abilityUnlocks || {})
          .map(([id, lvl]) => {
            const a = state.catalog.abilities[id],
              learned = ids.includes(id);
            return `<div class="skill-entry ${learned ? "learned" : ""}"><span class=icon>${a?.icon || "✦"}</span><div><b>${escapeHtml(a?.name || id)}</b><div class=muted>Level ${lvl}</div></div><span class=spacer></span>${learned ? "✅" : state.player.level >= lvl ? `<button type=button data-cmd=learn_skill data-ability-id="${id}">Learn</button>` : "🔒"}</div>`;
          })
          .join("");
    }
  }
  if (detail.service === "profession_trainer") {
    const id = detail.profession,
      lvl = detail.professionLevel || 0,
      known = !!detail.professionKnown;
    html += `<div class="npc-service-menu"><div class="service-choice"><b>${{ mining: "⛏️ Mining", blacksmith: "⚒️ Blacksmithing", skinning: "🪶 Skinning", alchemy: "⚗️ Alchemy", cooking: "🍲 Cooking" }[id] || id}</b><span class="muted">${known ? `Level ${lvl}` : "Not learned"}</span>${known ? `<button type="button" data-cmd="drop_profession" data-profession="${id}">Forget Profession</button>` : `<button type="button" class="primary" data-cmd="select_profession" data-profession="${id}">Learn Profession</button>`}</div></div>`;
  }
  if ((detail.offers || []).length) {
    html +=
      "<h3>❗ Quests</h3>" +
      detail.offers
        .map((x) => {
          const ready = x.requirementsMet !== false;
          const req = (x.quest.requires || [])
            .map(
              (id: any) =>
                state.catalog.quests.find((q: any) => q.id === id)?.name || id,
            )
            .filter(Boolean);
          return `<div class=quest-offer ${ready ? "" : "quest-locked"}><b>${ready ? "❗" : "🔒"} ${escapeHtml(x.quest.name)}</b><p>${escapeHtml(x.quest.description)}</p><div class=muted>✨ ${x.quest.xp || 0} XP • 🪙 ${x.quest.gold || 0} gold</div>${ready ? `<button type=button data-cmd=accept_quest data-quest-id="${x.quest.id}">Accept Quest</button>` : `<div class=muted>Prerequisite: ${escapeHtml(req.join(", ") || "Previous quest or story requirement")}</div>`}</div>`;
        })
        .join("");
  }
  if ((detail.activeQuests || []).length) {
    html +=
      "<h3>📜 Active quest</h3>" +
      detail.activeQuests
        .map(
          (x) =>
            `<div class=quest-offer><b>📜 ${escapeHtml(x.quest.name)}</b><p>${escapeHtml(x.quest.description)}</p><div class=muted>Progress: ${x.state.progress || 0}/${x.quest.amount || 1} • ${x.state.complete ? "Ready to turn in" : "In progress"}</div></div>`,
        )
        .join("");
  }
  if ((detail.turnins || []).length) {
    html +=
      "<h3>❓ Ready to turn in</h3>" +
      detail.turnins
        .map(
          (x) =>
            `<div class=quest-offer><b>❓ ${escapeHtml(x.quest.name)}</b><p>${escapeHtml(x.quest.description)}</p><button type=button class=primary data-cmd=turnin_quest data-quest-id="${x.quest.id}">Turn In & Receive Reward</button></div>`,
        )
        .join("");
  }
  if (
    (detail.service === "shop" || detail.service === "blacksmith") &&
    detail.shopId
  ) {
    html += `<h3>Services</h3><div class="npc-service-menu"><button type="button" data-action="npc-shop" data-shop-id="${detail.shopId}">🛒 Open Shop</button>${detail.service === "blacksmith" ? `<button type="button" data-action="npc-craft" data-shop-id="${detail.shopId}">⚒️ Open Forge</button>` : ""}</div>`;
  }
  if (detail.service === "auctioneer")
    html += `<h3>Services</h3><div class="npc-service-menu"><button type="button" data-action="npc-auction">⚖️ Auction House</button></div>`;
  if (
    !detail.offers?.length &&
    !detail.turnins?.length &&
    detail.service === "quest"
  )
    html +=
      "<p class=muted>No quests are currently available here. Complete the previous chapter first.</p>";
  $("npcBody").innerHTML = html;
  openModal("npcModal");
}
function openShop(shopId = null) {
  const id = shopId || selectedShopId || state.shops?.[0]?.id;
  selectedShopId = id;
  if (reactWindowsMounted()) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      selectedShopId: id,
    };
    refreshReactWindows();
    openModal("shopModal");
    return;
  }
  if (!$("shopList")) {
    (window as any).__ashenfallReactUi = {
      ...(window as any).__ashenfallReactUi,
      selectedShopId: id,
    };
    window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
    openModal("shopModal");
    return;
  }
  const shop = (state.shops || []).find((x) => x.id === id);
  const invItems = state.player.inventory.filter((x) => x.qty > 0);
  const sig = JSON.stringify({
    id,
    items: shop?.items,
    gold: state.player.gold,
    inv: invItems.map((x) => [x.itemId, x.qty]),
    eq: state.player.equipment,
  });
  if (sig === shopSignature) {
    openModal("shopModal");
    return;
  }
  shopSignature = sig;
  const buyRows =
    shop?.items
      ?.map((line) => {
        const it = state.catalog.items[line.itemId] || {};
        return `<div class=shop-row data-tip="${escapeHtml(itemDescription(it))}"><div><b>${it.icon || "📦"} ${escapeHtml(it.name || line.itemId)}</b><div class=muted>${it.rarity || "common"} • ${it.type}</div></div><b>🪙 ${line.price}</b><button type=button data-cmd=buy_shop data-shop-id="${shop.id}" data-item-id="${line.itemId}">Buy</button></div>`;
      })
      .join("") || "<div class=muted>This shop has no stock.</div>";
  const sellRows =
    invItems
      .map((x) => {
        const it = state.catalog.items[x.itemId] || {};
        const eq = Object.values<any>(state.player.equipment || {}).includes(
          x.itemId,
        );
        const price = state.vendorPrices?.[x.itemId] || it.vendorPrice || 1;
        return `<div class=shop-row sell-row data-tip="${escapeHtml(itemDescription(it))}"><div><b>${it.icon || "📦"} ${escapeHtml(it.name || x.itemId)}</b><div class=muted>×${x.qty} • Sell value ${price}g each${eq ? " • Equipped" : ""}</div></div><b>🪙 ${price}</b><button type=button data-cmd=sell_shop data-item-id="${x.itemId}" ${eq ? "disabled" : ""}>Sell 1</button></div>`;
      })
      .join("") || "<div class=muted>Your bag is empty.</div>";
  const currentGold = state.player.gold;
  const buybacks = (state.player.recentSales || []).filter(
    (x) => Number(x.soldAt || 0) > Date.now() - 30 * 60 * 1000,
  );
  const buybackRows =
    buybacks
      .map((x) => {
        const it = state.catalog.items[x.itemId] || {};
        const price = Math.max(1, Math.ceil(Number(x.unitPrice || 1) * 1.5));
        return `<div class=shop-row><div><b>${it.icon || "📦"} ${escapeHtml(it.name || x.itemId)}</b><div class=muted>×${x.qty} • Buyback ${price}g each</div></div><button data-cmd=buyback_shop data-item-id="${x.itemId}">Buy Back</button></div>`;
      })
      .join("") || "<div class=muted>No recent sales to recover.</div>";
  const buybackPane = `<div class=shop-pane><div class=shop-pane-head><h3>↩️ Buyback</h3><span>30 min</span></div>${buybackRows}</div>`;
  const forge =
    shop?.id === "stonehold_armory" || shop?.id === "citadel_armory"
      ? `<div class="card forge-pane"><h3>⚒️ Forge</h3><p class=muted>Forge at the blacksmith using your learned Blacksmithing profession.</p>${[
          ["iron_sword", "Copper Sword", "3 Copper Ore", 1],
          ["grave_steel_blade", "Grave Steel Blade", "5 Umbral Iron Ore", 3],
          ["blacksteel_blade", "Blacksteel Blade", "6 Blacksteel Ore", 6],
        ]
          .map(
            (r) =>
              `<div class=shop-row><div><b>${r[1]}</b><div class=muted>${r[2]} • Blacksmithing ${r[3]}</div></div><button data-cmd=craft_blacksmith data-item-id="${r[0]}">Forge</button></div>`,
          )
          .join("")}</div>`
      : "";
  const html = `<div class=shop-layout><div class=shop-pane><div class=shop-pane-head><h3>${shop?.icon || "🛒"} ${escapeHtml(shop?.name || "Shop")}</h3><span>🪙 ${currentGold}</span></div>${buyRows}</div>${buybackPane}<div class=shop-pane><div class=shop-pane-head><h3>🎒 Your Bag</h3><span>${invItems.reduce((n, x) => n + x.qty, 0)} items</span></div><p class=muted>Sell individual items here. Equipped items must be unequipped first.</p>${sellRows}</div></div>`;
  $("shopList").innerHTML = html;
  openModal("shopModal");
}
function renderCharacterModalContents() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const p = state.player,
    items = state.catalog.items,
    slots = [
      ["weapon", "⚔️"],
      ["shield", "🛡️"],
      ["helmet", "⛑️"],
      ["chest", "🧥"],
      ["shoulders", "🪖"],
      ["gloves", "🧤"],
      ["boots", "🥾"],
      ["neck", "📿"],
      ["ring", "💍"],
      ["ring2", "💍"],
      ["relic", "🔮"],
      ["relic2", "🔮"],
    ];
  const nextSig = JSON.stringify({
    stats: p.stats,
    points: p.statPoints,
    equipment: p.equipment,
    bonuses: p.bonuses,
    attack: p.attack,
    spellPower: p.spellPower,
    maxHp: p.maxHp,
    armor: p.armor,
    maxResolve: p.maxResolve,
    name: p.name,
    level: p.level,
    band: state.progression?.bandName,
  });
  if (nextSig === characterModalSig) return;
  characterModalSig = nextSig;
  progressionSig = "";
  loadoutSig = "";
  $("characterStats").innerHTML =
    Object.entries<any>(p.stats || {})
      .map(
        ([k, v]) =>
          `<div class=stat-row><b>${escapeHtml(k)}</b><span>${Number(v) || 0}</span><button type=button data-cmd=allocate_stat data-stat="${escapeHtml(k)}" data-amount="1" ${(p.statPoints || 0) > 0 ? "" : "disabled"}>+</button></div>`,
      )
      .join("") +
    `<div class=muted>${p.statPoints || 0} stat point(s) available.</div>`;
  $("characterDerived").innerHTML =
    `<div>Attack: <b>${p.attack}</b></div><div>Spell Power: <b>${p.spellPower || p.attack}</b></div><div>Armor: <b>${p.armor}</b></div><div>HP: <b>${p.maxHp}</b></div><div>${p.resourceName}: <b>${p.maxResolve}</b></div><div>Gear Score: <b>${Number(p.bonuses?.gearScore || 0).toFixed(1)}</b></div><div>Avg Item Level: <b>${Number(p.bonuses?.averageItemLevel || 0).toFixed(1)}</b></div><div>Build Score: <b>${Number(p.bonuses?.gearBuildScore || 0).toFixed(1)}</b></div><div>Haste: <b>${p.bonuses?.haste || 0}%</b></div><div>Crit: <b>${p.bonuses?.crit || 0}%</b></div><div>Bleed: <b>+${p.bonuses?.bleedDamage || 0}% dmg / +${p.bonuses?.bleedDuration || 0}% duration</b></div><div>Stun: <b>+${p.bonuses?.stunDuration || 0}% duration / -${p.bonuses?.stunResist || 0}% received</b></div><div>HoT: <b>+${p.bonuses?.hotDuration || 0}% duration</b></div>`;
  $("characterGear").innerHTML = slots
    .map(([slot, icon]) => {
      const id = p.equipment?.[slot],
        it = id ? items[id] : null;
      const score = (p.bonuses?.gearItems || []).find(
        (x: any) => x.id === id,
      )?.gearScore;
      return `<div class="item gear-slot-row"><span class="gear-slot-icon">${icon}</span><div class="gear-item-main"><b>${escapeHtml(it?.name || "Empty")}</b><div class="muted">${escapeHtml(slot)}${score ? ` • Gear Score ${Number(score).toFixed(1)}` : ""}</div></div><span class="gear-state ${it ? "equipped" : "empty"}">${it ? "Equipped" : "Empty"}</span>${it ? `<button type="button" class="gear-unequip" data-cmd="unequip" data-slot="${escapeHtml(slot)}">Unequip</button>` : '<span class="gear-unequip-placeholder" aria-hidden="true"></span>'}</div>`;
    })
    .join("");
  $("characterNameBig").textContent = p.name;
  $("characterMetaBig").textContent =
    `${p.icon} ${p.role} • Level ${p.level} • ${state.progression?.bandName || "Initiate"}`;
  const ca = $("characterAvatar") as HTMLElement | null;
  if (ca) {
    ca.textContent = "";
    ca.style.backgroundImage = `url('/assets/ashenfall/classes/${CLASS_PORTRAITS[p.classId] || ""}')`;
    ca.style.backgroundSize = "contain";
    ca.style.backgroundPosition = "center top";
  }
  renderProgressionPanel();
  renderLoadouts();
}
function openCharacterModal() {
  characterModalSig = "";
  openModal("characterModal");
}
function conciseClassDescription(c: any) {
  return (
    CLASS_SHORT_DESCRIPTIONS[c?.id] ||
    String(c?.description || "Choose this class to begin your journey.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 92)
      .replace(/\s+\S*$/, "") + "…"
  );
}
function fillClasses() {
  const raw = state?.catalog?.classes || {};
  const values =
    raw && typeof raw === "object"
      ? Object.values<any>(raw).filter(
          (c) => c && typeof c === "object" && c.id && c.name,
        )
      : [];
  const classes = (values.length ? values : CLASS_FALLBACK).map((c: any) => ({
    ...c,
    portrait: CLASS_PORTRAITS[c.id],
    cardPortrait: CLASS_CARD_PORTRAITS[c.id],
  }));
  const catalogSig = JSON.stringify(
    classes.map((c: any) => [
      c.id,
      c.name,
      c.role,
      c.icon,
      c.resource,
      c.description,
      c.portrait,
      c.cardPortrait,
    ]),
  );
  if (catalogSig === classChoiceSig) {
    const current = selectedClassId || classes[0]?.id || "";
    if ((window as any).__ashenfallCreateUiState?.selected !== current) {
      (window as any).__ashenfallCreateUiState = {
        ...((window as any).__ashenfallCreateUiState || {}),
        selected: current,
      };
      (window as any).__ashenfallCreateUiRender?.();
    }
    return;
  }
  classChoiceSig = catalogSig;
  const current = selectedClassId || classes[0]?.id || "";
  if (!classes.some((c: any) => c.id === current))
    selectedClassId = classes[0]?.id || "";
  else selectedClassId = current;
  const selected = selectedClassId || classes[0]?.id || "";
  (window as any).__ashenfallCreateUiState = {
    ...((window as any).__ashenfallCreateUiState || {}),
    classes,
    selected,
    creating: !!(window as any).__createPending,
  };
  (window as any).__ashenfallCreateUiRender?.();
}
function updateClassPreview(selected: string) {
  const classes = (window as any).__ashenfallCreateUiState?.classes || [];
  const c = classes.find((x: any) => x.id === selected);
  if (c) {
    (window as any).__ashenfallCreateUiState = {
      ...((window as any).__ashenfallCreateUiState || {}),
      selected: c.id,
    };
    (window as any).__ashenfallCreateUiRender?.();
  }
}
function syncClassChoiceSelection(selected: string) {
  selectedClassId = selected;
  updateClassPreview(selected);
}
function renderWorldIntel() {
  if ((window as any).__ashenfallReactWorldIntelMounted) {
    (window as any).__ashenfallReactWorldIntelSync?.({
      zoneInfo: state?.zoneInfo || {},
      region: state?.region || {},
      worldFactions: state?.worldFactions || [],
      regionalEconomy: state?.regionalEconomy || {},
      worldIntegration: state?.worldIntegration || {},
      emergentWorldEvents: state?.emergentWorldEvents || {},
      chronicle: state?.chronicle || {},
      guildWorld: state?.guildWorld || null,
    });
    return;
  }
  const box = $("worldIntelBody");
  if (!box || !state) return;
  const regionId = String(state.zoneInfo?.id || state.player?.zone || "");
  const region = state.region || {};
  const factions = (state.worldFactions || []).slice(0, 6);
  const eco = state.regionalEconomy || {};
  const integration = state.worldIntegration || {};
  const emergent = (state.emergentWorldEvents?.active || []).slice(-6);
  const recent = (state.chronicle?.entries || []).slice(-5).reverse();
  const opportunities = (integration.opportunities || []).slice(-8).reverse();
  const knowledge = (integration.knowledge || []).slice(-8).reverse();
  const guild = state.guildWorld;
  const risk = Number(state.zoneInfo?.danger || 0);
  const pct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
  const bar = (label, value, cls = "") =>
    `<div class="intel-meter"><div><span>${escapeHtml(label)}</span><b>${pct(value)}</b></div><i class="${cls}" style="width:${pct(value)}%"></i></div>`;
  const factionRows =
    factions
      .map(
        (f) =>
          `<div class="intel-row"><div><b>${escapeHtml(f.name || f.id)}</b><small>Influence ${pct(f.influence)} • Pressure ${pct(f.pressure)}</small></div><span>${f.activeOperations?.length ? `⚔ ${f.activeOperations.length} operation${f.activeOperations.length === 1 ? "" : "s"}` : "Quiet"}</span></div>`,
      )
      .join("") ||
    '<div class="muted">No faction data is available for this region.</div>';
  const marketKeys = Object.keys(eco.prices || {}).slice(0, 6);
  const marketRows =
    marketKeys
      .map(
        (k) =>
          `<div class="intel-row"><div><b>${escapeHtml(k.replace(/_/g, " "))}</b><small>Supply ${Math.round(Number(eco.supply?.[k] || 0))} • Demand ${Math.round(Number(eco.demand?.[k] || 0))}</small></div><strong>${Number(eco.prices?.[k] || 0).toFixed(2)}g</strong></div>`,
      )
      .join("") || '<div class="muted">No regional market data.</div>';
  const eventRows =
    emergent
      .map(
        (e) =>
          `<div class="intel-event"><b>${escapeHtml(e.title || e.kind || "World Event")}</b><p>${escapeHtml(e.description || "A situation is developing in the region.")}</p><small>${escapeHtml(e.severity || "regional")} • cause ${escapeHtml((e.causes || []).length ? `${e.causes.length} recorded signals` : "simulation state")}</small></div>`,
      )
      .join("") || '<div class="muted">No emergent situation is active.</div>';
  const contracts = (integration.contracts || []).slice(-3).reverse();
  const contractRows =
    contracts
      .map((c) => {
        const step = Math.max(0, Number(c.objectiveIndex || 0)),
          steps = Array.isArray(c.objectives) ? c.objectives : [];
        const objective =
          steps[step] || c.label || "Respond to the changing world.";
        const target = c.targetName ? ` • ${escapeHtml(c.targetName)}` : "";
        const actionLabel =
          step >= Math.max(0, steps.length - 1) ? "Resolve" : "Continue";
        return `<div class="intel-event contract"><div><b>${escapeHtml(c.title || "World contract")}</b><p>${escapeHtml(objective)}</p><small>${escapeHtml(c.kind || "contract")}${target} • Step ${Math.min(step + 1, Math.max(1, steps.length))}/${Math.max(1, steps.length)} • expires in ${Math.max(0, Math.ceil((Number(c.expiresTick || 0) - Number(integration.lastTick || 0)) / 20))}s</small></div><button class="primary compact" data-action="world-contract-action" data-contract-id="${escapeHtml(c.id)}">${actionLabel}</button></div>`;
      })
      .join("") || '<div class="muted">No active world contracts.</div>';
  const allPlayerContracts =
    integration.contractHistory || integration.contracts || [];
  const opportunityRows =
    opportunities
      .map((o) => {
        const related = allPlayerContracts.find(
          (c: any) => c.opportunityId === o.id,
        );
        const badge =
          related?.status === "active"
            ? '<span class="intel-badge">ACTIVE</span>'
            : related?.status === "completed"
              ? '<span class="intel-badge success">COMPLETED</span>'
              : related?.status === "failed"
                ? '<span class="intel-badge danger">FAILED</span>'
                : null;
        return `<div class="intel-event opportunity"><div><b>${escapeHtml(o.title || "World opportunity")}</b><p>${escapeHtml(o.description || "The world has changed here.")}</p><small>${escapeHtml(o.kind || "opportunity")} • ${escapeHtml(o.severity || "local")}</small></div>${badge || `<button class="primary compact" data-action="world-opportunity-accept" data-opportunity-id="${escapeHtml(o.id)}">Accept</button>`}</div>`;
      })
      .join("") ||
    '<div class="muted">Nothing is currently calling for your attention.</div>';
  const historyRows =
    recent
      .map(
        (e) =>
          `<div class="intel-row"><div><b>${escapeHtml(e.title || "Recorded event")}</b><small>${escapeHtml(e.summary || "")}</small></div><span>${Number(e.significance || 0)} significance</span></div>`,
      )
      .join("") ||
    '<div class="muted">The Chronicle has no recent entries for you.</div>';
  const species = state.worldIntegration?.ecology?.species || [];
  const ex = region.exploration || {};
  box.innerHTML = `<div class="intel-hero"><div><div class="eyebrow">CURRENT REGION</div><h2>${escapeHtml(state.zoneInfo?.name || region.name || regionId)}</h2><p>${escapeHtml(state.zoneInfo?.description || "The region is part of the living world simulation.")}</p></div><div class="intel-status"><b>${risk >= 70 ? "⚠ HIGH RISK" : risk >= 40 ? "◈ UNSTABLE" : "✓ STABLE"}</b><span>Danger ${risk}</span><span>${Number(ex.discoveredCount || 0)}/${Number(ex.totalDiscoveries || 0)} discoveries</span></div></div><div class="intel-grid"><section class="intel-card"><div class="section-head"><h3>⚠️ Situation</h3><span class="muted">live simulation</span></div>${bar("Regional danger", risk)}${bar("Economic scarcity", eco.scarcity || 0)}${bar("Guild influence", guild?.influence || 0)}<div class="intel-facts"><span>🧭 Condition: <b>${escapeHtml(String(region.runtime?.condition || "normal").replace(/-/g, " "))}</b></span><span>🌿 Active ecology signals: <b>${species.length}</b></span><span>🚚 Caravans nearby: <b>${(eco.caravans || []).filter((c) => c.state === "traveling").length}</b></span></div></section><section class="intel-card"><div class="section-head"><h3>🏴 Factions</h3><span class="muted">regional influence</span></div>${factionRows}</section><section class="intel-card"><div class="section-head"><h3>🔥 Emerging situations</h3><span class="muted">derived from world state</span></div>${eventRows}</section><section class="intel-card"><div class="section-head"><h3>🧭 Opportunities</h3><span class="muted">things you can act on</span></div>${opportunityRows}</section><section class="intel-card"><div class="section-head"><h3>📜 Active contracts</h3><span class="muted">your commitments</span></div>${contractRows}</section><section class="intel-card"><div class="section-head"><h3>⚖️ Regional market</h3><span class="muted">current prices</span></div>${marketRows}</section><section class="intel-card"><div class="section-head"><h3>📜 Recent history</h3><span class="muted">Chronicle</span></div>${historyRows}</section></div><div class="intel-footer"><div><b>What you know</b><span>${knowledge.length ? knowledge.map((x) => `<em>${escapeHtml(String(x).replace(/_/g, " "))}</em>`).join(" ") : "No regional knowledge recorded yet."}</span></div><button type="button" data-action="open-world-map">Open World Map</button></div>`;
}
function openWorldIntel() {
  renderWorldIntel();
  openModal("worldIntelModal");
}

function syncReactWorldMap() {
  const zones = (state?.zones || [])
    .filter((z: any) => z && z.id && !String(z.id).startsWith("arena_"))
    .map((z: any) => ({ id: String(z.id), name: String(z.name || z.id) }));
  (window as any).__ashenfallReactWorldMapSync?.({
    mode: worldMapMode,
    zone: worldMapZone || "",
    zones,
  });
}
function redrawWorldMapAfterReact() {
  requestAnimationFrame(() => {
    try {
      drawWorldMap();
    } catch (error) {
      console.error("Ashenfall world-map redraw failed", error);
    }
  });
}
function openWorldMap() {
  worldMapOpen = true;
  lastWorldMapDraw = performance.now();
  worldMapMode = "zone";
  worldMapZone = state?.zoneInfo?.id || state?.player?.zone || null;
  openModal("worldMapModal");
  syncReactWorldMap();
  redrawWorldMapAfterReact();
}
function loadSettingsUi() {
  if (reactUtilityMounted()) {
    syncReactUtilityState({ settings: { ...uiSettings } });
    return;
  }
  const max = $("settingMaxPlayers");
  if (!max) return;
  max.value = uiSettings.maxPlayers;
  $("settingMaxPlayersValue").textContent = uiSettings.maxPlayers;
  $("settingShowNames").checked = uiSettings.showNames;
  $("settingShowMobs").checked = uiSettings.showMobs;
  $("settingShowTerrain").checked = uiSettings.showTerrain;
  $("settingReduceMotion").checked = uiSettings.reduceMotion;
}
function saveSettings() {
  settingsController.save();
}
function renderTrade() {
  if (reactWindowsMounted()) {
    refreshReactWindows();
    return;
  }
  const trade = state.trade;
  if (!trade?.session) {
    tradeRenderSig = JSON.stringify(trade || null);
    if (trade?.pending) {
      $("tradeBody").innerHTML =
        `<div class="party-invite"><b>${escapeHtml(trade.pending.fromName)}</b> wants to trade with you.<div class="trade-actions"><button data-cmd="trade_decline">Decline</button><button class="primary" data-cmd="trade_accept" data-from-id="${trade.pending.fromId}">Accept Trade</button></div></div>`;
      openModal("tradeModal");
    } else $("tradeModal").classList.add("hidden");
    return;
  }
  const t = trade.session;
  const sig = JSON.stringify({
    session: t,
    inventory: state.player.inventory,
    gold: state.player.gold,
  });
  if (sig === tradeRenderSig) {
    if ($("tradeModal").classList.contains("hidden")) openModal("tradeModal");
    return;
  }
  tradeRenderSig = sig;
  const myItems = (state.player.inventory || [])
    .filter((x) => x.qty > 0)
    .map((x) => {
      const it = state.catalog.items[x.itemId] || {};
      const blocked = it.soulbound || it.tradeable === false;
      return `<button class="trade-item" data-cmd="trade_offer" data-item-id="${x.itemId}" data-qty="1" title="${blocked ? "This item cannot be traded." : "Offer one " + escapeHtml(it.name || x.itemId)}" ${blocked ? "disabled" : ""}>${it.icon || "📦"}<small>${x.qty}</small></button>`;
    })
    .join("");
  const fmt = (o) =>
    `${o.gold ? `🪙 ${o.gold}` : ""}${o.items?.length ? "<br>" + o.items.map((x) => `${state.catalog.items[x.itemId]?.icon || "📦"} ×${x.qty}`).join(" ") : ""}`;
  $("tradeBody").innerHTML =
    `<div class="trade-grid"><div class="trade-side"><h3>You</h3><div>Gold offered: <b>${t.my.gold}</b></div><div class="trade-items">${myItems || '<span class="muted">No tradeable items</span>'}</div><div class="trade-offer">Your offer:<br>${fmt(t.my) || "Nothing"}</div><label>Gold <input id="tradeGold" type="number" min="0" max="${state.player.gold}" value="${t.my.gold}"></label><button data-action="trade-set-gold">Set Gold</button></div><div class="trade-side"><h3>${escapeHtml(t.other?.name || "Player")}</h3><div>Gold offered: <b>${t.their.gold}</b></div><div class="trade-offer">Their offer:<br>${fmt(t.their) || "Nothing"}</div><div class="muted">${t.theirLocked ? "🔒 Offer locked" : "Offer open"} • ${t.theirConfirmed ? "✓ Confirmed" : "Waiting for confirmation"}</div></div></div><div class="trade-actions"><button data-cmd="trade_cancel">Cancel</button><button data-cmd="trade_unlock" ${t.myLocked ? "" : "disabled"}>${t.myLocked ? "Unlock Offer" : "Unlocked"}</button><button data-cmd="trade_lock" ${t.myLocked ? "disabled" : ""}>${t.myLocked ? "🔒 Locked" : "Lock Offer"}</button><button class="primary" data-cmd="trade_confirm" ${!t.myLocked || !t.theirLocked || t.myConfirmed ? "disabled" : ""}>${t.myConfirmed ? "Confirmed" : "Confirm Trade"}</button></div>`;
  openModal("tradeModal");
}
function openContextMenu(x, y, targetId) {
  contextTargetId = targetId;
  const pl = state.nearby.find((v) => v.id === targetId);
  if (!pl) return;
  const menu = $("contextMenu");
  if (!menu) return;
  menu.style.left = Math.min(x, innerWidth - 200) + "px";
  menu.style.top = Math.min(y, innerHeight - 250) + "px";
  menu.classList.remove("hidden");
  (window as any).__ashenfallReactContextMenuSync?.({
    open: true,
    targetId,
    name: pl.name,
    level: pl.level,
  });
}
function closeContextMenu() {
  contextTargetId = null;
  (window as any).__ashenfallReactContextMenuSync?.({ open: false });
  $("contextMenu")?.classList.add("hidden");
}
function handleContextMenuAction(action: string, id: string) {
  closeContextMenu();
  if (action === "target") return send("select_player", { targetId: id });
  if (action === "inspect") return send("inspect_player", { targetId: id });
  if (action === "friend") return send("friend_add", { targetId: id });
  if (action === "whisper") {
    selectedPlayerId = id;
    ($("mapChatInput") || $("chatInput"))?.focus();
    return toast("Type your whisper.", true);
  }
  if (action === "trade") return send("trade_request", { targetId: id });
  if (action === "party") return send("party_invite", { targetId: id });
  if (action === "pvp") return send("pvp_invite", { targetId: id });
  if (action === "pvp-open") return send("pvp_open_attack", { targetId: id });
}
function canvasPoint(e) {
  const c = $("worldCanvas"),
    r = c.getBoundingClientRect(),
    { w, h } = worldRenderer.canvasLogicalSize();
  return {
    x: ((e.clientX - r.left) / r.width) * w,
    y: ((e.clientY - r.top) / r.height) * h,
  };
}
function worldCanvasWidth() {
  return Number(($("worldCanvas") as HTMLCanvasElement)?.width || 1200);
}
function hitTest(e) {
  if (!state) return null;
  const q = canvasPoint(e),
    p = state.player;
  let best = null,
    bestD = Infinity;
  const test = (kind, id, x, y, r) => {
    const sp = worldToScreen(x, y),
      d = Math.hypot(sp.x - q.x, sp.y - q.y);
    if (d < r && d < bestD) {
      best = { kind, id, x, y };
      bestD = d;
    }
  };
  for (const x of state.nearby || []) {
    const r = worldRenderer.isSpriteClass(x.classId) ? 34 : 26;
    test("player", x.id, x.x, x.y, r);
  }
  for (const l of state.loot || []) test("loot", l.id, l.x, l.y, 34);
  const worldQ = screenToWorld(q.x, q.y),
    vf = worldRenderer.visibleFrac?.() || 0.25;
  const mobRadius = Math.max(
    0.0015,
    (Number(vf) / Math.max(300, worldCanvasWidth() || 1200)) * 30,
  );
  const source = state.mobs || [];
  if (mobHitGridSource !== source) {
    mobHitGridSource = source;
    mobHitGrid = new Map();
    for (const m of source) {
      if (m.state === "dead") continue;
      const mp = motionPosition(`m:${m.id}`, m.x, m.y, "remote");
      const cell = `${Math.floor(Number(mp.x) / mobHitCell)}:${Math.floor(Number(mp.y) / mobHitCell)}`;
      const list = mobHitGrid.get(cell) || [];
      list.push(m);
      mobHitGrid.set(cell, list);
    }
  }
  const cr = Math.max(1, Math.ceil(mobRadius / mobHitCell) + 1),
    cx = Math.floor(worldQ.x / mobHitCell),
    cy = Math.floor(worldQ.y / mobHitCell);
  const candidates: any[] = [];
  for (let ox = -cr; ox <= cr; ox++)
    for (let oy = -cr; oy <= cr; oy++) {
      const list = mobHitGrid.get(`${cx + ox}:${cy + oy}`);
      if (list) candidates.push(...list);
    }
  for (const m of candidates) {
    const mp = motionPosition(`m:${m.id}`, m.x, m.y, "remote");
    const d = Math.hypot(Number(mp.x) - worldQ.x, Number(mp.y) - worldQ.y);
    if (
      d < mobRadius &&
      d < bestD / Math.max(300, worldCanvasWidth() || 1200)
    ) {
      best = { kind: "mob", id: m.id, x: Number(mp.x), y: Number(mp.y) };
      bestD = d * Math.max(300, worldCanvasWidth() || 1200);
    }
  }
  for (const n of state.npcs || []) test("npc", n.id, n.x, n.y, 30);
  for (const g of state.gates || []) test("gate", g.id, g.x, g.y, 30);
  for (const o of state.ores || []) test("ore", o.id, o.x, o.y, 26);
  return best;
}
function nearestMob() {
  if (!state?.player) return null;
  const max = 250 / zoneWorldMeters();
  const local = motionController.state;
  return (
    (state.mobs || [])
      .filter((m) => m.state !== "dead")
      .map((m) => {
        const mp = motionPosition(`m:${m.id}`, m.x, m.y, "remote");
        return {
          m,
          d: Math.hypot(
            Number(mp.x) - Number(local.x),
            Number(mp.y) - Number(local.y),
          ),
        };
      })
      .filter((x) => x.d <= max)
      .sort((a, b) => a.d - b.d)[0]?.m || null
  );
}
function localApproachPoint(tx: number, ty: number, stopMeters: number) {
  const p = state?.player;
  const lm = motionController.state;
  if (!p) return { x: tx, y: ty };
  const px = Number.isFinite(lm?.x) ? lm.x : Number(p.x),
    py = Number.isFinite(lm?.y) ? lm.y : Number(p.y);
  const dx = px - tx,
    dy = py - ty,
    d = Math.hypot(dx, dy);
  const stop = Math.max(
    0.001,
    Number(stopMeters || 0) / Math.max(1, zoneWorldMeters()),
  );
  if (d <= stop || d < 0.0001) return { x: px, y: py };
  return {
    x: Math.max(0.01, Math.min(0.99, tx + (dx / d) * stop)),
    y: Math.max(0.01, Math.min(0.99, ty + (dy / d) * stop)),
  };
}
function handleCanvasClick(e) {
  if (!state?.player?.hasCharacter) return;
  const q = canvasPoint(e),
    hit = hitTest(e);
  if (hit) {
    if (hit.kind === "player")
      return send("select_player", { targetId: hit.id });
    if (hit.kind === "mob") {
      const mob = (state.mobs || []).find(
        (m: any) => String(m.id) === String(hit.id),
      );
      if (mob) {
        state.player.targetMobId = mob.id;
        state.targetMob = { ...mob };
        targetRenderSig = "";
        renderTarget();
      }
      if (keys.size === 0) {
        const basicRangeMeters = Number(
          state?.catalog?.classes?.[state.player.classId]?.basicAttackRange ||
            ([
              "ranger",
              "arcanist",
              "warden",
              "occultist",
              "hierophant",
            ].includes(String(state.player.classId))
              ? 72
              : 18),
        );
        const target = localApproachPoint(hit.x, hit.y, basicRangeMeters);
        beginLocalMoveTarget(target.x, target.y, "run", "combat");
      }
      return send("target_mob", { mobId: hit.id });
    }
    if (hit.kind === "npc") {
      const target = localApproachPoint(hit.x, hit.y, 5);
      beginLocalMoveTarget(target.x, target.y, "run");
      return send("interact_npc", { npcId: hit.id });
    }
    if (hit.kind === "gate") {
      const target = localApproachPoint(hit.x, hit.y, 12);
      beginLocalMoveTarget(target.x, target.y, "run");
      return send("use_gate", { gateId: hit.id });
    }
    if (hit.kind === "ore") {
      const target = localApproachPoint(hit.x, hit.y, 8);
      beginLocalMoveTarget(target.x, target.y, "run");
      return send("mine_ore", { oreId: hit.id });
    }
    if (hit.kind === "loot") {
      const target = localApproachPoint(hit.x, hit.y, 10);
      beginLocalMoveTarget(target.x, target.y, "run");
      return send("pickup_loot", { pileId: hit.id });
    }
  }
  const target = screenToWorld(q.x, q.y);
  const mode = e.shiftKey ? "run" : state.player.movementMode;
  beginLocalMoveTarget(target.x, target.y, mode);
  pendingMoveIntent = { x: target.x, y: target.y, mode };
  const flushMove = () => {
    pendingMoveTimer = null;
    const intent = pendingMoveIntent;
    if (!intent) return;
    pendingMoveIntent = null;
    lastMoveSentAt = performance.now();
    send("move", intent);
  };
  const wait =
    lastMoveSentAt === 0
      ? 0
      : Math.max(0, 45 - (performance.now() - lastMoveSentAt));
  if (pendingMoveTimer) clearTimeout(pendingMoveTimer);
  pendingMoveTimer = setTimeout(flushMove, wait);
}
const pendingCommandButtons = new Map<string, Set<HTMLElement>>();
function isCommandPending(action: string): boolean {
  return pendingCommandButtons.has(action);
}
function markCommandButton(button: HTMLElement, action: string): void {
  if (!action) return;
  const set = pendingCommandButtons.get(action) || new Set<HTMLElement>();
  set.add(button);
  pendingCommandButtons.set(action, set);
  button.dataset.commandPrevDisabled = button.disabled ? "1" : "0";
  button.dataset.commandPending = "1";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
}
function clearCommandButtons(action: string): void {
  const set = pendingCommandButtons.get(action);
  if (set) {
    for (const button of set) {
      button.dataset.commandPending = "";
      button.removeAttribute("data-command-pending");
      button.removeAttribute("aria-busy");
      if (button.dataset.commandPrevDisabled !== "1") button.disabled = false;
      delete button.dataset.commandPrevDisabled;
    }
    pendingCommandButtons.delete(action);
  }
}
function bind() {
  document.addEventListener(
    "click",
    (e: any) => {
      const close = (e.target as HTMLElement | null)?.closest?.(
        "[data-action=close-modal]",
      ) as HTMLElement | null;
      if (!close) return;
      const id = close.dataset.modal;
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      closeModal(id);
    },
    true,
  );
  document.addEventListener("click", (e) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const b = e.target.closest("button,[data-action]");
    if (!b) return;
    const action = b.dataset.action,
      cmd = b.dataset.cmd;
    if (cmd && b.dataset.commandPending === "1") {
      e.preventDefault();
      return;
    }
    if (cmd && cmd !== "cast_ability") markCommandButton(b, cmd);
    if (b.closest?.("#bottomMenu"))
      requestAnimationFrame(() => {
        try {
          b.blur();
        } catch {}
      });
    if (e.altKey && b.matches(".skill[data-hotbar-slot]")) {
      e.preventDefault();
      e.stopPropagation();
      clearHotbarSlot(Number(b.dataset.hotbarSlot));
      return;
    }
    if (action === "select-class") {
      const id = b.dataset.classId;
      if (!id) return;
      selectedClassId = id;
      classSelectionDirty = true;
      syncClassChoiceSelection(id);
      buildSig = "";
      return;
    }
    if (action === "create-character") {
      const name = $("charname").value.trim();
      if (!name) return toast("Choose a character name.", false);
      if (window.__createPending) return;
      window.__createPending = true;
      (window as any).__ashenfallCreateUiState = {
        ...((window as any).__ashenfallCreateUiState || {}),
        creating: true,
      };
      (window as any).__ashenfallCreateUiRender?.();
      const request = send("create_character", {
        name,
        classId: selectedClassId || $("classid").value,
      });
      if (!request) {
        toast(
          "The server connection is still opening. Your character request is queued and will be sent automatically.",
          true,
        );
      }
      return request;
    }
    if (action === "save-loadout") {
      const slot = b.dataset.slot || "leveling";
      const current = (state.progression?.loadouts || []).find(
        (x: any) => x.slot === slot,
      );
      const name = prompt(
        "Loadout name:",
        current?.name ||
          (
            {
              leveling: "Leveling",
              dungeon: "Dungeon",
              boss: "Boss",
              pvp: "PvP",
            } as any
          )[slot] ||
          slot,
      );
      if (name === null) return;
      return send("save_loadout", { slot, name: name.trim() || slot });
    }
    if (action === "apply-loadout") {
      return send("apply_loadout", { loadoutId: b.dataset.loadoutId });
    }
    if (action === "delete-loadout") {
      if (!confirm("Delete this loadout?")) return;
      return send("delete_loadout", {
        loadoutId: b.dataset.loadoutId,
        slot: b.dataset.slot,
      });
    }
    if (action === "open-quests") {
      openQuestJournal();
      return;
    }
    if (action === "open-bag") {
      openModal("bagModal");
      return;
    }
    if (action === "open-story") {
      send("open_story");
      return;
    }
    if (action === "open-skills") {
      renderSkills();
      return;
    }
    if (action === "open-build") {
      buildSig = "";
      renderBuild();
      openModal("buildModal");
      return;
    }
    if (action === "open-character") {
      openCharacterModal();
      return;
    }
    if (action === "open-trainer") {
      renderTrainer();
      if (!$("trainerModal")) {
        (window as any).__ashenfallReactUi = {
          ...(window as any).__ashenfallReactUi,
          openNpcId,
        };
        window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
        openModal("trainerModal");
      }
      return;
    }
    if (action === "open-shop") {
      openShop();
      return;
    }
    if (action === "open-mail") {
      openMail();
      return;
    }
    if (action === "open-auction") {
      openAuctionHouse();
      return;
    }
    if (action === "open-party") {
      renderParty();
      openModal("partyModal");
      return;
    }
    if (action === "open-social") {
      (window as any).__ashenfallReactUi = {
        ...(window as any).__ashenfallReactUi,
        socialTab,
        socialSearchResults,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      openModal("socialModal");
      return;
    }
    if (action === "open-dungeon-match") {
      renderDungeonMatch();
      return;
    }
    if (action === "social-tab") {
      socialTab = b.dataset.socialTab || "friends";
      socialRenderSig = "";
      (window as any).__ashenfallReactUi = {
        ...(window as any).__ashenfallReactUi,
        socialTab,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      return;
    }
    if (action === "social-search") {
      const input = $(b.dataset.input || "socialSearchInput");
      return send("social_search", {
        query: String(input?.value || "").trim(),
      });
    }
    if (action === "social-whisper-send") {
      if (!socialWhisperTargetId) return toast("Choose a player first.", false);
      const input = $("socialWhisperInput");
      const text = String(input?.value || "").trim();
      if (!text) return;
      return send("whisper", { targetId: socialWhisperTargetId, text });
    }
    if (action === "guild-chat-send") {
      const input = $("guildChatInput");
      const text = String(input?.value || "").trim();
      if (!text) return;
      return send("guild_chat", { text });
    }
    if (action === "guild-save-description") {
      return send("guild_set_description", {
        text: String($("guildDescriptionInput")?.value || ""),
      });
    }
    if (action === "guild-save-motd") {
      return send("guild_set_motd", {
        text: String($("guildMotdInput")?.value || ""),
      });
    }
    if (action === "open-pvp") {
      renderPvp();
      openModal("pvpModal");
      return;
    }
    if (action === "open-dungeon") {
      renderDungeon();
      openModal("dungeonModal");
      return;
    }
    if (action === "open-world-map") {
      openWorldMap();
      return;
    }
    if (action === "open-world-intel") {
      openWorldIntel();
      return;
    }
    if (action === "world-opportunity-accept") {
      markCommandButton(b, action);
      return send("world_opportunity_accept", {
        opportunityId: b.dataset.opportunityId,
      });
    }
    if (action === "world-contract-action") {
      const cid = b.dataset.contractId;
      const c = (state.worldIntegration?.contracts || []).find(
        (x: any) => String(x.id) === String(cid),
      );
      if (
        c &&
        Number(c.objectiveIndex || 0) >=
          Number((c.objectives || []).length || 3) - 1
      ) {
        const ok = confirm(
          c.kind === "trade_contract"
            ? "Protect the caravan?\n\nOK = protect it\nCancel = withdraw"
            : "Resolve the situation?\n\nOK = resolve it\nCancel = withdraw",
        );
        return send("world_opportunity_action", {
          contractId: cid,
          outcome: ok ? "success" : "failure",
        });
      }
      return send("world_opportunity_action", { contractId: cid });
    }
    if (action === "open-settings") {
      loadSettingsUi();
      openModal("settingsModal");
      return;
    }
    if (action === "guild-create") {
      const name = String($("guildNameInput")?.value || "").trim();
      if (name.length < 3)
        return toast("Guild name must be at least 3 characters.", false);
      if (Number(state.player.gold || 0) < 1000)
        return toast("You need 1,000 gold to create a guild.", false);
      return send("guild_create", { name });
    }
    if (action === "guild-disband") {
      if (
        !confirm("Disband the guild permanently? All members will be removed.")
      )
        return;
      return send("guild_disband");
    }
    if (action === "player-guild-invite")
      return send("guild_invite", { targetId: b.dataset.playerId });
    if (action === "toggle-quest-route") {
      questRouteVisible = !questRouteVisible;
      localStorage.setItem(
        "ashenfall.questRouteVisible",
        questRouteVisible ? "1" : "0",
      );
      questHelperSig = "";
      uiDirty = true;
      renderQuestHelper();
      return;
    }
    if (action === "open-professions") {
      renderProfessions();
      openModal("professionModal");
      return;
    }
    if (action === "open-hearth") {
      return send("use_hearthstone");
    }
    if (action === "close-modal") {
      closeModal(b.dataset.modal || "");
      return;
    }
    if (action === "toggle-run") {
      return send("toggle_run");
    }
    if (action === "rest") return send("rest");
    if (action === "toggle-auto") {
      const enabled = !state.player.combat.autoAttack;
      if (enabled && !keys.size) {
        const p = state.player;
        const mob = (state.mobs || []).find(
          (m: any) => String(m.id) === String(p.targetMobId),
        );
        if (mob && mob.state !== "dead") {
          const mp = motionPosition(
            `m:${mob.id}`,
            Number(mob.x),
            Number(mob.y),
            "remote",
          );
          const range = Math.max(
            1,
            Number(
              state.catalog?.classes?.[p.classId]?.basicAttackRange ||
                ([
                  "ranger",
                  "arcanist",
                  "warden",
                  "occultist",
                  "hierophant",
                ].includes(String(p.classId))
                  ? 72
                  : 18),
            ),
          );
          const dist =
            Math.hypot(
              Number(mp.x) - Number(motionController.state.x),
              Number(mp.y) - Number(motionController.state.y),
            ) * zoneWorldMeters();
          if (dist > range) {
            const ap = localApproachPoint(Number(mp.x), Number(mp.y), range);
            beginLocalMoveTarget(ap.x, ap.y, "run", "combat");
          }
        }
      }
      return send("toggle_auto", { enabled });
    }
    if (action === "clear-log") {
      state.player.worldCombatLog = [];
      renderLog();
      return;
    }
    if (action === "party-target") {
      return send("party_target", { targetId: b.dataset.playerId });
    }
    if (action === "player-target")
      return send("select_player", { targetId: b.dataset.playerId });
    if (action === "player-inspect")
      return send("inspect_player", { targetId: b.dataset.playerId });
    if (action === "player-whisper") {
      chatWhisperTargetId = b.dataset.playerId;
      selectedPlayerId = b.dataset.playerId;
      setChatChannel("whisper", b.dataset.playerId);
      return;
    }
    if (action === "whisper-reply") {
      if (b.dataset.playerId) {
        chatWhisperTargetId = b.dataset.playerId;
        selectedPlayerId = b.dataset.playerId;
        setChatChannel("whisper", b.dataset.playerId);
      }
      return;
    }
    if (action === "player-invite")
      return send("party_invite", { targetId: b.dataset.playerId });
    if (action === "quest-tab") {
      questJournalTab = b.dataset.tab || "current";
      selectedQuest = null;
      if (questJournalTab !== "story") selectedStoryArcId = null;
      questSig = "";
      (window as any).__ashenfallReactUi = {
        questJournalTab,
        selectedQuest,
        selectedStoryArcId,
        selectedSkill,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      return;
    }
    if (action === "story-arc") {
      questJournalTab = "story";
      selectedQuest = null;
      selectedStoryArcId = b.dataset.storyArcId || null;
      questSig = "";
      (window as any).__ashenfallReactUi = {
        questJournalTab,
        selectedQuest,
        selectedStoryArcId,
        selectedSkill,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      return;
    }
    if (action === "select-quest") {
      selectedQuest = b.dataset.questId;
      questSig = "";
      (window as any).__ashenfallReactUi = {
        questJournalTab,
        selectedQuest,
        selectedStoryArcId,
        selectedSkill,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      return;
    }
    if (action === "set-active-quest") {
      const id = String(b.dataset.questId || "");
      if (!id) return;
      return send("set_active_quest", { questId: id });
    }
    if (action === "select-skill") {
      selectedSkill = b.dataset.skillId;
      (window as any).__ashenfallReactUi = {
        questJournalTab,
        selectedQuest,
        selectedStoryArcId,
        selectedSkill,
      };
      window.dispatchEvent(new Event("ashenfall-react-ui-refresh"));
      return;
    }
    if (action === "npc-shop") {
      selectedShopId = b.dataset.shopId;
      openShop(selectedShopId);
      return;
    }
    if (action === "npc-craft") {
      selectedShopId = b.dataset.shopId;
      openForge(selectedShopId);
      return;
    }
    if (action === "npc-auction") {
      openAuctionHouse();
      return;
    }
    if (action === "auction-search") {
      window.__auctionQuery = $("auctionSearch")?.value?.trim() || "";
      window.__auctionRarity = $("auctionRarity")?.value || "";
      window.__auctionMinLevel = $("auctionMinLevel")?.value || "";
      window.__auctionSort = $("auctionSort")?.value || "newest";
      window.__auctionTab = "Market";
      auctionStats = null;
      auctionRenderSig = "";
      syncAuctionReactUi();
      return send("auction_search", {
        filters: {
          query: window.__auctionQuery,
          rarity: window.__auctionRarity,
          minLevel: Number(window.__auctionMinLevel || 0),
          sort: $("auctionSort")?.value || "newest",
          page: 1,
          pageSize: 20,
        },
      });
    }
    if (action === "auction-history") {
      return send("market_stats", { itemId: b.dataset.itemId, days: 7 });
    }
    if (action === "auction-sales-refresh") {
      syncAuctionReactUi();
      return send("auction_seller_history", { days: 30 });
    }
    if (action === "auction-category") {
      window.__auctionCategory = b.dataset.category || "All";
      auctionRenderSig = "";
      syncAuctionReactUi();
      openAuctionHouse();
      return;
    }
    if (action === "auction-tab") {
      window.__auctionTab = b.dataset.tab || "Market";
      auctionRenderSig = "";
      syncAuctionReactUi();
      if (window.__auctionTab === "Sales History" && !auctionSellerHistory)
        return send("auction_seller_history", { days: 30 });
      openAuctionHouse();
      return;
    }
    if (cmd === "trade_cancel") {
      closeModal("tradeModal");
      return send("trade_cancel");
    }
    if (action === "trade-set-gold") {
      const gold = Number($("tradeGold")?.value || 0);
      return send("trade_offer", { gold });
    }
    if (action === "auction-submit") {
      const itemId = $("auctionItem")?.value;
      const qty = Math.max(1, Number($("auctionQty")?.value || 1));
      const price = Number($("auctionPrice")?.value || 0);
      const buyout = Number($("auctionBuyout")?.value || 0) || null;
      if (!itemId || price < 1)
        return toast("Choose an item and a valid starting bid.", false);
      if (buyout != null && buyout < price)
        return toast("Buyout must be at least the starting bid.", false);
      return send("auction_list", { itemId, qty, price, buyout });
    }
    if (b.dataset.hotbarKind === "item") {
      return send(
        b.dataset.itemId === "ashen_homeward_stone"
          ? "use_hearthstone"
          : "use_item",
        { itemId: b.dataset.itemId },
      );
    }
    if (cmd) {
      const d: Record<string, string> = {};
      for (const k of Object.keys(b.dataset)) {
        if (k === "cmd") continue;
        const camel = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        d[camel] = b.dataset[k];
      }
      if (cmd === "dungeon_queue" || cmd === "dungeon_queue_party") {
        if (d.dungeonId === "random") {
          d.dungeonId = String($("dungeonSelect")?.value || "random");
        }
        return send(cmd, d);
      }
      if (cmd === "hotbar_item") {
        return send(
          d.itemId === "ashen_homeward_stone" ? "use_hearthstone" : "use_item",
          { itemId: d.itemId },
        );
      }
      if (cmd === "mail_read") return send("mail_read", { mailId: d.mailId });
      if (cmd === "mail_unread")
        return send("mail_unread", { mailId: d.mailId });
      if (cmd === "claim_mail") return send("claim_mail", { mailId: d.mailId });
      if (cmd === "claim_all_mail") return send("claim_all_mail");
      if (cmd === "delete_mail")
        return send("delete_mail", { mailId: d.mailId });
      if (cmd === "social_search") {
        const input = $(b.dataset.queryInput || "socialSearchInput");
        return send("social_search", {
          query: String(input?.value || "").trim(),
        });
      }
      if (cmd === "guild_accept") {
        return send("guild_accept", { guildId: d.guildId });
      }
      if (cmd === "guild_decline") {
        return send("guild_decline");
      }
      if (cmd === "party_decline") {
        return send("party_decline", { partyId: d.partyId });
      }
      if (cmd === "cast_ability") {
        if (state.encounter)
          return send("cast_ability", { abilityId: d.abilityId });
        return triggerAbilityById(d.abilityId);
      }
      return send(cmd, d);
    }
  });
  let pointerDrag = null;
  let suppressClickUntil = 0;
  function makeDragGhost(source) {
    const ghost = document.createElement("div");
    ghost.className = "ashen-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.position = "fixed";
    ghost.style.pointerEvents = "none";
    ghost.style.width = "52px";
    ghost.style.height = "52px";
    ghost.style.zIndex = "99999";
    const kind = source.kind;
    const id = source.id;
    let icon = "✦";
    let label = "";
    if (kind === "item") {
      const it = state?.catalog?.items?.[id] || {};
      icon = it.icon || "📦";
      label = it.name || id;
    } else if (kind === "ability") {
      const a = state?.catalog?.abilities?.[id] || {};
      icon = a.icon || "✦";
      label = a.name || id;
    }
    ghost.innerHTML = `<span class="drag-icon">${icon}</span><span class="drag-label">${escapeHtml(label)}</span>`;
    document.body.appendChild(ghost);
    return ghost;
  }
  function hotbarDropAtPoint(x, y, source) {
    const nodes = document.elementsFromPoint?.(x, y) || [];
    let el = nodes
      .map((n) => n?.closest?.(".skill[data-hotbar-slot]"))
      .find(Boolean);
    if (!el) {
      const slots = [...document.querySelectorAll(".skill[data-hotbar-slot]")];
      el = slots.find((slot) => {
        const r = slot.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      });
    }
    if (!el) return false;
    const to = Number(el.dataset.hotbarSlot);
    if (!Number.isInteger(to) || to < 0 || to >= 18) return false;
    const h = hotbarLoadout();
    const from = source.hotbarSlot == null ? null : Number(source.hotbarSlot);
    if (source.kind === "locked") return false;
    if (from !== null && Number.isInteger(from) && from >= 0 && from < 18) {
      if (from === to) return true;
      const tmp = h[to] || null;
      h[to] = h[from] || null;
      h[from] = tmp;
    } else h[to] = { kind: source.kind, id: source.id };
    saveHotbar(h);
    combatHotbarSig = "";
    renderCombat();
    return true;
  }
  function removeDragGhost() {
    if (pointerDrag?.ghost) pointerDrag.ghost.remove();
    pointerDrag = null;
    document.body.classList.remove("ashen-dragging", "ashen-skill-dragging");
  }
  document.addEventListener("dragstart", (e) => e.preventDefault(), true);
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button !== 0) return;
      const el = e.target.closest?.("[data-drag-kind][data-drag-id]");
      if (!el || el.dataset.dragKind === "empty") return;
      pointerDrag = {
        el,
        startX: e.clientX,
        startY: e.clientY,
        kind: el.dataset.dragKind,
        id: el.dataset.dragId,
        hotbarSlot: el.dataset.hotbarSlot,
        dragging: false,
        ghost: null,
        pointerId: e.pointerId,
      };
    },
    true,
  );
  document.addEventListener(
    "pointermove",
    (e) => {
      if (!pointerDrag || pointerDrag.pointerId !== e.pointerId) return;
      const dx = e.clientX - pointerDrag.startX,
        dy = e.clientY - pointerDrag.startY;
      if (!pointerDrag.dragging && Math.hypot(dx, dy) < 5) return;
      if (!pointerDrag.dragging) {
        pointerDrag.dragging = true;
        suppressClickUntil = performance.now() + 450;
        pointerDrag.el.classList.add("dragging");
        pointerDrag.ghost = makeDragGhost(pointerDrag);
        document.body.classList.add("ashen-dragging");
        if (pointerDrag.kind === "ability")
          document.body.classList.add("ashen-skill-dragging");
      }
      e.preventDefault();
      const over = document
        .elementsFromPoint?.(e.clientX, e.clientY)
        ?.map((n) => n?.closest?.(".skill[data-hotbar-slot]"))
        .find(Boolean);
      document
        .querySelectorAll(".skill[data-hotbar-slot].drag-over")
        .forEach((x) => x.classList.remove("drag-over"));
      if (over) over.classList.add("drag-over");
      if (pointerDrag.ghost) {
        pointerDrag.ghost.style.left = `${e.clientX - 26}px`;
        pointerDrag.ghost.style.top = `${e.clientY - 26}px`;
      }
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (!pointerDrag || pointerDrag.pointerId !== e.pointerId) return;
      const d = pointerDrag;
      if (d.dragging) {
        e.preventDefault();
        e.stopPropagation();
        const placed = hotbarDropAtPoint(e.clientX, e.clientY, d);
        if (!placed && d.hotbarSlot != null && d.kind !== "empty") {
          const elAt = document.elementFromPoint(e.clientX, e.clientY);
          const onWorld = !!elAt?.closest?.("#worldCanvas");
          if (onWorld || !elAt) {
            clearHotbarSlot(Number(d.hotbarSlot));
          }
        }
      }
      d.el.classList.remove("dragging");
      document
        .querySelectorAll(".skill[data-hotbar-slot].drag-over")
        .forEach((x) => x.classList.remove("drag-over"));
      removeDragGhost();
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    () => {
      if (pointerDrag?.el) pointerDrag.el.classList.remove("dragging");
      removeDragGhost();
    },
    true,
  );
  function handleContextMenuInput(e: MouseEvent) {
    e.preventDefault();
    const target = e.target as HTMLElement | null;
    const slot = target?.closest?.(
      ".bag-slot[data-bag-item]",
    ) as HTMLElement | null;
    if (slot && state) {
      const id = slot.dataset.bagItem,
        type = slot.dataset.itemType;
      if (type === "consumable")
        return send(
          id === "ashen_homeward_stone" ? "use_hearthstone" : "use_item",
          { itemId: id },
        );
      if (
        [
          "weapon",
          "shield",
          "helmet",
          "chest",
          "shoulders",
          "gloves",
          "boots",
          "neck",
          "ring",
          "relic",
        ].includes(type || "")
      )
        return send("equip", { itemId: id });
    }
    if (target?.closest?.("#targetHud") && state?.player?.targetPlayerId)
      return openContextMenu(e.clientX, e.clientY, state.player.targetPlayerId);
    if (target?.closest?.("#worldCanvas") && state) {
      const hit = hitTest(e);
      if (hit?.kind === "player")
        return openContextMenu(e.clientX, e.clientY, hit.id);
    }
  }
  const inputRouter = new ClientInputRouter({
    onContextMenu: handleContextMenuInput,
    onPointerOver: (e: any) => {
      const el = e.target?.closest?.(
        "[data-tip],button.skill,.item,.bag-row,.shop-row,.skill-entry,.journal-entry,.zone,.player-card,#bottomMenu button,button:not(#bottomMenu button)",
      );
      if (!el || el.contains(e.relatedTarget)) return;
      showTipFor(el, e);
    },
    onPointerMoveTooltip: (e: any) => {
      const el = e.target?.closest?.(
        "[data-tip],button.skill,.item,.bag-row,.shop-row,.skill-entry,.journal-entry,.zone,.player-card,#bottomMenu button,button:not(#bottomMenu button)",
      );
      if (el) showTipFor(el, e);
      else if (tip) tip.style.display = "none";
    },
    onPointerOut: (e: any) => {
      const el = e.target?.closest?.(
        "[data-tip],button.skill,.item,.bag-row,.shop-row,.skill-entry,.journal-entry,.zone,.player-card,#bottomMenu button,button:not(#bottomMenu button)",
      );
      if (el && el.contains(e.relatedTarget)) return;
      if (tip) tip.style.display = "none";
    },
  });
  inputRouter.bind();
  (window as any).__ashenfallContextMenuAction = handleContextMenuAction;
  document.addEventListener("click", (e) => {
    if (!e.target.closest?.("#contextMenu")) closeContextMenu();
  });
  const direct = {
    questsBtn: () => openQuestJournal(),
    bagBtn: () => renderBagModal(),
    skillsBtn: () => renderSkills(),
    buildBtn: () => {
      buildSig = "";
      renderBuild();
      openModal("buildModal");
    },
    storyBtn: () => send("open_story"),
    trainerBtn: () => {
      renderTrainer();
      openModal("trainerModal");
    },
    shopBtn: () => openShop(),
    auctionBtn: () => openAuctionHouse(),
  };
  Object.entries<any>(direct).forEach(([id, fn]) =>
    $(id)?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    }),
  );
  $("charBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCharacterModal();
  });

  (window as any).__ashenfallWorldMapMode = (mode: "world" | "zone") => {
    worldMapMode = mode;
    if (mode === "zone")
      worldMapZone = state?.zoneInfo?.id || state?.player?.zone || worldMapZone;
    syncReactWorldMap();
    redrawWorldMapAfterReact();
  };
  (window as any).__ashenfallWorldMapZoneChange = (zone: string) => {
    worldMapZone = zone;
    worldMapMode = "zone";
    syncReactWorldMap();
    redrawWorldMapAfterReact();
  };
  $("classid")?.addEventListener("change", () => {
    selectedClassId = $("classid").value;
    classSelectionDirty = true;
    syncClassChoiceSelection(selectedClassId);
    buildSig = "";
  });
  $("chatSend")?.addEventListener("click", sendChat);
  $("chatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });
  $("mapChatSend")?.addEventListener("click", sendChat);
  $("mapChatChannel")?.addEventListener("change", (e) => {
    setChatChannel(e.target.value);
  });
  $("mapChatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat();
  });
  const c = $("worldCanvas"),
    vp = document.querySelector(".viewport-wrap");
  const applyZoom = (factor) => {
    const next = Math.max(
      minZoomForZone(),
      Math.min(worldRenderer.getZoomBounds().max, zoomTarget * factor),
    );
    zoomTarget = Math.round(next * 1000) / 1000;
    uiDirty = true;
  };
  const onWheel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const step = Math.max(-2, Math.min(2, e.deltaY / 120));
    applyZoom(Math.pow(1.035, -step));
  };
  c.addEventListener("wheel", onWheel, { passive: false });
  const miniMinus = $("minimapZoomOut"),
    miniPlus = $("minimapZoomIn");
  const applyMinimapZoom = (factor) => {
    setMinimapZoom(getMinimapZoom() * factor);
    drawMinimap(true);
  };
  miniMinus?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyMinimapZoom(0.8);
  });
  miniPlus?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    applyMinimapZoom(1.25);
  });
  c.style.touchAction = "none";
  if (vp) vp.style.overscrollBehavior = "contain";
  if (c) {
    c.addEventListener("pointermove", (e) => {
      const hit = hitTest(e);
      const action =
        hit?.kind === "mob"
          ? "attack"
          : hit?.kind === "player"
            ? "target"
            : hit?.kind || "move";
      c.dataset.cursorAction = action;
    });
    c.addEventListener("pointerleave", () => {
      c.dataset.cursorAction = "move";
    });
    c.dataset.cursorAction = "move";
  }
  c.addEventListener("click", (e) => handleCanvasClick(e));
  $("respawnBtn").onclick = () => send("respawn");
}
document.addEventListener(
  "click",
  (e) => {
    const modal = (e.target as HTMLElement)?.closest?.(".modal");
    if (
      modal &&
      modal.id !== "create" &&
      e.target === modal &&
      !modal.classList.contains("hidden")
    ) {
      closeModal(modal.id);
      return;
    }
  },
  true,
);
const windowController = new ClientWindowController({ getOpenModals });
window.addEventListener("resize", () => {
  resizeWorldCanvas();
  windowController.constrainOpenWindows();
});

const realtimeUiController = new ClientRealtimeUiController({
  getState: () => state,
  renderCombatPresentation,
  renderTarget,
  renderDeath,
  getLocalFx: () => localFx,
  setLocalFx: (fx) => {
    localFx = fx;
  },
  renderRegionHud,
  renderHeader,
  renderQuestHelper,
  renderPartyHud,
  renderChat,
  renderLootRolls,
  renderDungeonQueueHud,
  renderArenaQueueHud,
  renderDungeonMatch,
  renderWorldIntel,
  isWorldIntelOpen: () => !$("worldIntelModal")?.classList.contains("hidden"),
  isWorldMapOpen: () => worldMapOpen,
  getWorldMapDrawAt: () => lastWorldMapDraw,
  setWorldMapDrawAt: (value) => {
    lastWorldMapDraw = value;
  },
  drawWorldMap,
  syncStoryModal,
  isNpcModalOpen: () => !$("npcModal")?.classList.contains("hidden"),
  refreshNpcModal,
});
function updateTimers() {
  realtimeUiController.tick();
}

const interactionController = new ClientInteractionController({
  getState: () => state,
  getAnchorId: () => npcInteractionAnchorId,
  clearAnchor: () => {
    npcInteractionAnchorId = null;
    openNpcId = null;
    selectedShopId = null;
    shopSignature = "";
    npcRenderSig = "";
    if (!getOpenModals().length) document.body.classList.remove("modal-open");
  },
  closeModal: (id) => {
    const el = $(id);
    if (el) {
      modalStack = modalStack.filter((x) => x !== id);
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    }
  },
  getRenderRange: (meters) => worldMetersForRenderRange(meters),
});
function enforceNpcInteractionRange() {
  interactionController.enforceNpcRange();
}
const clientRenderLoop = new ClientRenderLoop({
  expirePrediction: () => combatPrediction.expire(),
  enforceInteractionRange: enforceNpcInteractionRange,
  getHitStopUntil: () => hitStopUntil,
  drawWorld: (time) => drawWorld(time),
  drawFallbackWorld: () => worldRenderer.drawFallbackWorld(),
  isUiDirty: () => uiDirty,
  setUiDirty: (value) => {
    uiDirty = value;
  },
  getLastUiRender: () => lastUiRender,
  setLastUiRender: (value) => {
    lastUiRender = value;
  },
  renderUi: () => renderAll(),
});

function triggerHotbarSlot(slot: number) {
  if (!state?.player?.hasCharacter) return;
  const h = hotbarLoadout();
  const entry = h[slot];
  if (!entry) return;
  if (entry.kind === "item")
    return send(
      entry.id === "ashen_homeward_stone" ? "use_hearthstone" : "use_item",
      { itemId: entry.id },
    );
  return triggerAbilityById(entry.id);
}

const keys = new Set<string>();
let wasdActive = false;
function sendMoveInput() {
  if (!state?.player?.hasCharacter) return;
  let dx = 0,
    dy = 0;
  if (keys.has("a")) dx -= 1;
  if (keys.has("d")) dx += 1;
  if (keys.has("w")) dy -= 1;
  if (keys.has("s")) dy += 1;
  const len = Math.hypot(dx, dy);
  wasdActive = len > 0;
  if (len > 0) {
    dx /= len;
    dy /= len;
    setLocalMoveInput(
      dx,
      dy,
      state.player.movementMode === "run" ? "run" : "walk",
    );
    send("move_input", {
      dx,
      dy,
      mode: state.player.movementMode === "run" ? "run" : "walk",
    });
  } else {
    stopLocalMotion();
    send("move_input", {
      dx: 0,
      dy: 0,
      mode: state.player.movementMode === "run" ? "run" : "walk",
    });
  }
}
window.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "TEXTAREA", "SELECT"].includes(
      (document.activeElement as any)?.tagName,
    )
  )
    return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const code = e.code;
  if (code === "Escape") {
    e.preventDefault();
    closeContextMenu();
    if (closeTopModal()) return;
    return send("clear_target");
  }
  if (/^Digit[1-9]$/.test(code)) {
    e.preventDefault();
    const n = Number(code.slice(5)) - 1;
    triggerHotbarSlot(e.shiftKey ? 9 + n : n);
    return;
  }
  const moveMap: any = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" };
  const k = moveMap[code];
  if (k) {
    e.preventDefault();
    if (!keys.has(k)) {
      keys.add(k);
      sendMoveInput();
    }
  }
});
window.addEventListener("keyup", (e) => {
  const moveMap: any = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" };
  const k = moveMap[e.code];
  if (k && keys.has(k)) {
    keys.delete(k);
    sendMoveInput();
  }
});
window.addEventListener("blur", () => {
  keys.clear();
  if (pendingMoveTimer) {
    clearTimeout(pendingMoveTimer);
    pendingMoveTimer = null;
  }
  pendingMoveIntent = null;
  stopLocalMotion();
  if (wasdActive) {
    wasdActive = false;
    send("move_input", {
      dx: 0,
      dy: 0,
      mode: state?.player?.movementMode === "run" ? "run" : "walk",
    });
    send("stop");
  }
});
function preloadGameCursors() {
  const sources = ["target", "move", "attack", "loot", "talk", "mine", "gate"];
  const jobs = sources.map(
    (name) =>
      new Promise<void>((resolve) => {
        const img = new Image();
        const done = (ready = true) => {
          if (ready) gameCursorImages[name] = img;
          resolve();
        };
        img.onload = () => {
          const decoded =
            typeof img.decode === "function" ? img.decode() : Promise.resolve();
          Promise.resolve(decoded)
            .then(() => done(true))
            .catch(() => done(false));
        };
        img.onerror = () => done(false);
        img.src = `/assets/cursors/${name}.png?v=050`;
        gameCursorImages[name] = img;
      }),
  );
  Promise.all(jobs).then(() =>
    document.body.classList.add("game-cursors-ready"),
  );
}
function applyUiVisualSystem() {
  document.body.classList.toggle("reduce-motion", !!uiSettings.reduceMotion);
  document
    .querySelectorAll<HTMLButtonElement>("#bottomMenu button")
    .forEach((button) => {
      const label = (
        button.querySelector("span")?.textContent ||
        button.getAttribute("aria-label") ||
        ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (label) {
        button.setAttribute("data-tip", label);
        button.setAttribute("aria-label", label);
        button.removeAttribute("title");
      }
    });
  const modalTitles = {
    characterModal: "CHARACTER",
    bagModal: "INVENTORY",
    skillModal: "ABILITIES",
    questModal: "QUEST LOG",
    buildModal: "BUILD & TALENTS",
    partyModal: "PARTY",
    socialModal: "SOCIAL",
    pvpModal: "PLAYER VS PLAYER",
    professionModal: "PROFESSIONS",
    dungeonModal: "DUNGEON FINDER",
    worldMapModal: "WORLD MAP",
    auctionModal: "AUCTION HOUSE",
    mailModal: "MAILBOX",
    settingsModal: "SETTINGS",
    shopModal: "VENDOR",
    tradeModal: "TRADE",
  };
  for (const [id, label] of Object.entries<any>(modalTitles)) {
    const m = $(id);
    if (!m) continue;
    const h = m.querySelector(".modal-head");
    if (h && !h.dataset.ashenDecorated) {
      h.dataset.ashenDecorated = "1";
      const e = document.createElement("span");
      e.className = "ashen-screen-label";
      e.textContent = label;
      h.appendChild(e);
    }
  }
}
preloadGameCursors();
applyUiVisualSystem();
window.addEventListener("ashenfall-ui-settings", applyUiVisualSystem);
window.addEventListener("ashenfall-react-window-mounted", () => {
  try {
    bindMovableWindows();
    applyUiVisualSystem();
    if (!$("buildModal")?.classList.contains("hidden")) {
      if (!$("talentList")?.childElementCount) buildSig = "";
      renderBuild();
    }
  } catch (err) {
    console.error("React window binding failed", err);
  }
});
bindCriticalControls();
fillClasses();
loadVisualAssets();
resizeWorldCanvas();
try {
  bind();
} catch (err) {
  console.error("Ashenfall input binding failed", err);
  toast("Some controls failed to initialize.", false);
}
try {
  bindMovableWindows();
} catch (err) {
  console.error("Ashenfall window binding failed", err);
}
window.addEventListener("ashenfall-auth-ready", () => {
  setSessionLoading(
    true,
    savedCharacterId()
      ? "Restoring your Ashenfall character…"
      : "Preparing your new journey…",
  );
  document.body.classList.remove("creating-character", "game-ready");
  connect();
  loadWorldLayout().catch(() => {});
});
setInterval(updateTimers, 120);
clientRenderLoop.start();

document.addEventListener("click", (e: any) => {
  const b = e.target?.closest?.("[data-account-action]");
  if (!b) return;
  const a = b.dataset.accountAction;
  if (a === "refresh-sessions") loadAccountSessions();
  if (a === "logout-all") logoutAllAccountSessions();
});
window.addEventListener("ashenfall-auth-ready", () => loadAccountSessions());
