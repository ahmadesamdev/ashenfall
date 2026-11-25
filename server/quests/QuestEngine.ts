import { questAdjustedXp } from "../progression/Progression.js";
import { applyReputation } from "../progression/StoryProgression.js";
class QuestEngine {
  private quests: any[];
  private inv: any;
  private world: any;
  private byId: Record<string, any>;
  constructor(quests, inv, world = null) {
    this.quests = quests;
    this.inv = inv;
    this.world = world;
    this.byId = Object.assign(
      Object.create(null),
      Object.fromEntries(quests.map((q) => [q.id, q])),
    );
  }
  ensure(p) {
    p.quests = p.quests && typeof p.quests === "object" ? p.quests : {};
    for (const q of this.quests)
      if (!Object.hasOwn(p.quests, q.id))
        p.quests[q.id] = {
          progress: 0,
          complete: false,
          claimed: false,
          visible: false,
          accepted: false,
        };
  }
  get(id) {
    const key = String(id ?? "");
    return Object.hasOwn(this.byId, key) ? this.byId[key] : undefined;
  }
  state(p, id) {
    const key = String(id ?? "");
    p.quests = p.quests && typeof p.quests === "object" ? p.quests : {};
    if (!Object.hasOwn(this.byId, key))
      return Object.hasOwn(p.quests, key)
        ? p.quests[key]
        : {
            progress: 0,
            complete: false,
            claimed: false,
            visible: false,
            accepted: false,
          };
    if (!Object.hasOwn(p.quests, key))
      p.quests[key] = {
        progress: 0,
        complete: false,
        claimed: false,
        visible: false,
        accepted: false,
      };
    return p.quests[key];
  }
  prerequisitesMet(p, q) {
    if (!q) return false;
    if (q.requiresWorldEvent) {
      const ws = this.world?.worldEventState?.[q.zone || this.get(q.id)?.zone];
      const eventId = String(q.requiresWorldEvent);
      const regions = this.world?.worldEventState || {};
      const match = (Object.values(regions) as any[]).find(
        (r: any) => String(r?.defId || r?.eventId) === eventId,
      );
      const outcome = String(q.requiresWorldEventOutcome || "completed");
      if (!match || String(match.lastOutcome || match.outcome) !== outcome)
        return false;
    }
    if (
      q.requires &&
      !q.requires.every((id) => {
        const s = p.quests[id];
        return !!s?.claimed;
      })
    )
      return false;
    if (q.requiresStoryFlag) {
      const flags = Array.isArray(q.requiresStoryFlag)
        ? q.requiresStoryFlag
        : [q.requiresStoryFlag];
      if (!flags.every((id) => !!p.storyFlags?.[id])) return false;
    }
    if (q.requiresAnyStoryFlag) {
      const flags = Array.isArray(q.requiresAnyStoryFlag)
        ? q.requiresAnyStoryFlag
        : [q.requiresAnyStoryFlag];
      if (!flags.some((id) => !!p.storyFlags?.[id])) return false;
    }
    if (
      q.requiresStoryChapter != null &&
      Number(p.storyChapter || 0) < Number(q.requiresStoryChapter)
    )
      return false;
    if (q.requiresFactionRep) {
      for (const [f, v] of Object.entries(q.requiresFactionRep)) {
        if (Number(p.factionReputation?.[f] || 0) < Number(v)) return false;
      }
    }
    return true;
  }
  classAllowed(p, q) {
    if (!q) return false;
    const classId = String(p?.classId || "");
    const declared = q.classIds || q.classes || q.class;
    if (Array.isArray(declared) && declared.length)
      return declared.map(String).includes(classId);
    if (typeof q.classId === "string" && q.classId)
      return q.classId === classId;
    return true;
  }
  offersForNpc(p, npc) {
    return (npc.questIds || [])
      .map((id) => this.byId[id])
      .filter(Boolean)
      .filter((q) => {
        const s = this.state(p, q.id);
        return (
          !s.claimed &&
          !s.accepted &&
          this.classAllowed(p, q) &&
          (q.minLevel || 1) <= p.level
        );
      })
      .map((q) => ({
        quest: q,
        state: this.state(p, q.id),
        requirementsMet: this.prerequisitesMet(p, q),
        requiredQuestIds: q.requires || [],
      }));
  }
  turninsForNpc(p, npc) {
    return (npc.questIds || [])
      .map((id) => this.byId[id])
      .filter(Boolean)
      .filter((q) => {
        const s = this.state(p, q.id);
        return s.accepted && !s.claimed && s.complete;
      })
      .map((q) => ({ quest: q, state: this.state(p, q.id) }));
  }
  accept(p, id) {
    const q = this.get(id),
      s = this.state(p, id);
    if (!q) return [false, "Quest not found."];
    if (!this.classAllowed(p, q))
      return [false, "This class story is not meant for your class."];
    if (s.claimed || s.accepted)
      return [false, "Quest is already accepted or completed."];
    if (!this.prerequisitesMet(p, q))
      return [false, "Complete the previous quest in the story first."];
    if ((q.minLevel || 1) > p.level)
      return [false, `Reach level ${q.minLevel || 1} first.`];
    s.accepted = true;
    s.visible = true;
    if (q.type === "world_event_consequence") {
      this.onWorldEventConsequence(
        p,
        q.requiresWorldEvent,
        q.requiresWorldEventOutcome || "completed",
        q.amount || 1,
      );
    }
    return [true, `Quest accepted: ${q.name}.`];
  }
  progress(p, type, target, amount = 1) {
    for (const q of this.quests) {
      if (q.type !== type) continue;
      const s = this.state(p, q.id);
      if (!s.accepted || s.claimed) continue;
      const match =
        type === "kill"
          ? q.enemy === target
          : type === "travel"
            ? q.target === target
            : type === "dungeon"
              ? q.target === target
              : type === "mine"
                ? q.target === target
                : type === "talk"
                  ? q.target === target
                  : type === "craft"
                    ? q.target === target
                    : type === "sell"
                      ? q.target === "any" || q.target === target
                      : type === "auction"
                        ? q.target === "any" || q.target === target
                        : type === "trade"
                          ? q.target === "any" || q.target === target
                          : type === "dungeon_stage"
                            ? q.target === target
                            : type === "interact"
                              ? q.target === target
                              : type === "collect"
                                ? q.target === target
                                : type === "escort"
                                  ? q.target === target
                                  : type === "investigate"
                                    ? q.target === target
                                    : type === "discover"
                                      ? q.target === target
                                      : type === "world_event"
                                        ? q.target === target
                                        : false;
      if (match) {
        s.progress = Math.min(q.amount, s.progress + amount);
        s.complete = s.progress >= q.amount;
        s.visible = true;
      }
    }
  }
  onWorldEventConsequence(p, eventId, outcome = "completed", amount = 1) {
    for (const q of this.quests) {
      if (
        q.type !== "world_event_consequence" ||
        q.requiresWorldEvent !== eventId ||
        String(q.requiresWorldEventOutcome || "completed") !== String(outcome)
      )
        continue;
      const s = this.state(p, q.id);
      if (!s.accepted || s.claimed) continue;
      s.progress = Math.min(
        Number(q.amount || 1),
        Number(s.progress || 0) + amount,
      );
      s.complete = s.progress >= Number(q.amount || 1);
      s.visible = true;
    }
  }
  onWorldEvent(p, eventId, amount = 1) {
    this.progress(p, "world_event", eventId, amount);
  }

  partyEligible(owner, member, q) {
    if (!q || q.creditMode !== "party") return false;
    if (
      q.partyCreditRequiresAcceptance !== false &&
      !this.state(member, q.id).accepted
    )
      return false;
    if (
      q.partyCreditRequiresLevel !== false &&
      Number(member.level || 1) < Number(q.minLevel || 1)
    )
      return false;
    if (
      !member.online ||
      member.dead ||
      member.zone !== owner.zone ||
      !owner.partyId ||
      member.partyId !== owner.partyId
    )
      return false;
    const meters = Number(q.partyCreditDistanceMeters || 120);
    return (
      Math.hypot(member.x - owner.x, member.y - owner.y) <=
      this.world.normalizedMeters(owner.zone, meters)
    );
  }
  onKill(p, eid) {
    this.progress(p, "kill", eid, 1);
    const players = this.world?.players || [];
    for (const q of this.quests.filter(
      (q) => q.type === "kill" && q.creditMode === "party",
    )) {
      const ownerState = this.state(p, q.id);
      if (!ownerState.accepted || ownerState.claimed || q.enemy !== eid)
        continue;
      for (const member of players) {
        if (member.id === p.id || !this.partyEligible(p, member, q)) continue;
        this.progress(member, "kill", eid, 1);
      }
    }
    for (const q of this.quests.filter(
      (q) => q.type === "kill" && q.enemy === eid && q.questItem,
    )) {
      const st = this.state(p, q.id);
      if (st.accepted && !st.claimed && !this.inv.has(p, q.questItem))
        this.inv.give(p, q.questItem, 1);
      if (q.creditMode === "party") {
        for (const member of players) {
          if (member.id === p.id || !this.partyEligible(p, member, q)) continue;
          const ms = this.state(member, q.id);
          if (ms.accepted && !ms.claimed && !this.inv.has(member, q.questItem))
            this.inv.give(member, q.questItem, 1);
        }
      }
    }
  }
  onTravel(p, zone) {
    this.progress(p, "travel", zone, 1);
    this.reconcile(p);
  }
  reconcile(p) {
    for (const q of this.quests) {
      const st = this.state(p, q.id);
      if (
        q.type === "travel" &&
        !st.claimed &&
        st.accepted &&
        q.target === p.zone
      ) {
        st.progress = q.amount || 1;
        st.complete = true;
        st.visible = true;
      }
    }
  }
  onDungeon(p, id) {
    this.progress(p, "dungeon", id, 1);
    const party = this.world?.players || [];
    for (const q of this.quests.filter(
      (q) =>
        q.type === "dungeon" && q.creditMode === "party" && q.target === id,
    )) {
      const st = this.state(p, q.id);
      if (!st.accepted || st.claimed) continue;
      for (const m of party) {
        if (m.id !== p.id && this.partyEligible(p, m, q))
          this.progress(m, "dungeon", id, 1);
      }
    }
  }
  onMine(p, id, amount = 1) {
    this.progress(p, "mine", id, amount);
  }
  onCraft(p, id, amount = 1) {
    this.progress(p, "craft", id, amount);
  }
  onSell(p, id, amount = 1) {
    this.progress(p, "sell", id, amount);
  }
  onAuction(p, id = "any", amount = 1) {
    this.progress(p, "auction", id, amount);
  }
  onTrade(p, amount = 1) {
    this.progress(p, "trade", "any", amount);
  }
  onDungeonStage(p, id, amount = 1) {
    this.progress(p, "dungeon_stage", id, amount);
    const party = this.world?.players || [];
    for (const q of this.quests.filter(
      (q) =>
        q.type === "dungeon_stage" &&
        q.creditMode === "party" &&
        q.target === id,
    )) {
      const st = this.state(p, q.id);
      if (!st.accepted || st.claimed) continue;
      for (const m of party) {
        if (
          m.id !== p.id &&
          this.partyEligible(p, m, q) &&
          m.dungeon?.id === p.dungeon?.id
        )
          this.progress(m, "dungeon_stage", id, amount);
      }
    }
  }
  onTalk(p, npcId) {
    this.progress(p, "talk", npcId, 1);
  }
  onInteract(p, targetId, amount = 1) {
    this.progress(p, "interact", targetId, amount);
  }
  onCollect(p, itemId, amount = 1) {
    this.progress(p, "collect", itemId, amount);
  }
  onEscort(p, targetId, amount = 1) {
    this.progress(p, "escort", targetId, amount);
  }
  onInvestigate(p, targetId, amount = 1) {
    this.progress(p, "investigate", targetId, amount);
  }
  onDiscover(p, targetId, amount = 1) {
    this.progress(p, "discover", targetId, amount);
  }
  claim(p, id) {
    const q = this.get(id),
      s = this.state(p, id);
    if (!q || !s.accepted)
      return [false, "Accept this quest from the quest giver first."];
    if (!s.complete)
      return [false, `Objective incomplete: ${s.progress}/${q.amount}.`];
    if (s.claimed) return [false, "Quest reward already claimed."];
    const requiredQty = Number(q.requiredItemQty || 1);
    if (q.requiredItem) {
      const count = (p.inventory || [])
        .filter((x) => x.itemId === q.requiredItem)
        .reduce((sum, x) => sum + Math.max(0, Number(x.qty || 0)), 0);
      if (count < requiredQty)
        return [false, `You still need ${requiredQty} ${q.requiredItem}.`];
    }
    const rewardItem = q.classRewards?.[p.classId] || q.item || null;
    if (rewardItem && !this.inv.canGive(p, rewardItem, 1))
      return [
        false,
        "Your bag is full. Free a slot before turning in this quest.",
      ];
    if (q.requiredItem && !this.inv.remove(p, q.requiredItem, requiredQty))
      return [
        false,
        "Your required quest item could not be consumed. Nothing was changed.",
      ];
    s.claimed = true;
    s.accepted = false;
    if (!p.storyFlags || typeof p.storyFlags !== "object") p.storyFlags = {};
    if (q.storyFlag) p.storyFlags[String(q.storyFlag)] = true;
    if (q.category === "main_story" || q.category === "world")
      p.storyFlags[`quest:${q.id}`] = true;
    if (q.reputation) applyReputation(p, q.reputation);
    if (q.category === "main_story") {
      const chapter = Number.isFinite(Number(q.storyChapterId))
        ? Math.max(0, Math.floor(Number(q.storyChapterId)))
        : (() => {
            const chapterText = String(q.chapter || "");
            const roman = chapterText
              .match(/Chapter\s+(I{1,3}|IV|V|VI|VII|VIII|IX|X)/i)?.[1]
              ?.toUpperCase();
            const map: any = {
              I: 1,
              II: 2,
              III: 3,
              IV: 4,
              V: 5,
              VI: 6,
              VII: 7,
              VIII: 8,
              IX: 9,
              X: 10,
            };
            return roman
              ? Number(map[roman] ?? 0)
              : chapterText.toLowerCase().includes("prologue")
                ? 0
                : null;
          })();
      if (chapter !== null) {
        p.storyChapter = Math.max(Number(p.storyChapter || 0), chapter);
        p.storyChapterHistory = Array.isArray(p.storyChapterHistory)
          ? p.storyChapterHistory
          : [];
        if (!p.storyChapterHistory.includes(chapter))
          p.storyChapterHistory.push(chapter);
      }
    }
    const rewardXp = questAdjustedXp(q.xp || 0, p.level, q.minLevel || 1);
    return [
      true,
      {
        reward: { xp: rewardXp, gold: q.gold || 0, item: rewardItem },
        story: q.story || "",
        next: q.next || null,
        chapter: p.storyChapter || 0,
        storyFlags: p.storyFlags,
      },
    ];
  }
}
export { QuestEngine };
