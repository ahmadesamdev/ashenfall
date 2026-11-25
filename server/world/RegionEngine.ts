const DISCOVERY_RADIUS_METERS = 12;
const ROOT_SNARE_RADIUS_METERS = 18;
const STORM_PERIOD_MS = 180000;
const STORM_DURATION_MS = 45000;
const STORM_DAMAGE_INTERVAL_MS = 5000;

export class RegionEngine {
  regions: any[];
  world: any;
  repo: any;
  worldPoi: any;
  exploration: any;
  byId: Record<string, any>;
  traversal: any;

  constructor(
    regions: any[] = [],
    world: any,
    repo: any,
    worldPoi: any = null,
    exploration: any = null,
    traversal: any = null,
  ) {
    this.regions = regions || [];
    this.world = world;
    this.repo = repo;
    this.worldPoi = worldPoi || { zones: {} };
    this.exploration = exploration || {
      discoveryRewards: { xp: 150, gold: 25 },
      regionFirstVisitReward: { xp: 75, gold: 10 },
      zoneCompletionRewards: {},
      achievementMilestones: [],
      rules: {},
    };
    this.traversal = traversal || { profiles: {}, regionProfiles: {} };
    this.byId = Object.fromEntries(this.regions.map((r: any) => [r.id, r]));
  }

  regionFor(p: any) {
    return this.byId[p?.zone] || null;
  }
  traversalFor(region: any) {
    const id = this.traversal?.regionProfiles?.[region?.id];
    return (
      this.traversal?.profiles?.[id] ||
      this.traversal?.profiles?.lantern_forest || {
        roadSpeedMultiplier: 1,
        offRoadSpeedMultiplier: 1,
        roadAggroMultiplier: 1,
        offRoadAggroMultiplier: 1,
        condition: "normal",
        travelTip: "Follow the roads to travel safely.",
      }
    );
  }
  worldStateFor(zone: string) {
    return this.world?.worldEventState?.[zone]?.worldState || null;
  }
  poisFor(p: any) {
    const list = this.worldPoi?.zones?.[p?.zone] || [];
    return list.map((poi: any) => ({
      ...poi,
      discovered: (p?.regionDiscoveries || []).includes(poi.id),
      description: (p?.regionDiscoveries || []).includes(poi.id)
        ? poi.description
        : "Explore the region to discover this location.",
    }));
  }

  poiSnapshotFor(p: any) {
    if (!p?.zone) return [];
    const ws = this.worldStateFor(p.zone);
    const states = ws?.poiStates || {};
    return this.poisFor(p)
      .map((poi: any) => {
        const state = states[poi.id] || {};
        return {
          id: poi.id,
          name: state.name || poi.name,
          type: poi.type,
          icon: state.icon || poi.icon,
          x: poi.x,
          y: poi.y,
          discovered: !!poi.discovered,
          description: state.description || poi.description,
          state: String(state.state || "normal"),
          label: state.label || null,
          highlight: Boolean(state.highlight),
          available: state.available !== false,
        };
      })
      .filter((poi: any) => poi.available);
  }

  ensurePlayer(p: any) {
    if (!Array.isArray(p.regionDiscoveries)) p.regionDiscoveries = [];
    if (!p.regionRuntime || typeof p.regionRuntime !== "object")
      p.regionRuntime = {};
    if (!p.exploration || typeof p.exploration !== "object")
      p.exploration = {
        version: 2,
        regions: {},
        completedRegions: [],
        milestones: [],
        lastDiscovery: null,
      };
    if (!p.exploration.regions || typeof p.exploration.regions !== "object")
      p.exploration.regions = {};
    if (!Array.isArray(p.exploration.completedRegions))
      p.exploration.completedRegions = [];
    if (!Array.isArray(p.exploration.milestones)) p.exploration.milestones = [];
    return p.regionRuntime;
  }

  zoneDiscoverables(region: any) {
    const pois = (this.worldPoi?.zones?.[region?.id] || []).filter(
      (x: any) => x?.id,
    );
    const hidden = (region?.hiddenLocations || [])
      .filter((x: any) => x?.id)
      .map((x: any) => ({ ...x, type: x.type || "hidden_path" }));
    const seen = new Set<string>();
    return [...pois, ...hidden].filter((x: any) => {
      if (seen.has(x.id)) return false;
      seen.add(x.id);
      return true;
    });
  }

  explorationSnapshotFor(p: any, region: any) {
    this.ensurePlayer(p);
    const all = this.zoneDiscoverables(region);
    const discovered = new Set(p.regionDiscoveries || []);
    const zoneState = p.exploration.regions[region.id] || {};
    const discoveredCount = all.filter((x: any) => discovered.has(x.id)).length;
    return {
      regionDiscovered: Boolean(zoneState.firstVisitedAt),
      discoveredCount,
      totalDiscoveries: all.length,
      completionPercent: all.length
        ? Math.round((discoveredCount / all.length) * 100)
        : 0,
      completed: Boolean(zoneState.completedAt),
      completedAt: zoneState.completedAt || null,
      firstVisitedAt: zoneState.firstVisitedAt || null,
      lastDiscovery: p.exploration.lastDiscovery || null,
      milestones: [...(p.exploration.milestones || [])],
      locations: all.map((x: any) => ({
        id: x.id,
        name: x.name,
        type: x.type,
        icon: x.icon || "◆",
        x: Number(x.x),
        y: Number(x.y),
        discovered: discovered.has(x.id),
        hint: discovered.has(x.id)
          ? x.hint || x.description || ""
          : "Explore this area to uncover it.",
        minLevel: Number(x.minLevel || 1),
      })),
    };
  }

  firstVisit(p: any, region: any, now: number, results: any[]) {
    this.ensurePlayer(p);
    const rs = p.exploration.regions[region.id] || {};
    if (rs.firstVisitedAt) return;
    rs.firstVisitedAt = now;
    rs.firstVisitCount = 1;
    p.exploration.regions[region.id] = rs;
    const reward = this.exploration.regionFirstVisitReward || {
      xp: 75,
      gold: 10,
    };
    const gold = Math.max(0, Number(reward.gold || 0)),
      xp = Math.max(0, Number(reward.xp || 0));
    p.gold = (Number(p.gold) || 0) + gold;
    p.exploration.lastDiscovery = {
      kind: "region",
      regionId: region.id,
      name: region.name,
      at: now,
    };
    results.push({
      type: "region_discovery",
      player: p,
      regionId: region.id,
      location: { id: region.id, name: region.name, type: "region" },
      xp,
      gold,
    });
  }

  maybeMilestones(p, results, now) {
    const milestones = this.exploration.achievementMilestones || [];
    const locationCount = Array.isArray(p.regionDiscoveries)
      ? p.regionDiscoveries.length
      : 0;
    const regionCount = Object.values(p.exploration.regions || {}).filter(
      (x: any) => x?.firstVisitedAt,
    ).length;
    const completeCount = Array.isArray(p.exploration.completedRegions)
      ? p.exploration.completedRegions.length
      : 0;
    for (const m of milestones) {
      if (!m?.id || p.exploration.milestones.includes(m.id)) continue;
      const threshold = Number(m.threshold || 0);
      const value =
        m.condition === "discover_10_locations"
          ? locationCount
          : m.condition === "discover_5_regions"
            ? regionCount
            : m.condition === "complete_3_regions"
              ? completeCount
              : 0;
      if (value < threshold) continue;
      p.exploration.milestones.push(m.id);
      if (!Array.isArray(p.achievements)) p.achievements = [];
      if (!p.achievements.includes(m.id)) p.achievements.push(m.id);
      results.push({
        type: "exploration_milestone",
        player: p,
        milestone: m,
        at: now,
      });
    }
  }

  checkZoneCompletion(p, region, now, results) {
    this.ensurePlayer(p);
    const all = this.zoneDiscoverables(region);
    const discovered = new Set(p.regionDiscoveries || []);
    const rs = p.exploration.regions[region.id] || {};
    if (
      rs.completedAt ||
      !all.length ||
      all.some((x: any) => !discovered.has(x.id))
    )
      return;
    rs.completedAt = now;
    p.exploration.regions[region.id] = rs;
    if (!p.exploration.completedRegions.includes(region.id))
      p.exploration.completedRegions.push(region.id);
    const reward = (this.exploration.zoneCompletionRewards || {})[
      region.id
    ] || { xp: 250, gold: 75 };
    const xp = Math.max(0, Number(reward.xp || 0)),
      gold = Math.max(0, Number(reward.gold || 0));
    p.gold = (Number(p.gold) || 0) + gold;
    results.push({
      type: "zone_exploration_complete",
      player: p,
      regionId: region.id,
      location: { id: region.id, name: region.name, type: "region" },
      xp,
      gold,
    });
  }

  distanceToRoad(p: any) {
    const layout = this.world.layoutFor?.(p.zone) || {};
    const roads = layout.roads || [];
    let best = Infinity;
    for (const road of roads) {
      for (let i = 1; i < road.length; i++) {
        const a = road[i - 1],
          b = road[i],
          dx = b[0] - a[0],
          dy = b[1] - a[1];
        const t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
        const x = a[0] + dx * t,
          y = a[1] + dy * t;
        best = Math.min(best, Math.hypot(p.x - x, p.y - y));
      }
    }
    return best;
  }

  nearHidden(p: any, h: any) {
    return (
      Math.hypot(p.x - Number(h.x), p.y - Number(h.y)) <=
      this.world.normalizedMeters(p.zone, DISCOVERY_RADIUS_METERS)
    );
  }

  stormActive(now: number) {
    const phase = ((now % STORM_PERIOD_MS) + STORM_PERIOD_MS) % STORM_PERIOD_MS;
    return phase < STORM_DURATION_MS;
  }

  hiddenAllowed(p: any, h: any) {
    if (h.id === "sealed_door" && Number(p.storyChapter || 0) < 2) return false;
    return true;
  }

  tick(players: any[], now = Date.now()) {
    const results: any[] = [];
    for (const p of players || []) {
      if (!p?.online || !p.hasCharacter || p.dungeon) continue;
      const region = this.regionFor(p);
      if (!region) continue;
      const rt = this.ensurePlayer(p);
      this.firstVisit(p, region, now, results);
      const mechanics = new Set((region.mechanics || []).map((m: any) => m.id));
      const roadDistance = this.distanceToRoad(p);
      const onRoad = roadDistance <= this.world.normalizedMeters(p.zone, 18);
      const traversal = this.traversalFor(region);
      let speedMultiplier = Number(
        onRoad
          ? traversal.roadSpeedMultiplier
          : traversal.offRoadSpeedMultiplier,
      );
      let condition = String(
        onRoad
          ? traversal.condition || "road"
          : traversal.offRoadCondition ||
              `${traversal.condition || "normal"}-offroad`,
      );
      const worldState = this.worldStateFor(p.zone);
      let resourceMultiplier = 1;

      if (onRoad && mechanics.has("lantern-trails")) {
        speedMultiplier *= 1.02;
        condition = "lantern-trail";
      }
      if (onRoad && mechanics.has("caravan-lanes")) {
        speedMultiplier *= 1.03;
        condition = "caravan-lane";
      }
      if (onRoad && mechanics.has("royal-roads")) {
        speedMultiplier *= 1.02;
        condition = "royal-road";
      }
      if (onRoad && mechanics.has("hollow-winds")) {
        speedMultiplier *= 1.01;
        condition = "hollow-wind";
      }

      if (mechanics.has("root-snare")) {
        const shrine = (region.hiddenLocations || []).find(
          (h: any) => h.id === "rootbound_shrine",
        );
        if (shrine && this.nearHidden(p, shrine)) {
          speedMultiplier = Math.min(speedMultiplier, 0.55);
          condition = "root-snare";
          rt.rootSnareUntil = now + 1200;
        }
      }

      const storm =
        region.id === "ashen_wastes" &&
        mechanics.has("veil-storms") &&
        this.stormActive(now);
      if (storm) {
        condition = "veil-storm";
        rt.veilStorm = true;
        if (now >= Number(rt.nextStormDamageAt || 0)) {
          const damage = Math.max(
            1,
            Math.floor(Number(p.maxHp || p.hp || 1) * 0.01),
          );
          p._lastDamageAt = Date.now();
          p._hpRegenAt = Date.now();
          p.hp = Math.max(0, Number(p.hp || 0) - damage);
          rt.nextStormDamageAt = now + STORM_DAMAGE_INTERVAL_MS;
          if (p.hp <= 0) {
            p.dead = true;
            p.respawnAt = now + 10000;
            p.respawnReady = false;
          }
          results.push({ type: "storm_damage", player: p, damage });
        }
      } else {
        rt.veilStorm = false;
        rt.nextStormDamageAt = 0;
      }

      resourceMultiplier =
        region.id === "ashen_wastes" && mechanics.has("volatile-veins")
          ? 1.25
          : region.id === "eastern_reach" && mechanics.has("contested-veins")
            ? 1.15
            : 1;
      if (worldState) {
        speedMultiplier *= Number(worldState.travelMultiplier || 1);
        resourceMultiplier *= Number(worldState.resourceMultiplier || 1);
        if (worldState.outcome === "active")
          condition = `event-${worldState.phase || "opening"}`;
        else if (worldState.outcome === "completed")
          condition = "event-recovered";
        else if (worldState.outcome === "failed")
          condition = "event-threatened";
        else if (worldState.outcome === "recovering")
          condition = "event-recovering";
      }
      rt.resourceModifier = resourceMultiplier;
      rt.worldEventState = worldState ? { ...worldState } : null;
      rt.onRegionalRoad = onRoad;
      rt.condition = condition;
      rt.speedMultiplier = speedMultiplier;
      rt.updatedAt = now;
      const aggroMultiplier = Number(
        onRoad
          ? traversal.roadAggroMultiplier
          : traversal.offRoadAggroMultiplier,
      );
      rt.regionalAggroMultiplier = aggroMultiplier;

      for (const h of region.hiddenLocations || []) {
        if (
          !this.hiddenAllowed(p, h) ||
          !this.nearHidden(p, h) ||
          p.regionDiscoveries.includes(h.id)
        )
          continue;
        if (Number(p.level || 1) < Number(h.minLevel || 1)) continue;
        p.regionDiscoveries.push(h.id);
        const base = this.exploration.discoveryRewards || { xp: 150, gold: 25 };
        const rewardXp = Number(h.reward?.xp ?? base.xp ?? 120),
          rewardGold = Number(h.reward?.gold ?? base.gold ?? 35);
        p.gold = (Number(p.gold) || 0) + rewardGold;
        p.exploration.lastDiscovery = {
          kind: "location",
          regionId: region.id,
          locationId: h.id,
          name: h.name,
          at: now,
        };
        results.push({
          type: "discovery",
          player: p,
          regionId: region.id,
          location: h,
          xp: rewardXp,
          gold: rewardGold,
        });
      }
      for (const poi of this.poisFor(p)) {
        if (p.regionDiscoveries.includes(poi.id)) continue;
        if (Number(p.level || 1) < Number(poi.minLevel || 1)) continue;
        if (
          Math.hypot(p.x - Number(poi.x), p.y - Number(poi.y)) >
          this.world.normalizedMeters(p.zone, DISCOVERY_RADIUS_METERS)
        )
          continue;
        p.regionDiscoveries.push(poi.id);
        const base = this.exploration.discoveryRewards || { xp: 150, gold: 25 };
        const rewardXp = Number(
          poi.reward?.xp ??
            (poi.type === "lore"
              ? 140
              : poi.type === "landmark"
                ? 110
                : poi.type === "settlement"
                  ? 90
                  : poi.type === "rare_spawn"
                    ? 170
                    : base.xp),
        );
        const rewardGold = Number(
          poi.reward?.gold ??
            (poi.type === "resource_hotspot"
              ? 60
              : poi.type === "rare_spawn"
                ? 90
                : base.gold),
        );
        p.gold = (Number(p.gold) || 0) + rewardGold;
        p.exploration.lastDiscovery = {
          kind: "location",
          regionId: region.id,
          locationId: poi.id,
          name: poi.name,
          at: now,
        };
        results.push({
          type: "poi_discovery",
          player: p,
          regionId: region.id,
          location: poi,
          xp: rewardXp,
          gold: rewardGold,
        });
      }
      this.checkZoneCompletion(p, region, now, results);
      this.maybeMilestones(p, results, now);
    }
    return results;
  }

  snapshotFor(p: any) {
    const r = this.regionFor(p);
    if (!r) return null;
    const rt = this.ensurePlayer(p);
    const storm = r.id === "ashen_wastes" && this.stormActive(Date.now());
    const traversalForSnapshot = this.traversalFor(r);

    return {
      id: r.id,
      name: r.name,
      environment: r.environment,
      identity: r.identity,
      mechanics: r.mechanics || [],
      materials: r.materials || [],
      settlements: r.settlements || [],
      rareMob: r.rareMob || null,
      dungeon: r.dungeon || null,
      worldEvents: r.worldEvents || [],
      lore: r.lore || "",
      discoveries: (p.regionDiscoveries || []).filter(
        (id: string) =>
          (r.hiddenLocations || []).some((h: any) => h.id === id) ||
          this.poisFor(p).some((h: any) => h.id === id),
      ),
      pois: this.poiSnapshotFor(p),
      hiddenLocations: (r.hiddenLocations || []).map((h: any) => ({
        id: h.id,
        name: h.name,
        x: h.x,
        y: h.y,
        discovered: (p.regionDiscoveries || []).includes(h.id),
        hint: (p.regionDiscoveries || []).includes(h.id)
          ? h.hint
          : "Explore the region to uncover this location.",
      })),
      runtime: {
        condition: rt.condition || "normal",
        onRegionalRoad: !!rt.onRegionalRoad,
        speedMultiplier: Number(rt.speedMultiplier || 1),
        resourceModifier: Number(rt.resourceModifier || 1),
        regionalAggroMultiplier: Number(rt.regionalAggroMultiplier || 1),
        travelTip: traversalForSnapshot.travelTip || "",
        veilStorm: storm,
        worldEvent: rt.worldEventState || null,
      },
      worldEventState: this.worldStateFor(r.id),
      exploration: this.explorationSnapshotFor(p, r),
    };
  }
}
