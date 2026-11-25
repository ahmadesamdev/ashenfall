import crypto from "node:crypto";
import {
  applyReputation,
  factionTier,
} from "../progression/StoryProgression.js";

const uid = (p: string) => `${p}_${crypto.randomBytes(4).toString("hex")}`;
const OPEN_WORLD_STATE_ID = "open-world-activity-v1";

export const OPEN_WORLD_ACTIVITY_DEFS: any = {
  gloamwood: {
    faction: "lantern_guard",
    contract: {
      id: "gloamwood_lantern_watch",
      name: "Lantern Watch",
      goal: 8,
      kind: "hunt",
      enemyTypes: ["gloomroot_spider", "hollow_wolf", "gloam_cultist"],
      reward: { xp: 180, gold: 75, rep: 18 },
      description:
        "Clear threats from the lantern roads and keep the forest crossings open.",
    },
    routes: [
      [
        [0.14, 0.53],
        [0.28, 0.47],
        [0.42, 0.52],
        [0.58, 0.42],
        [0.73, 0.5],
      ],
      [
        [0.18, 0.68],
        [0.32, 0.62],
        [0.48, 0.67],
        [0.66, 0.61],
      ],
    ],
  },
  marches_of_dawn: {
    faction: "stonehold_council",
    contract: {
      id: "marches_frontier_watch",
      name: "Frontier Watch",
      goal: 10,
      kind: "hunt",
      enemyTypes: ["feral_ravager", "crowsworn_scavenger", "ashen_hyena"],
      reward: { xp: 220, gold: 90, rep: 20 },
      description: "Keep the farm roads safe from roaming beasts.",
    },
    routes: [
      [
        [0.08, 0.5],
        [0.25, 0.46],
        [0.42, 0.52],
        [0.62, 0.48],
        [0.82, 0.56],
      ],
    ],
  },
  eastern_reach: {
    faction: "stonehold_council",
    contract: {
      id: "eastern_caravan_guard",
      name: "Caravan Guard",
      goal: 10,
      kind: "hunt",
      enemyTypes: ["reach_roadbandit", "reach_thornstag", "reach_mirewing"],
      reward: { xp: 260, gold: 105, rep: 22 },
      description:
        "Protect the trade road and drive raiders away from the frontier.",
    },
    routes: [
      [
        [0.08, 0.5],
        [0.25, 0.5],
        [0.44, 0.48],
        [0.62, 0.52],
        [0.82, 0.5],
      ],
      [
        [0.18, 0.72],
        [0.38, 0.64],
        [0.6, 0.68],
        [0.82, 0.6],
      ],
    ],
  },
  ashen_wastes: {
    faction: "ashen_covenant",
    contract: {
      id: "wastes_ashfall_watch",
      name: "Ashfall Watch",
      goal: 12,
      kind: "hunt",
      enemyTypes: [
        "ashen_reaver",
        "veilbound_howler",
        "ashbound_executioner",
        "veilscarred_arcanist",
      ],
      reward: { xp: 420, gold: 170, rep: 26 },
      description:
        "Survive the ash roads and cull creatures empowered by the Veil.",
    },
    routes: [
      [
        [0.1, 0.52],
        [0.28, 0.45],
        [0.48, 0.5],
        [0.68, 0.42],
        [0.9, 0.5],
      ],
      [
        [0.18, 0.76],
        [0.4, 0.68],
        [0.62, 0.72],
        [0.82, 0.62],
      ],
    ],
  },
  old_kingdom: {
    faction: "veil_wardens",
    contract: {
      id: "old_kingdom_relic_watch",
      name: "Relic Watch",
      goal: 10,
      kind: "hunt",
      enemyTypes: [
        "kingdom_hollow_knight",
        "kingdom_crownwraith",
        "kingdom_basilisk",
      ],
      reward: { xp: 460, gold: 185, rep: 28 },
      description:
        "Push back the restless dead while the Wardens recover the royal roads.",
    },
    routes: [
      [
        [0.08, 0.52],
        [0.24, 0.48],
        [0.42, 0.5],
        [0.62, 0.46],
        [0.84, 0.52],
      ],
      [
        [0.18, 0.3],
        [0.38, 0.34],
        [0.58, 0.3],
        [0.78, 0.36],
      ],
    ],
  },
  hollow_expanse: {
    faction: "veil_wardens",
    contract: {
      id: "hollow_frontier_watch",
      name: "Hollow Frontier Watch",
      goal: 14,
      kind: "hunt",
      enemyTypes: [
        "ashbound_executioner",
        "veilscarred_arcanist",
        "kingdom_hollow_knight",
        "kingdom_crownwraith",
      ],
      reward: { xp: 720, gold: 300, rep: 34 },
      description:
        "Hold the apex roads against elite creatures spilling out of the Hollow.",
    },
    routes: [
      [
        [0.1, 0.5],
        [0.28, 0.46],
        [0.46, 0.52],
        [0.64, 0.48],
        [0.9, 0.5],
      ],
      [
        [0.18, 0.72],
        [0.38, 0.64],
        [0.6, 0.68],
        [0.82, 0.62],
      ],
    ],
  },
  briarfen: {
    faction: "lantern_guard",
    contract: {
      id: "briarfen_lantern_reclaim",
      name: "Reclaim the Lantern Causeways",
      goal: 10,
      kind: "hunt",
      enemyTypes: ["fen_stalker", "thorn_hag", "marshbone_hound"],
      reward: { xp: 300, gold: 125, rep: 22 },
      description: "Keep the drowned causeways open and the lanterns burning.",
    },
    routes: [
      [
        [0.08, 0.52],
        [0.24, 0.48],
        [0.42, 0.54],
        [0.64, 0.48],
        [0.9, 0.5],
      ],
      [
        [0.2, 0.72],
        [0.4, 0.66],
        [0.62, 0.7],
        [0.82, 0.62],
      ],
    ],
  },
  sunscar_steppe: {
    faction: "stonehold_council",
    contract: {
      id: "sunscar_caravan_guard",
      name: "Guard the Sunscar Roads",
      goal: 12,
      kind: "hunt",
      enemyTypes: ["sunscar_raider", "redmaw_hyena", "ashwing_vulture"],
      reward: { xp: 420, gold: 170, rep: 25 },
      description:
        "Drive raiders from the caravan lanes and keep supplies moving east.",
    },
    routes: [
      [
        [0.08, 0.5],
        [0.28, 0.48],
        [0.48, 0.52],
        [0.7, 0.46],
        [0.92, 0.5],
      ],
      [
        [0.18, 0.24],
        [0.4, 0.3],
        [0.62, 0.24],
        [0.84, 0.32],
      ],
    ],
  },
  crownfall_expanse: {
    faction: "veil_wardens",
    contract: {
      id: "crownfall_relic_watch",
      name: "Crownfall Relic Watch",
      goal: 12,
      kind: "hunt",
      enemyTypes: [
        "crownfall_revenant",
        "royal_boneguard",
        "ashbound_reclaimer",
      ],
      reward: { xp: 600, gold: 240, rep: 30 },
      description:
        "Hold the royal roads while relic hunters search the haunted estates.",
    },
    routes: [
      [
        [0.08, 0.52],
        [0.28, 0.48],
        [0.46, 0.52],
        [0.66, 0.48],
        [0.92, 0.5],
      ],
      [
        [0.18, 0.72],
        [0.38, 0.64],
        [0.6, 0.7],
        [0.82, 0.62],
      ],
    ],
  },
  veilscar_highlands: {
    faction: "veil_wardens",
    contract: {
      id: "veilscar_storm_watch",
      name: "Stormscar Watch",
      goal: 14,
      kind: "hunt",
      enemyTypes: ["veilscar_raider", "aether_wraith", "stormbound_arcanist"],
      reward: { xp: 850, gold: 340, rep: 38 },
      description:
        "Survive the highland storms and keep the ascent open to the frontier.",
    },
    routes: [
      [
        [0.08, 0.5],
        [0.28, 0.46],
        [0.48, 0.52],
        [0.68, 0.46],
        [0.92, 0.5],
      ],
      [
        [0.2, 0.72],
        [0.4, 0.64],
        [0.62, 0.7],
        [0.84, 0.62],
      ],
    ],
  },
  nightveil_coast: {
    faction: "the_hollow",
    contract: {
      id: "nightveil_black_tide",
      name: "Hold the Black Tide",
      goal: 16,
      kind: "hunt",
      enemyTypes: ["nightveil_drowned", "nightveil_reaver", "hollowtide_witch"],
      reward: { xp: 1100, gold: 450, rep: 45 },
      description: "Hold the final coast road until the black tide withdraws.",
    },
    routes: [
      [
        [0.08, 0.5],
        [0.28, 0.52],
        [0.48, 0.48],
        [0.68, 0.52],
        [0.92, 0.5],
      ],
      [
        [0.18, 0.72],
        [0.4, 0.64],
        [0.62, 0.7],
        [0.84, 0.62],
      ],
    ],
  },
};

export class OpenWorldDirector {
  world: any;
  repo: any;
  playerMutations: any;
  state: any;
  rewardXp: any = null;
  lastRotation = 0;
  rotationMs = 300000;
  lastRoam = 0;
  roamMs = 90000;
  maxRoamingPerZone = 2;
  pendingRareRewards = new Map<string, any>();
  private rareRewardsInFlight = new Set<string>();
  private statePersistQueue: Promise<void> = Promise.resolve();
  constructor(world: any, repo: any, playerMutations: any = null) {
    this.world = world;
    this.repo = repo;
    this.playerMutations = playerMutations;
    const raw = repo?.loadWorldState?.(OPEN_WORLD_STATE_ID);
    this.state = this.restoreState(raw);
    for (const reward of Array.isArray(raw?.pendingRareRewards)
      ? raw.pendingRareRewards
      : []) {
      if (
        reward?.key &&
        reward?.playerId &&
        reward?.eventId &&
        reward?.type &&
        OPEN_WORLD_ACTIVITY_DEFS[String(reward.zone)]
      )
        this.pendingRareRewards.set(String(reward.key), {
          key: String(reward.key),
          playerId: String(reward.playerId),
          zone: String(reward.zone),
          eventId: String(reward.eventId),
          type: String(reward.type),
          name: String(reward.name || reward.type),
          faction: String(
            reward.faction ||
              OPEN_WORLD_ACTIVITY_DEFS[String(reward.zone)].faction,
          ),
          createdAt: Math.max(0, Number(reward.createdAt) || Date.now()),
        });
    }
  }
  private restoreState(raw: any) {
    const source =
      raw?.version === 1 && raw?.zones && typeof raw.zones === "object"
        ? raw.zones
        : raw;
    const restored: any = {};
    for (const zone of Object.keys(OPEN_WORLD_ACTIVITY_DEFS)) {
      const a = source?.[zone];
      if (!a || typeof a !== "object" || !a.id || String(a.zone) !== zone)
        continue;
      const goal = Math.max(
        1,
        Math.floor(
          Number(a.goal) || OPEN_WORLD_ACTIVITY_DEFS[zone].contract.goal,
        ),
      );
      const progress = Math.max(
        0,
        Math.min(goal, Math.floor(Number(a.progress) || 0)),
      );
      const contributors: any = {};
      if (a.contributors && typeof a.contributors === "object")
        for (const [id, count] of Object.entries(a.contributors)) {
          const n = Math.max(0, Math.floor(Number(count) || 0));
          if (id && n > 0) contributors[String(id)] = n;
        }
      const definition = OPEN_WORLD_ACTIVITY_DEFS[zone].contract;
      restored[zone] = {
        id: String(a.id),
        zone,
        defId: String(a.defId || definition.id),
        name: String(a.name || definition.name),
        description: String(a.description || definition.description),
        goal,
        progress,
        startedAt: Math.max(0, Number(a.startedAt) || Date.now()),
        endsAt: Math.max(0, Number(a.endsAt) || Date.now()),
        faction: String(a.faction || OPEN_WORLD_ACTIVITY_DEFS[zone].faction),
        enemyTypes: Array.isArray(a.enemyTypes)
          ? a.enemyTypes
              .map(String)
              .filter((x: string) => x.length <= 100)
              .slice(0, 100)
          : [...definition.enemyTypes],
        reward: {
          xp: Math.max(0, Number(a.reward?.xp) || 0),
          gold: Math.max(0, Number(a.reward?.gold) || 0),
          rep: Math.max(0, Number(a.reward?.rep) || 0),
        },
        contributors,
        completed:
          !!a.completed || progress >= goal || a.rewardStatus === "committed",
        rewardStatus: a.rewardStatus === "committed" ? "committed" : "pending",
      };
    }
    return restored;
  }
  private stateSnapshot() {
    const zones: any = {};
    for (const [zone, a] of Object.entries(this.state) as any[]) {
      if (!a) continue;
      const { rewardPromise, ...stored } = a;
      zones[zone] = JSON.parse(JSON.stringify(stored));
    }
    return {
      version: 1,
      zones,
      pendingRareRewards: [...this.pendingRareRewards.values()].map(
        (x: any) => ({ ...x }),
      ),
    };
  }
  private persistState() {
    const run = this.statePersistQueue.then(async () => {
      const result = this.repo?.saveWorldState?.(
        this.stateSnapshot(),
        OPEN_WORLD_STATE_ID,
      );
      if (result && typeof result.then === "function") await result;
    });
    this.statePersistQueue = run.then(
      () => undefined,
      (error: any) => {
        console.warn(
          "[open-world] contract state checkpoint failed:",
          String(error?.message || error),
        );
      },
    );
  }
  private persistStateNow() {
    const run = this.statePersistQueue.then(async () => {
      const snapshot = this.stateSnapshot();
      if (typeof this.repo?.saveWorldStateNow === "function")
        await this.repo.saveWorldStateNow(snapshot, OPEN_WORLD_STATE_ID);
      else if (typeof this.repo?.saveWorldState === "function") {
        await this.repo.saveWorldState(snapshot, OPEN_WORLD_STATE_ID);
        if (typeof this.repo?.checkpoint === "function")
          await this.repo.checkpoint();
      } else
        throw new Error(
          "Durable open-world contract state persistence is unavailable.",
        );
    });
    this.statePersistQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  ensurePlayer(p: any) {
    if (!p.openWorld || typeof p.openWorld !== "object") p.openWorld = {};
    if (!p.openWorld.regions || typeof p.openWorld.regions !== "object")
      p.openWorld.regions = {};
    if (!p.openWorld.rareKills || typeof p.openWorld.rareKills !== "object")
      p.openWorld.rareKills = {};
    return p.openWorld;
  }
  eligiblePlayers(zone: string) {
    return (this.world.players || []).filter(
      (p: any) => p?.online && p?.hasCharacter && !p.dead && p.zone === zone,
    );
  }
  zoneLevel(zone: string) {
    return Number(
      this.world.zoneConfig?.(zone)?.regionTier ||
        this.world.zoneConfig?.(zone)?.danger ||
        1,
    );
  }
  contractFor(zone: string) {
    const def = OPEN_WORLD_ACTIVITY_DEFS[zone];
    if (!def) return null;
    return def.contract;
  }
  activeContract(zone: string, now = Date.now()) {
    const def = OPEN_WORLD_ACTIVITY_DEFS[zone];
    if (!def) return null;
    const current = this.state[zone];
    if (
      current &&
      (now < current.endsAt ||
        current.rewardStatus !== "committed" ||
        current.rewardPromise)
    )
      return current;
    const contract = def.contract;
    const id = uid(`regional_${contract.id}`);
    this.state[zone] = {
      id,
      zone,
      defId: contract.id,
      name: contract.name,
      description: contract.description,
      goal: contract.goal,
      progress: 0,
      startedAt: now,
      endsAt: now + this.rotationMs,
      faction: def.faction,
      enemyTypes: [...(contract.enemyTypes || [])],
      reward: { ...(contract.reward || {}) },
      contributors: {},
      completed: false,
      rewardStatus: "pending",
    };
    this.persistState();
    return this.state[zone];
  }
  spawnRoamingPack(zone, now = Date.now()) {
    const def = OPEN_WORLD_ACTIVITY_DEFS[zone];
    if (!def || !this.eligiblePlayers(zone).length) return null;
    const existing = [...this.world.mobs.values()].filter(
      (m: any) => m.zone === zone && m.roamingPackId && m.state !== "dead",
    );
    if (existing.length >= this.maxRoamingPerZone) return null;
    const candidates = (this.world.mobDefs || []).filter(
      (m: any) => (m.zones || []).includes(zone) && !m.rare && !m.worldEvent,
    );
    if (!candidates.length) return null;
    const base = candidates[Math.floor(Math.random() * candidates.length)];
    const route = def.routes[Math.floor(Math.random() * def.routes.length)];
    const start = route[0],
      packId = uid("roam");
    const count = 2 + Math.floor(Math.random() * 2);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const m = this.world.spawnMob(base, zone, 70000 + i, {
        x: start[0] + (Math.random() - 0.5) * 0.02,
        y: start[1] + (Math.random() - 0.5) * 0.02,
        r: 0.02,
        id: `${packId}_${i}`,
      });
      m.roamingPackId = packId;
      m.roamPath = route.map((x: any) => ({ x: x[0], y: x[1] }));
      m.roamIndex = 0;
      m.roamPauseUntil = now + Math.random() * 2000;
      m.temper = "neutral";
      m.baseRuntimeDamageMultiplier = 1.05;
      m.baseRuntimeSpeedMultiplier = 1.12;
      m.roaming = true;
      ids.push(m.id);
    }
    return { packId, ids, zone };
  }
  updateRoaming(dt, now) {
    for (const m of this.world.mobs.values()) {
      if (
        !m.roamingPackId ||
        m.state === "dead" ||
        !Array.isArray(m.roamPath) ||
        !m.roamPath.length
      )
        continue;
      if (m.state !== "idle") continue;
      if (now < Number(m.roamPauseUntil || 0)) continue;
      const point =
        m.roamPath[Math.min(m.roamIndex || 0, m.roamPath.length - 1)];
      const d = Math.hypot(Number(point.x) - m.x, Number(point.y) - m.y);
      if (d <= 0.006) {
        m.roamIndex = ((m.roamIndex || 0) + 1) % m.roamPath.length;
        m.roamPauseUntil = now + 900 + Math.random() * 1400;
        continue;
      }
      const step =
        ((Math.max(5, Number(m.speedMeters || 5.5)) * 1.08) /
          this.world.worldMetersFor(m.zone)) *
        dt;
      m.x += ((Number(point.x) - m.x) / d) * step;
      m.y += ((Number(point.y) - m.y) / d) * step;
      m.targetX = Number(point.x);
      m.targetY = Number(point.y);
      m.velocityX =
        (((Number(point.x) - m.x) / Math.max(d, 0.001)) * step) /
        Math.max(dt, 0.001);
      m.velocityY =
        (((Number(point.y) - m.y) / Math.max(d, 0.001)) * step) /
        Math.max(dt, 0.001);
    }
  }
  onDiscovery(p, location: any) {
    const def = OPEN_WORLD_ACTIVITY_DEFS[p.zone];
    if (!def || !location) return;
    const gain =
      location.type === "landmark"
        ? 8
        : location.type === "rare_spawn"
          ? 10
          : location.type === "resource_hotspot"
            ? 6
            : location.type === "settlement"
              ? 4
              : 3;
    applyReputation(p, { [def.faction]: gain });
    const st = this.ensurePlayer(p);
    st.regions[p.zone] = {
      ...(st.regions[p.zone] || {}),
      discoveries: (Number(st.regions[p.zone]?.discoveries) || 0) + 1,
      lastDiscoveryAt: Date.now(),
    };
  }
  onKill(p, info: any = {}) {
    const a = this.activeContract(p.zone);
    if (!a || a.completed) return;
    if (
      a.enemyTypes.length &&
      !a.enemyTypes.includes(String(info.enemyId || ""))
    )
      return;
    a.progress = Math.min(a.goal, a.progress + 1);
    a.contributors[p.id] = (a.contributors[p.id] || 0) + 1;
    if (a.progress >= a.goal) {
      a.completed = true;
      a.rewardStatus = "pending";
    }
    this.persistState();
    if (a.completed)
      void this.completeContract(a).catch((error: any) => {
        console.warn(
          "[open-world] contract reward commit failed; will retry:",
          String(error?.message || error),
        );
      });
  }
  async onRareKill(p, m: any, eventId: any) {
    const zone = String(p?.zone || "");
    const def = OPEN_WORLD_ACTIVITY_DEFS[zone];
    const instanceId = String(eventId || "").trim();
    if (!p?.id || !def || !m?.type || !instanceId) return false;
    const rewardKey = `open-world-rare-hunt:${zone}:${instanceId}:${String(p.id)}`;
    if (!this.pendingRareRewards.has(rewardKey)) {
      this.pendingRareRewards.set(rewardKey, {
        key: rewardKey,
        playerId: String(p.id),
        zone,
        eventId: instanceId,
        type: String(m.type),
        name: String(m.name || m.type),
        faction: def.faction,
        createdAt: Date.now(),
      });
      await this.persistStateNow();
    }
    return this.processRareReward(rewardKey);
  }
  private async processRareReward(rewardKey: string) {
    if (this.rareRewardsInFlight.has(rewardKey)) return false;
    const pending = this.pendingRareRewards.get(rewardKey);
    if (!pending) return false;
    this.rareRewardsInFlight.add(rewardKey);
    try {
      await this.persistStateNow();
      const grant = async () => {
        const current = this.repo?.getPlayer?.(String(pending.playerId));
        if (!current || !current.hasCharacter)
          throw new Error(
            `Rare-hunt contributor ${pending.playerId} is not available for reward recovery.`,
          );
        if (
          Array.isArray(current._rewardLedger) &&
          current._rewardLedger.includes(rewardKey)
        )
          return false;
        const before = JSON.parse(JSON.stringify(current));
        try {
          const state = this.ensurePlayer(current);
          state.rareKills[pending.type] =
            (Number(state.rareKills[pending.type]) || 0) + 1;
          applyReputation(current, { [pending.faction]: 45 });
          current.lastOpenWorldReward = {
            type: "rare_hunt",
            mob: pending.type,
            name: pending.name,
            rep: 45,
            at: Date.now(),
            eventId: pending.eventId,
          };
          if (typeof this.repo?.savePlayerRewardOnce !== "function")
            throw new Error(
              "Durable rare-hunt reward persistence is unavailable.",
            );
          const committed = await this.repo.savePlayerRewardOnce(
            current,
            rewardKey,
          );
          if (!committed) {
            for (const key of Object.keys(current)) delete current[key];
            Object.assign(current, before);
            return false;
          }
          return true;
        } catch (error) {
          for (const key of Object.keys(current)) delete current[key];
          Object.assign(current, before);
          throw error;
        }
      };
      const committed = this.playerMutations?.withPlayer
        ? await this.playerMutations.withPlayer(String(pending.playerId), grant)
        : await grant();
      this.pendingRareRewards.delete(rewardKey);
      try {
        await this.persistStateNow();
      } catch (error) {
        this.pendingRareRewards.set(rewardKey, pending);
        throw error;
      }
      return committed;
    } catch (error) {
      throw error;
    } finally {
      this.rareRewardsInFlight.delete(rewardKey);
    }
  }
  private retryPendingRareRewards() {
    for (const key of this.pendingRareRewards.keys()) {
      if (this.rareRewardsInFlight.has(key)) continue;
      void this.processRareReward(key).catch((error: any) =>
        console.warn(
          "[open-world] pending rare-hunt reward retry failed:",
          String(error?.message || error),
        ),
      );
    }
  }
  completeContract(a: any) {
    if (a.rewardStatus === "committed") return Promise.resolve();
    if (a.rewardPromise) return a.rewardPromise;
    a.completed = true;
    a.rewardStatus = "pending";
    const work = (async () => {
      await this.persistStateNow();
      for (const [id, count] of Object.entries(a.contributors || {})) {
        const p = this.repo.getPlayer(String(id));
        if (!p || !p.hasCharacter)
          throw new Error(
            `Open-world contract contributor ${String(id)} is not available for reward recovery.`,
          );
        const grant = async () => {
          const rewardKey = `open-world-contract:${String(a.id)}:${String(id)}`;
          if (
            Array.isArray(p._rewardLedger) &&
            p._rewardLedger.includes(rewardKey)
          )
            return;
          const before = JSON.parse(JSON.stringify(p));
          try {
            const c = Number(count) || 0;
            const mult = 1 + Math.min(0.25, Math.max(0, c - 1) * 0.025);
            const xp = Math.round(Number(a.reward?.xp || 0) * mult);
            const gold = Math.round(Number(a.reward?.gold || 0) * mult);
            p.gold = (Number(p.gold) || 0) + gold;
            if (this.rewardXp) this.rewardXp(p, xp);
            else p.totalXp = Number(p.totalXp || 0) + xp;
            applyReputation(p, { [a.faction]: Number(a.reward?.rep || 0) });
            const state = this.ensurePlayer(p);
            state.regions[a.zone] = {
              ...(state.regions[a.zone] || {}),
              completed: (Number(state.regions[a.zone]?.completed) || 0) + 1,
              lastCompletedAt: Date.now(),
              progress: 100,
            };
            p.lastOpenWorldReward = {
              type: "regional_contract",
              name: a.name,
              xp,
              gold,
              rep: Number(a.reward?.rep || 0),
              faction: a.faction,
              at: Date.now(),
            };
            if (typeof this.repo.savePlayerRewardOnce !== "function")
              throw new Error(
                "Durable open-world reward persistence is unavailable.",
              );
            const committed = await this.repo.savePlayerRewardOnce(
              p,
              rewardKey,
            );
            if (!committed) {
              for (const key of Object.keys(p)) delete p[key];
              Object.assign(p, before);
              return;
            }
          } catch (error) {
            for (const key of Object.keys(p)) delete p[key];
            Object.assign(p, before);
            throw error;
          }
        };
        if (this.playerMutations?.withPlayer)
          await this.playerMutations.withPlayer(String(id), grant);
        else await grant();
      }
      a.rewardStatus = "committed";
      try {
        await this.persistStateNow();
      } catch (error) {
        a.rewardStatus = "pending";
        throw error;
      }
    })();
    a.rewardPromise = work.finally(() => {
      delete a.rewardPromise;
    });
    return a.rewardPromise;
  }
  tick(now = Date.now()) {
    this.retryPendingRareRewards();
    for (const zone of Object.keys(OPEN_WORLD_ACTIVITY_DEFS)) {
      const players = this.eligiblePlayers(zone);
      const current = this.state[zone];
      if (current && current.progress >= current.goal && !current.completed) {
        current.completed = true;
        current.rewardStatus = "pending";
        this.persistState();
      }
      if (current && now >= current.endsAt && !current.completed) {
        current.completed = true;
        current.rewardStatus = "pending";
        this.persistState();
      }
      if (
        current &&
        current.completed &&
        current.rewardStatus !== "committed" &&
        !current.rewardPromise
      ) {
        void this.completeContract(current).catch((error: any) =>
          console.warn(
            "[open-world] contract reward commit failed; will retry:",
            String(error?.message || error),
          ),
        );
      }
      if (
        current &&
        current.completed &&
        current.rewardStatus === "committed" &&
        now >= current.endsAt &&
        !current.rewardPromise
      ) {
        this.state[zone] = null;
        this.persistState();
      }
      if (!players.length) continue;
      const a = this.activeContract(zone, now);
      if (
        a &&
        a.completed &&
        a.rewardStatus === "committed" &&
        now >= a.endsAt &&
        !a.rewardPromise
      ) {
        this.state[zone] = null;
        this.persistState();
      }
      const existing = [...this.world.mobs.values()].some(
        (m: any) => m.zone === zone && m.roamingPackId && m.state !== "dead",
      );
      if (now - this.lastRoam >= this.roamMs && !existing) {
        this.spawnRoamingPack(zone, now);
      }
    }
    if (now - this.lastRoam >= this.roamMs) this.lastRoam = now;
    this.updateRoaming(0.05, now);
  }
  snapshotFor(p: any) {
    const def = OPEN_WORLD_ACTIVITY_DEFS[p.zone];
    if (!def) return null;
    const a = this.state[p.zone] || this.activeContract(p.zone);
    const s = this.ensurePlayer(p);
    const rep = Number(p.factionReputation?.[def.faction] || 0);
    return {
      regionId: p.zone,
      faction: def.faction,
      factionTier: factionTier(rep),
      reputation: rep,
      contract: a
        ? {
            id: a.id,
            name: a.name,
            description: a.description,
            goal: a.goal,
            progress: a.progress,
            endsAt: a.endsAt,
            completed: !!a.completed,
            contribution: Number(a.contributors?.[p.id] || 0),
          }
        : null,
      rareMob:
        (this.world.mobDefs || []).find(
          (m: any) => m.rare && (m.zones || []).includes(p.zone),
        )?.type || null,
      rareKills: Number(
        s.rareKills?.[
          (this.world.mobDefs || []).find(
            (m: any) => m.rare && (m.zones || []).includes(p.zone),
          )?.type
        ] || 0,
      ),
      roamingPacks: [...this.world.mobs.values()].filter(
        (m: any) => m.zone === p.zone && m.roamingPackId && m.state !== "dead",
      ).length,
    };
  }
}
