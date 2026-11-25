export function registerWorldCombatCommands(handlers: any, ctx: any) {
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
  } = ctx;
  handlers["clear_target"] = async function (p: any, cmd: any) {
    p.targetMobId = null;
    p.targetPlayerId = null;
    p.combat.autoApproach = false;
    if (p.movementIntent === "combat") p.movementIntent = "none";
    p.combat.queuedWorldAbility = null;
    p.combat.queuedAbility = null;
    p.pendingNpc = null;
    p.pendingGate = null;
    return [true, "Target cleared."];
  };
  handlers["target_mob"] = async function (p: any, cmd: any) {
    const m = world.byIdMob(cmd.mobId);
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      return [false, "That creature is not here."];
    p.targetMobId = m.id;
    p.targetPlayerId = null;
    p.combat.autoAttack = true;
    p.combat.approachSatisfied = false;
    const activelySteering = !!p.moveInput;
    const activelyManualClick =
      !!p.combat.manualMove && p.moveState === "moving" && !p.moveInput;
    if (activelyManualClick) {
      p.combat.manualMove = false;
      p.movementIntent = "combat";
    } else if (!activelySteering) p.combat.manualMove = false;
    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    const basicRangeNorm = world.normalizedMeters(
      p.zone,
      world.combatRangeMeters(p),
    );
    if (dist <= basicRangeNorm) {
      world.engageMobAgainstPlayer(p, m);
      p.combat.autoApproach = false;
      p.combat.approachSatisfied = true;
      world.enterWorldCombat(p, m);
      p.movementIntent = "combat";
      if (!p.combat.manualMove) {
        p.targetX = p.x;
        p.targetY = p.y;
        p.moveState = "idle";
      }
      return [true, `Targeting ${m.name}. In attack range.`];
    }
    p.combat.approachRangeMeters = world.combatRangeMeters(p);
    p.combat.approachSatisfied = false;
    if (activelySteering) {
      p.combat.autoApproach = false;
      return [true, `Targeting ${m.name}.`];
    }
    p.combat.autoApproach = true;
    p.movementIntent = "combat";
    const stand = Number(
      p.combat.approachRangeMeters || COMBAT_RANGES.meleeMeters,
    );
    const ap = world.approachPoint(p, m, stand);
    p.targetX = ap.x;
    p.targetY = ap.y;
    p.movementMode = "run";
    p.moveState = "moving";
    return [true, `Targeting ${m.name}. Approaching attack range...`];
  };
  handlers["cancel_cast"] = async function (p: any, cmd: any) {
    return combat.cancelCast(p, "Cancelled.")
      ? [true, "Cast cancelled."]
      : [false, "You are not casting."];
  };
  handlers["attack_mob"] = async function (p: any, cmd: any) {
    const m = world.byIdMob(cmd.mobId || p.targetMobId);
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      return [false, "No valid target."];
    p.targetMobId = m.id;
    p.targetPlayerId = null;
    p.combat.autoAttack = true;
    const activelySteering = !!p.moveInput;
    const activelyManualClick =
      !!p.combat.manualMove && p.moveState === "moving" && !p.moveInput;
    if (activelyManualClick) {
      p.combat.manualMove = false;
      p.movementIntent = "combat";
    } else if (!activelySteering) p.combat.manualMove = false;
    const dist = Math.hypot(p.x - m.x, p.y - m.y);
    const basicRangeNorm = world.normalizedMeters(
      p.zone,
      world.combatRangeMeters(p),
    );
    p.combat.approachRangeMeters = world.combatRangeMeters(p);
    if (dist > basicRangeNorm) {
      if (activelySteering) {
        p.combat.autoApproach = false;
        return [true, "Target selected. Manual movement remains in control."];
      }
      p.combat.autoApproach = true;
      p.movementIntent = "combat";
      const stand = Number(
        p.combat.approachRangeMeters || COMBAT_RANGES.meleeMeters,
      );
      const ap = world.approachPoint(p, m, stand);
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [true, "Approaching target attack range..."];
    }
    world.engageMobAgainstPlayer(p, m);
    world.enterWorldCombat(p, m);
    const r = combat.requestWorldCast(p, "basic_strike", m);
    if (r[0] && r[1]?.killed)
      rewardMobKill(p, {
        ...r[1],
        level: m.level,
        enemyId: m.type,
        mobId: m.id,
        source:
          m.ai === "boss" ? "boss" : m.ai === "elite" ? "elite" : "normal",
      });
    return r;
  };
  handlers["use_world_ability"] = async function (p: any, cmd: any) {
    const ability = abilities[cmd.abilityId];
    if (!ability) return [false, "Unknown ability."];
    if (
      ability?.heal ||
      ability?.partyBuff ||
      ability?.revive ||
      ability?.purge
    ) {
      return combat.requestWorldCast(
        p,
        cmd.abilityId,
        null,
        cmd.targetPlayerId || p.targetPlayerId || null,
      );
    }
    if (ability?.selfBuff) {
      return combat.requestWorldCast(p, cmd.abilityId, null, p.id);
    }
    if (ability?.aoe?.center === "self") {
      return combat.requestWorldCast(p, cmd.abilityId, null, null);
    }
    let m = p.worldCombatMobId ? world.byIdMob(p.worldCombatMobId) : null;
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      m = p.targetMobId ? world.byIdMob(p.targetMobId) : null;
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      m = cmd.mobId ? world.byIdMob(cmd.mobId) : null;
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      m = world
        .zoneMobs(p.zone, p)
        .filter(
          (x) =>
            x.state !== "dead" &&
            Math.hypot(x.x - p.x, x.y - p.y) <=
              world.normalizedMeters(p.zone, AUTO_TARGET_MAX_METERS),
        )
        .sort(
          (a, b) =>
            Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y),
        )[0];
    if (
      !m ||
      m.zone !== p.zone ||
      m.state === "dead" ||
      !world.sameDungeonInstance(m, p)
    )
      return [false, "No valid target."];
    p.targetMobId = m.id;
    p.targetPlayerId = null;
    p.combat.autoAttack = true;
    const abilityRangeNorm = combat.abilityRangeNormalized(p, ability);
    p.combat.approachRangeMeters = Math.max(
      1.5,
      abilityRangeNorm * world.worldMetersFor(p.zone),
    );
    return combat.requestWorldCast(p, cmd.abilityId, m);
  };
  handlers["toggle_auto"] = async function (p: any, cmd: any) {
    p.combat.autoAttack = !!cmd.enabled;
    if (!p.combat.autoAttack) {
      p.combat.autoApproach = false;
      p.combat.approachSatisfied = false;
      if (p.movementIntent === "combat") p.movementIntent = "none";
      return [true, "Auto-attack disabled."];
    }
    const m = p.targetMobId ? world.byIdMob(p.targetMobId) : null;
    if (m && m.zone === p.zone && m.state !== "dead") {
      const activelySteering = !!p.moveInput;
      if (!activelySteering) {
        p.combat.manualMove = false;
        p.movementIntent = "combat";
      }
      const rangeMeters = world.combatRangeMeters(p);
      const d = Math.hypot(p.x - m.x, p.y - m.y);
      p.combat.approachRangeMeters = rangeMeters;
      if (d <= world.normalizedMeters(p.zone, rangeMeters)) {
        world.engageMobAgainstPlayer(p, m);
        world.enterWorldCombat(p, m);
        p.combat.autoApproach = false;
        p.combat.approachSatisfied = true;
        p.movementIntent = activelySteering ? "manual" : "combat";
        if (!activelySteering) {
          p.targetX = p.x;
          p.targetY = p.y;
          p.moveState = "idle";
          p.velocityX = 0;
          p.velocityY = 0;
        }
      } else if (activelySteering) {
        p.combat.autoApproach = false;
        p.combat.approachSatisfied = false;
        p.movementIntent = "manual";
      } else {
        p.combat.approachSatisfied = false;
        p.combat.autoApproach = true;
        p.movementIntent = "combat";
        const ap = world.approachPoint(p, m, rangeMeters);
        p.targetX = ap.x;
        p.targetY = ap.y;
        p.movementMode = "run";
        p.moveState = "moving";
      }
    }
    return [true, "Auto-attack enabled."];
  };
}
