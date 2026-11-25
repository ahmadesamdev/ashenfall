import { runtimeId } from "../shared/Ids.js";
import { DungeonQueueService } from "./services/DungeonQueueService.js";
import { PvpMatchService } from "./services/PvpMatchService.js";

export class QueueService {
  readonly dungeonQueue: any[] = [];
  readonly dungeonMatches = new Map<string, any>();
  readonly battlegroundQueue = new Set<string>();
  readonly battlegrounds = new Map<string, any>();
  readonly pvpQueueTimes = new Map<string, number>();
  readonly arenaQueues = new Map<string, any[]>();
  readonly arenaQueueTimes = new Map<string, number>();
  readonly arenaMatches = new Map<string, any>();
  readonly dungeonPartyQueues = new Map<string, any>();
  readonly dungeonQueueService: DungeonQueueService;
  readonly pvpMatchService: PvpMatchService;
  constructor(private readonly ctx: any) {
    this.dungeonQueueService = new DungeonQueueService(this);
    this.pvpMatchService = new PvpMatchService(this);
  }
  duelHonorLog = new Map<string, { start: number; count: number }>();
  isArenaQueued(id: string) {
    return [...this.arenaQueues.values()].some((q: any[]) =>
      q.some((g: any) => (g.memberIds || []).includes(id)),
    );
  }
  hasArenaMatch(id: string) {
    return [...this.arenaMatches.values()].some((m: any) =>
      (m.playerIds || []).includes(id),
    );
  }
  isDungeonQueued(id: string) {
    return (
      this.dungeonQueue.some((q: any) => q.id === id) ||
      [...this.dungeonPartyQueues.values()].some((g: any) =>
        (g.memberIds || []).includes(id),
      )
    );
  }
  isQueueBusy(p: any) {
    return (
      !p ||
      !!(
        p.dungeon ||
        p.dungeonId ||
        p.encounterId ||
        p.worldCombatMobId ||
        p.battlegroundId ||
        p.pvp ||
        p.dungeonMatch ||
        p.dungeonQueueGroupId ||
        p.arenaQueueId ||
        this.isArenaQueued(p.id) ||
        this.hasArenaMatch(p.id) ||
        this.battlegroundQueue.has(p.id) ||
        this.isDungeonQueued(p.id)
      )
    );
  }

  requeueMatch(m: any) {
    const partyGroups = m.partyGroups || [];
    for (const gid of partyGroups) {
      const members = (m.playerIds || [])
        .map((id: any) => this.ctx.repo.getPlayer(id))
        .filter(
          (p: any) =>
            p && p.partyId === this.ctx.social.getParty(p.partyId)?.id,
        );
      const originalMembers = m.originalPartyMembers?.[gid] || [];
      const live = originalMembers
        .map((id: any) => this.ctx.repo.getPlayer(id))
        .filter(
          (p: any) =>
            p &&
            p.online &&
            !p.dead &&
            !p.dungeon &&
            !p.encounterId &&
            !p.worldCombatMobId,
        );
      if (live.length === originalMembers.length && live.length) {
        const q = {
          id: gid,
          partyId: live[0].partyId,
          leader: live[0].partyId
            ? this.ctx.social.getParty(live[0].partyId)?.leader
            : null,
          memberIds: live.map((p: any) => p.id),
          dungeonId: m.dungeonId,
          roles: Object.fromEntries(
            live.map((p: any) => [
              p.id,
              m.roles?.[p.id] || this.dungeonRole(p),
            ]),
          ),
          queuedAt: Date.now(),
        };
        this.dungeonPartyQueues.set(gid, q);
        for (const p of live) p.dungeonQueueGroupId = gid;
      } else {
        for (const p of live)
          this.dungeonQueue.push({
            id: p.id,
            dungeonId: m.dungeonId,
            role: m.roles?.[p.id] || this.dungeonRole(p),
            queuedAt: Date.now(),
          });
      }
    }
    const grouped = new Set(Object.values(m.originalPartyMembers || {}).flat());
    for (const pid of m.playerIds || []) {
      const p = this.ctx.repo.getPlayer(pid);
      if (p?.dungeonMatch?.id === m.id) {
        p.dungeonMatch = null;
        if (
          m.accepted?.[pid] === true &&
          !grouped.has(pid) &&
          p.online &&
          !p.dead &&
          !p.dungeon &&
          !p.encounterId &&
          !p.worldCombatMobId &&
          !p.battlegroundId &&
          !p.pvp &&
          !this.dungeonQueue.some((q) => q.id === p.id)
        )
          this.dungeonQueue.push({
            id: p.id,
            dungeonId: m.dungeonId,
            role: m.roles?.[p.id] || this.dungeonRole(p),
            queuedAt: Date.now(),
          });
      }
    }
  }
  cleanupDungeonMatches(now = Date.now()) {
    for (const [id, m] of this.dungeonMatches) {
      if (Number(m.expiresAt || 0) > now) continue;
      this.requeueMatch(m);
      this.dungeonMatches.delete(id);
    }
  }
  dungeonSnapshot(p: any) {
    this.cleanupDungeonMatches();
    const q = this.dungeonQueue.find((x) => x.id === p.id);
    if (q)
      return {
        queued: true,
        dungeonId: q.dungeonId,
        role: q.role,
        queuedAt: q.queuedAt,
        position: this.dungeonQueue.filter((x) => x.queuedAt <= q.queuedAt)
          .length,
        elapsedSeconds: Math.max(
          0,
          Math.floor((Date.now() - q.queuedAt) / 1000),
        ),
        roles: this.queueRoleCounts(q.dungeonId),
      };
    return {
      queued: false,
      match: p.dungeonMatch ? { ...p.dungeonMatch } : null,
    };
  }
  dungeonRole(p: any, requested?: string) {
    const r = String(
      requested || p.partyRole || this.ctx.partyRole(p) || "DPS",
    ).toUpperCase();
    return r === "TANK" ? "TANK" : r === "HEALER" ? "HEALER" : "DPS";
  }
  queueRoleCounts(dungeonId = "random") {
    const pool = this.dungeonQueue.filter(
      (q) => q.dungeonId === dungeonId || q.dungeonId === "random",
    );
    return {
      TANK: pool.filter((q) => q.role === "TANK").length,
      HEALER: pool.filter((q) => q.role === "HEALER").length,
      DPS: pool.filter((q) => q.role === "DPS").length,
      total: pool.length,
    };
  }
  setRole(p: any, requested?: string) {
    const r = this.dungeonRole(p, requested);
    p.partyRole = r === "TANK" ? "Tank" : r === "HEALER" ? "Healer" : "DPS";
    return r;
  }
  enqueueParty(p: any, dungeonId = "random", roles: any = {}) {
    const party = this.ctx.social.getParty(p.partyId);
    if (!party) return [false, "You are not in a party."];
    if (party.leader !== p.id)
      return [false, "Only the party leader can queue the party."];
    if (party.members.length < 1 || party.members.length > 5)
      return [false, "Party size must be between 1 and 5."];
    const members = party.members
      .map((id: any) => this.ctx.repo.getPlayer(id))
      .filter(Boolean);
    if (
      members.length !== party.members.length ||
      members.some((x: any) => !x.online || x.dead || this.isQueueBusy(x))
    )
      return [
        false,
        "Every party member must be online, alive, and out of combat.",
      ];
    if (
      members.some(
        (x: any) =>
          this.dungeonQueue.find((q) => q.id === x.id) || x.dungeonMatch,
      )
    )
      return [false, "A party member is already queued or has a ready check."];
    if (
      dungeonId !== "random" &&
      !this.ctx.dungeons.some((d: any) => d.id === dungeonId)
    )
      return [false, "Unknown dungeon."];
    const roleMap: any = {};
    for (const m of members) roleMap[m.id] = this.dungeonRole(m, roles?.[m.id]);
    const counts = { TANK: 0, HEALER: 0, DPS: 0 };
    for (const r of Object.values(roleMap) as any[]) counts[r]++;
    const groupId = runtimeId("dqueueparty");
    const q = {
      id: groupId,
      partyId: party.id,
      leader: p.id,
      memberIds: members.map((x: any) => x.id),
      dungeonId,
      roles: roleMap,
      queuedAt: Date.now(),
    };
    this.dungeonPartyQueues.set(groupId, q);
    for (const m of members) {
      this.removeDungeon(m.id);
      m.dungeonQueueGroupId = groupId;
    }
    this.tryMatchDungeon();
    return [
      true,
      `Party queued for ${dungeonId === "random" ? "Random Dungeon" : this.ctx.dungeons.find((d: any) => d.id === dungeonId)?.name || dungeonId}.`,
      this.dungeonSnapshot(p),
    ];
  }
  leavePartyQueue(p: any) {
    const gid = p?.dungeonQueueGroupId;
    if (!gid) return false;
    const q = this.dungeonPartyQueues.get(gid);
    if (!q) return false;
    if (q.leader !== p.id) return false;
    for (const id of q.memberIds) {
      const m = this.ctx.repo.getPlayer(id);
      if (m) m.dungeonQueueGroupId = null;
    }
    this.dungeonPartyQueues.delete(gid);
    return true;
  }
  removeDungeon(id: string) {
    for (let i = this.dungeonQueue.length - 1; i >= 0; i--)
      if (this.dungeonQueue[i].id === id) this.dungeonQueue.splice(i, 1);
  }
  enqueueDungeon(p: any, dungeonId = "random", requestedRole?: string) {
    this.cleanupDungeonMatches();
    if (
      !p?.hasCharacter ||
      p.dead ||
      this.isQueueBusy({ ...p, dungeonMatch: p.dungeonMatch })
    )
      return {
        queued: false,
        match: p?.dungeonMatch || null,
        error:
          "You are already busy, in combat, or queued for another activity.",
      };
    this.removeDungeon(p.id);
    const role = this.dungeonRole(p, requestedRole);
    this.dungeonQueue.push({ id: p.id, dungeonId, role, queuedAt: Date.now() });
    this.tryMatchDungeon();
    return this.dungeonSnapshot(p);
  }
  declineDungeonMatch(p: any) {
    this.cleanupDungeonMatches();
    const id = p?.dungeonMatch?.id;
    const m = id ? this.dungeonMatches.get(id) : null;
    if (!m)
      return [false, "There is no dungeon match waiting for confirmation."];
    const remaining = (m.playerIds || []).filter((pid) => pid !== p.id);
    this.dungeonMatches.delete(id);
    p.dungeonMatch = null;
    for (const pid of remaining) {
      const x = this.ctx.repo.getPlayer(pid);
      if (x?.dungeonMatch?.id === id) x.dungeonMatch = null;
      if (
        x &&
        x.online &&
        !x.dead &&
        !x.dungeon &&
        !x.encounterId &&
        !x.worldCombatMobId &&
        !x.battlegroundId &&
        !x.pvp &&
        !this.dungeonQueue.some((q: any) => q.id === x.id)
      )
        this.dungeonQueue.push({
          id: x.id,
          dungeonId: m.dungeonId,
          role: m.roles?.[x.id] || this.dungeonRole(x),
          queuedAt: Date.now(),
        });
    }
    this.tryMatchDungeon();
    return [
      true,
      "Dungeon match declined. You have been returned to the queue.",
    ];
  }
  acceptDungeonMatch(p: any) {
    this.cleanupDungeonMatches();
    const id = p?.dungeonMatch?.id;
    const m = id ? this.dungeonMatches.get(id) : null;
    if (!m) return [false, "That dungeon match has expired."];
    if (!m.playerIds.includes(p.id))
      return [false, "You are not part of this match."];
    p.dungeonMatch.accepted = true;
    m.accepted[p.id] = true;
    const all = m.playerIds.every((pid) => m.accepted[pid]);
    if (!all)
      return [true, "Ready confirmed. Waiting for the rest of the party."];
    const players = m.playerIds
      .map((pid) => this.ctx.repo.getPlayer(pid))
      .filter(Boolean);
    if (
      players.length !== 5 ||
      players.some(
        (x) =>
          !x.online ||
          x.dead ||
          x.dungeon ||
          x.encounterId ||
          x.worldCombatMobId ||
          x.battlegroundId ||
          x.pvp,
      )
    ) {
      this.dungeonMatches.delete(id);
      for (const x of players) {
        x.dungeonMatch = null;
        if (
          x.online &&
          !x.dead &&
          !x.dungeon &&
          !x.encounterId &&
          !x.worldCombatMobId &&
          !x.battlegroundId &&
          !x.pvp &&
          !this.dungeonQueue.some((q) => q.id === x.id)
        )
          this.dungeonQueue.push({
            id: x.id,
            dungeonId: m.dungeonId,
            role: m.roles?.[x.id] || this.dungeonRole(x),
            queuedAt: Date.now(),
          });
      }
      this.tryMatchDungeon();
      return [
        false,
        "The dungeon group changed before teleport. Eligible players have been returned to the queue.",
      ];
    }
    const existingPartyIds = [
      ...new Set(players.map((x: any) => x.partyId).filter(Boolean)),
    ];
    const preserved =
      existingPartyIds.length === 1
        ? this.ctx.social.getParty(existingPartyIds[0])
        : null;
    const preservedSnapshot = preserved
      ? { ...preserved, members: [...(preserved.members || [])] }
      : null;
    const partyId = preserved?.id || runtimeId("dungeonparty");
    const memberIds = players.map((x: any) => x.id);
    if (preserved) {
      preserved.members = [...new Set(memberIds)];
      preserved.dungeonFinder = true;
      preserved.dungeonFinderAt = Date.now();
      this.ctx.social.persistParty?.(preserved);
    } else
      this.ctx.social.parties.set(partyId, {
        id: partyId,
        leader: players[0].id,
        members: memberIds,
        createdAt: Date.now(),
        dungeonFinder: true,
      });
    for (const x of players) {
      x.partyId = partyId;
      x.partyLeaderId =
        x.id === (preserved?.leader || players[0].id) ? partyId : null;
      x.dungeonMatch = null;
    }
    const result = this.ctx.dungeonEngine.start(players[0], m.dungeonId);
    if (!result[0]) {
      for (const x of players) {
        x.partyId = preservedSnapshot ? preservedSnapshot.id : null;
        x.partyLeaderId = null;
      }
      if (preservedSnapshot)
        this.ctx.social.parties.set(partyId, preservedSnapshot);
      else this.ctx.social.parties.delete(partyId);
      for (const x of players)
        this.dungeonQueue.push({
          id: x.id,
          dungeonId: m.dungeonId,
          role: m.roles?.[x.id] || this.dungeonRole(x),
          queuedAt: Date.now(),
        });
      this.dungeonMatches.delete(id);
      return result;
    }
    this.dungeonMatches.delete(id);
    for (const x of players) {
      x.dungeonFinderMatch = {
        matched: true,
        dungeonId: m.dungeonId,
        dungeonName: m.dungeonName,
        role: m.roles?.[x.id] || "DPS",
        at: Date.now(),
      };
    }
    return [
      true,
      `Dungeon group ready. Entering ${m.dungeonName}.`,
      {
        dungeon: m.dungeonName,
        partyId,
        members: players.map((x) => x.name),
        roles: m.roles,
      },
    ];
  }
  pruneDungeonQueues() {
    const validDungeons = new Map<string, any>(
      this.ctx.dungeons.map((d: any) => [String(d.id), d]),
    );
    for (let i = this.dungeonQueue.length - 1; i >= 0; i--) {
      const q = this.dungeonQueue[i],
        p = this.ctx.repo.getPlayer(q.id),
        d = q.dungeonId === "random" ? null : validDungeons.get(q.dungeonId);
      const range = d?.levelRange || {
        min: Number(d?.level || 1),
        max: Number(d?.level || 60),
      };
      const invalid =
        !p ||
        !p.hasCharacter ||
        !p.online ||
        p.dead ||
        p.dungeon ||
        p.encounterId ||
        p.worldCombatMobId ||
        p.battlegroundId ||
        p.pvp ||
        p.dungeonMatch ||
        this.battlegroundQueue.has(p?.id) ||
        this.isArenaQueued(p?.id) ||
        this.hasArenaMatch(p?.id) ||
        !!(
          d &&
          (Number(p.level || 1) < Number(range.min || 1) ||
            Number(p.level || 1) > Number(range.max || 60) ||
            Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0))
        ) ||
        (!d && q.dungeonId !== "random");
      if (invalid) this.dungeonQueue.splice(i, 1);
    }
    for (const [gid, g] of this.dungeonPartyQueues) {
      const d =
        g.dungeonId === "random" ? null : validDungeons.get(g.dungeonId);
      const members = g.memberIds.map((id: any) => this.ctx.repo.getPlayer(id));
      const range = d?.levelRange || {
        min: Number(d?.level || 1),
        max: Number(d?.level || 60),
      };
      const party = this.ctx.social.getParty(g.partyId);
      const invalid =
        !members.length ||
        members.length !== g.memberIds.length ||
        members.some((p: any) => {
          if (
            !p ||
            !p.hasCharacter ||
            !p.online ||
            p.dead ||
            p.dungeon ||
            p.encounterId ||
            p.worldCombatMobId ||
            p.battlegroundId ||
            p.pvp ||
            p.dungeonMatch ||
            this.battlegroundQueue.has(p?.id) ||
            this.isArenaQueued(p?.id) ||
            this.hasArenaMatch(p?.id)
          )
            return true;
          if (
            d &&
            (Number(p.level || 1) < Number(range.min || 1) ||
              Number(p.level || 1) > Number(range.max || 60) ||
              Number(p.storyChapter || 0) < Number(d.requiresStoryChapter || 0))
          )
            return true;
          return false;
        }) ||
        (!d && g.dungeonId !== "random") ||
        !party ||
        party.leader !== g.leader ||
        party.members.length !== g.memberIds.length;
      if (invalid) {
        this.dungeonPartyQueues.delete(gid);
        for (const p of members)
          if (p?.dungeonQueueGroupId === gid) p.dungeonQueueGroupId = null;
      }
    }
  }

  tryMatchDungeon() {
    this.cleanupDungeonMatches();
    this.pruneDungeonQueues();
    const partyGroups = [...this.dungeonPartyQueues.values()];
    const groups: any[] = [];
    for (const g of partyGroups) {
      const members = g.memberIds
        .map((id: any) => this.ctx.repo.getPlayer(id))
        .filter(Boolean);
      if (
        members.length !== g.memberIds.length ||
        members.some(
          (p: any) =>
            !p.online ||
            p.dead ||
            p.dungeon ||
            p.encounterId ||
            p.worldCombatMobId ||
            p.battlegroundId,
        )
      )
        continue;
      groups.push({ queue: g, players: members, roles: g.roles });
    }
    const solos = this.dungeonQueue
      .map((q) => ({
        queue: q,
        players: [this.ctx.repo.getPlayer(q.id)],
        roles: { [q.id]: q.role },
      }))
      .filter(
        (x) =>
          x.players[0] &&
          x.players[0].online &&
          !x.players[0].dead &&
          !x.players[0].dungeon &&
          !x.players[0].encounterId &&
          !x.players[0].worldCombatMobId &&
          !x.players[0].battlegroundId,
      );
    const candidates: any[] = [];
    for (const d of this.ctx.dungeons) {
      const range = d.levelRange || { min: Number(d.level || 1), max: 60 };
      const min = Number(range.min || d.level || 1),
        max = Number(range.max || 60);
      const compatible = (g: any) =>
        g.players.every(
          (p: any) =>
            Number(p.level || 1) >= min &&
            Number(p.level || 1) <= max &&
            Number(p.storyChapter || 0) >= Number(d.requiresStoryChapter || 0),
        );
      const eligibleGroups = [...groups, ...solos]
        .filter(
          (g) => g.queue.dungeonId === d.id || g.queue.dungeonId === "random",
        )
        .filter(compatible);
      const sorted = eligibleGroups
        .sort(
          (a, b) =>
            Number(a.queue.queuedAt || 0) - Number(b.queue.queuedAt || 0),
        )
        .slice(0, 80);
      const findCombo = (
        start: number,
        slots: number,
        picked: any[],
        tank: number,
        healer: number,
        dps: number,
      ): any[] | null => {
        if (slots === 0)
          return tank >= 1 && healer >= 1 && dps >= 3 ? picked : null;
        if (slots < 0) return null;
        const remaining = sorted.length - start;
        if (remaining <= 0) return null;
        for (let i = start; i < sorted.length; i++) {
          const g = sorted[i],
            n = g.players.length;
          if (n > slots) continue;
          const rolesFor = g.players.map(
            (p: any) => g.roles[p.id] || this.dungeonRole(p),
          );
          const nt = tank + rolesFor.filter((r: any) => r === "TANK").length,
            nh = healer + rolesFor.filter((r: any) => r === "HEALER").length,
            nd = dps + rolesFor.filter((r: any) => r === "DPS").length;
          if (nt > 1 || nh > 1 || nd > 3) continue;
          const result = findCombo(
            i + 1,
            slots - n,
            [...picked, g],
            nt,
            nh,
            nd,
          );
          if (result) return result;
        }
        return null;
      };
      const chosen = findCombo(0, 5, [], 0, 0, 0);
      if (!chosen) continue;
      const players = chosen.flatMap((g) => g.players),
        roles = Object.assign({}, ...chosen.map((g) => g.roles));
      const span =
        Math.max(...players.map((p: any) => Number(p.level || 1))) -
        Math.min(...players.map((p: any) => Number(p.level || 1)));
      if (span > 10) continue;
      candidates.push({
        d,
        chosen,
        players,
        roles,
        span,
        oldest: Math.min(
          ...chosen.map((g) => Number(g.queue.queuedAt || Date.now())),
        ),
      });
    }
    if (!candidates.length) return;
    candidates.sort((a, b) => a.span - b.span || a.oldest - b.oldest);
    const selected = candidates[0],
      d = selected.d,
      players = selected.players,
      roles = selected.roles;
    const matchId = runtimeId("dmatch");
    const match = {
      id: matchId,
      dungeonId: d.id,
      dungeonName: d.name,
      playerIds: players.map((x: any) => x.id),
      roles,
      accepted: Object.fromEntries(players.map((x: any) => [x.id, false])),
      createdAt: Date.now(),
      expiresAt: Date.now() + 25000,
      partyGroups: selected.chosen
        .filter((g: any) => g.queue.partyId)
        .map((g: any) => g.queue.id),
      originalPartyMembers: Object.fromEntries(
        selected.chosen
          .filter((g: any) => g.queue.partyId)
          .map((g: any) => [g.queue.id, g.queue.memberIds]),
      ),
    };
    this.dungeonMatches.set(matchId, match);
    for (const g of selected.chosen) {
      if (g.queue.partyId) this.dungeonPartyQueues.delete(g.queue.id);
      else this.removeDungeon(g.players[0].id);
      for (const p of g.players) {
        p.dungeonQueueGroupId = null;
        p.dungeonMatch = {
          id: matchId,
          dungeonId: d.id,
          dungeonName: d.name,
          role: roles[p.id] || "DPS",
          accepted: false,
          expiresAt: match.expiresAt,
          playerIds: match.playerIds,
        };
      }
    }
  }
  pvpSnapshot(p: any) {
    this.pruneArenaQueues();
    const bgQueued = this.battlegroundQueue.has(p.id);
    const arenaQueued = [...this.arenaQueues.entries()].find(([, q]) =>
      q.some((g: any) => g.memberIds?.includes(p.id)),
    );
    const arenaMatch = [...this.arenaMatches.values()].find((m: any) =>
      m.playerIds?.includes(p.id),
    );
    const base = {
      queued: bgQueued,
      position: bgQueued
        ? Math.max(
            1,
            [...this.battlegroundQueue]
              .map((id) => ({
                id,
                queuedAt: Number(this.pvpQueueTimes.get(id) || 0),
              }))
              .sort((a, b) => a.queuedAt - b.queuedAt)
              .findIndex((x) => x.id === p.id) + 1,
          )
        : 0,
      queuedAt: bgQueued
        ? Number(this.pvpQueueTimes.get(p.id) || Date.now())
        : 0,
    };
    if (arenaQueued) {
      const [bracket, q] = arenaQueued;
      const g = q.find((x: any) => x.memberIds.includes(p.id));
      return {
        ...base,
        arena: {
          queued: true,
          bracket,
          queuedAt: Number(g.queuedAt || Date.now()),
          position: q.filter(
            (x: any) => Number(x.queuedAt || 0) <= Number(g.queuedAt || 0),
          ).length,
          role: "rated",
          partySize: bracket === "3v3" ? 3 : 2,
          groupSize: g.memberIds.length,
          solo: !!g.solo,
          leader: g.leader === p.id,
        },
      };
    }
    if (arenaMatch)
      return {
        ...base,
        arena: {
          matched: true,
          bracket: arenaMatch.bracket,
          matchId: arenaMatch.id,
          expiresAt: arenaMatch.endsAt,
        },
      };
    return base;
  }
  pvpStats(p: any) {
    p.pvpStats = p.pvpStats || {};
    const s = p.pvpStats;
    s.kills = Number(s.kills || 0);
    s.deaths = Number(s.deaths || 0);
    s.duelWins = Number(s.duelWins || 0);
    s.duelLosses = Number(s.duelLosses || 0);
    s.honor = Number(s.honor || 0);
    s.conquest = Number(s.conquest || 0);
    s.battlegroundWins = Number(s.battlegroundWins || 0);
    s.battlegroundLosses = Number(s.battlegroundLosses || 0);
    s.season = String(s.season || "season-1");
    s.arena = s.arena || {};
    for (const b of ["2v2", "3v3"])
      s.arena[b] = {
        rating: Number(s.arena[b]?.rating || 0),
        mmr: Number(s.arena[b]?.mmr || 1000),
        wins: Number(s.arena[b]?.wins || 0),
        losses: Number(s.arena[b]?.losses || 0),
      };
    return s;
  }
  pvpRank(r: number) {
    r = Number(r || 0);
    return r >= 2400
      ? "Gladiator"
      : r >= 2100
        ? "Duelist"
        : r >= 1800
          ? "Rival"
          : r >= 1600
            ? "Challenger"
            : r >= 1400
              ? "Combatant"
              : "Unranked";
  }
  pvpNormalizedStats(p: any) {
    const level = Math.max(1, Number(p.level || 1));
    const ilvl = Number(p.bonuses?.averageItemLevel || level);
    const gearFactor = Math.max(
      0.85,
      Math.min(
        1.05,
        0.9 + (Math.max(0, ilvl - level) / Math.max(1, level)) * 0.15,
      ),
    );
    return {
      maxHp: Math.max(1, Math.round(Number(p.maxHp || 100) * gearFactor)),
      attack: Math.max(1, Math.round(Number(p.attack || 10) * gearFactor)),
      armor: Math.max(1, Math.round(Number(p.armor || 4) * gearFactor)),
      resolve: Math.max(1, Math.round(Number(p.maxResolve || 100))),
      gearFactor,
    };
  }
  applyPvpTemplate(p: any) {
    const n = this.pvpNormalizedStats(p);
    if (!p._pvpOriginalStats)
      p._pvpOriginalStats = {
        maxHp: p.maxHp,
        attack: p.attack,
        armor: p.armor,
        hp: p.hp,
      };
    p.pvpRuntimeStats = n;
    p.maxHp = n.maxHp;
    p.attack = n.attack;
    p.armor = n.armor;
    p.hp = n.maxHp;
    return n;
  }
  clearPvpTemplate(p: any) {
    const o = p._pvpOriginalStats;
    if (o) {
      p.maxHp = o.maxHp;
      p.attack = o.attack;
      p.armor = o.armor;
      p.hp = Math.min(
        p.maxHp,
        Math.max(
          0,
          Math.round(
            p.maxHp *
              (Number(o.hp || p.maxHp) /
                Math.max(1, Number(o.maxHp || p.maxHp))),
          ),
        ),
      );
    }
    delete p._pvpOriginalStats;
    delete p.pvpRuntimeStats;
  }
  finishDuel(winner: any, loser: any) {
    const ws = this.pvpStats(winner),
      ls = this.pvpStats(loser);
    ws.kills++;
    ws.duelWins++;
    const now = Date.now(),
      pair = `${winner.id}>${loser.id}`,
      rec = this.duelHonorLog.get(pair);
    if (!rec || now - rec.start > 3600000)
      this.duelHonorLog.set(pair, { start: now, count: 1 });
    else rec.count++;
    if ((this.duelHonorLog.get(pair)?.count || 1) <= 3) ws.honor += 10;
    if (this.duelHonorLog.size > 2000) {
      for (const [k, v] of this.duelHonorLog)
        if (now - v.start > 3600000) this.duelHonorLog.delete(k);
    }
    ls.deaths++;
    ls.duelLosses++;
    loser.pvp = null;
    winner.pvp = null;
    winner.pvpCombatUntil = Date.now() + 8000;
    loser.pvpCombatUntil = Date.now() + 8000;
    winner.targetPlayerId = null;
    loser.targetPlayerId = null;
  }
  battlegroundSnapshot(bg: any) {
    return {
      id: bg.id,
      state: bg.state,
      mode: bg.mode || "battleground",
      score: { red: bg.score.red, blue: bg.score.blue },
      objective: bg.objective,
      endsAt: bg.endsAt,
      teams: {
        red: bg.red
          .map((id: any) => this.ctx.repo.getPlayer(id)?.name)
          .filter(Boolean),
        blue: bg.blue
          .map((id: any) => this.ctx.repo.getPlayer(id)?.name)
          .filter(Boolean),
      },
    };
  }
  battlegroundBracket(level: number) {
    const l = Number(level || 1);
    if (l >= 60) return "60";
    if (l >= 50) return "50-59";
    if (l >= 40) return "40-49";
    if (l >= 30) return "30-39";
    if (l >= 20) return "20-29";
    return "5-19";
  }
  startBattleground() {
    const waiting = [...this.battlegroundQueue]
      .map((id) => this.ctx.repo.getPlayer(id))
      .filter(
        (p: any) =>
          p &&
          p.online &&
          !p.dead &&
          !p.battlegroundId &&
          p.level >= 5 &&
          !p.pvp &&
          !p.dungeon &&
          !p.dungeonId &&
          !p.encounterId &&
          !p.worldCombatMobId &&
          !p.dungeonMatch,
      );
    const brackets = ["5-19", "20-29", "30-39", "40-49", "50-59", "60"];
    for (const bracket of brackets) {
      const pool = waiting
        .filter((p: any) => this.battlegroundBracket(p.level) === bracket)
        .sort(
          (a: any, b: any) =>
            Number(this.pvpQueueTimes.get(a.id) || 0) -
            Number(this.pvpQueueTimes.get(b.id) || 0),
        );
      if (pool.length < 10) continue;
      const chosen = pool.slice(0, 10),
        mid = 5;
      const bg = {
        id: runtimeId("bg"),
        mode: "battleground",
        bracket,
        state: "active",
        red: chosen.slice(0, mid).map((p) => p.id),
        blue: chosen.slice(mid).map((p) => p.id),
        score: { red: 0, blue: 0 },
        objective: { owner: null, progress: 0 },
        endsAt: Date.now() + 8 * 60 * 1000,
      };
      this.battlegrounds.set(bg.id, bg);
      for (const p of chosen) {
        const original = { zone: p.zone, x: p.x, y: p.y };
        const team = bg.red.includes(p.id) ? "red" : "blue";
        p.battlegroundId = bg.id;
        p.pvp = {
          id: bg.id,
          opponentId: null,
          state: "battleground",
          startedAt: Date.now(),
          team,
          members: [...bg.red, ...bg.blue],
          fromZone: original.zone,
          fromX: original.x,
          fromY: original.y,
        };
        p.zone = "battleground";
        p.x = team === "red" ? 0.18 : 0.82;
        p.y = 0.5;
        p.targetX = p.x;
        p.targetY = p.y;
        p.dead = false;
        p.hp = Math.max(1, p.maxHp);
        p.respawnAt = 0;
        this.applyPvpTemplate(p);
        p.targetPlayerId = null;
      }
      for (const id of chosen.map((p) => p.id)) {
        this.battlegroundQueue.delete(id);
        this.pvpQueueTimes.delete(id);
      }
      return bg;
    }
    return null;
  }
  enqueueArena(p: any, bracket = "2v2", solo = false) {
    const size = bracket === "3v3" ? 3 : 2;
    if (!p.hasCharacter || p.dead)
      return [false, "You cannot queue for rated PvP right now."];
    if (this.isQueueBusy(p) || p.pvp?.state === "arena")
      return [
        false,
        "Leave combat and any existing PvP or dungeon queue before queueing for an arena.",
      ];
    const party = solo ? null : this.ctx.social.getParty(p.partyId);
    let members: any[] = [];
    let partyId: any = null;
    if (party) {
      if (party.leader !== p.id)
        return [false, "Only the arena leader can queue the party."];
      if (party.members.length !== size)
        return [
          false,
          `Rated ${bracket} requires exactly ${size} players in the party.`,
        ];
      members = party.members
        .map((id: any) => this.ctx.repo.getPlayer(id))
        .filter(Boolean);
      partyId = party.id;
    } else {
      members = [p];
    }
    if (members.length > size)
      return [false, `Rated ${bracket} cannot use more than ${size} players.`];
    if (members.some((x: any) => !x.online || x.dead || this.isQueueBusy(x)))
      return [
        false,
        "Every arena teammate must be online, alive, and out of combat.",
      ];
    const q = this.arenaQueues.get(bracket) || [];
    const ids = members.map((m: any) => m.id);
    if (q.some((g: any) => g.memberIds.some((id: any) => ids.includes(id))))
      return [false, "You are already queued for rated arena."];
    const group = {
      id: runtimeId("arenaq"),
      partyId,
      leader: p.id,
      memberIds: ids,
      bracket,
      mmr: Math.round(
        members.reduce(
          (n: any, x: any) =>
            n + Number(this.pvpStats(x).arena[bracket].mmr || 1000),
          0,
        ) / members.length,
      ),
      queuedAt: Date.now(),
      solo: members.length === 1,
    };
    q.push(group);
    q.sort((a: any, b: any) => a.queuedAt - b.queuedAt);
    this.arenaQueues.set(bracket, q);
    for (const m of members) m.arenaQueueId = group.id;
    this.tryMatchArena(bracket);
    return [
      true,
      party
        ? `Queued your party for rated ${bracket}.`
        : `Solo-queued for rated ${bracket}.`,
      {
        bracket,
        partySize: size,
        queuedGroupSize: members.length,
        solo: !party,
      },
    ];
  }

  leaveArenaQueue(p: any) {
    for (const [bracket, q] of this.arenaQueues) {
      const idx = q.findIndex((g: any) => g.memberIds.includes(p.id));
      if (idx < 0) continue;
      const g = q[idx];
      if (g.leader !== p.id)
        return [
          false,
          "Only the arena leader can leave the rated queue for the party.",
        ];
      q.splice(idx, 1);
      for (const id of g.memberIds) {
        const x = this.ctx.repo.getPlayer(id);
        if (x) x.arenaQueueId = null;
      }
      return [true, `Left rated ${bracket} queue.`];
    }
    return [false, "You are not queued for rated arena."];
  }
  pruneArenaQueues() {
    for (const [bracket, q] of this.arenaQueues) {
      const size = bracket === "3v3" ? 3 : 2;
      const kept = q.filter((g: any) => {
        const members = (g.memberIds || []).map((id: any) =>
          this.ctx.repo.getPlayer(id),
        );
        return (
          members.length === g.memberIds.length &&
          members.length > 0 &&
          members.length <= size &&
          members.every(
            (p: any) =>
              p?.hasCharacter &&
              p.online &&
              !p.dead &&
              !p.battlegroundId &&
              !p.pvp &&
              !p.encounterId &&
              !p.worldCombatMobId &&
              (!p.partyId || this.ctx.social.getParty(p.partyId)),
          )
        );
      });
      if (kept.length !== q.length) {
        for (const g of q) {
          if (kept.includes(g)) continue;
          for (const id of g.memberIds || []) {
            const p = this.ctx.repo.getPlayer(id);
            if (p?.arenaQueueId === g.id) p.arenaQueueId = null;
          }
        }
        this.arenaQueues.set(bracket, kept);
      }
    }
  }

  tryMatchArena(bracket) {
    this.pruneArenaQueues();
    const size = bracket === "3v3" ? 3 : 2;
    const q = this.arenaQueues.get(bracket) || [];
    if (q.length < 2) return null;
    const groups = q
      .filter(
        (g: any) =>
          Array.isArray(g.memberIds) &&
          g.memberIds.length > 0 &&
          g.memberIds.length <= size,
      )
      .sort(
        (a: any, b: any) => Number(a.queuedAt || 0) - Number(b.queuedAt || 0),
      );
    const makeTeams = (
      pool: any[],
      remaining: number,
      start = 0,
      picked: any[] = [],
    ): any[] => {
      if (remaining === 0) return [picked];
      for (let i = start; i < pool.length; i++) {
        const g = pool[i];
        if (g.memberIds.length > remaining) continue;
        const found = makeTeams(pool, remaining - g.memberIds.length, i + 1, [
          ...picked,
          g,
        ]);
        if (found.length) return found;
      }
      return [];
    };
    let teamA: any[] = [],
      teamB: any[] = [],
      used: any[] = [];
    for (let i = 0; i < groups.length; i++) {
      const first = groups[i],
        rest = groups.slice(i + 1),
        a = makeTeams(rest, size - first.memberIds.length, 0, [first]);
      if (!a.length) continue;
      const chosenA = a[0],
        chosenSet = new Set(chosenA),
        remaining = groups.filter((g) => !chosenSet.has(g)),
        b = makeTeams(remaining, size);
      if (!b.length) continue;
      teamA = chosenA;
      teamB = b[0];
      used = [...teamA, ...teamB];
      break;
    }
    if (!used.length) return null;
    const avg = (team: any[]) => {
        const ids = team.flatMap((g: any) => g.memberIds || []);
        const vals = ids
          .map((id: any) => this.ctx.repo.getPlayer(id))
          .filter(Boolean)
          .map((p: any) => Number(this.pvpStats(p).arena[bracket].mmr || 1000));
        return (
          vals.reduce((n: number, v: number) => n + v, 0) /
          Math.max(1, vals.length)
        );
      },
      mmrA = avg(teamA),
      mmrB = avg(teamB),
      spread = Math.abs(mmrA - mmrB),
      wait =
        (Date.now() -
          Math.min(...used.map((g) => Number(g.queuedAt || Date.now())))) /
        1000;
    if (spread > 150 + Math.floor(wait / 15) * 50) return null;
    const teamAIds = teamA.flatMap((g) => g.memberIds),
      teamBIds = teamB.flatMap((g) => g.memberIds);
    if (teamAIds.length !== size || teamBIds.length !== size) return null;
    this.arenaQueues.set(
      bracket,
      q.filter((g: any) => !used.includes(g)),
    );
    const players = [...teamAIds, ...teamBIds]
      .map((id: any) => this.ctx.repo.getPlayer(id))
      .filter(Boolean);
    const id = runtimeId("arena"),
      centerX = 0.5,
      centerY = 0.5,
      arenaRadius = 0.22,
      match = {
        id,
        mode: "arena",
        bracket,
        state: "active",
        teamA: teamAIds,
        teamB: teamBIds,
        playerIds: players.map((x: any) => x.id),
        mmrA,
        mmrB,
        centerX,
        centerY,
        arenaRadius,
        startedAt: Date.now(),
        endsAt: Date.now() + 8 * 60 * 1000,
      };
    this.arenaMatches.set(id, match);
    for (const x of players) {
      const team = teamAIds.includes(x.id) ? "A" : "B",
        original = { zone: x.zone, x: x.x, y: x.y };
      x.arenaQueueId = null;
      x.pvp = {
        id,
        opponentId: team === "A" ? teamBIds[0] : teamAIds[0],
        state: "arena",
        bracket,
        team,
        teamMembers: team === "A" ? teamAIds : teamBIds,
        opponents: team === "A" ? teamBIds : teamAIds,
        centerX,
        centerY,
        arenaRadius,
        startedAt: match.startedAt,
        endsAt: match.endsAt,
        fromZone: original.zone,
        fromX: original.x,
        fromY: original.y,
      };
      x.zone = bracket === "3v3" ? "arena_3v3" : "arena_2v2";
      x.x = team === "A" ? 0.32 : 0.68;
      x.y = 0.5;
      x.targetX = x.x;
      x.targetY = x.y;
      this.applyPvpTemplate(x);
      x.targetPlayerId = x.pvp.opponentId;
    }
    return match;
  }

  arenaSnapshot(m: any) {
    return {
      id: m.id,
      mode: "arena",
      state: m.state,
      bracket: m.bracket,
      endsAt: m.endsAt,
      teamA: m.teamA
        .map((id: any) => this.ctx.repo.getPlayer(id)?.name)
        .filter(Boolean),
      teamB: m.teamB
        .map((id: any) => this.ctx.repo.getPlayer(id)?.name)
        .filter(Boolean),
      mmrA: m.mmrA,
      mmrB: m.mmrB,
    };
  }
  finishArena(m: any, winnerTeam: "A" | "B" | null, reason = "defeat") {
    if (!m || m.state !== "active") return;
    m.state = "finished";
    m.finishedAt = Date.now();
    const winning =
      winnerTeam === "A" ? m.teamA : winnerTeam === "B" ? m.teamB : [];
    const losing =
      winnerTeam === "A" ? m.teamB : winnerTeam === "B" ? m.teamA : [];
    const avgA = Number(m.mmrA || 1000),
      avgB = Number(m.mmrB || 1000),
      expectedA = 1 / (1 + Math.pow(10, (avgB - avgA) / 400)),
      expectedB = 1 - expectedA;
    const deltaA = winnerTeam
        ? Math.round(32 * ((winnerTeam === "A" ? 1 : 0) - expectedA))
        : 0,
      deltaB = winnerTeam
        ? Math.round(32 * ((winnerTeam === "B" ? 1 : 0) - expectedB))
        : 0;
    for (const id of m.playerIds) {
      const x = this.ctx.repo.getPlayer(id);
      if (!x) continue;
      const team = m.teamA.includes(id) ? "A" : "B",
        s = this.pvpStats(x),
        a = s.arena[m.bracket];
      if (winnerTeam) {
        const delta = team === "A" ? deltaA : deltaB;
        a.mmr = Math.max(0, a.mmr + delta);
        a.rating = Math.max(0, a.rating + delta);
        if (team === winnerTeam) {
          a.wins++;
          s.honor += 100;
          s.conquest += 15;
        } else {
          a.losses++;
          s.honor += 50;
        }
      } else {
        s.honor += 30;
      }
      x.lastPvpResult = {
        mode: "arena",
        bracket: m.bracket,
        result: winnerTeam
          ? team === winnerTeam
            ? "victory"
            : "defeat"
          : "draw",
        rating: a.rating,
        mmr: a.mmr,
        honor: s.honor,
        conquest: s.conquest,
        reason,
        at: Date.now(),
      };
      const from = x.pvp?.fromZone || x.homeCity || "stonehold",
        rx = Number(x.pvp?.fromX ?? x.x),
        ry = Number(x.pvp?.fromY ?? x.y);
      x.pvp = null;
      x.targetPlayerId = null;
      x.battlegroundId = null;
      x.pvpCombatUntil = Date.now() + 5000;
      this.clearPvpTemplate(x);
      x.zone = from;
      x.x = rx;
      x.y = ry;
      x.targetX = rx;
      x.targetY = ry;
    }
    return m;
  }
}
