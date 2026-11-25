import { GAME_RUNTIME } from "../shared/GameRuntimeConfig.js";

export class AuthoritativeSimulationCoordinator {
  ctx: any;
  send: any;
  performWorldBasicAttack: any;
  awaitOrSyncCheckpoint: any;
  broadcast: any;
  broadcastMotion: any;
  private explorationRewardsInFlight = new Set<string>();
  constructor(ctx: any, callbacks: any = {}) {
    this.ctx = ctx;
    Object.assign(this, callbacks);
  }
  finishCast(p: any, c: any, now: number) {
    const { combat, repo } = this.ctx as any,
      handle = (this.ctx as any).handle;
    if (!handle) {
      p.combat.casting = null;
      return;
    }
    combat.grantCompletion(p, c.abilityId, now);
    p.combat.gcdReadyAt = 0;
    const settle = (note?: string) => {
      p.combat.casting = null;
      p.combat.castEventAt = Date.now();
      p.combat.gcdReadyAt = Math.max(Date.now(), Number(c.gcdReadyAt || 0));
      if (note) {
        p.worldCombatLog = p.worldCombatLog || [];
        p.worldCombatLog.push({
          t: new Date().toLocaleTimeString(),
          msg: `✖️ ${c.name}: ${note}`,
        });
        p.worldCombatLog = p.worldCombatLog.slice(-80);
      }
      repo.savePlayer(p);
    };
    Promise.resolve(handle(p, { ...c.command, castCompletion: true }))
      .then((r: any) => {
        const ok = Array.isArray(r) ? r[0] : r?.ok !== false;
        const msg = Array.isArray(r)
          ? typeof r[1] === "string"
            ? r[1]
            : ""
          : String(r?.message || "");
        settle(ok ? undefined : msg || "Failed.");
      })
      .catch((error: any) => {
        console.warn("[cast] completion failed:", error?.message || error);
        settle("Failed.");
      });
  }
  tick(scheduledNow = Date.now()) {
    const {
      repo,
      world,
      quest,
      combat,
      bus,
      tradeSessions,
      dungeonEngine,
      economy,
      social,
      regionEngine,
      worldEvents,
      worldSimulation,
      npcMemory,
      factionSimulation,
      worldEcology,
      emergentWorldEvents,
      discoveryEngine,
      regionalEconomy,
      guildOrganizations,
      worldIntegration,
      chronicle,
      openWorld,
      playerMutations,
      clients,
      SESSION_CHECKPOINT_MS,
      queues,
      battlegroundQueue,
      battlegrounds,
      pvpQueueTimes,
      arenaMatches,
      tryMatchArena,
      finishArena,
      resolveExpiredLootRolls,
      pvpStats,
      startBattleground,
      tryMatchDungeonQueue,
      stateRevisionRef,
      lastPersistenceCheckpointAtRef,
      telemetry,
      tickMetrics,
      gainXp,
      rewardMobKill,
      profession,
      inv,
      abilities,
      COMBAT_RANGES,
      normalizeMovement,
      normalizeStoryQuest,
      guardPlayerRuntime,
      npcDetail,
      tradeDistanceOk,
      playerCombatSimulation,
      worldCombatSimulation,
      combatVictory,
    } = this.ctx;
    const now = Number.isFinite(Number(scheduledNow))
      ? Number(scheduledNow)
      : Date.now();
    const TICK_MS = GAME_RUNTIME.tickMs;
    const reconcileTravelQuestState = (player: any) => {
      quest.ensure(player);
      quest.reconcile(player);
    };

    const tradeNow = now;
    for (const [id, t] of tradeSessions) {
      if (tradeNow > Number(t.expiresAt || 0)) {
        tradeSessions.delete(id);
        continue;
      }
      const a = repo.getPlayer(t.a),
        b = repo.getPlayer(t.b);
      if (!tradeDistanceOk(a, b) || a.dead || b.dead) tradeSessions.delete(id);
    }
    const tickStarted = performance.now();
    void economy.cleanup(now).catch((error: any) => {
      this.ctx.telemetry?.record?.("economy_cleanup_failed", {
        message: String(error?.message || error),
      });
    });
    queues.cleanupDungeonMatches(now);
    const simulationTick = Math.floor(now / GAME_RUNTIME.tickMs);
    guildOrganizations?.tick?.(simulationTick, now);
    const factionOperations = factionSimulation.tick(
      worldSimulation.snapshot(),
      simulationTick,
    );
    const economyEvents =
      regionalEconomy?.tick?.(simulationTick, now, world.players) || [];
    for (const ev of economyEvents) {
      worldIntegration?.assignCaravanFaction?.(ev.caravan);
      worldIntegration?.observeCaravanOutcome?.(
        ev.caravan,
        ev.type === "caravan_arrived"
          ? "arrived"
          : ev.type === "caravan_lost"
            ? "lost"
            : "departed",
        simulationTick,
      );
      worldSimulation.record({
        id: `economy:${ev.type}:${ev.caravan?.id || ev.regionId}:${simulationTick}`,
        type: "economic_transition",
        source: "regional_economy",
        actorId: null,
        regionId: String(ev.regionId || ev.caravan?.to || ""),
        simulationTick,
        worldTime: now,
        payload: {
          economyEvent: ev.type,
          caravanId: ev.caravan?.id || null,
          resource: ev.caravan?.resource || null,
          amount: Number(ev.caravan?.amount || 0),
          from: ev.caravan?.from || null,
          to: ev.caravan?.to || null,
        },
        causes: [],
        consequenceIds: [],
        severity: "regional",
      });
    }

    for (const op of factionOperations) {
      const dangerDelta =
        op.kind === "reinforcement"
          ? -Math.min(12, Math.round(op.strength * 0.2))
          : op.kind === "patrol"
            ? -Math.min(6, Math.round(op.strength * 0.1))
            : op.kind === "territorial_pressure"
              ? 2
              : 0;
      const factionPressureDelta =
        op.kind === "territorial_pressure"
          ? 5
          : op.kind === "trade_restriction"
            ? 3
            : -1;
      worldSimulation.record({
        id: `faction-op:${op.id}`,
        type: "faction_operation",
        source: "faction_simulation",
        actorId: null,
        regionId: op.regionId,
        simulationTick,
        worldTime: now,
        payload: {
          factionId: op.factionId,
          operationId: op.id,
          operationKind: op.kind,
          dangerDelta,
          factionPressureDelta,
        },
        causes: op.causeEventIds || [],
        consequenceIds: [],
        severity: "regional",
      });
    }
    worldSimulation.tick(simulationTick, now);
    const emergentEvents =
      emergentWorldEvents?.tick?.(simulationTick, world) || [];
    if (emergentEvents.length) worldSimulation.tick(simulationTick, now);
    const activeEcologyZones = new Set(
      (world.players || [])
        .filter((p: any) => p?.online && !p?.dead && p?.hasCharacter)
        .map((p: any) => String(p.zone || "")),
    );
    const ecologyChanges =
      worldEcology?.ingestWorld?.(world, simulationTick, activeEcologyZones) ||
      [];
    for (const change of ecologyChanges.slice(0, 12)) {
      const payload: any = {
        speciesId: change.speciesId,
        ecologyChange: change.kind,
        delta: Number(change.delta || 0),
      };
      if (change.to) payload.toRegionId = change.to;
      worldSimulation.record({
        id: `ecology:${simulationTick}:${change.regionId}:${change.speciesId}:${change.kind}:${change.to || ""}`,
        type: "ecology_transition",
        source: "world_ecology",
        actorId: null,
        regionId: String(change.regionId),
        simulationTick,
        worldTime: now,
        payload,
        causes: [],
        consequenceIds: [],
        severity: change.kind === "migration" ? "regional" : "local",
      });
    }
    worldIntegration?.tick?.(world, simulationTick);
    worldEvents.tick(now);
    for (const [id, bg] of battlegrounds) {
      if (bg.state === "active" && Date.now() >= bg.endsAt) {
        bg.state = "finished";
        bg.finishedAt = Date.now();
        const winner =
          bg.score.red === bg.score.blue
            ? null
            : bg.score.red > bg.score.blue
              ? "red"
              : "blue";
        bg.winner = winner;
        for (const pid of [...bg.red, ...bg.blue]) {
          const x = repo.getPlayer(pid);
          if (x) {
            const s = pvpStats(x),
              team = bg.red.includes(pid) ? "red" : "blue";
            if (winner && team === winner) {
              s.battlegroundWins = Number(s.battlegroundWins || 0) + 1;
              s.honor += 50;
            } else if (winner) {
              s.battlegroundLosses = Number(s.battlegroundLosses || 0) + 1;
              s.honor += 10;
            }
            x.lastPvpResult = {
              mode: "battleground",
              result: !winner ? "draw" : team === winner ? "victory" : "defeat",
              score: { ...bg.score },
              at: Date.now(),
            };
            const original = x.pvp || {};
            x.battlegroundId = null;
            x.pvp = null;
            x.targetPlayerId = null;
            x.zone = original.fromZone || x.homeCity || "stonehold";
            x.x = Number(original.fromX ?? x.x);
            x.y = Number(original.fromY ?? x.y);
            x.targetX = x.x;
            x.targetY = x.y;
            queues.clearPvpTemplate?.(x);
          }
        }
      }
      if (
        bg.state === "finished" &&
        Date.now() > Number(bg.finishedAt || bg.endsAt) + 30000
      )
        battlegrounds.delete(id);
    }
    for (const [id, m] of arenaMatches) {
      if (m.state === "active" && Date.now() >= m.endsAt)
        finishArena(m, null, "time");
      if (m.state === "finished" && Date.now() > Number(m.endsAt || 0) + 30000)
        arenaMatches.delete(id);
    }
    for (const bracket of ["2v2", "3v3"]) tryMatchArena(bracket);
    resolveExpiredLootRolls(now);
    world.players = [...clients]
      .map((c) => c.player)
      .filter((p) => p && p.online && p.hasCharacter && p.classId);
    const tickPlayers = world.players.filter(
      (p: any) => !playerMutations?.isLocked?.(p?.id),
    );
    const regionResults = regionEngine.tick(tickPlayers, now);
    const discoveryResults =
      discoveryEngine?.tick?.(tickPlayers, simulationTick, now) || [];
    openWorld.tick(now);
    world.updateNpcs(TICK_MS / 1000, now);
    world.updatePlayers(0.05);
    const explorationRewardWork = (async () => {
      for (const rr of [...regionResults, ...discoveryResults]) {
        const p = rr.player;
        if (!p?.id) continue;
        const explorationSubject = String(
          rr.location?.id ||
            rr.discovery?.id ||
            rr.milestone?.id ||
            rr.regionId ||
            p?.zone ||
            "unknown",
        );
        const explorationOccurrence =
          rr.type === "storm_damage"
            ? String(simulationTick)
            : explorationSubject;
        const explorationRewardKey = `exploration:${String(p?.id || "unknown")}:${String(rr.type || "unknown")}:${explorationOccurrence}`;
        if (this.explorationRewardsInFlight.has(explorationRewardKey)) continue;
        this.explorationRewardsInFlight.add(explorationRewardKey);
        const processResult = async () => {
          if (!p || !p.id) return;
          const explorationBefore = JSON.parse(JSON.stringify(p));
          try {
            if (
              Array.isArray(p._rewardLedger) &&
              p._rewardLedger.includes(explorationRewardKey)
            ) {
              if (rr.type === "dynamic_discovery")
                discoveryEngine?.markDiscovered?.(rr.discovery?.id, p.id);
              return;
            }
            if (rr.type === "poi_discovery") {
              worldSimulation.record({
                id: `discovery:${rr.location.id}:${p.id}`,
                type: "discovery_found",
                source: "exploration",
                actorId: p.id,
                regionId: String(rr.regionId),
                simulationTick,
                worldTime: now,
                payload: {
                  discoveryId: rr.location.id,
                  discoveryKind: rr.location.type,
                  participantIds: [p.id],
                  outcome: "discovered",
                },
                causes: [],
                consequenceIds: [],
                severity: "local",
              });
              openWorld.onDiscovery?.(p, rr.location);
              worldIntegration?.observePlayerDiscovery?.(
                p,
                rr.location,
                simulationTick,
              );
              quest.onDiscover?.(p, rr.location.id, 1);
              gainXp(p, rr.xp);
              p.lastRegionDiscovery = {
                regionId: rr.regionId,
                locationId: rr.location.id,
                name: rr.location.name,
                xp: rr.xp,
                gold: rr.gold,
                at: Date.now(),
              };
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Discovered ${rr.location.name}. +${rr.xp} XP, +${rr.gold} gold.`,
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                return;
              }
            }
            if (rr.type === "region_discovery") {
              worldIntegration?.observePlayerDiscovery?.(
                p,
                rr.location,
                simulationTick,
              );
              worldSimulation.record({
                id: `discovery:${rr.location.id}:${p.id}`,
                type: "region_discovery_found",
                source: "exploration",
                actorId: p.id,
                regionId: String(rr.regionId),
                simulationTick,
                worldTime: now,
                payload: {
                  discoveryId: rr.location.id,
                  discoveryKind: "region",
                  participantIds: [p.id],
                  outcome: "discovered",
                },
                causes: [],
                consequenceIds: [],
                severity: "regional",
              });
              gainXp(p, rr.xp);
              p.lastRegionDiscovery = {
                regionId: rr.regionId,
                locationId: rr.location.id,
                name: rr.location.name,
                xp: rr.xp,
                gold: rr.gold,
                kind: "region",
                at: Date.now(),
              };
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Discovered ${rr.location.name}. +${rr.xp} XP, +${rr.gold} gold.`,
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                return;
              }
            }
            if (rr.type === "zone_exploration_complete") {
              gainXp(p, rr.xp);
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Zone complete: ${rr.location.name}. +${rr.xp} XP, +${rr.gold} gold.`,
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                return;
              }
            }
            if (rr.type === "exploration_milestone") {
              gainXp(p, Number(rr.milestone?.rewardXp || 0));
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Exploration achievement: ${rr.milestone?.id || "milestone"}${rr.milestone?.rewardXp ? ` • +${rr.milestone.rewardXp} XP` : ""}.`,
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                return;
              }
            }
            if (rr.type === "storm_damage") {
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `The Veil Storm tears through you for ${rr.damage} damage.`,
                  },
                });
              if (typeof repo.savePlayerNow !== "function")
                throw new Error(
                  "Durable player persistence is unavailable for storm damage.",
                );
              await repo.savePlayerNow(p);
            }
            if (rr.type === "dynamic_discovery") {
              const d = rr.discovery;
              quest.onDiscover?.(p, d.id, 1);
              gainXp(p, rr.xp);
              p.gold = (Number(p.gold) || 0) + Number(rr.gold || 0);
              p.lastRegionDiscovery = {
                regionId: rr.regionId,
                locationId: d.id,
                name: d.name,
                xp: rr.xp,
                gold: rr.gold,
                kind: "dynamic",
                at: now,
              };
              worldSimulation.record({
                id: `discovery:${d.id}:${p.id}`,
                type: "discovery_found",
                source: "world_discovery",
                actorId: p.id,
                regionId: String(rr.regionId),
                simulationTick,
                worldTime: now,
                payload: {
                  discoveryId: d.id,
                  discoveryKind: d.kind,
                  participantIds: [p.id],
                  rarity: d.rarity,
                  outcome: "discovered",
                },
                causes: d.sourceEventIds || [],
                consequenceIds: [],
                severity: d.severity,
              });
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Discovered ${d.name}. +${rr.xp} XP, +${rr.gold} gold.`,
                    detail: { regionId: rr.regionId, location: d },
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                discoveryEngine?.markDiscovered?.(d.id, p.id);
                return;
              }
              discoveryEngine?.markDiscovered?.(d.id, p.id);
            }
            if (rr.type === "discovery") {
              worldSimulation.record({
                id: `discovery:${rr.location.id}:${p.id}`,
                type: "discovery_found",
                source: "exploration",
                actorId: p.id,
                regionId: String(rr.regionId),
                simulationTick,
                worldTime: now,
                payload: {
                  discoveryId: rr.location.id,
                  discoveryKind: rr.location.type || "hidden",
                  participantIds: [p.id],
                  outcome: "discovered",
                },
                causes: [],
                consequenceIds: [],
                severity: "local",
              });
              openWorld.onDiscovery?.(p, rr.location);
              quest.onDiscover?.(p, rr.location.id, 1);
              gainXp(p, rr.xp);
              p.lastRegionDiscovery = {
                regionId: rr.regionId,
                locationId: rr.location.id,
                name: rr.location.name,
                xp: rr.xp,
                gold: rr.gold,
                at: Date.now(),
              };
              const c = [...clients].find((x: any) => x.player?.id === p.id);
              if (c)
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: true,
                    message: `Discovered ${rr.location.name}. +${rr.xp} XP, +${rr.gold} gold.`,
                    detail: {
                      regionId: rr.regionId,
                      location: rr.location,
                      lore: regionEngine.byId[rr.regionId]?.lore || "",
                    },
                  },
                });
              if (typeof repo.savePlayerRewardOnce !== "function")
                throw new Error(
                  "Durable exploration reward persistence is unavailable.",
                );
              const committed = await repo.savePlayerRewardOnce(
                p,
                explorationRewardKey,
              );
              if (!committed) {
                for (const key of Object.keys(p)) delete p[key];
                Object.assign(p, explorationBefore);
                return;
              }
            }
          } catch (error: any) {
            for (const key of Object.keys(p)) delete p[key];
            Object.assign(p, explorationBefore);
            console.error("[exploration] reward persistence failed", {
              playerId: String(p?.id || ""),
              type: String(rr?.type || ""),
              error: String(error?.message || error),
            });
          } finally {
            this.explorationRewardsInFlight.delete(explorationRewardKey);
          }
        };
        try {
          if (p?.id && playerMutations?.withPlayer)
            await playerMutations.withPlayer(String(p.id), processResult);
          else await processResult();
        } catch (error: any) {
          this.explorationRewardsInFlight.delete(explorationRewardKey);
          console.error("[exploration] player mutation lock failed", {
            playerId: String(p?.id || ""),
            type: String(rr?.type || ""),
            error: String(error?.message || error),
          });
        }
      }
    })();
    void explorationRewardWork.catch((error: any) =>
      console.error("[exploration] reward processing failed:", error),
    );
    for (const c of clients) {
      if (c.player && playerMutations?.isLocked?.(c.player.id)) continue;
      const tp = c.player ? c.player._travelCompletedZone : null;
      if (tp) {
        delete c.player._travelCompletedZone;
        quest.onTravel(c.player, tp);
        reconcileTravelQuestState(c.player);
      }
      quest.reconcile(c.player);
    }
    bus.emit("world.tick", { dt: 0.05 });
    for (const c of clients) {
      const p = c.player;
      if (!p || playerMutations?.isLocked?.(p.id)) continue;
      try {
        if (p.hasCharacter) {
          guardPlayerRuntime(p);
          normalizeMovement(p);
          normalizeStoryQuest(p);
          if (p.pvp) {
            const mode = p.pvp.state;
            if (mode === "battleground") {
              const bg = battlegrounds.get(p.battlegroundId);
              if (!bg || bg.state !== "active") {
                p.battlegroundId = null;
                p.pvp = null;
                p.targetPlayerId = null;
                queues.clearPvpTemplate?.(p);
              } else {
                const onRed = bg.red.includes(p.id),
                  onBlue = bg.blue.includes(p.id);
                if (!onRed && !onBlue) {
                  p.battlegroundId = null;
                  p.pvp = null;
                  p.targetPlayerId = null;
                  queues.clearPvpTemplate?.(p);
                } else {
                  const enemyIds = onRed ? bg.blue : bg.red;
                  const enemies = enemyIds
                    .map((id: any) => repo.getPlayer(id))
                    .filter(
                      (x: any) => x && x.online && !x.dead && x.zone === p.zone,
                    );
                  const target = enemies.find(
                    (x: any) => x.id === p.targetPlayerId,
                  );
                  if (target && !p.combat.manualMove && !p.moveInput) {
                    const standMeters = Math.max(
                      1,
                      Number(world.combatRangeMeters(p) || 18),
                    );
                    const rangeNorm = world.normalizedMeters(
                        p.zone,
                        standMeters,
                      ),
                      distance = Math.hypot(p.x - target.x, p.y - target.y),
                      hysteresis = world.normalizedMeters(p.zone, 3);
                    if (distance > rangeNorm + hysteresis) {
                      const ap = world.approachPoint(p, target, standMeters);
                      p.combat.autoApproach = true;
                      p.combat.approachSatisfied = false;
                      p.movementIntent = "combat";
                      p.targetX = ap.x;
                      p.targetY = ap.y;
                      p.movementMode = "run";
                      p.moveState = "moving";
                    } else {
                      p.combat.autoApproach = false;
                      p.combat.approachSatisfied = true;
                      p.movementIntent = "combat";
                      p.targetX = p.x;
                      p.targetY = p.y;
                      p.moveState = "idle";
                      p.velocityX = 0;
                      p.velocityY = 0;
                    }
                  }
                }
              }
            } else {
              const match =
                mode === "arena" ? arenaMatches.get(p.pvp.id) : null;
              const opponentIds = match
                ? match.teamA.includes(p.id)
                  ? match.teamB
                  : match.teamA
                : [p.pvp.opponentId];
              const opponents = opponentIds
                .map((id: any) => repo.getPlayer(id))
                .filter(
                  (x: any) => x && x.online && !x.dead && x.zone === p.zone,
                );
              if (!opponents.length) {
                if (mode === "arena" && match && match.state === "active")
                  finishArena(
                    match,
                    match.teamA.includes(p.id) ? "A" : "B",
                    "opponent-unavailable",
                  );
                else {
                  p.pvp = null;
                  p.targetPlayerId = null;
                  queues.clearPvpTemplate?.(p);
                }
              } else {
                let opp =
                  opponents.find((x: any) => x.id === p.targetPlayerId) ||
                  opponents[0];
                if (p.pvp && p.targetPlayerId !== opp.id)
                  p.targetPlayerId = opp.id;
                const arena = p.pvp,
                  distFromCenter = Math.hypot(
                    p.x - arena.centerX,
                    p.y - arena.centerY,
                  );
                if (distFromCenter > arena.arenaRadius) {
                  arena.outSince = arena.outSince || now;
                  if (now - arena.outSince >= 10000) {
                    if (mode === "arena") {
                      const m = arenaMatches.get(p.pvp.id);
                      if (m && m.state === "active")
                        finishArena(
                          m,
                          m.teamA.includes(p.id) ? "B" : "A",
                          "boundary",
                        );
                    } else {
                      opp.pvp = null;
                      p.pvp = null;
                      p.targetPlayerId = null;
                      opp.targetPlayerId = null;
                    }
                    this.send(c, {
                      type: "command_result",
                      data: { ok: true, message: "You left the PvP boundary." },
                    });
                  }
                } else arena.outSince = 0;
                if (
                  p.pvp &&
                  p.targetPlayerId === opp.id &&
                  !p.combat.manualMove &&
                  !p.moveInput
                ) {
                  const standMeters = Math.max(
                    1,
                    Number(world.combatRangeMeters(p) || 18),
                  );
                  const rangeNorm = world.normalizedMeters(p.zone, standMeters),
                    distance = Math.hypot(p.x - opp.x, p.y - opp.y),
                    hysteresis = world.normalizedMeters(p.zone, 3);
                  if (distance > rangeNorm + hysteresis) {
                    const ap = world.approachPoint(p, opp, standMeters);
                    p.combat.autoApproach = true;
                    p.combat.approachSatisfied = false;
                    p.movementIntent = "combat";
                    p.targetX = ap.x;
                    p.targetY = ap.y;
                    p.movementMode = "run";
                    p.moveState = "moving";
                  } else {
                    p.combat.autoApproach = false;
                    p.combat.approachSatisfied = true;
                    p.movementIntent = "combat";
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.moveState = "idle";
                    p.velocityX = 0;
                    p.velocityY = 0;
                  }
                }
              }
            }
          }
          {
            const castTick = combat.tickCast(p, now);
            if (castTick?.complete) this.finishCast(p, castTick.complete, now);
          }
          if (p.dead) {
            if (Date.now() >= p.respawnAt) p.respawnReady = true;
            p.combatFx = (p.combatFx || []).filter((f) => f.expiresAt > now);
            repo.savePlayer(p);
            continue;
          }
          let before = p.encounterId;
          let r = combat.processQueue(p, now);
          if (r?.[0])
            bus.emit("skill.processed", { playerId: p.id, result: r[1] });
          if (r?.[0] && r[1]?.won && before)
            combatVictory.encounterVictory(p, before);
          r = combat.autoAttack(p, now);
          if (r?.[0])
            bus.emit("skill.processed", { playerId: p.id, result: r[1] });
          if (r?.[0] && r[1]?.won && before)
            combatVictory.encounterVictory(p, before);
          if (!p.encounterId && p.targetMobId && !p.worldCombatMobId) {
            const m = world.byIdMob(p.targetMobId);
            if (m && m.zone === p.zone && m.state !== "dead") {
              const d = Math.hypot(p.x - m.x, p.y - m.y);
              const basicRangeNorm = world.normalizedMeters(
                p.zone,
                world.combatRangeMeters(p),
              );
              if (d <= basicRangeNorm) {
                world.engageMobAgainstPlayer(p, m);
                world.enterWorldCombat(p, m);
                if (!p.combat.manualMove) {
                  p.targetX = p.x;
                  p.targetY = p.y;
                  p.moveState = "idle";
                }
              } else if (p.combat.autoApproach && !p.combat.manualMove) {
                const stand = Number(
                  p.combat.approachRangeMeters || COMBAT_RANGES.meleeMeters,
                );
                const ap = world.approachPoint(p, m, stand);
                p.targetX = ap.x;
                p.targetY = ap.y;
                p.movementMode = "run";
                p.moveState = "moving";
              }
            }
          }
          if (p.worldCombatMobId) {
            const m = world.byIdMob(p.worldCombatMobId);
            if (!m || m.state === "dead" || m.zone !== p.zone) {
              p.worldCombatMobId = null;
              p.combat.autoAttack = false;
              if (!m || m.state === "dead" || m.zone !== p.zone)
                p.targetMobId = null;
            } else {
              const d = Math.hypot(p.x - m.x, p.y - m.y);
              if (
                d <= world.combatDisengageNormalized(p.zone) &&
                m.state !== "returning" &&
                m.state !== "fleeing" &&
                (!m.aggroTarget ||
                  m.aggroTarget !== p.id ||
                  !m.attackers?.[p.id])
              ) {
                world.engageMobAgainstPlayer(p, m);
                world.enterWorldCombat(p, m);
                p.combat.approachSatisfied = true;
                p.combat.autoApproach = false;
                p.targetX = p.x;
                p.targetY = p.y;
                p.moveState = "idle";
              }
              if (
                !p.combat?.manualMove &&
                !p.moveInput &&
                p.movementIntent !== "manual" &&
                (p.combat?.autoAttack ||
                  p.combat?.queuedWorldAbility ||
                  p.combat?.autoApproach)
              ) {
                const queuedId = String(p.combat?.queuedWorldAbility || "");
                const queuedRange = queuedId
                  ? Number(abilities?.[queuedId]?.range || 0)
                  : 0;
                const basicRange = Math.max(
                  1.5,
                  Number(
                    world.combatRangeMeters(p) || COMBAT_RANGES.meleeMeters,
                  ),
                );
                const approachMeters = Math.max(
                  basicRange,
                  queuedRange > 0 ? queuedRange : 0,
                );
                p.combat.approachRangeMeters = approachMeters;
                const approachRange = world.normalizedMeters(
                  p.zone,
                  approachMeters,
                );
                const hysteresis = world.normalizedMeters(p.zone, 2.5);
                if (d <= approachRange) {
                  p.combat.approachSatisfied = true;
                  p.combat.autoApproach = false;
                  p.movementIntent = "combat";
                  p.targetX = p.x;
                  p.targetY = p.y;
                  p.moveState = "idle";
                  p.velocityX = 0;
                  p.velocityY = 0;
                } else if (
                  !p.combat.approachSatisfied ||
                  d > approachRange + hysteresis ||
                  p.combat.autoAttack
                ) {
                  p.combat.approachSatisfied = false;
                  p.combat.autoApproach = true;
                  p.movementIntent = "combat";
                  const ap = world.approachPoint(p, m, approachMeters);
                  p.targetX = ap.x;
                  p.targetY = ap.y;
                  p.movementMode = "run";
                  p.moveState = "moving";
                }
              }
              const beyondDisengage =
                d > world.combatDisengageNormalized(p.zone);
              const ownsManualEscape =
                !!p.moveInput ||
                !!p.combat.manualMove ||
                p.movementIntent === "manual";
              const shouldDisengage =
                beyondDisengage &&
                (ownsManualEscape ||
                  (!p.combat.autoApproach && !p.combat.queuedWorldAbility));
              if (shouldDisengage) {
                const wasSteering = ownsManualEscape;
                world.disengagePlayer(p);
                p.combat.autoApproach = false;
                if (wasSteering) {
                  p.combat.manualMove = true;
                  p.movementIntent = "manual";
                } else if (p.movementIntent === "combat")
                  p.movementIntent = "none";
              } else {
                if (
                  (m.state === "fleeing" || m.state === "returning") &&
                  p.combat.autoAttack &&
                  !p.combat.manualMove
                ) {
                  const stand = Number(
                    p.combat.approachRangeMeters || COMBAT_RANGES.meleeMeters,
                  );
                  const rangeNorm = world.normalizedMeters(p.zone, stand);
                  const distanceToMob = Math.hypot(p.x - m.x, p.y - m.y);
                  const hysteresisNorm = world.normalizedMeters(p.zone, 2.5);
                  if (
                    !p.combat.approachSatisfied &&
                    distanceToMob > rangeNorm
                  ) {
                    p.combat.autoApproach = true;
                    p.movementIntent = "combat";
                    const ap = world.approachPoint(p, m, stand);
                    p.targetX = ap.x;
                    p.targetY = ap.y;
                    p.movementMode = "run";
                  } else if (distanceToMob <= rangeNorm) {
                    p.combat.approachSatisfied = true;
                    p.combat.autoApproach = false;
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.moveState = "idle";
                    world.engageMobAgainstPlayer(p, m);
                    world.enterWorldCombat(p, m);
                  } else if (
                    p.combat.approachSatisfied &&
                    distanceToMob <= rangeNorm + hysteresisNorm
                  ) {
                    p.combat.autoApproach = false;
                    p.targetX = p.x;
                    p.targetY = p.y;
                    p.moveState = "idle";
                  }
                }
                const wr = combat.processWorldQueue(p, now, m);
                if (wr?.[0])
                  bus.emit("skill.queued_executed", {
                    playerId: p.id,
                    mobId: m.id,
                    result: wr[1],
                  });
                if (wr?.[0] && wr[1]?.killed)
                  rewardMobKill(p, {
                    enemyId: m.type,
                    enemyName: m.name,
                    level: m.level,
                    xp: m.xp,
                    gold: m.gold,
                    lootPile: wr[1].lootPile,
                    participants: wr[1].participants,
                    mobId: m.id,
                    x: m.x,
                    y: m.y,
                  });
                if (!wr?.[1]?.killed && p.combat.autoAttack) {
                  const ar = this.performWorldBasicAttack(p, m, now);
                  if (ar?.[0])
                    bus.emit("combat.auto_attack", {
                      playerId: p.id,
                      mobId: m.id,
                      result: ar[1],
                    });
                  if (ar?.[0] && ar[1]?.killed)
                    rewardMobKill(p, {
                      enemyId: m.type,
                      enemyName: m.name,
                      level: m.level,
                      xp: m.xp,
                      gold: m.gold,
                      lootPile: ar[1].lootPile,
                      participants: ar[1].participants,
                      mobId: m.id,
                      x: m.x,
                      y: m.y,
                    });
                }
              }
            }
          } else if (
            p.combat?.queuedWorldAbility ||
            p.combat?.queuedAbilities?.some(
              (q: any) =>
                q?.world && abilities[q.abilityId]?.aoe?.center === "self",
            )
          ) {
            const wr = combat.processWorldQueue(p, now, null);
            if (wr?.[0])
              bus.emit("skill.queued_executed", {
                playerId: p.id,
                mobId: null,
                result: wr[1],
              });
          }
          if (p._npcArrived) {
            const n = world
              .zoneNpcs(p.zone)
              .find((x) => x.id === p._npcArrived);
            p._npcArrived = null;
            if (n) {
              p.trainerNpcId = n.kind === "trainer" ? n.id : null;
              quest.onTalk(p, n.id);
              this.send(c, {
                type: "command_result",
                data: {
                  ok: true,
                  message: `${n.name} is ready to speak with you.`,
                  detail: npcDetail(p, n),
                },
              });
            }
          }
          if (p.mining) {
            if (p.worldCombatMobId || p.encounterId) {
              const o = world.ores.get(p.mining.oreId);
              if (o) o.claimedBy = null;
              p.mining = null;
              p._miningCompletionPending = false;
              this.send(c, {
                type: "command_result",
                data: { ok: false, message: "Mining interrupted by combat." },
              });
            } else if (
              Date.now() >= p.mining.endsAt &&
              !p._miningCompletionPending
            ) {
              p._miningCompletionPending = true;
              const finishMining = async () => {
                try {
                  if (!p.mining || Date.now() < Number(p.mining.endsAt || 0))
                    return;
                  if (p.worldCombatMobId || p.encounterId) {
                    const activeOre = world.ores.get(p.mining.oreId);
                    if (activeOre) activeOre.claimedBy = null;
                    p.mining = null;
                    this.send(c, {
                      type: "command_result",
                      data: {
                        ok: false,
                        message: "Mining interrupted by combat.",
                      },
                    });
                    return;
                  }
                  const ore = world.ores.get(p.mining.oreId);
                  let qty = ore ? profession.miningYield(p, ore) : 0;
                  const regionModifier = Number(
                    p.regionRuntime?.resourceModifier || 1,
                  );
                  if (
                    regionModifier > 1 &&
                    Math.random() < Math.min(0.95, regionModifier - 1)
                  )
                    qty += 1;
                  if (!ore || !inv.canGive(p, ore.type, qty)) {
                    if (ore) ore.claimedBy = null;
                    p.mining = null;
                    this.send(c, {
                      type: "command_result",
                      data: {
                        ok: false,
                        message:
                          "Your bag is full. Free a slot before mining again.",
                      },
                    });
                    return;
                  }
                  const rr = world.completeMining(p, p.mining.oreId);
                  if (rr[0]) {
                    if (!inv.give(p, rr[1].ore, qty)) {
                      this.send(c, {
                        type: "command_result",
                        data: {
                          ok: false,
                          message:
                            "Mining reward could not be added. Your inventory was unchanged.",
                        },
                      });
                      return;
                    }
                    regionalEconomy?.observeHarvest?.(
                      String(p.zone),
                      String(rr[1].ore),
                      qty,
                      String(p.id),
                      simulationTick,
                    );
                    worldSimulation.record({
                      id: `economy:harvest:${p.id}:${p.zone}:${rr[1].ore}:${simulationTick}`,
                      type: "economic_transition",
                      source: "regional_economy",
                      actorId: p.id,
                      regionId: String(p.zone),
                      simulationTick,
                      worldTime: now,
                      payload: {
                        economyEvent: "resource_harvest",
                        resource: String(rr[1].ore),
                        amount: Number(qty || 0),
                      },
                      causes: [],
                      consequenceIds: [],
                      severity: "local",
                    });
                    const prog = profession.awardXp(p, "mining", rr[1].xp);
                    quest.onMine(p, rr[1].ore, qty);
                    await repo.savePlayer(p);
                    this.send(c, {
                      type: "command_result",
                      data: {
                        ok: true,
                        message: `Mined ${qty} × ${ore?.name || rr[1].ore}.`,
                        detail: {
                          profession: "mining",
                          level: prog.level,
                          discoveries: prog.discoveries,
                        },
                      },
                    });
                  } else if (rr[1]?.message)
                    this.send(c, {
                      type: "command_result",
                      data: { ok: false, message: rr[1].message },
                    });
                } catch (error: any) {
                  this.ctx.telemetry?.record?.("mining_completion_failed", {
                    playerId: String(p.id),
                    message: String(error?.message || error),
                  });
                  console.warn(
                    "Mining completion failed:",
                    error?.message || error,
                  );
                } finally {
                  p._miningCompletionPending = false;
                }
              };
              void (playerMutations?.withPlayer
                ? playerMutations.withPlayer(String(p.id), finishMining)
                : finishMining());
              continue;
            }
          }
          if (p._oreArrived) {
            const id = p._oreArrived;
            p._oreArrived = null;
            const rr = world.mineOre(p, id);
            if (rr[0] && !rr[1].approaching) {
              const ore = world.ores.get(id);
              if (ore) ore.claimedBy = p.id;
            }
          }
          if (p._lootArrived) {
            const id = String(p._lootArrived);
            p._lootArrived = null;
            const collectLoot = async () => {
              const pile = world.lootPiles.get(id);
              if (!pile) {
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message: "That loot is no longer available.",
                  },
                });
                return;
              }
              if (!inv.canGiveMany(p, pile.items || [])) {
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message:
                      "Your bag is full. Free a slot before collecting this loot.",
                  },
                });
                return;
              }
              const inventoryBefore = (p.inventory || []).map((x: any) => ({
                ...x,
              }));
              const goldBefore = Number(p.gold || 0);
              const pileBefore = structuredClone(pile);
              const rr = world.pickupLoot(p, id);
              if (!rr?.[0]) {
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message: String(
                      rr?.[1] || "That loot could not be collected.",
                    ),
                  },
                });
                return;
              }
              if (rr[1]?.approaching) return;
              const rewards = rr[1] || { gold: 0, items: [] };
              if (!inv.canGiveMany(p, rewards.items || [])) {
                world.lootPiles.set(id, pileBefore);
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message:
                      "Your bag is full. Free a slot before collecting this loot.",
                  },
                });
                return;
              }
              let committed = true;
              for (const it of rewards.items || []) {
                if (!inv.give(p, it.itemId, it.qty)) {
                  committed = false;
                  break;
                }
              }
              if (!committed) {
                p.inventory = inventoryBefore;
                p.gold = goldBefore;
                inv.recalc(p);
                world.lootPiles.set(id, pileBefore);
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message:
                      "Loot could not be added. Your bag and the loot pile have been restored.",
                  },
                });
                return;
              }
              p.gold = goldBefore + Math.max(0, Number(rewards.gold || 0));
              inv.recalc(p);
              try {
                if (typeof repo.savePlayerNow === "function")
                  await repo.savePlayerNow(p);
                else await repo.savePlayer(p);
              } catch (error: any) {
                p.inventory = inventoryBefore;
                p.gold = goldBefore;
                inv.recalc(p);
                world.lootPiles.set(id, pileBefore);
                this.ctx.telemetry?.record?.("loot_pickup_persist_failed", {
                  playerId: String(p.id),
                  pileId: id,
                  message: String(error?.message || error),
                });
                this.send(c, {
                  type: "command_result",
                  data: {
                    ok: false,
                    message:
                      "Loot could not be saved. The loot pile has been restored; please try again.",
                  },
                });
                return;
              }
              this.send(c, {
                type: "command_result",
                data: {
                  ok: true,
                  message: `Loot collected: +${Math.max(0, Number(rewards.gold || 0))} gold.`,
                },
              });
            };
            const work = playerMutations?.withPlayer
              ? playerMutations.withPlayer(String(p.id), collectLoot)
              : collectLoot();
            void Promise.resolve(work).catch((error: any) => {
              this.ctx.telemetry?.record?.("loot_pickup_failed", {
                playerId: String(p.id),
                pileId: id,
                message: String(error?.message || error),
              });
            });
            continue;
          }
          playerCombatSimulation.tick(p, now);
          repo.savePlayer(p);
        }
      } catch (err) {
        console.error("tick", err);
      }
    }
    const projectileResults = combat.tickProjectiles(now);
    for (const hit of projectileResults) {
      const r = hit.r?.[1];
      if (!hit.r?.[0] || !r?.killed) continue;
      const owner = world.players.find(
        (x: any) => x.id === hit.projectile.playerId,
      );
      if (owner) {
        rewardMobKill(owner, {
          enemyId: r.enemyId,
          enemyName: r.enemyName,
          level: world.byIdMob(r.mobId)?.level || owner.level,
          xp: r.xp,
          gold: r.gold,
          lootPile: r.lootPile,
          participants: r.participants,
          mobId: r.mobId,
          x: r.x,
          y: r.y,
          source:
            world.byIdMob(r.mobId)?.ai === "boss"
              ? "boss"
              : world.byIdMob(r.mobId)?.ai === "elite"
                ? "elite"
                : "normal",
        });
        owner.lastCombat = { outcome: "victory", enemy: r.enemyName, at: now };
      }
    }
    for (const id of [...battlegroundQueue]) {
      const q = repo.getPlayer(id);
      if (!q || !q.online || q.dead || q.battlegroundId || q.level < 5) {
        battlegroundQueue.delete(id);
        pvpQueueTimes.delete(id);
      }
    }
    tryMatchDungeonQueue();
    startBattleground();
    stateRevisionRef.value++;
    worldCombatSimulation.tick(TICK_MS / 1000, now);
    if (now % 1000 < 50) {
      world.cleanup(now);
      social.cleanup(now);
      combat.cleanupOrphans(world.players, now);
    }

    for (const pp of world.players) {
      if (
        pp?.dungeon &&
        !pp.encounterId &&
        !playerMutations?.isLocked?.(pp.id)
      ) {
        const dr = dungeonEngine.tick(pp);
        if (dr) {
          pp.lastDungeonResult = dr;
        }
      }
    }
    this.broadcast();
    this.broadcastMotion(now);
    const elapsed = performance.now() - tickStarted;
    if (now - lastPersistenceCheckpointAtRef.value >= SESSION_CHECKPOINT_MS) {
      lastPersistenceCheckpointAtRef.value = now;
      try {
        this.awaitOrSyncCheckpoint();
      } catch (error) {
        console.warn("Periodic persistence checkpoint failed:", error);
      }
    }
    tickMetrics.lastMs = elapsed;
    tickMetrics.maxMs = Math.max(tickMetrics.maxMs, elapsed);
    tickMetrics.samples++;
    tickMetrics.avgMs += (elapsed - tickMetrics.avgMs) / tickMetrics.samples;
    if (elapsed > TICK_MS) tickMetrics.overruns++;
    telemetry.recordTick(elapsed, elapsed > TICK_MS);
  }
}
