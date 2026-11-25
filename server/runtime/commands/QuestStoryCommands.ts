export function registerQuestStoryCommands(handlers: any, ctx: any) {
  const rollbackOwnedChanges = (target: any, before: any, attempted: any) => {
    const same = (a: any, b: any): boolean => {
      try {
        return JSON.stringify(a) === JSON.stringify(b);
      } catch {
        return Object.is(a, b);
      }
    };
    const walk = (dst: any, old: any, written: any) => {
      const keys = new Set([
        ...Object.keys(old || {}),
        ...Object.keys(written || {}),
      ]);
      for (const key of keys) {
        const hadOld = Object.prototype.hasOwnProperty.call(old || {}, key),
          hadWritten = Object.prototype.hasOwnProperty.call(written || {}, key);
        const currentHas = Object.prototype.hasOwnProperty.call(dst || {}, key);
        const ov = old?.[key],
          wv = written?.[key],
          cv = dst?.[key];
        if (
          hadOld &&
          hadWritten &&
          ov &&
          wv &&
          cv &&
          typeof ov === "object" &&
          typeof wv === "object" &&
          typeof cv === "object" &&
          !Array.isArray(ov) &&
          !Array.isArray(wv) &&
          !Array.isArray(cv)
        ) {
          walk(cv, ov, wv);
          continue;
        }
        if (currentHas === hadWritten && (!currentHas || same(cv, wv))) {
          if (hadOld) dst[key] = structuredClone(ov);
          else delete dst[key];
        }
      }
    };
    walk(target, before, attempted);
  };
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
    ensureStoryState,
    npcInteractionService,
    playerMutations,
  } = ctx;
  handlers["npc_dialogue"] = async function (p: any, cmd: any) {
    ensureStoryState(p);
    const n = (world.zoneNpcs(p.zone) || []).find(
      (x) => x.id === String(cmd.npcId || ""),
    );
    if (!n) return [false, "That NPC is not here."];
    if (
      Math.hypot(p.x - n.x, p.y - n.y) >
      world.normalizedMeters(p.zone, NPC_INTERACTION_METERS)
    )
      return [false, "You are too far away from that NPC."];
    p.activeNpcId = n.id;
    quest.onTalk?.(p, n.id);
    npcMemory?.rememberInteraction?.(n.id, p.id);
    const memory = npcMemory?.summary?.(n.id, p.id) || null;
    const node = (npcDialogue || []).find(
      (x: any) =>
        x.npcId === n.id &&
        Number(p.storyChapter || 0) >= Number(x.minChapter || 0) &&
        (!x.requiresFlag || !!p.storyFlags?.[x.requiresFlag]),
    );
    if (!node)
      return [
        true,
        "No new dialogue is available.",
        { npc: n.id, lines: [], choices: [], memory },
      ];
    p.dialogueState = p.dialogueState || {};
    const seenBefore = Boolean(p.dialogueState[node.id]);
    p.dialogueState[node.id] = true;
    return [
      true,
      "Dialogue available.",
      { npc: n.id, node, repeat: seenBefore, memory },
    ];
  };
  handlers["interact_npc"] = async function (p: any, cmd: any) {
    const n = (world.zoneNpcs(p.zone) || []).find((x) => x.id === cmd.npcId);
    if (!n) return [false, "That NPC is not here."];
    const interactionMeters = NPC_INTERACTION_METERS,
      standMeters = NPC_STAND_METERS;
    const d = Math.hypot(p.x - n.x, p.y - n.y);
    if (d > world.normalizedMeters(p.zone, interactionMeters)) {
      const ap = world.approachPoint(p, n, standMeters);
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
      p.pendingGate = null;
      p.pendingLoot = null;
      p.movementIntent = "interaction";
      p.targetX = ap.x;
      p.targetY = ap.y;
      p.movementMode = "run";
      p.moveState = "moving";
      p.pendingNpc = n.id;
      return [true, `Approaching ${n.name}.`];
    }
    p.pendingNpc = null;
    p.activeNpcId = n.id;
    p.trainerNpcId = n.kind === "trainer" ? n.id : null;
    quest.onTalk(p, n.id);
    quest.onInteract?.(p, n.id, 1);
    return [true, npcDetail(p, n)];
  };
  handlers["world_opportunity_accept"] = async function (p: any, cmd: any) {
    const tick = Number(
      worldIntegration?.state?.lastTick || Math.floor(Date.now() / 50),
    );
    const r = worldIntegration?.acceptOpportunity?.(
      p,
      String(cmd.opportunityId || ""),
      tick,
    );
    if (r?.[0]) {
      repo.savePlayer(p);
    }
    return r || [false, "World opportunities are temporarily unavailable."];
  };
  handlers["world_opportunity_action"] = async function (p: any, cmd: any) {
    const tick = Number(
      worldIntegration?.state?.lastTick || Math.floor(Date.now() / 50),
    );
    const r = worldIntegration?.actionOpportunity?.(
      p,
      String(cmd.contractId || ""),
      tick,
      String(cmd.outcome || ""),
    );
    if (r?.[0]) {
      const detail = r[2] || {};
      if (Number(detail.xp || 0) && gainXp) gainXp(p, Number(detail.xp));
      repo.savePlayer(p);
    }
    return r || [false, "World contracts are temporarily unavailable."];
  };
  handlers["set_active_quest"] = async function (p: any, cmd: any) {
    const id = String(cmd.questId || "");
    if (!id) {
      p.activeQuestId = null;
      repo.savePlayer(p);
      return [true, "Quest helper cleared.", { activeQuestId: null }];
    }
    const q = quest.get(id),
      st = quest.state(p, id);
    if (!q || st.claimed || (!st.accepted && !st.complete && !st.visible))
      return [false, "That quest is not available in your journal."];
    p.activeQuestId = id;
    repo.savePlayer(p);
    return [true, `Quest helper set to ${q.name}.`, { activeQuestId: id }];
  };
  handlers["accept_quest"] = async function (p: any, cmd: any) {
    const q = quest.get(cmd.questId);
    if (!q) return [false, "Quest not found."];
    if (q.giver) {
      const g = (world.zoneNpcs(p.zone) || []).find((n) => n.id === q.giver);
      if (
        !g ||
        Math.hypot(p.x - g.x, p.y - g.y) > world.normalizedMeters(p.zone, 30)
      )
        return [false, "Return to the quest giver to accept this quest."];
      p.activeNpcId = g.id;
    } else if (!npcInteractionService.isActiveNpcNearby(p)) {
      return [false, "You moved too far away from the quest giver."];
    }
    const r = quest.accept(p, cmd.questId);
    if (r[0]) {
      quest.reconcile(p);
      return [true, r[1], { questAccepted: cmd.questId }];
    }
    return r;
  };
  handlers["turnin_quest"] = async function (p: any, cmd: any) {
    const commit = async () => {
      const q = quest.get(cmd.questId);
      if (!q) return [false, "Quest not found."];
      const before = structuredClone(p);
      let attempted: any = null;
      if (q.giver) {
        const g = (world.zoneNpcs(p.zone) || []).find((n) => n.id === q.giver);
        if (
          !g ||
          Math.hypot(p.x - g.x, p.y - g.y) > world.normalizedMeters(p.zone, 30)
        )
          return [false, "Return to the quest giver to turn this in."];
        p.activeNpcId = g.id;
      } else if (!npcInteractionService.isActiveNpcNearby(p)) {
        return [false, "You moved too far away from the quest giver."];
      }
      try {
        const r = quest.claim(p, cmd.questId);
        if (!r[0]) return r;
        const rw = r[1].reward || {};
        reward(p, rw.xp || 0, rw.gold || 0, rw.item ? [rw.item] : []);
        if (r[1].next) {
          const ns = quest.state(p, r[1].next);
          ns.visible = true;
          ns.claimed = false;
          ns.complete = false;
          ns.progress = 0;
          ns.accepted = true;
        }
        p.lastQuestClaim = {
          questId: cmd.questId,
          reward: rw,
          story: r[1].story || "",
          at: Date.now(),
        };
        const rewardKey = `quest:${String(p.id)}:${String(cmd.questId)}:claim`;
        attempted = structuredClone(p);
        if (typeof repo.savePlayerRewardOnce !== "function") {
          throw new Error("Durable quest reward persistence is unavailable.");
        }
        const committed = await repo.savePlayerRewardOnce(p, rewardKey);
        if (!committed) {
          rollbackOwnedChanges(p, before, attempted);
          return [false, "This quest reward has already been claimed."];
        }
        return [
          true,
          `Quest turned in: ${q.name}.`,
          { reward: rw, next: r[1].next || null },
        ];
      } catch (error) {
        if (attempted) rollbackOwnedChanges(p, before, attempted);
        else {
          for (const key of Object.keys(p)) delete p[key];
          Object.assign(p, structuredClone(before));
        }
        console.error(
          "[quest] turn-in persistence failed; player state restored",
          { playerId: String(p.id), questId: String(cmd.questId || ""), error },
        );
        return [
          false,
          "Your quest reward could not be saved. Nothing was consumed; please try again.",
        ];
      }
    };
    return playerMutations?.withPlayer
      ? playerMutations.withPlayer(String(p.id), commit)
      : commit();
  };
}
