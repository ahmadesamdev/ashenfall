const chatLastAt = new Map<string, number>();
export function registerSocialCommands(handlers: any, ctx: any) {
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
  handlers["party_target"] = async function (p: any, cmd: any) {
    const party = social.getParty(p.partyId);
    const target = repo.getPlayer(cmd.targetId);
    if (!party || !party.members.includes(cmd.targetId))
      return [false, "That player is not in your party."];
    if (!target || !target.online || target.zone !== p.zone)
      return [false, "Party member is not available in your area."];
    p.targetPlayerId = target.id;
    p.targetMobId = null;
    return [true, `Targeting ${target.name}.`];
  };
  handlers["party_assist"] = async function (p: any, cmd: any) {
    const party = social.getParty(p.partyId);
    if (!party) return [false, "You are not in a party."];
    const sourceId = cmd.targetId || p.partyAssistId || party.leader;
    const source = repo.getPlayer(sourceId);
    if (!source || !party.members.includes(source.id))
      return [false, "That player is not in your party."];
    if (!source.targetPlayerId && !source.targetMobId)
      return [false, "That player has no target."];
    if (source.targetPlayerId) {
      const target = repo.getPlayer(source.targetPlayerId);
      if (!target || !target.online || target.zone !== p.zone)
        return [false, "Their target is unavailable here."];
      p.targetPlayerId = target.id;
      p.targetMobId = null;
      return [true, `Assisting ${source.name}: ${target.name}.`];
    }
    const mob = world.byIdMob(source.targetMobId);
    if (!mob || mob.state === "dead" || mob.zone !== p.zone)
      return [false, "Their target is unavailable here."];
    p.targetMobId = mob.id;
    p.targetPlayerId = null;
    return [true, `Assisting ${source.name}: ${mob.name}.`];
  };
  handlers["party_set_assist"] = async function (p: any, cmd: any) {
    return social.setAssist(
      p,
      cmd.targetId || p.partyAssistId || social.getParty(p.partyId)?.leader,
    );
  };
  handlers["party_transfer_leader"] = async function (p: any, cmd: any) {
    return social.transferLeader(p, cmd.targetId);
  };
  handlers["inspect_player"] = async function (p: any, cmd: any) {
    const target = repo.getPlayer(cmd.targetId);
    if (!target) return [false, "Player is not available."];
    const isFriend = (p.friends || []).includes(target.id);
    if (target.id !== p.id && target.zone !== p.zone && !isFriend)
      return [false, "That player is not in your area."];
    const party = social.getParty(p.partyId);
    if (
      target.id !== p.id &&
      !isFriend &&
      (!party || !party.members.includes(target.id))
    )
      return [
        false,
        "You can inspect yourself, a friend, or a nearby party member.",
      ];
    return [
      true,
      `Inspecting ${target.name}.`,
      {
        inspect: {
          id: target.id,
          name: target.name,
          icon: target.icon,
          classId: target.classId,
          role: target.role,
          partyRole: target.partyRole || partyRole(target),
          secondaryRole: target.secondaryRole || null,
          level: target.level,
          zone: target.zone,
          hp: target.hp,
          maxHp: target.maxHp,
          resolve: target.resolve,
          maxResolve: target.maxResolve,
          equipment: target.equipment || {},
          stats: target.stats || {},
          professions: target.professions || [],
          friends: undefined,
        },
      },
    ];
  };
  handlers["friend_add"] = async function (p: any, cmd: any) {
    return social.friendAdd(p, cmd.targetId);
  };
  handlers["friend_accept"] = async function (p: any, cmd: any) {
    return social.friendAccept(p, cmd.targetId);
  };
  handlers["friend_decline"] = async function (p: any, cmd: any) {
    return social.friendDecline(p, cmd.targetId);
  };
  handlers["friend_remove"] = async function (p: any, cmd: any) {
    return social.friendRemove(p, cmd.targetId);
  };
  handlers["social_search"] = async function (p: any, cmd: any) {
    return social.searchPlayers(p, cmd.query);
  };
  handlers["whisper"] = async function (p: any, cmd: any) {
    return social.whisper(p, cmd.targetId, cmd.text);
  };
  handlers["guild_set_description"] = async function (p: any, cmd: any) {
    return social.guildSetDescription(p, cmd.text);
  };
  handlers["guild_set_motd"] = async function (p: any, cmd: any) {
    return social.guildSetMotd(p, cmd.text);
  };
  handlers["guild_chat"] = async function (p: any, cmd: any) {
    return social.guildChat(p, cmd.text);
  };
  handlers["ignore_add"] = async function (p: any, cmd: any) {
    return social.ignoreAdd(p, cmd.targetId);
  };
  handlers["ignore_remove"] = async function (p: any, cmd: any) {
    return social.ignoreRemove(p, cmd.targetId);
  };
  handlers["social_notifications_clear"] = async function (p: any, cmd: any) {
    p.socialNotifications = [];
    return [true, "Notifications cleared."];
  };
  handlers["select_player"] = async function (p: any, cmd: any) {
    const target = repo.getPlayer(cmd.targetId);
    if (!target || !target.online || target.zone !== p.zone)
      return [false, "Player not available."];
    p.targetPlayerId = target.id;
    p.targetMobId = null;
    return [true, `Targeting ${target.name}.`];
  };
  handlers["chat"] = async function (p: any, cmd: any) {
    const txt = String(cmd.text || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 240);
    if (!txt) return [false, "Empty message."];
    const chatNow = Date.now(),
      chatKey = String(p.id),
      lastChat = chatLastAt.get(chatKey) || 0;
    if (chatNow - lastChat < 750)
      return [false, "You are sending messages too quickly."];
    chatLastAt.set(chatKey, chatNow);
    if (chatLastAt.size > 5000) {
      for (const [k, t] of chatLastAt)
        if (chatNow - t > 60000) chatLastAt.delete(k);
    }
    const message = addChat(p.zone, {
      from: p.name,
      text: txt,
      kind: "player",
      partyId: p.partyId,
    });
    return [true, "Sent.", { chatMessage: message }];
  };
  handlers["party_chat"] = async function (p: any, cmd: any) {
    const r = social.partyChat(p, cmd.text);
    return r;
  };
  handlers["party_create"] = async function (p: any, cmd: any) {
    const r = social.partyCreate(p);
    if (Array.isArray(r)) return r;
    await repo.savePlayerNow(p);
    const party = social.getParty(p.partyId);
    return [
      true,
      `Party created: ${r}.`,
      { partyId: r, party: party ? partyState(p) : null },
    ];
  };
  handlers["party_invite"] = async function (p: any, cmd: any) {
    const target = repo.getPlayer(cmd.targetId);
    if (!target || !target.online || target.zone !== p.zone)
      return [false, "That player is not in your current area."];
    if (
      Math.hypot(target.x - p.x, target.y - p.y) >
      world.normalizedMeters(p.zone, 800)
    )
      return [false, "That player is outside your visible area."];
    return social.invite(p, cmd.targetId);
  };
  handlers["party_accept"] = async function (p: any, cmd: any) {
    const targetParty = social.getParty(cmd.partyId);
    if (!targetParty) return [false, "That party no longer exists."];
    if (!targetParty.members.some((id: any) => repo.getPlayer(id)?.online))
      return [false, "No party member is currently online."];
    return social.acceptInvite(p, cmd.partyId);
  };
  handlers["party_decline"] = async function (p: any, cmd: any) {
    return social.declineInvite(p, cmd.partyId);
  };
  handlers["party_kick"] = async function (p: any, cmd: any) {
    const r = social.partyKick(p, cmd.targetId);
    if (r[0]) {
      const target = repo.getPlayer(cmd.targetId);
      if (target) target.partyId = null;
    }
    return r;
  };
  handlers["party_disband"] = async function (p: any, cmd: any) {
    const r = social.partyDisband(p);
    if (r[0]) return [true, r[1], { party: null, partyId: null }];
    return r;
  };
  handlers["party_leave"] = async function (p: any, cmd: any) {
    social.partyLeave(p);
    return [true, "Left party.", { party: null, partyId: null }];
  };
  handlers["guild_create"] = async function (p: any, cmd: any) {
    const cost = 1000;
    if (Number(p.gold || 0) < cost)
      return [false, `You need ${cost} gold to create a guild.`];
    const r = social.guildCreate(p, cmd.name || "");
    if (r[0]) p.gold -= cost;
    return r;
  };
  handlers["guild_disband"] = async function (p: any, cmd: any) {
    return social.guildDisband(p);
  };
  handlers["guild_invite"] = async function (p: any, cmd: any) {
    return social.guildInvite(p, cmd.targetId);
  };
  handlers["guild_accept"] = async function (p: any, cmd: any) {
    return social.guildJoin(p, cmd.guildId);
  };
  handlers["guild_decline"] = async function (p: any, cmd: any) {
    return social.guildDecline(p);
  };
  handlers["guild_kick"] = async function (p: any, cmd: any) {
    return social.guildKick(p, cmd.targetId);
  };
  handlers["guild_promote"] = async function (p: any, cmd: any) {
    return social.guildPromote(p, cmd.targetId, cmd.rank);
  };
  handlers["guild_transfer_leader"] = async function (p: any, cmd: any) {
    return social.guildTransferLeader(p, cmd.targetId);
  };
  handlers["guild_leave"] = async function (p: any, cmd: any) {
    return social.guildLeave(p);
  };
  handlers["guild_project_start"] = async function (p: any, cmd: any) {
    return (
      guildOrganizations?.startProject?.(
        p,
        cmd.projectType || cmd.type,
        cmd.regionId || p.zone,
      ) || [false, "Guild world projects are unavailable."]
    );
  };
  handlers["guild_project_contribute"] = async function (p: any, cmd: any) {
    return (
      guildOrganizations?.contribute?.(p, cmd.projectId, cmd.amount) || [
        false,
        "Guild world projects are unavailable.",
      ]
    );
  };
}
