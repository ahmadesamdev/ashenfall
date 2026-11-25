import { normalizePlayerClassState } from "../ClassRuntimeNormalization.js";
export function registerCharacterCommands(handlers: any, ctx: any) {
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
    loadoutService,
  } = ctx;
  handlers["resume_character"] = async function (p: any, cmd: any) {
    const saved = repo.getPlayer(String(cmd.playerId || ""));
    if (!saved || !saved.hasCharacter)
      return [false, "Saved character not found."];
    if (!saved.accountId || saved.accountId !== p.accountId)
      return [false, "That character does not belong to this account."];
    const active = activeSessions.get(saved.id);
    if (active && active !== p)
      return [false, "That character is already connected."];
    if (saved.online && !active) saved.online = false;
    Object.assign(p, saved);
    p.online = true;
    p.lastLoginAt = Date.now();
    p.lastSeenAt = p.lastLoginAt;
    p.sessionEpoch = Number(p.sessionEpoch || 0) + 1;
    p.combatFx = p.combatFx || [];
    p.combat = p.combat || {};
    const dungeonResume = dungeonEngine.reconnect(p);
    if (!dungeonResume[0]) return dungeonResume;
    const cls = normalizePlayerClassState(p, classes);
    if (cls) {
      p.availableSkills = p.availableSkills || [];
    }
    quest.ensure(p);
    loadoutService.ensureStarterInventory(p);
    normalizeXpTrack(p);
    inv.recalc(p);
    addChat(p.zone, {
      from: "Ashenfall",
      text: `Welcome back, ${p.name}.`,
      kind: "system",
    });
    await repo.savePlayerNow(p);
    return [
      true,
      `Welcome back, ${p.name}.`,
      { resumed: true, playerId: p.id },
    ];
  };
  handlers["create_character"] = async function (p: any, cmd: any) {
    if (!p.accountId)
      return [
        false,
        "You must enter Ashenfall through an authenticated session first.",
      ];
    if (p.hasCharacter) return [false, "This character is already created."];
    const classKey = String(cmd.classId || "");
    const c =
      (Object.hasOwn(classes || {}, classKey) ? classes[classKey] : null) ||
      (Array.isArray(classes)
        ? classes.find((x: any) => x?.id === classKey)
        : null);
    if (!c || typeof c !== "object" || c.id !== classKey)
      return [false, "Invalid class selection. Please choose a class."];
    const z = world.byId[p.zone] || zones[0];
    const requestedName =
      String(cmd.name || p.name || "Ashen Wanderer")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 20) || "Ashen Wanderer";
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '\-_.]{1,19}$/u.test(requestedName))
      return [
        false,
        "Character names must be 2-20 characters: letters, numbers, spaces, apostrophes, hyphens, dots or underscores.",
      ];
    const nameKey = normalizeCharacterName(requestedName);
    if (
      characterNameTaken(requestedName, p.id) ||
      reservedCharacterNames.has(nameKey)
    )
      return [
        false,
        "That character name is already taken. Choose another name.",
      ];
    try {
      await repo.reserveCharacterName(nameKey, p.id);
    } catch (error) {
      return [
        false,
        error?.message ||
          "That character name is already taken. Choose another name.",
      ];
    }
    reservedCharacterNames.add(nameKey);
    p.name = requestedName;
    p.accountId = p.accountId;
    p.classId = c.id;
    p.icon = c.icon;
    p.role = c.role;
    p.partyRole =
      c.partyRole ||
      (["vanguard"].includes(c.id)
        ? "Tank"
        : c.id === "hierophant"
          ? "Healer"
          : c.id === "warden"
            ? "Support"
            : "DPS");
    p.secondaryRole = c.secondaryRole || null;
    p.combatProfile = c.combatProfile || null;
    p.resourceName = c.resource;
    p.resourceIcon = c.resourceIcon;
    const starterPool =
      c.startSkills && c.startSkills.length >= 3
        ? c.startSkills
        : (c.abilities || [])
            .filter((id) => (c.abilityUnlocks || {})[id] <= 1)
            .slice(0, 3);
    p.abilityIds = [...starterPool].slice(0, 3);
    p.learnedSkills = [...p.abilityIds];
    p.knownAbilities = [...p.abilityIds];
    p.hasCharacter = true;
    p.baseHp = Number(c.baseHp || 1);
    p.baseAttack = Number(c.baseAttack || 0);
    p.baseArmor = Number(c.baseArmor || 0);
    p.baseResolve = Number(c.baseResolve || 1);
    p.maxHp = p.hp = p.baseHp;
    p.attack = p.baseAttack;
    p.armor = p.baseArmor;
    p.maxResolve = p.resolve = p.baseResolve;
    p.stats = {
      strength: 10,
      agility: 10,
      intellect: 10,
      vitality: 10,
      willpower: 10,
    };
    p.statPoints = 0;
    p.talentPoints = 0;
    p.talents = [];
    p.activeBuildId = null;
    p.buildBonuses = {};
    p.bonuses = { haste: 0, crit: 0, damage: 0, healing: 0 };
    p.talentBonuses = {
      attack: 0,
      maxHp: 0,
      armor: 0,
      maxResolve: 0,
      haste: 0,
      crit: 0,
      damage: 0,
      healing: 0,
      resolveRegen: 0,
    };
    p.combatFx = [];
    p.movementIntent = "none";
    p.combat.manualMove = false;
    p.combat.autoApproach = false;
    p.x = z.spawn.x;
    p.y = z.spawn.y;
    p.targetX = p.x;
    p.targetY = p.y;
    p.speed = MOVEMENT_SPEEDS.walk;
    p.runSpeed = MOVEMENT_SPEEDS.run;
    p.movementMode = "run";
    p.movementPreferenceInitialized = true;
    p.movementPreferenceVersion = 2;
    loadoutService.ensureStarterInventory(p);
    inv.recalc(p);
    quest.ensure(p);
    p.storyDialogueOpen = true;
    p.storyDialogueStep = 0;
    p.storyIntroSeen = false;
    p.hasCharacter = true;
    p.homeCity = z.homeCity || z.id;
    const qs = p.quests.call_of_ashenfall || {
      progress: 0,
      complete: false,
      claimed: false,
      visible: false,
      accepted: false,
    };
    qs.visible = true;
    qs.accepted = false;
    qs.complete = false;
    p.quests.call_of_ashenfall = qs;
    p.lastLoginAt = Date.now();
    p.lastSeenAt = p.lastLoginAt;
    p.sessionEpoch = Number(p.sessionEpoch || 0) + 1;
    addChat(p.zone, {
      from: "Ashenfall",
      text: `Welcome, ${p.name}. Your adventure begins.`,
      kind: "system",
    });
    try {
      await repo.savePlayerNow(p);
    } catch (error) {
      reservedCharacterNames.delete(nameKey);
      try {
        await repo.releaseCharacterName(nameKey, p.id);
      } catch {}
      activeSessions.delete(p.id);
      p.hasCharacter = false;
      throw error;
    }
    return [true, `Welcome to Ashenfall, ${p.name}.`];
  };
  handlers["learn_skill"] = async function (p: any, cmd: any) {
    const cls = classes[p.classId];
    const trainer = (world.zoneNpcs(p.zone) || []).find(
      (n: any) => n.kind === "trainer" && n.classId === p.classId,
    );
    if (
      !trainer ||
      Math.hypot(p.x - trainer.x, p.y - trainer.y) >
        world.normalizedMeters(p.zone, 12)
    )
      return [
        false,
        "You must stand near your class trainer to learn this skill.",
      ];
    const unlocks = cls?.abilityUnlocks || {};
    const abilityKey = String(cmd.abilityId || "");
    const req = Object.hasOwn(unlocks, abilityKey)
      ? Number(unlocks[abilityKey])
      : 0;
    if (!req || !Number.isFinite(req))
      return [false, "That skill is not part of your class."];
    if (p.level < req)
      return [false, `Reach level ${req} to learn this skill.`];
    if (p.abilityIds.includes(abilityKey))
      return [false, "You already know that skill."];
    p.abilityIds.push(abilityKey);
    p.knownAbilities = p.abilityIds.slice();
    return [
      true,
      `Learned ${abilities[cmd.abilityId]?.name || cmd.abilityId}.`,
    ];
  };
  handlers["respawn"] = async function (p: any, cmd: any) {
    if (p.pvp?.state === "arena")
      return [false, "You cannot respawn during an active arena match."];
    if (!p.dead) return [false, "You are not dead."];
    if (Date.now() < p.respawnAt) return [false, "Not ready to respawn."];
    if (p.dungeon) {
      const wipe = p.dungeon.wipePending;
      const instance = dungeonEngine.getPlayerInstance(p);
      p.dead = false;
      p.respawnReady = false;
      if (wipe) {
        const r = dungeonEngine.resetAfterWipe(p);
        if (!r[0]) return r;
        return [true, "The dungeon has reset after the wipe.", r[1]];
      }
      if (instance && instance.state === "ACTIVE") {
        p.hp = p.maxHp;
        p.resolve = p.maxResolve;
        p.x = Number(p.dungeon.checkpointX ?? p.x);
        p.y = Number(p.dungeon.checkpointY ?? p.y);
        p.targetX = p.x;
        p.targetY = p.y;
        p.moveState = "idle";
        p.velocityX = 0;
        p.velocityY = 0;
        p.targetMobId = null;
        p.targetPlayerId = null;
        p.worldCombatMobId = null;
        p.encounterId = null;
        p.combat.queuedAbility = null;
        p.combat.queuedWorldAbility = null;
        p.combat.autoAttack = false;
        p.combat.manualMove = false;
        p.combat.autoApproach = false;
        return [
          true,
          "You respawn at the dungeon checkpoint.",
          { dungeon: p.dungeon.id, instanceId: instance.id },
        ];
      }
    }
    const wasDungeon = !!p.dungeon;
    const returnZone =
      p.dungeon?.fromZone || p.zone || p.homeCity || "stonehold";
    const returnPos = wasDungeon
      ? { x: p.dungeon?.fromX, y: p.dungeon?.fromY }
      : { x: p.x, y: p.y };
    const z = world.byId[returnZone] || zones[0];
    const safe = wasDungeon
      ? returnPos
      : world.nearestRespawnPoint(
          returnZone,
          Number(returnPos.x),
          Number(returnPos.y),
        );
    p.dead = false;
    p.respawnReady = false;
    p.hp = p.maxHp;
    p.resolve = p.maxResolve;
    p.dungeon = null;
    p.x = Number.isFinite(safe?.x) ? safe.x : z.spawn.x;
    p.y = Number.isFinite(safe?.y) ? safe.y : z.spawn.y;
    p.zone = returnZone;
    p.targetX = p.x;
    p.targetY = p.y;
    p.moveState = "idle";
    p.targetMobId = null;
    p.targetPlayerId = null;
    p.worldCombatMobId = null;
    p.encounterId = null;
    p.combat.queuedAbility = null;
    p.combat.queuedWorldAbility = null;
    p.combat.autoAttack = false;
    p.combat.manualMove = false;
    p.combat.autoApproach = false;
    p.combat.approachSatisfied = false;
    return [
      true,
      wasDungeon
        ? `You return to ${z.name} after the defeat.`
        : `You respawn at ${z.name}.`,
    ];
  };
  handlers["rest"] = async function (p: any, cmd: any) {
    if (p.dead) return [false, "You cannot rest while dead."];
    if (p.encounterId || p.worldCombatMobId)
      return [false, "You cannot rest during combat."];
    if (p.pvp || Date.now() < Number(p.pvpCombatUntil || 0))
      return [false, "You cannot rest during PvP combat."];
    p.hp = p.maxHp;
    p.resolve = p.maxResolve;
    return [true, "You are fully rested."];
  };
  handlers["travel"] = async function (p: any, cmd: any) {
    const zoneKey = String(cmd.zoneId ?? "");
    const dest = Object.hasOwn(world.byId || {}, zoneKey)
      ? world.byId[zoneKey]
      : null;
    if (!dest || !dest.city)
      return [false, "You can only travel to a city this way."];
    if (p.dead) return [false, "You cannot travel while dead."];
    if (p.dungeon || p.pvp || p.battlegroundId)
      return [false, "Leave your dungeon or PvP match before travelling."];
    if (Number(dest.minLevel || 0) > Number(p.level || 1))
      return [false, `Reach level ${dest.minLevel} to travel there.`];
    if (Date.now() < Number(p.teleportCooldownUntil || 0))
      return [false, "You must wait a moment before travelling again."];
    const r = world.travel(p, zoneKey);
    if (r[0]) p.teleportCooldownUntil = Date.now() + 3000;
    if (r[0]) {
      quest.onTravel(p, zoneKey);
      reconcileTravelQuestState(p);
    }
    return r;
  };
  handlers["use_gate"] = async function (p: any, cmd: any) {
    const g = (world.zoneGates(p.zone) || []).find((x) => x.id === cmd.gateId);
    if (!g) return [false, "That road is not here."];
    if (p.gateCooldownUntil > Date.now())
      return [false, "Give yourself a moment after arriving."];
    const d = Math.hypot(p.x - g.x, p.y - g.y);
    if (d > world.normalizedMeters(p.zone, 16)) {
      const ap = world.approachPoint(p, g, 12);
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
      p.pendingNpc = null;
      p.pendingLoot = null;
      p.movementIntent = "interaction";
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      p.pendingGate = g.id;
      return [true, "Approaching the gate."];
    }
    const r = world.travel(p, g.to, true, `${g.id}_return`);
    if (r[0]) {
      quest.onTravel(p, g.to);
      reconcileTravelQuestState(p);
    }
    return r;
  };
}
