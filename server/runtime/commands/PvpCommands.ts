import { rollAvoidance } from "../../combat/CombatTable.js";
import { pushFx } from "../../combat/CombatEffects.js";
export function registerPvpCommands(handlers: any, ctx: any) {
  const {
    bus,
    repo,
    activeSessions,
    reservedCharacterNames,
    guildOrganizations,
    worldIntegration,
    classes,
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
    dungeons,
    recipes,
    shops,
    storyIntro,
    talents,
    talentTrees,
    classBuilds,
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
    clearPvpTemplate,
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
    npcMemory,
    reconcileTravelQuestState,
    makeGearInstance,
    randomAffix,
    itemization,
    findTradeSession,
    tradeRequests,
    tradeDistanceOk,
    tradeSessions,
    tradeOffer,
    completeTrade,
    resolveLootRollForParty,
    claimDungeonRewardChest,
    partyRole,
    runtimeId,
  } = ctx;
  handlers["pvp_arena_queue"] = async function (p: any, cmd: any) {
    const bracket = String(cmd.bracket || "2v2") === "3v3" ? "3v3" : "2v2";
    return enqueueArena(
      p,
      bracket,
      cmd.solo === true || String(cmd.solo).toLowerCase() === "true",
    );
  };
  handlers["pvp_arena_leave_queue"] = async function (p: any, cmd: any) {
    return leaveArenaQueue(p);
  };
  handlers["pvp_queue"] = async function (p: any, cmd: any) {
    if (!p.hasCharacter || p.dead || Number(p.hp || 0) <= 0)
      return [false, "You cannot queue right now."];
    if (p.dungeon || p.dungeonId || p.encounterId || p.worldCombatMobId)
      return [
        false,
        "Leave your dungeon or combat encounter before queueing for PvP.",
      ];
    if (p.pvp || p.battlegroundId)
      return [false, "You cannot queue while already in PvP."];
    if (
      p.dungeonMatch ||
      p.dungeonQueueGroupId ||
      dungeonQueue.some((q: any) => q.id === p.id) ||
      [...arenaQueues.values()].some((q: any) =>
        q.some((g: any) => (g.memberIds || []).includes(p.id)),
      ) ||
      [...arenaMatches.values()].some((m: any) =>
        (m.playerIds || []).includes(p.id),
      )
    )
      return [
        false,
        "Leave your existing dungeon or arena queue before queueing for a battleground.",
      ];
    if (p.level < 5) return [false, "Battlegrounds unlock at level 5."];
    battlegroundQueue.add(p.id);
    pvpQueueTimes.set(p.id, Date.now());
    const bg = startBattleground();
    return [
      true,
      bg
        ? `Battleground ${bg.id} started.`
        : `Queued for ${Number(p.level || 1) >= 60 ? "level 60" : `${Math.floor((Number(p.level || 1) - 5) / 10) * 10 + 5}-${Math.min(60, Math.floor((Number(p.level || 1) - 5) / 10) * 10 + 14)}`} battleground.`,
      bg ? battlegroundSnapshot(bg) : null,
    ];
  };
  handlers["pvp_leave_queue"] = async function (p: any, cmd: any) {
    battlegroundQueue.delete(p.id);
    pvpQueueTimes.delete(p.id);
    return [true, "Removed from battleground queue."];
  };
  handlers["pvp_battleground_attack"] = async function (p: any, cmd: any) {
    const bg = battlegrounds.get(p.battlegroundId);
    if (!bg || bg.state !== "active") return [false, "No active battleground."];
    if (p.dead || Number(p.hp || 0) <= 0)
      return [false, "You cannot attack while defeated."];
    const onRed = bg.red.includes(p.id),
      onBlue = bg.blue.includes(p.id);
    if (!onRed && !onBlue)
      return [false, "You are not assigned to this battleground."];
    const enemyTeam = onRed ? bg.blue : bg.red;
    const enemies = enemyTeam
      .map((id: any) => repo.getPlayer(id))
      .filter((x: any) => x && x.online && !x.dead && x.zone === p.zone);
    const o =
      enemies.find(
        (x: any) => x.id === String(cmd.targetId || p.targetPlayerId || ""),
      ) ||
      enemies.sort(
        (a: any, b: any) =>
          Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
      )[0];
    if (!o) return [false, "No enemy is available in this battleground."];
    const dist = Math.hypot(p.x - o.x, p.y - o.y),
      rangeMeters = Math.max(1, Number(world.combatRangeMeters(p) || 18)),
      rangeNorm = world.normalizedMeters(p.zone, rangeMeters);
    if (dist > rangeNorm) {
      if (dist > world.normalizedMeters(p.zone, 800))
        return [false, "Enemy is outside your visible area."];
      p.targetPlayerId = o.id;
      p.combat.manualMove = false;
      p.combat.autoApproach = true;
      p.combat.approachSatisfied = false;
      p.movementIntent = "combat";
      const ap = world.approachPoint(p, o, rangeMeters);
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [
        true,
        `Approaching ${o.name}.`,
        { pvp: true, approaching: true, targetId: o.id },
      ];
    }
    const n = Date.now();
    if (
      (p.statuses || []).some(
        (st: any) =>
          st === "stunned" ||
          (st?.id === "stunned" && Number(st.until || 0) > n),
      )
    )
      return [false, "You are stunned."];
    if ((p.combat.gcdReadyAt || 0) > n)
      return [false, "Global cooldown active."];
    {
      const avoided = rollAvoidance(o, Number(p.level || 1));
      if (avoided) {
        o._lastDamageAt = n;
        o._hpRegenAt = n;
        pushFx(o, "avoid", p.id, o.id, null, {
          outcome: avoided,
          durationMs: 900,
        });
        pushFx(p, "miss", p.id, o.id, null, {
          outcome: avoided,
          durationMs: 900,
        });
        p.combat.gcdReadyAt = n + 1200;
        p.pvpCombatUntil = n + 8000;
        return [
          true,
          avoided === "dodge"
            ? `${o.name} dodges your attack.`
            : `You miss ${o.name}.`,
          { pvp: true, damage: 0, avoided },
        ];
      }
    }
    const rolled = rollDamage({
      attack: Number(p.pvpRuntimeStats?.attack || p.attack || 0),
      power: 1,
      armor: Number(o.pvpRuntimeStats?.armor || o.armor || 0),
      attackerLevel: Number(p.level || 1),
      critChance: p.bonuses?.crit || 0,
      damageBonus: Number(p.bonuses?.damage || 0),
    });
    const dmg = Math.min(
      Math.max(1, Math.round(o.maxHp * 0.18)),
      Math.max(1, Math.round(rolled.damage * 0.65)),
    );
    o._lastDamageAt = n;
    o._hpRegenAt = n;
    o.hp = Math.max(0, o.hp - dmg);
    p.combat.gcdReadyAt = n + 1200;
    p.pvpCombatUntil = n + 8000;
    if (o.hp <= 0) {
      const stats = pvpStats(p),
        opponentStats = pvpStats(o);
      stats.kills++;
      stats.honor += 5;
      opponentStats.deaths++;
      o.hp = o.maxHp;
      o.dead = false;
      o.respawnAt = 0;
      o.pvpCombatUntil = n + 3000;
      o.x = bg.red.includes(o.id) ? 0.18 : 0.82;
      o.y = 0.5;
      o.targetX = o.x;
      o.targetY = o.y;
      o.moveState = "idle";
      o.velocityX = 0;
      o.velocityY = 0;
      return [
        true,
        `${o.name} was defeated.`,
        { pvp: true, damage: dmg, killed: true },
      ];
    }
    return [true, `You hit ${o.name} for ${dmg}.`, { pvp: true, damage: dmg }];
  };
  handlers["pvp_capture"] = async function (p: any, cmd: any) {
    const bg = battlegrounds.get(p.battlegroundId);
    if (!bg || bg.state !== "active") return [false, "No active battleground."];
    if (p.dead || Number(p.hp || 0) <= 0)
      return [false, "You cannot capture an objective while defeated."];
    if (Math.hypot(p.x - 0.5, p.y - 0.5) > 0.09)
      return [false, "Move onto the central objective."];
    const team: any = bg.red.includes(p.id)
      ? "red"
      : bg.blue.includes(p.id)
        ? "blue"
        : null;
    if (!team) return [false, "You are not assigned to this battleground."];
    const enemy: any = team === "red" ? "blue" : "red";
    const enemyIds: any[] = team === "red" ? bg.blue : bg.red;
    const now = Date.now();
    const contested = enemyIds.some((id: any) => {
      const x = repo.getPlayer(id);
      return (
        x &&
        x.online &&
        !x.dead &&
        x.zone === p.zone &&
        Math.hypot(x.x - 0.5, x.y - 0.5) <= 0.09
      );
    });
    if (contested) {
      bg.objective.owner = null;
      return [true, "Objective contested."];
    }
    const captureCooldownMs = 2000;
    const lastCaptureAt = Number(bg.objective.lastCaptureAt || 0);
    if (now - lastCaptureAt < captureCooldownMs)
      return [false, "The objective is still being captured."];
    bg.objective.lastCaptureAt = now;
    bg.objective.owner = team;
    bg.objective.progress = Math.min(100, bg.objective.progress + 10);
    bg.score[team] += 10;
    if (bg.score[team] >= 100) {
      bg.state = "finished";
      bg.winner = team;
      bg.finishedAt = now;
      for (const id of [...bg.red, ...bg.blue]) {
        const x = repo.getPlayer(id);
        if (x) {
          const won = team === (bg.red.includes(id) ? "red" : "blue");
          const stats = pvpStats(x);
          if (won) {
            stats.battlegroundWins = Number(stats.battlegroundWins || 0) + 1;
            stats.honor += 25;
          } else
            stats.battlegroundLosses =
              Number(stats.battlegroundLosses || 0) + 1;
          const original = x.pvp || {};
          x.battlegroundId = null;
          x.pvp = null;
          x.targetPlayerId = null;
          x.zone = original.fromZone || x.homeCity || "stonehold";
          x.x = Number(original.fromX ?? x.x);
          x.y = Number(original.fromY ?? x.y);
          x.targetX = x.x;
          x.targetY = x.y;
          clearPvpTemplate(x);
        }
      }
    }
    return [true, `${team} captures the objective.`, battlegroundSnapshot(bg)];
  };
  handlers["pvp_leave_battleground"] = async function (p: any, cmd: any) {
    const bg = battlegrounds.get(p.battlegroundId);
    if (!bg) return [false, "You are not in a battleground."];
    bg.red = bg.red.filter((id: any) => id !== p.id);
    bg.blue = bg.blue.filter((id: any) => id !== p.id);
    const original = p.pvp || {};
    p.battlegroundId = null;
    p.pvp = null;
    p.targetPlayerId = null;
    p.zone = original.fromZone || p.homeCity || "stonehold";
    p.x = Number(original.fromX ?? p.x);
    p.y = Number(original.fromY ?? p.y);
    p.targetX = p.x;
    p.targetY = p.y;
    clearPvpTemplate(p);
    p.pvpDisengageUntil = Date.now() + 5000;
    if (bg.red.length === 0 || bg.blue.length === 0) {
      bg.state = "finished";
      bg.winner =
        bg.red.length === 0
          ? bg.blue.length
            ? "blue"
            : null
          : bg.red.length
            ? "red"
            : null;
      bg.finishedAt = Date.now();
      for (const id of [...bg.red, ...bg.blue]) {
        const member = repo.getPlayer(id);
        if (!member) continue;
        const prior = member.pvp || {};
        member.battlegroundId = null;
        member.pvp = null;
        member.targetPlayerId = null;
        member.zone = prior.fromZone || member.homeCity || "stonehold";
        member.x = Number(prior.fromX ?? member.x);
        member.y = Number(prior.fromY ?? member.y);
        member.targetX = member.x;
        member.targetY = member.y;
        clearPvpTemplate(member);
      }
    }
    return [true, "You left the battleground."];
  };
  handlers["pvp_attack"] = async function (p: any, cmd: any) {
    if (!p.pvp || !["active", "arena"].includes(p.pvp.state))
      return [false, "You are not in PvP."];
    if (!pvpAllowed(p)) return [false, "PvP is disabled here."];
    if (Date.now() < (p.pvpDisengageUntil || 0))
      return [false, "You are still disengaging from PvP."];
    const match = p.pvp.state === "arena" ? arenaMatches.get(p.pvp.id) : null;
    const opponentIds = match
      ? match.teamA.includes(p.id)
        ? match.teamB
        : match.teamA
      : [p.pvp.opponentId];
    const opponents = opponentIds
      .map((id: any) => repo.getPlayer(id))
      .filter((x: any) => x && x.online && !x.dead && x.zone === p.zone);
    const targetId =
      cmd.targetId ||
      cmd.targetPlayerId ||
      p.targetPlayerId ||
      (match ? null : p.pvp.opponentId);
    const target = opponents.find((x: any) => x.id === targetId);
    if (!target) return [false, "Select a valid PvP target."];
    const attackDistance = Math.hypot(p.x - target.x, p.y - target.y);
    const attackRange = world.normalizedMeters(
      p.zone,
      Math.max(1, Number(world.combatRangeMeters(p) || 18)),
    );
    if (attackDistance > attackRange) {
      if (attackDistance > world.normalizedMeters(p.zone, 800))
        return [false, "Your opponent is too far away."];
      p.targetPlayerId = target.id;
      p.combat.manualMove = false;
      p.combat.autoApproach = true;
      p.combat.approachSatisfied = false;
      p.movementIntent = "combat";
      const standMeters = Math.max(1, Number(world.combatRangeMeters(p) || 18));
      const ap = world.approachPoint(p, target, standMeters);
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [
        true,
        `Approaching ${target.name}.`,
        { pvp: true, approaching: true, targetId: target.id },
      ];
    }
    const result = combat.executePvpBasic(p, target, Date.now());
    if (result[0] && result[2]?.killed) {
      if (match) {
        const team = match.teamA.includes(p.id) ? "A" : "B";
        const living = (team === "A" ? match.teamB : match.teamA)
          .map((id: any) => repo.getPlayer(id))
          .filter((x: any) => x && !x.dead);
        if (living.length === 0) finishArena(match, team, "elimination");
      } else finishDuel(p, target);
    }
    return result;
  };
  handlers["pvp_cast"] = async function (p: any, cmd: any) {
    if (!p.pvp || !["active", "arena"].includes(p.pvp.state))
      return [false, "You are not in PvP."];
    if (!pvpAllowed(p)) return [false, "PvP is disabled here."];
    if (Date.now() < (p.pvpDisengageUntil || 0))
      return [false, "You are still disengaging from PvP."];
    const match = p.pvp.state === "arena" ? arenaMatches.get(p.pvp.id) : null;
    const opponentIds = match
      ? match.teamA.includes(p.id)
        ? match.teamB
        : match.teamA
      : [p.pvp.opponentId];
    const opponents = opponentIds
      .map((id: any) => repo.getPlayer(id))
      .filter((x: any) => x && x.online && x.zone === p.zone);
    const allyIds = match
      ? match.teamA.includes(p.id)
        ? match.teamA
        : match.teamB
      : [p.id];
    const allies = allyIds
      .map((id: any) => repo.getPlayer(id))
      .filter((x: any) => x && x.online && x.zone === p.zone);
    const ability = abilities[String(cmd.abilityId || "")];
    if (!ability) return [false, "Unknown ability."];
    const targetId =
      cmd.targetId || cmd.targetPlayerId || p.targetPlayerId || null;
    const result = combat.executePvpCast(
      p,
      ability,
      targetId,
      opponents,
      allies,
      Date.now(),
    );
    if (result[0] && Number(result[2]?.kills || 0) > 0) {
      const defeated = opponents.filter((x: any) => x?.dead);
      for (const t of defeated) {
        if (match && match.playerIds.includes(t.id)) {
          const team = match.teamA.includes(p.id) ? "A" : "B";
          const living = (team === "A" ? match.teamB : match.teamA)
            .map((id: any) => repo.getPlayer(id))
            .filter((x: any) => x && !x.dead);
          if (living.length === 0) finishArena(match, team, "elimination");
        } else if (t.id === p.pvp?.opponentId) finishDuel(p, t);
      }
    }
    return result;
  };
  handlers["pvp_invite"] = async function (p: any, cmd: any) {
    const target = repo.getPlayer(cmd.targetId);
    const z = world.byId[p.zone];
    if (
      !p.hasCharacter ||
      p.dead ||
      Number(p.hp || 0) <= 0 ||
      p.dungeon ||
      p.dungeonId ||
      p.encounterId
    )
      return [
        false,
        "You cannot challenge players while defeated or inside a dungeon.",
      ];
    if (z?.city)
      return [
        false,
        "You cannot challenge another player to PvP inside a city or safe zone. Move to a PvP-enabled area first.",
      ];
    if (!pvpAllowed(p))
      return [
        false,
        "PvP is not enabled in this zone or you are below its level requirement.",
      ];
    if (!target || !target.online || target.zone !== p.zone)
      return [false, "That player is not available."];
    if (target.id === p.id) return [false, "You cannot challenge yourself."];
    if (
      target.dead ||
      Number(target.hp || 0) <= 0 ||
      target.dungeon ||
      target.dungeonId ||
      target.encounterId
    )
      return [
        false,
        "That player cannot accept a challenge while defeated or inside a dungeon.",
      ];
    if (
      target.pvpInvite &&
      Date.now() - Number(target.pvpInvite.at || 0) <= 60000
    )
      return [false, "That player already has a pending PvP challenge."];
    if (p.pvp || target.pvp) return [false, "One of you is already in a duel."];
    if (world.byId[target.zone]?.city)
      return [false, "PvP is disabled in cities."];
    if (
      Math.hypot(target.x - p.x, target.y - p.y) >
      world.normalizedMeters(p.zone, 800)
    )
      return [false, "That player is outside your visible area."];
    target.pvpInvite = { from: p.id, at: Date.now() };
    return [true, `PvP challenge sent to ${target.name}.`];
  };
  handlers["pvp_accept"] = async function (p: any, cmd: any) {
    if (
      !p.hasCharacter ||
      p.dead ||
      Number(p.hp || 0) <= 0 ||
      p.dungeon ||
      p.dungeonId ||
      p.encounterId
    )
      return [
        false,
        "You cannot accept a PvP challenge while defeated or inside a dungeon.",
      ];
    if (!pvpAllowed(p))
      return [
        false,
        "PvP is not enabled in this zone or you are below its level requirement.",
      ];
    if (p.pvpInvite && Date.now() - Number(p.pvpInvite.at || 0) > 60000) {
      p.pvpInvite = null;
      return [false, "That PvP challenge has expired."];
    }
    const from = repo.getPlayer(String(cmd.fromId || p.pvpInvite?.from || ""));
    if (!from || !from.online || !p.pvpInvite || p.pvpInvite.from !== from.id)
      return [false, "No active PvP challenge."];
    if (
      from.dead ||
      Number(from.hp || 0) <= 0 ||
      from.dungeon ||
      from.dungeonId ||
      from.encounterId
    )
      return [false, "The challenger is defeated or inside a dungeon."];
    if (from.pvp || p.pvp) return [false, "A player is already in a duel."];
    if (from.zone !== p.zone)
      return [false, "The challenger is no longer in this zone."];
    const id = runtimeId("duel");
    const startedAt = Date.now(),
      centerX = (from.x + p.x) / 2,
      centerY = (from.y + p.y) / 2,
      arenaRadius = world.normalizedMeters(p.zone, 250);
    from.pvp = {
      id,
      opponentId: p.id,
      state: "active",
      startedAt,
      centerX,
      centerY,
      arenaRadius,
      outSince: 0,
    };
    p.pvp = {
      id,
      opponentId: from.id,
      state: "active",
      startedAt,
      centerX,
      centerY,
      arenaRadius,
      outSince: 0,
    };
    from.pvpInvite = null;
    p.pvpInvite = null;
    from.targetPlayerId = p.id;
    p.targetPlayerId = from.id;
    return [true, "PvP duel started.", { pvp: true, opponentId: from.id }];
  };
  handlers["pvp_decline"] = async function (p: any, cmd: any) {
    p.pvpInvite = null;
    return [true, "PvP challenge declined."];
  };
  handlers["pvp_cancel"] = async function (p: any, cmd: any) {
    if (!p.pvp || !["active", "arena"].includes(p.pvp.state))
      return [false, "You are not in PvP."];
    if (p.pvp.state === "arena")
      return [
        false,
        "An active arena match cannot be cancelled by a participant. Finish the match or contact an administrator.",
      ];
    const o = repo.getPlayer(p.pvp.opponentId);
    const engaged =
      Date.now() -
        Math.max(Number(p._lastDamageAt || 0), Number(o?._lastDamageAt || 0)) <
      10000;
    if (engaged) {
      if (!String(p.pvp.id || "").startsWith("open_") && o) {
        finishDuel(o, p);
        return [true, "You forfeited the duel."];
      }
      if (String(p.pvp.id || "").startsWith("open_"))
        return [false, "You cannot disengage while in combat."];
    }
    if (o) {
      o.pvp = null;
      o.targetPlayerId = null;
      o.pvpDisengageUntil = Date.now() + 5000;
    }
    p.pvp = null;
    p.targetPlayerId = null;
    p.pvpDisengageUntil = Date.now() + 5000;
    return [true, "PvP duel ended."];
  };
  handlers["pvp_open_attack"] = async function (p: any, cmd: any) {
    if (
      !p.hasCharacter ||
      p.dead ||
      Number(p.hp || 0) <= 0 ||
      p.dungeon ||
      p.dungeonId ||
      p.encounterId
    )
      return [
        false,
        "You cannot initiate PvP while defeated or inside a dungeon.",
      ];
    if (
      p.pvp ||
      world.byId[p.zone]?.city ||
      !pvpZone(p) ||
      Number(p.level || 1) < (Number(world.byId[p.zone]?.pvpLevelMin) || 1)
    )
      return [false, "World PvP is not enabled here."];
    const o = repo.getPlayer(cmd.targetId || p.targetPlayerId);
    if (
      !o ||
      o.id === p.id ||
      !o.online ||
      !o.hasCharacter ||
      o.dead ||
      o.zone !== p.zone ||
      !pvpAllowed(o)
    )
      return [false, "That player is not a valid PvP target."];
    if (o.dungeon || o.dungeonId || o.encounterId)
      return [false, "That player is inside a dungeon."];
    if (o.pvp) return [false, "That player is already engaged in PvP."];
    if (p.partyId && p.partyId === o.partyId)
      return [false, "Party members cannot attack each other."];
    if (Date.now() < (p.pvpDisengageUntil || 0))
      return [false, "You are still disengaging from PvP."];
    const dist = Math.hypot(p.x - o.x, p.y - o.y);
    if (dist > world.normalizedMeters(p.zone, 800))
      return [false, "That player is outside your visible area."];
    p.targetPlayerId = o.id;
    p.pvp = {
      id: runtimeId("open"),
      opponentId: o.id,
      state: "active",
      startedAt: Date.now(),
      centerX: p.x,
      centerY: p.y,
      arenaRadius: Infinity,
      outSince: 0,
    };
    o.pvp = o.pvp || {
      id: p.pvp.id,
      opponentId: p.id,
      state: "active",
      startedAt: Date.now(),
      centerX: o.x,
      centerY: o.y,
      arenaRadius: Infinity,
      outSince: 0,
    };
    o.targetPlayerId = p.id;
    if (
      dist >
      world.normalizedMeters(
        p.zone,
        Math.max(1, Number(world.combatRangeMeters(p) || 18)),
      )
    ) {
      p.combat.manualMove = false;
      p.combat.autoApproach = true;
      p.combat.approachSatisfied = false;
      p.movementIntent = "combat";
      const ap = world.approachPoint(p, o, world.combatRangeMeters(p));
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [
        true,
        `You engage ${o.name} and begin closing the distance.`,
        { pvp: true, approaching: true, targetId: o.id },
      ];
    }
    return [
      true,
      `You engaged ${o.name} in world PvP.`,
      { pvp: true, targetId: o.id },
    ];
  };
}
