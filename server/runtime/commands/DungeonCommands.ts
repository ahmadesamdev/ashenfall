export function registerDungeonCommands(handlers: any, ctx: any) {
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
  handlers["start_dungeon"] = async function (p: any, cmd: any) {
    if (!p.partyId) return [false, "Create or join a party first."];
    const d = dungeons.find((x) => x.id === cmd.dungeonId);
    if (!d) return [false, "Unknown dungeon."];
    const party = social.getParty(p.partyId);
    if (!party) return [false, "Party not found."];
    if (party.leader !== p.id)
      return [false, "Only the party leader can enter the dungeon."];
    const onlineMembers = party.members
      .map((id) => repo.getPlayer(id))
      .filter((x) => x && x.online && !x.dead);
    if (!onlineMembers.length)
      return [false, "No party members are available."];
    for (const member of onlineMembers) {
      if (member.encounterId || member.worldCombatMobId)
        return [false, `${member.name} is already in combat.`];
      if (member.pvp || member.battlegroundId)
        return [false, `${member.name} is in PvP and cannot enter a dungeon.`];
      if (member.level < d.level)
        return [false, `${member.name} needs level ${d.level}.`];
      if (
        Number(member.storyChapter || 0) < Number(d.requiresStoryChapter || 0)
      )
        return [
          false,
          `${member.name} must reach story chapter ${d.requiresStoryChapter} first.`,
        ];
    }
    const r = dungeonEngine.start(p, d.id);
    if (!r[0]) return r;
    for (const member of onlineMembers) member.dungeonMechanicsShown = false;
    return [
      true,
      `Your party entered ${d.name}.`,
      {
        dungeon: d.name,
        stage: 1,
        total: d.stages.length,
        mechanics: d.mechanics || {},
        routeChoices: d.routeChoices || [],
        optionalRooms: d.optionalRooms || [],
        shortcuts: d.shortcuts || [],
        members: onlineMembers.map((x) => x.name),
        zoneId: d.id,
      },
    ];
  };
  handlers["claim_dungeon_reward"] = async function (p: any, cmd: any) {
    return claimDungeonRewardChest(p, String(cmd.chestId || ""));
  };
  handlers["dungeon_queue"] = async function (p: any, cmd: any) {
    if (!p.hasCharacter || p.dead)
      return [false, "You cannot queue right now."];
    if (p.pvp || p.battlegroundId)
      return [false, "Leave PvP before queueing for a dungeon."];
    if (p.dungeonMatch)
      return [
        false,
        "You already have a dungeon match waiting for confirmation.",
      ];
    if (p.partyId)
      return [
        false,
        "Leave your party before solo-queueing. The party leader can enter a dungeon directly.",
      ];
    if (p.dungeon || p.encounterId || p.worldCombatMobId)
      return [false, "You cannot queue while in combat or a dungeon."];
    const id = String(cmd.dungeonId || "random");
    const eligible = dungeons.filter((d: any) => {
      const r = d.levelRange || { min: d.level, max: 60 };
      return (
        Number(p.level || 1) >= Number(r.min || d.level || 1) &&
        Number(p.level || 1) <= Number(r.max || 60) &&
        Number(p.storyChapter || 0) >= Number(d.requiresStoryChapter || 0)
      );
    });
    if (id !== "random") {
      const d = dungeons.find((x: any) => x.id === id);
      if (!d) return [false, "Unknown dungeon."];
      const r = d.levelRange || { min: d.level, max: 60 };
      if (
        Number(p.level || 1) < Number(r.min || d.level || 1) ||
        Number(p.level || 1) > Number(r.max || 60)
      )
        return [false, `That dungeon is for levels ${r.min}-${r.max}.`];
    } else if (!eligible.length)
      return [
        false,
        "No dungeon is unlocked for your level yet. The first dungeon unlocks at level 4.",
      ];
    const role = dungeonQueueRole(p, String(cmd.role || ""));
    const snap = enqueueDungeonQueue(p, id, role);
    if (snap?.error) return [false, snap.error];
    return [true, `Queued as ${role}.`, snap];
  };
  handlers["dungeon_set_role"] = async function (p: any, cmd: any) {
    if (!p.hasCharacter) return [false, "Create a character first."];
    if (p.dungeon || p.encounterId || p.worldCombatMobId)
      return [false, "You cannot change dungeon role while in combat."];
    const role = dungeonQueueRole(p, String(cmd.role || ""));
    p.partyRole =
      role === "TANK" ? "Tank" : role === "HEALER" ? "Healer" : "DPS";
    return [true, `Dungeon role set to ${role}.`, { role }];
  };
  handlers["dungeon_queue_party"] = async function (p: any, cmd: any) {
    if (!p.hasCharacter || p.dead)
      return [false, "You cannot queue right now."];
    if (p.pvp || p.battlegroundId)
      return [false, "Leave PvP before queueing for a dungeon."];
    if (p.dungeonMatch)
      return [
        false,
        "You already have a dungeon match waiting for confirmation.",
      ];
    if (p.dungeon || p.encounterId || p.worldCombatMobId)
      return [false, "You cannot queue while in combat or a dungeon."];
    const id = String(cmd.dungeonId || "random");
    const roles = cmd.roles && typeof cmd.roles === "object" ? cmd.roles : {};
    const result = dungeonQueueService.enqueueParty(p, id, roles);
    return result;
  };
  handlers["dungeon_accept_match"] = async function (p: any, cmd: any) {
    if (p.pvp || p.battlegroundId)
      return [false, "Leave PvP before entering a dungeon."];
    return acceptDungeonMatch(p);
  };
  handlers["dungeon_decline_match"] = async function (p: any, cmd: any) {
    return declineDungeonMatch(p);
  };
  handlers["dungeon_leave_queue"] = async function (p: any, cmd: any) {
    if (p.dungeonQueueGroupId) {
      if (!leaveDungeonPartyQueue(p))
        return [
          false,
          "Only the party leader can leave a premade dungeon queue.",
        ];
      return [
        true,
        "Your party left the dungeon queue.",
        dungeonQueueSnapshot(p),
      ];
    }
    removeDungeonQueue(p.id);
    return [true, "You left the dungeon queue.", dungeonQueueSnapshot(p)];
  };
  handlers["dungeon_choose_route"] = async function (p: any, cmd: any) {
    return dungeonEngine.chooseRoute(p, String(cmd.routeId || ""));
  };
  handlers["dungeon_enter_optional"] = async function (p: any, cmd: any) {
    return dungeonEngine.enterOptional(p, String(cmd.roomId || ""));
  };
  handlers["dungeon_unlock_shortcut"] = async function (p: any, cmd: any) {
    return dungeonEngine.unlockShortcut(p, String(cmd.shortcutId || ""));
  };
  handlers["abandon_dungeon"] = async function (p: any, cmd: any) {
    const r = dungeonEngine.abandon(p);
    if (r[0])
      world.travel(p, r[1]?.returnZone || p.homeCity || "stonehold", false);
    return r;
  };
  handlers["leave_dungeon"] = async function (p: any, cmd: any) {
    const r = dungeonEngine.abandon(p);
    if (r[0])
      world.travel(p, r[1]?.returnZone || p.homeCity || "stonehold", false);
    return r;
  };
}
