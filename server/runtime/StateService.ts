import {
  CHARACTER_PROGRESSION,
  progressionBand,
  storyChapterForLevel,
} from "../progression/CharacterProgression.js";
import { narrativeSnapshot } from "../progression/StoryProgression.js";
import { progressionSummary } from "../progression/ProgressionSummary.js";
import { levelingJourneyForPlayer } from "../progression/LevelingJourney.js";
import { itemGearScore } from "../items/ItemizationEngine.js";
import { sectionsForCommand } from "../shared/CommandStateSections.js";
import { PlayerSpatialIndex } from "../shared/PlayerSpatialIndex.js";
export function createStateService(ctx: any) {
  const {
    repo,
    guildOrganizations,
    worldIntegration,
    chronicle,
    mmo,
    world,
    worldMobDefs,
    quest,
    quests,
    social,
    classStories,
    lore,
    economy,
    worldEvents,
    worldSimulation,
    npcMemory,
    emergentWorldEvents,
    discoveryEngine,
    regionalEconomy,
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
    worldRegions,
    worldPoi,
    worldZoneProgression,
    gates,
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
    stateRevisionRef,
    uiRevisionRef,
    motionSequenceRef,
  } = ctx;
  let motionSequence = motionSequenceRef.value;
  let playerSpatialIndex: PlayerSpatialIndex<any> | null = null;
  let spatialIndexBroadcastActive = false;
  const rebuildPlayerSpatialIndex = () => {
    playerSpatialIndex = new PlayerSpatialIndex(world.players || []);
    return playerSpatialIndex;
  };
  const nearbyPlayers = (p: any, radius: number, limit = 250) => {
    const index = spatialIndexBroadcastActive
      ? playerSpatialIndex || rebuildPlayerSpatialIndex()
      : new PlayerSpatialIndex(world.players || []);
    const instanceKey = String(p.dungeon?.instanceId || "");
    return index
      .nearby(p.zone, p.x, p.y, radius, p.id, limit * 2)
      .filter((x: any) => String(x.dungeon?.instanceId || "") === instanceKey)
      .slice(0, limit);
  };
  const getStateRevision = () => stateRevisionRef.value;
  const getUiRevision = () => uiRevisionRef.value;
  function zonePlayers(p) {
    return nearbyPlayers(p, world.normalizedMeters(p.zone, 650), 250).map(
      (x) => ({
        id: x.id,
        name: x.name,
        icon: x.icon,
        classId: x.classId,
        role: x.role,
        level: x.level,
        x: x.x,
        y: x.y,
        hp: x.hp,
        maxHp: x.maxHp,
        dead: !!x.dead,
        velocityX: Number(x.velocityX || 0),
        velocityY: Number(x.velocityY || 0),
        facingX: Number(x.facingX || 0),
        facingY: Number(x.facingY || -1),
        statuses: (Array.isArray(x.statuses) ? x.statuses : []).map(
          (s: any) => ({
            id: s.id,
            name: s.name || s.id,
            effect: s.effect || s.description || "",
            duration: s.duration || null,
            until: s.until || 0,
            description: s.description || "",
            icon: s.icon || null,
            tickHeal: Number(s.tickHeal || 0),
            damage: Number(
              s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0,
            ),
            damagePerTick: Number(
              s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0,
            ),
            modifiers: { ...(s.modifiers || {}) },
          }),
        ),
        movementMode: x.movementMode,
        partyId: x.partyId,
        guildId: x.guildId,
        pvp: !!x.pvp,
        battlegroundId: x.battlegroundId || null,
        combatFx: (x.combatFx || [])
          .filter((f: any) => Number(f.expiresAt || 0) > Date.now())
          .slice(-8),
      }),
    );
  }
  function visibleMobs(p, limit = 120) {
    const maxDistance = world.normalizedMeters(p.zone, 10000);
    const all: any[] = world.zoneMobs(p.zone, p);
    const nearby = all.filter(
      (m) =>
        Math.hypot(m.x - p.x, m.y - p.y) <= maxDistance ||
        m.aggroTarget === p.id ||
        m.id === p.targetMobId,
    );
    nearby.sort(
      (a, b) =>
        Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
    );
    const capped = nearby.slice(0, limit);
    if (capped.length < 12) {
      for (const m of all.slice().sort((a, b) => {
        const ad = (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y),
          bd = (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y);
        return ad - bd;
      })) {
        if (!capped.includes(m)) capped.push(m);
        if (capped.length >= 12) break;
      }
    }
    return capped;
  }
  function worldMobs(p) {
    return visibleMobs(p, 120).map((m) => ({
      id: m.id,
      type: m.type,
      name: m.name,
      icon: m.icon,
      level: m.level,
      hp: m.hp,
      maxHp: m.maxHp,
      x: m.x,
      y: m.y,
      velocityX: m.velocityX || 0,
      velocityY: m.velocityY || 0,
      radius: m.radius,
      temper: m.temper,
      state: m.state,
      statuses: (m.statuses || []).map((s) => ({
        id: s.id,
        name: s.name || s.id,
        until: s.until || 0,
        description: s.description || "",
        icon: s.icon || null,
        duration: s.duration || null,
        damage: Number(s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0),
        damagePerTick: Number(
          s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0,
        ),
        modifiers: { ...(s.modifiers || {}) },
      })),
      aggroTarget: m.aggroTarget,
      ranged: !!m.ranged,
      leader: !!m.leader,
      elite: !!m.elite,
      rare: !!m.rare,
      aoe: !!m.aoe,
      behaviorProfile: m.behaviorProfile || "territorial",
      faction: m.faction || "wilds",
    }));
  }
  function worldOres(p) {
    const maxDistance = world.normalizedMeters(p.zone, 800);
    return world
      .zoneOres(p.zone)
      .filter((o) => Math.hypot(o.x - p.x, o.y - p.y) <= maxDistance)
      .map((o) => ({
        id: o.id,
        type: o.type,
        name: o.name,
        icon: o.icon,
        level: o.level,
        miningLevel: o.miningLevel || o.level,
        x: o.x,
        y: o.y,
        state: o.state,
      }));
  }
  function lootState(p) {
    const maxDistance = world.normalizedMeters(p.zone, 800);
    return world
      .zoneLoot(p.zone)
      .filter((l) => Math.hypot(l.x - p.x, l.y - p.y) <= maxDistance)
      .map((l) => ({
        id: l.id,
        x: l.x,
        y: l.y,
        icon: l.icon,
        name: l.name,
        gold: l.gold,
        items: l.items,
        eligible: l.eligible.includes(p.id),
      }));
  }
  function worldMapGates() {
    return Object.entries(world.gates || {}).flatMap(([zone, list]) =>
      (Array.isArray(list) ? list : []).map((g: any) => ({ ...g, zone })),
    );
  }
  function worldMapNpcs(p) {
    return npcs.map((n) => {
      const offers = quest.offersForNpc(p, n),
        turnins = quest.turninsForNpc(p, n);
      let marker = "";
      if (turnins.length) marker = "?";
      else if (offers.length) marker = "!";
      return {
        ...n,
        questMarker: marker,
        offersCount: offers.length,
        turninsCount: turnins.length,
      };
    });
  }
  function npcDetail(p, n) {
    const offers = quest.offersForNpc(p, n),
      turnins = quest.turninsForNpc(p, n);
    npcMemory?.rememberInteraction?.(n.id, p.id);
    const memory = npcMemory?.summary?.(n.id, p.id) || null;
    const active = (n.questIds || [])
      .map((id) => quest.get(id))
      .filter(Boolean)
      .map((q) => ({ quest: q, state: quest.state(p, q.id) }))
      .filter((x) => x.state.accepted && !x.state.claimed);
    const d: any = {
      npc: n,
      offers,
      turnins,
      activeQuests: active,
      service: n.kind,
      shopId: n.shopId || null,
      memory,
    };
    if (n.kind === "teleporter")
      d.teleports = zones
        .filter((z) => z.city && z.id !== p.zone)
        .map((z) => ({
          id: z.id,
          name: z.name,
          icon: z.icon,
          danger: z.danger,
        }));
    if (n.kind === "profession_trainer") {
      d.profession = n.profession;
      d.professionLevel = p.profession?.[n.profession] || 0;
      d.professionKnown = (p.professions || []).includes(n.profession);
    }
    if (n.kind === "trainer") {
      d.classId = n.classId;
      d.isClassTrainer = true;
      d.isYourClass = n.classId === p.classId;
      d.playerClassId = p.classId;
    }
    if (n.kind === "auctioneer") d.auction = true;
    return d;
  }
  function questHelperForPlayer(p) {
    quest.reconcile(p);
    const eligibleEntries = Object.entries(p.quests || {}).filter(
      ([id, q]: any) =>
        q &&
        q.visible !== false &&
        !q.claimed &&
        (q.accepted || q.complete || q.visible),
    );
    const explicitId = String(p.activeQuestId || "");
    const explicit = explicitId
      ? eligibleEntries.find(([id]: any) => String(id) === explicitId)
      : null;
    const active = explicit
      ? quest.get(explicit[0])
      : eligibleEntries
          .map(([id]: any) => quest.get(id))
          .filter(Boolean)
          .sort(
            (a: any, b: any) =>
              Number(!!p.quests[b.id]?.accepted && !p.quests[b.id]?.complete) -
                Number(
                  !!p.quests[a.id]?.accepted && !p.quests[a.id]?.complete,
                ) ||
              Number(!!p.quests[b.id]?.complete) -
                Number(!!p.quests[a.id]?.complete) ||
              Number(!!p.quests[b.id]?.accepted) -
                Number(!!p.quests[a.id]?.accepted),
          )[0];
    if (!active) {
      const contracts =
        worldIntegration?.activeContracts?.(
          p.id,
          Number(worldIntegration?.state?.lastTick || 0),
        ) || [];
      const c =
        contracts.find((x: any) => String(x.regionId) === String(p.zone)) ||
        contracts[0];
      if (!c) return null;
      const idx = Number(c.objectiveIndex || 0),
        steps = c.objectives || [];
      return {
        id: c.id,
        name: c.title,
        description: c.description,
        type: "world_contract",
        zoneId: c.regionId,
        targetName: c.targetName || c.label || "World objective",
        targetX: Number.isFinite(Number(c.targetX)) ? Number(c.targetX) : null,
        targetY: Number.isFinite(Number(c.targetY)) ? Number(c.targetY) : null,
        routeZoneId: c.targetZoneId || c.regionId,
        progress: idx,
        amount: steps.length || 3,
        complete: c.status === "completed",
        turnIn: false,
        objective: steps[idx] || "Complete the world situation.",
      };
    }
    const st = p.quests[active.id] || {};
    let zoneId = active.target || p.zone,
      targetKind = active.type,
      targetName = zoneId ? world.byId[zoneId]?.name : null,
      x = null,
      y = null;
    if (st.complete && !st.claimed && active.giver) {
      const giver = npcs.find((n: any) => n.id === active.giver);
      if (giver) {
        targetKind = "talk";
        targetName = giver.name;
        if (giver.zone === p.zone) {
          zoneId = giver.zone;
          x = giver.x;
          y = giver.y;
        } else {
          const gate = (world.zoneGates(p.zone) || []).find(
            (g: any) => g.to === giver.zone,
          );
          if (gate) {
            zoneId = p.zone;
            x = gate.x;
            y = gate.y;
            targetKind = "travel";
            targetName = `Gate to ${world.byId[giver.zone]?.name || giver.zone}`;
          } else {
            zoneId = p.zone;
            targetKind = "travel";
            targetName = `Return to ${world.byId[giver.zone]?.name || giver.zone}`;
            x = null;
            y = null;
          }
        }
      }
    } else if (active.id === "call_of_ashenfall") {
      const giver =
        npcs.find((n: any) => n.id === active.giver) ||
        npcs.find((n: any) => /Captain Aric/i.test(n.name || ""));
      zoneId = giver?.zone || p.zone;
      targetKind = "talk";
      targetName = giver?.name || "Captain Aric";
      x = giver?.x ?? p.x;
      y = giver?.y ?? p.y;
    } else if (active.type === "kill") {
      const def = worldMobDefs.find((m: any) => m.type === active.enemy);
      if (def) {
        const zids = def.zones || [];
        zoneId = p.zone && zids.includes(p.zone) ? p.zone : zids[0] || p.zone;
        targetName = def.name;
        const m = world
          .zoneMobs(zoneId)
          .find((m: any) => m.type === active.enemy);
        if (m) {
          x = m.x;
          y = m.y;
        } else if (world.byId[zoneId]?.spawn) {
          x = world.byId[zoneId].spawn.x;
          y = world.byId[zoneId].spawn.y;
        }
      }
    } else if (active.type === "talk") {
      const n = npcs.find((x: any) => x.id === active.target);
      if (n) {
        zoneId = n.zone;
        targetName = n.name;
        x = n.x;
        y = n.y;
      }
    } else if (active.type === "mine") {
      const o =
        world.zoneOres(p.zone).find((x: any) => x.type === active.target) ||
        zones
          .map((z: any) =>
            world.zoneOres(z.id).find((x: any) => x.type === active.target),
          )
          .find(Boolean);
      if (o) {
        zoneId = o.zone;
        targetName = o.name;
        x = o.x;
        y = o.y;
      } else {
        zoneId = p.zone;
        targetName = "Ore vein";
      }
    } else if (active.type === "travel") {
      if (active.target !== p.zone) {
        const gate = (world.zoneGates(p.zone) || []).find(
          (g: any) => g.to === active.target,
        );
        if (gate) {
          x = gate.x;
          y = gate.y;
          targetName = world.byId[active.target]?.name || active.target;
        }
      } else {
        x = world.byId[p.zone]?.spawn?.x ?? p.x;
        y = world.byId[p.zone]?.spawn?.y ?? p.y;
        targetName = world.byId[p.zone]?.name || p.zone;
      }
    } else if (active.type === "dungeon" || active.type === "dungeon_stage") {
      const dungeon =
        dungeons.find((d: any) => d.id === active.target) ||
        dungeons.find((d: any) => d.baseDungeonId === active.target);
      const baseId = dungeon?.baseDungeonId || active.target;
      targetName =
        dungeon?.name || String(active.target || "Dungeon").replace(/_/g, " ");
      const poi = Object.entries<any>(worldPoi?.zones || {})
        .flatMap(([, arr]) => (Array.isArray(arr) ? arr : []))
        .find(
          (v: any) =>
            v.type === "dungeon_entrance" &&
            String(v.id).startsWith(
              String(baseId).replace(/_(?:veteran|heroic|mythic|apex)$/, ""),
            ),
        );
      if (poi) {
        const zoneEntry = Object.entries<any>(worldPoi?.zones || {}).find(
          ([, arr]) =>
            Array.isArray(arr) && arr.some((v: any) => v.id === poi.id),
        );
        zoneId = String(zoneEntry?.[0] || p.zone);
        x = Number(poi.x);
        y = Number(poi.y);
      }
    } else if (active.type === "world_event") {
      const arr = Array.isArray(worldPoi?.zones?.[p.zone])
        ? worldPoi.zones[p.zone]
        : [];
      const site = arr.find((v: any) => v.type === "event_site");
      targetName = String(active.target || "world event").replace(/_/g, " ");
      if (site) {
        zoneId = p.zone;
        x = Number(site.x);
        y = Number(site.y);
      }
    } else if (active.giver) {
      const giver = npcs.find((n: any) => n.id === active.giver);
      if (giver) {
        targetKind = "talk";
        targetName = giver.name;
        zoneId = giver.zone;
        if (giver.zone === p.zone) {
          x = giver.x;
          y = giver.y;
        } else {
          const gate = (world.zoneGates(p.zone) || []).find(
            (g: any) => g.to === giver.zone,
          );
          if (gate) {
            zoneId = p.zone;
            x = gate.x;
            y = gate.y;
            targetKind = "travel";
            targetName = `Gate to ${world.byId[giver.zone]?.name || giver.zone}`;
          }
        }
      }
    } else if (zoneId && world.byId[zoneId]?.spawn) {
      x = world.byId[zoneId].spawn.x;
      y = world.byId[zoneId].spawn.y;
    }
    return {
      id: active.id,
      name: active.name,
      description: active.description,
      type: targetKind,
      zoneId,
      targetName,
      targetX: x,
      targetY: y,
      routeZoneId: zoneId,
      progress: p.quests[active.id]?.progress || 0,
      amount: active.amount || 1,
      complete: !!st.complete,
      turnIn: !!(st.complete && !st.claimed),
    };
  }
  function partyState(p: any) {
    const party = social.getParty(p.partyId);
    if (!party) return null;
    return {
      id: party.id,
      leader: party.leader,
      assistId: p.partyAssistId || party.leader,
      chat: (party.chat || []).slice(-80),
      lootMethod: "group",
      lootThreshold: "uncommon",
      members: party.members
        .map((id) => {
          const x = repo.getPlayer(id);
          if (!x) return null;
          const range =
            x.id === p.id
              ? 0
              : x.zone === p.zone
                ? world.worldMetersFor(p.zone) *
                  Math.hypot(x.x - p.x, x.y - p.y)
                : Infinity;
          const encounter = x.encounterId ? combat.get(x.encounterId) : null;
          const threatTarget = encounter?.threat
            ? Object.entries(encounter.threat).sort(
                (a: any, b: any) => Number(b[1]) - Number(a[1]),
              )[0]?.[0]
            : null;
          const targetMob = x.targetMobId ? world.byIdMob(x.targetMobId) : null;
          const targetPlayer = x.targetPlayerId
            ? repo.getPlayer(x.targetPlayerId)
            : null;
          const incomingHeal = (x.statuses || [])
            .filter(
              (st: any) =>
                Number(st.until || 0) > Date.now() &&
                st.sourcePlayerId &&
                Number(st.tickHeal || 0) > 0,
            )
            .reduce(
              (sum: number, st: any) => sum + Number(st.tickHeal || 0),
              0,
            );
          return {
            id: x.id,
            name: x.name,
            icon: x.icon,
            classId: x.classId,
            role: x.role,
            partyRole: x.partyRole || partyRole(x),
            secondaryRole: x.secondaryRole || null,
            level: x.level,
            zone: x.zone,
            online: !!x.online,
            x: x.x,
            y: x.y,
            hp: x.hp,
            maxHp: x.maxHp,
            resolve: x.resolve,
            maxResolve: x.maxResolve,
            targetMobId: x.targetMobId,
            targetPlayerId: x.targetPlayerId,
            target: targetMob
              ? {
                  id: targetMob.id,
                  name: targetMob.name,
                  type: targetMob.type,
                  hp: targetMob.hp,
                  maxHp: targetMob.maxHp,
                }
              : targetPlayer
                ? {
                    id: targetPlayer.id,
                    name: targetPlayer.name,
                    type: "player",
                    hp: targetPlayer.hp,
                    maxHp: targetPlayer.maxHp,
                  }
                : null,
            dead: !!x.dead,
            rangeMeters: Number.isFinite(range)
              ? Math.round(range * 10) / 10
              : null,
            inSupportRange: Number.isFinite(range) && range <= 45,
            incomingHealPerSecond: Math.round(incomingHeal * 100) / 100,
            assistSelected: p.partyAssistId === x.id,
            combat: encounter
              ? {
                  enemyId: encounter.enemy.id,
                  enemyName: encounter.enemy.name,
                  enemyHp: encounter.enemyHp,
                  maxHp: encounter.maxHp,
                  phase: encounter.phase,
                  threat: Number(encounter.threat?.[x.id] || 0),
                  threatPercent: Math.max(
                    0,
                    Math.min(
                      100,
                      (Number(encounter.threat?.[x.id] || 0) /
                        Math.max(
                          ...Object.values(encounter.threat || {}).map(Number),
                          1,
                        )) *
                        100,
                    ),
                  ),
                  isThreatTarget: threatTarget === x.id,
                  forcedThreatTarget:
                    encounter.forcedTarget?.id === x.id &&
                    Number(encounter.forcedTarget?.until || 0) > Date.now(),
                  cast: encounter.cast
                    ? {
                        name: encounter.cast.name,
                        endsAt: encounter.cast.endsAt,
                        targetPlayerId: encounter.cast.targetPlayerId,
                        targetPlayerIds: encounter.cast.targetPlayerIds || [],
                      }
                    : null,
                }
              : null,
            statuses: (x.statuses || []).map((st: any) => ({
              id: st.id,
              name:
                st.name ||
                (String(st.id || "").startsWith("hot_") ? "Renew" : st.id),
              effect: st.effect || st.description || "Active status effect",
              duration: st.duration || null,
              until: st.until || 0,
              description: st.description || "",
              icon: st.icon || null,
              tickHeal: Number(st.tickHeal || 0),
            })),
            combatFx: (x.combatFx || [])
              .filter((f: any) => Number(f.expiresAt || 0) > Date.now())
              .slice(-8),
          };
        })
        .filter(Boolean),
    };
  }
  function storyProgressForPlayer(p: any) {
    const claimed = new Set(
      Object.entries(p.quests || {})
        .filter(([, q]: any) => q?.claimed)
        .map(([id]) => id),
    );
    const accepted = new Set(
      Object.entries(p.quests || {})
        .filter(([, q]: any) => q?.accepted && !q?.claimed)
        .map(([id]) => id),
    );
    const arcs = (worldStory.arcs || []).map((arc: any, index: number) => {
      const ids = Array.isArray(arc.quests) ? arc.quests : [];
      const done = ids.filter((id: string) => claimed.has(id)).length;
      const active = ids.filter((id: string) => accepted.has(id)).length;
      return {
        id: arc.id,
        index,
        name: arc.name,
        purpose: arc.purpose,
        zones: arc.zones || [],
        quests: ids,
        total: ids.length,
        completed: done,
        active,
        complete: ids.length > 0 && done >= ids.length,
      };
    });
    const current =
      arcs.find((a: any) => !a.complete) || arcs[arcs.length - 1] || null;
    const completedQuests = Object.values(p.quests || {}).filter(
      (q: any) => q?.claimed,
    ).length;
    const mainStory = (quests || []).filter(
      (q: any) => q?.category === "main_story",
    );
    const activeMain =
      mainStory.find(
        (q: any) => p.quests?.[q.id]?.accepted && !p.quests?.[q.id]?.claimed,
      ) || null;
    const nextMain =
      activeMain ||
      mainStory.find(
        (q: any) =>
          !p.quests?.[q.id]?.claimed &&
          (q.requires || []).every((id: string) => p.quests?.[id]?.claimed) &&
          Number(q.minLevel || 1) <= Number(p.level || 1),
      ) ||
      null;
    return {
      currentArcId: current?.id || null,
      currentArcName: current?.name || null,
      currentChapter: Number(p.storyChapter || 0),
      recommendedChapter: storyChapterForLevel(p.level),
      completedQuests,
      nextMainQuest: nextMain
        ? {
            id: nextMain.id,
            name: nextMain.name,
            chapter: nextMain.chapter,
            storyChapterId: Number(nextMain.storyChapterId || 0),
            giver: nextMain.giver || null,
            minLevel: Number(nextMain.minLevel || 1),
          }
        : null,
      arcs,
    };
  }
  function state(c: any, includeCatalog = false, sections: any = {}) {
    const p = c.player;
    const progressionGearInventory = (p.inventory || [])
      .filter((x: any) => x?.qty > 0)
      .map((x: any) => {
        const it = items[x.itemId];
        if (
          !it ||
          ![
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
        )
          return null;
        return {
          id: x.itemId,
          name: it.name,
          itemLevel: Number(it.itemLevel || it.level || 1),
          rarity: it.rarity || "common",
          gearScore: Number(itemGearScore(it, itemization || {}).toFixed(2)),
        };
      })
      .filter(Boolean);
    profession.ensure(p);
    normalizeMovement(p);
    normalizeStoryQuest(p);
    const e = p.encounterId ? combat.get(p.encounterId) : null;
    const invite = social.invites.get(p.id);
    const classDef =
      classes[p.classId] ||
      (Array.isArray(classes)
        ? classes.find((x: any) => x?.id === p.classId)
        : null);
    if (classDef) {
      p.icon = classDef.icon || p.icon;
      p.role = classDef.role || p.role || "Adventurer";
      p.partyRole =
        classDef.partyRole ||
        p.partyRole ||
        (["vanguard"].includes(classDef.id)
          ? "Tank"
          : classDef.id === "hierophant"
            ? "Healer"
            : classDef.id === "warden"
              ? "Support"
              : "DPS");
      p.resourceName = classDef.resource || p.resourceName || "Resolve";
      p.resourceIcon = classDef.resourceIcon || p.resourceIcon || "🔥";
      if (Number(p.maxHp || 0) <= 0) p.maxHp = Number(classDef.baseHp || 1);
      if (!p.dead && Number(p.hp || 0) <= 0) p.hp = p.maxHp;
      if (Number(p.maxResolve || 0) <= 0)
        p.maxResolve = Number(classDef.baseResolve || 1);
      if (Number(p.resolve || 0) < 0) p.resolve = 0;
      const allowed = new Set(
        Array.isArray(classDef.abilities) ? classDef.abilities : [],
      );
      const starter =
        Array.isArray(classDef.startSkills) && classDef.startSkills.length
          ? classDef.startSkills
          : (classDef.abilities || [])
              .filter(
                (id: any) => Number((classDef.abilityUnlocks || {})[id]) <= 1,
              )
              .slice(0, 3);
      const known = (Array.isArray(p.abilityIds) ? p.abilityIds : []).filter(
        (id: any) => allowed.has(id),
      );
      for (const id of starter) {
        if (known.length >= 3) break;
        if (!known.includes(id)) known.push(id);
      }
      p.abilityIds = known;
      p.learnedSkills = [
        ...new Set(
          (Array.isArray(p.learnedSkills) ? p.learnedSkills : [])
            .filter((id: any) => allowed.has(id))
            .concat(known),
        ),
      ];
      p.knownAbilities = known.slice();
    }
    const playerSnapshot = {
      ...p,
      icon: classDef?.icon || p.icon,
      role: classDef?.role || p.role,
      partyRole: classDef?.partyRole || p.partyRole,
      resourceName: classDef?.resource || p.resourceName,
      resourceIcon: classDef?.resourceIcon || p.resourceIcon,
      respawnReady: !!p.respawnReady,
    };
    const base: any = {
      serverNow: Date.now(),
      stateRevision: getStateRevision(),
      uiRevision: getUiRevision(),
      player: playerSnapshot,
      progression: {
        ...progressionSummary(p),
        journey: levelingJourneyForPlayer(p, classes, zones, dungeons),
        availableSkills: p.availableSkills || [],
        loadouts: (p.loadouts || []).map((x: any) => ({
          id: x.id,
          slot: x.slot,
          name: x.name,
          buildId: x.buildId,
          savedAt: x.savedAt,
          active: x.id === p.activeLoadoutId,
        })),
        gearInventory: progressionGearInventory,
      },
      guild: social.guildSnapshot(p),
      social: {
        friends: (p.friends || [])
          .map((id: string) => {
            const f = repo.getPlayer(id);
            return f
              ? {
                  id: f.id,
                  name: f.name,
                  online: !!f.online,
                  zone: f.zone,
                  level: f.level,
                  icon: f.icon,
                  classId: f.classId,
                  role: f.role,
                }
              : null;
          })
          .filter(Boolean),
        ignored: (p.ignoredPlayers || [])
          .map((id: string) => {
            const f = repo.getPlayer(id);
            return f ? { id: f.id, name: f.name, online: !!f.online } : null;
          })
          .filter(Boolean),
        notifications: (p.socialNotifications || []).slice(-20),
        whispers: (p.chatHistory || [])
          .filter((m: any) => m?.kind === "whisper")
          .slice(-40),
        guildChat: (p.guildChatHistory || []).slice(-40),
      },
      storyProgress: storyProgressForPlayer(p),
      narrativeStory: narrativeSnapshot(
        p,
        storyline,
        worldStory,
        classStories,
        lore,
      ),
      party: partyState(p),
      questHelper: p.dungeon ? null : questHelperForPlayer(p),
      pendingPartyInvite: invite
        ? {
            id: invite.id,
            partyId: invite.partyId,
            fromId: invite.from,
            fromName: repo.getPlayer(invite.from)?.name || "Player",
            at: invite.at,
          }
        : p.pendingPartyInvite &&
            Date.now() - Number(p.pendingPartyInvite.at || 0) < 60000
          ? {
              id: p.pendingPartyInvite.id,
              partyId: p.pendingPartyInvite.partyId,
              fromId: p.pendingPartyInvite.from,
              fromName:
                repo.getPlayer(p.pendingPartyInvite.from)?.name || "Player",
              at: p.pendingPartyInvite.at,
            }
          : null,
      pendingGuildInvite:
        p.pendingGuildInvite &&
        Date.now() - Number(p.pendingGuildInvite.at || 0) < 120000
          ? {
              id: p.pendingGuildInvite.id,
              guildId: p.pendingGuildInvite.guildId,
              guildName:
                social.guilds.get(p.pendingGuildInvite.guildId)?.name ||
                "Guild",
              fromId: p.pendingGuildInvite.from,
              fromName:
                repo.getPlayer(p.pendingGuildInvite.from)?.name || "Player",
              at: p.pendingGuildInvite.at,
            }
          : null,
      pendingFriendRequests: (p.pendingFriendRequests || [])
        .filter(
          (r: any) => Date.now() - Number(r.at || 0) < 7 * 24 * 60 * 60 * 1000,
        )
        .map((r: any) => ({
          fromId: r.fromId,
          fromName: repo.getPlayer(r.fromId)?.name || "Player",
          at: r.at,
        })),
      pendingPvpInvite: p.pvpInvite
        ? {
            fromId: p.pvpInvite.from,
            fromName: repo.getPlayer(p.pvpInvite.from)?.name || "Player",
          }
        : null,
      mailSummary: economy.mailSummary(p.id),
      pvp: p.pvp
        ? {
            id: p.pvp.id,
            opponentId: p.pvp.opponentId,
            state: p.pvp.state,
            combatUntil: p.pvpCombatUntil || 0,
            zoneEnabled: pvpZone(p),
            centerX: p.pvp.centerX,
            centerY: p.pvp.centerY,
            arenaRadius: p.pvp.arenaRadius,
            outSince: p.pvp.outSince || 0,
            stats: pvpStats(p),
          }
        : null,
      dungeonQueue: dungeonQueueSnapshot(p),
      dungeonMatch: p.dungeonMatch || null,
      battleground: p.battlegroundId
        ? battlegrounds.has(p.battlegroundId)
          ? battlegroundSnapshot(battlegrounds.get(p.battlegroundId))
          : { id: p.battlegroundId, state: "finished" }
        : null,
      pvpStats: pvpStats(p),
      pvpQueue: pvpQueueSnapshot(p),
      lastPvpResult: p.lastPvpResult || null,
      pvpRuntimeStats: p.pvpRuntimeStats || null,
      worldEvent: worldEvents.snapshotFor(p),
      emergentWorldEvents: emergentWorldEvents?.snapshotForRegion?.(p.zone) || {
        active: [],
        recent: [],
      },
      dynamicDiscoveries:
        discoveryEngine?.snapshotForRegion?.(
          p.zone,
          worldSimulation?.snapshot?.().simulationTick || 0,
        ) || [],
      regionalEconomy: regionalEconomy?.snapshotForRegion?.(p.zone) || null,
      guildWorld: guildOrganizations?.snapshotForGuild?.(p.guildId) || null,
      chronicle: chronicle?.snapshotForPlayer?.(p.id) || null,
      worldIntegration:
        worldIntegration?.snapshotForPlayer?.(p.id, String(p.zone || "")) ||
        null,
      region: regionEngine?.snapshotFor(p) || null,
      worldFactions: worldSimulation?.factionSnapshot?.(p.zone) || [],
      openWorld: openWorld?.snapshotFor(p) || null,
      worldPoi: regionEngine?.poiSnapshotFor(p) || [],
      mmo: mmo?.snapshot(p) || null,
      lootRolls: p.pendingLootRolls || [],
      dungeonRewardChests: (p.dungeonRewardChests || []).map((c: any) => ({
        id: c.id,
        instanceId: c.instanceId,
        dungeonId: c.dungeonId,
        dungeonName: c.dungeonName,
        createdAt: c.createdAt,
        claimedAt: c.claimedAt,
        rewards: c.rewards || { xp: 0, gold: 0, items: [] },
        source: c.source || "dungeon_final_boss",
      })),
      trade: tradeState(p),
      nearby: zonePlayers(p),
      mobs: worldMobs(p),
      targetMob: p.targetMobId
        ? (() => {
            const m = world.byIdMob(p.targetMobId);
            return m && m.zone === p.zone && m.state !== "dead"
              ? {
                  id: m.id,
                  type: m.type,
                  name: m.name,
                  icon: m.icon,
                  level: m.level,
                  hp: m.hp,
                  maxHp: m.maxHp,
                  temper: m.temper,
                  state: m.state,
                  aggroTarget: m.aggroTarget,
                  ranged: !!m.ranged,
                  statuses: (m.statuses || []).map((s) => ({
                    id: s.id,
                    name: s.name || s.id,
                    until: s.until || 0,
                    description: s.description || "",
                    icon: s.icon || null,
                    duration: s.duration || null,
                    damage: Number(
                      s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0,
                    ),
                    damagePerTick: Number(
                      s.damagePerTick ?? s.snapshotDamage ?? s.damage ?? 0,
                    ),
                    modifiers: { ...(s.modifiers || {}) },
                  })),
                }
              : null;
          })()
        : null,
      ores: p.dungeon ? [] : worldOres(p),
      loot: p.dungeon ? [] : lootState(p),
      partyId: p.partyId || null,
      dungeon: p.dungeon || null,
      dungeonMap: p.dungeon
        ? (() => {
            const d = dungeons.find((d) => d.id === p.dungeon.id) || {};
            return {
              id: d.id,
              rooms: d.rooms || [],
              optionalRooms: d.optionalRooms || [],
              paths: d.paths || [],
              roads: d.roads || [],
              routeChoices: d.routeChoices || [],
              shortcuts: d.shortcuts || [],
              walls: true,
              entrance: d.entrance || null,
              dungeonBounds: d.dungeonBounds || null,
            };
          })()
        : null,
      zoneInfo: p.dungeon
        ? {
            id: p.zone,
            name: dungeons.find((d) => d.id === p.dungeon.id)?.name || p.zone,
            icon: dungeons.find((d) => d.id === p.dungeon.id)?.icon || "💀",
            city: false,
            danger: dungeons.find((d) => d.id === p.dungeon.id)?.level || 1,
            description:
              dungeons.find((d) => d.id === p.dungeon.id)?.description ||
              "Dungeon",
            worldMeters: 12000,
            dungeonBounds: { minX: 0.08, maxX: 0.92, minY: 0.035, maxY: 0.945 },
          }
        : {
            ...world.byId[p.zone],
            worldMeters: world.byId[p.zone]?.worldMeters || 1000,
          },
      npcs: p.dungeon ? [] : world.zoneNpcs(p.zone),
      gates: p.dungeon ? [] : world.zoneGates(p.zone),
      encounter: e
        ? {
            id: e.id,
            enemy: e.enemy,
            enemyHp: e.enemyHp,
            maxHp: e.maxHp,
            phase: e.phase,
            statuses: e.statuses,
            threat: e.threat,
            log: e.log,
            state: e.state,
            bossPosition: e.bossPosition || null,
            cast: e.cast || null,
            activeOverlapCasts: (e.activeOverlapCasts || []).map((c: any) => ({
              ...c,
              targetPlayerIds: c.targetPlayerIds || [],
            })),
            groundEffects: (e.groundEffects || []).map((z: any) => ({ ...z })),
            partyExecution: e.partyExecution || null,
          }
        : null,
      lastCombat: p.lastCombat,
      shops: shops[p.zone] || [],
    };
    if (includeCatalog || sections.zones) base.zones = zones;
    base.worldRegions = worldRegions?.regions || [];
    if (includeCatalog || sections.worldMapNpcs) {
      base.worldMapNpcs = worldMapNpcs(p);
      base.worldMapGates = worldMapGates();
    }
    if (includeCatalog || sections.auctions) {
      economy.cleanup();
      worldEvents.tick(Date.now());
      base.auctions = [...economy.auctions.values()].filter(
        (a) => a.expiresAt > Date.now(),
      );
      base.myAuctions = [...economy.auctions.values()].filter(
        (a) => a.seller === p.id,
      );
    }
    if (includeCatalog || sections.mail) base.mail = economy.mailFor(p.id);
    if (includeCatalog || sections.chat)
      base.chat = chatService.history(p.zone);
    if (includeCatalog)
      base.catalog = {
        classes,
        abilities,
        dungeons,
        items,
        quests,
        storyline,
        worldStory,
        worldRegions,
        worldPoi,
        worldZoneProgression,
        worldMobDefs,
        npcs,
        gates,
        storyIntro,
        shops,
        talents,
        recipes,
        talentTrees,
        talentTransformations,
        classBuilds,
        buildEncounterProfiles,
        combatResources,
        combatRotations,
        trainer: { name: "Master Elowen", zone: "stonehold" },
      };
    base.professions = {
      levels: p.profession,
      xp: p.professionXp,
      specializations: p.professionSpecializations,
      knownRecipes: p.knownRecipes,
      recipes: recipes.filter((r: any) => p.knownRecipes?.includes(r.id)),
    };
    base.dynamicItems = dynamicItemsForPlayer(p, items, world.zoneLoot(p.zone));
    base.itemization = {
      version: 2,
      rules: itemization?.rules || {},
      gems: itemization?.gems || {},
      enchants: itemization?.enchants || {},
      tertiaryStats: itemization?.tertiaryStats || [],
      buildOptimization: itemization?.buildOptimization || null,
    };
    return base;
  }
  const STATE_KEEPALIVE_MS = 2000;
  const MOTION_KEEPALIVE_MS = 1000;
  function broadcast(sections: any = {}) {
    rebuildPlayerSpatialIndex();
    spatialIndexBroadcastActive = true;
    try {
      for (const c of clients) {
        const data = state(c, false, selectionsOrEmpty(sections));
        const payload = { type: "state", data };
        const raw = JSON.stringify(payload);
        // Egress control: an unchanged snapshot (ignoring the clock) is only re-sent as a slow keepalive.
        const sig = JSON.stringify({ ...data, serverNow: 0 });
        const now = Date.now();
        if (
          c._stateSig === sig &&
          now - Number(c._stateSentAt || 0) < STATE_KEEPALIVE_MS
        ) {
          networkMetrics.fullSkipped = (networkMetrics.fullSkipped || 0) + 1;
          continue;
        }
        if (wsSend(c, payload)) {
          c._stateSig = sig;
          c._stateSentAt = now;
          networkMetrics.fullPackets++;
          networkMetrics.fullBytes += raw.length;
        }
      }
    } finally {
      spatialIndexBroadcastActive = false;
      playerSpatialIndex = null;
    }
  }
  function selectionsOrEmpty(sections: any) {
    return sections || {};
  }

  function motionStateFor(c: any, serverNow = Date.now()) {
    const p = c.player;
    const nearby = nearbyPlayers(
      p,
      world.normalizedMeters(p.zone, 650),
      250,
    ).map((x: any) => ({
      id: x.id,
      x: x.x,
      y: x.y,
      vx: Number(x.velocityX || 0),
      vy: Number(x.velocityY || 0),
      state: x.moveState || "idle",
      movementMode: x.movementMode || "walk",
      zone: x.zone,
      dead: !!x.dead,
    }));
    const mobs = visibleMobs(p, 120).map((m: any) => ({
      id: m.id,
      x: m.x,
      y: m.y,
      vx: Number(m.velocityX || 0),
      vy: Number(m.velocityY || 0),
      state: m.state || "idle",
      zone: m.zone,
      aggroTarget: m.aggroTarget || null,
    }));
    const playerVx = Number(p.velocityX || 0),
      playerVy = Number(p.velocityY || 0);
    const playerSpeedMeters =
      Math.hypot(playerVx, playerVy) * world.worldMetersFor(p.zone);
    return {
      serverNow: Number(serverNow) || Date.now(),
      sequence: ++motionSequence,
      zone: p.zone,
      worldMeters: Number(world.worldMetersFor(p.zone) || 1000),
      player: {
        id: p.id,
        x: p.x,
        y: p.y,
        vx: playerVx,
        vy: playerVy,
        speedMeters:
          playerSpeedMeters > 0.01
            ? playerSpeedMeters
            : (Number(p.movementMode === "run" ? p.runSpeed : p.speed) || 45) *
              Number(p.regionRuntime?.speedMultiplier || 1),
        state: p.moveState || "idle",
        movementIntent: p.movementIntent || "none",
        movementMode: p.movementMode || "walk",
        targetX: Number.isFinite(Number(p.targetX)) ? Number(p.targetX) : null,
        targetY: Number.isFinite(Number(p.targetY)) ? Number(p.targetY) : null,
        approachSatisfied: !!p.combat?.approachSatisfied,
        autoApproach: !!p.combat?.autoApproach,
        zone: p.zone,
        dead: !!p.dead,
        respawnAt: Number(p.respawnAt || 0),
        respawnReady: !!p.respawnReady,
        respawnMessage: p.respawnMessage || null,
      },
      players: nearby,
      mobs,
    };
  }
  function broadcastMotion(serverNow = Date.now()) {
    rebuildPlayerSpatialIndex();
    spatialIndexBroadcastActive = true;
    try {
      for (const c of clients) {
        const data = motionStateFor(c, serverNow);
        const payload = { type: "motion", data };
        const raw = JSON.stringify(payload);
        // Nothing moved near this player: send a 1s keepalive instead of 20 identical packets per second.
        const sig = JSON.stringify({ ...data, serverNow: 0, sequence: 0 });
        const now = Date.now();
        if (
          c._motionSig === sig &&
          now - Number(c._motionSentAt || 0) < MOTION_KEEPALIVE_MS
        ) {
          networkMetrics.motionSkipped =
            (networkMetrics.motionSkipped || 0) + 1;
          continue;
        }
        if (wsSend(c, payload)) {
          c._motionSig = sig;
          c._motionSentAt = now;
          networkMetrics.motionPackets++;
          networkMetrics.motionBytes += raw.length;
        }
      }
    } finally {
      spatialIndexBroadcastActive = false;
      playerSpatialIndex = null;
    }
  }

  motionSequenceRef.value = motionSequence;
  return {
    rebuildPlayerSpatialIndex,
    zonePlayers,
    worldMobs,
    lootState,
    worldMapGates,
    worldMapNpcs,
    npcDetail,
    questHelperForPlayer,
    tradeState,
    partyState,
    storyProgressForPlayer,
    state,
    commandStateSections: sectionsForCommand,
    broadcast,
    motionStateFor,
    broadcastMotion,
  };
}
