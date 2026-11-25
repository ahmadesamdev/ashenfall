import { runtimeId } from "../shared/Ids.js";
interface Party {
  id: string;
  leader: string;
  members: string[];
  chat?: any[];
  lootCursor?: number;
}
interface PartyInvite {
  partyId?: string;
  guildId?: string;
  from: string;
  at: number;
  id?: string;
}
class Social {
  guildProgression: any;
  parties: Map<string, Party>;
  invites: Map<string, PartyInvite>;
  guilds: Map<string, any>;
  _playerLookup: any;
  _playerPersist: any;
  constructor() {
    this.guildProgression = {
      maxLevel: 20,
      base: 1000,
      growth: 1.35,
      memberCaps: { 1: 50, 2: 55, 5: 60, 10: 70, 15: 80, 20: 100 },
    };
    this.parties = new Map<string, Party>();
    this.invites = new Map<string, PartyInvite>();
    this.guilds = new Map();
    this._playerLookup = null;
    this._playerPersist = null;
  }
  _lastSocialAt = new Map<string, number>();
  throttle(p: any, key: string, ms = 700) {
    const k = `${key}:${p?.id}`,
      now = Date.now(),
      last = this._lastSocialAt.get(k) || 0;
    if (now - last < ms) return false;
    this._lastSocialAt.set(k, now);
    if (this._lastSocialAt.size > 8000) {
      for (const [id, t] of this._lastSocialAt)
        if (now - t > 60000) this._lastSocialAt.delete(id);
    }
    return true;
  }
  setPlayerLookup(fn) {
    this._playerLookup = fn;
  }
  setGuildProgression(config: any) {
    if (config?.xpCurve) {
      this.guildProgression.base = Number(config.xpCurve.base || 1000);
      this.guildProgression.growth = Number(config.xpCurve.growth || 1.35);
    }
    this.guildProgression.maxLevel = Number(config?.maxLevel || 20);
    for (const r of config?.levelRewards || [])
      if (r?.level)
        this.guildProgression.memberCaps[r.level] = Number(
          r.memberCap || this.guildProgression.memberCaps[r.level] || 50,
        );
  }
  guildXpNext(level: number) {
    const l = Math.max(1, Number(level) || 1);
    return Math.max(
      1,
      Math.round(
        this.guildProgression.base * Math.pow(l, this.guildProgression.growth),
      ),
    );
  }
  awardGuildXp(p: any, amount: number, source = "activity") {
    const g = this.guilds.get(p?.guildId);
    if (!g || amount <= 0) return null;
    g.xp = Number(g.xp || 0) + Math.max(0, Number(amount) || 0);
    g.level = Math.max(1, Number(g.level || 1));
    const levels: number[] = [];
    while (
      g.level < this.guildProgression.maxLevel &&
      g.xp >= this.guildXpNext(g.level)
    ) {
      g.xp -= this.guildXpNext(g.level);
      g.level++;
      levels.push(g.level);
    }
    g.memberCap =
      this.guildProgression.memberCaps[g.level] || g.memberCap || 50;
    g.lastProgress = { source, amount: Number(amount), at: Date.now() };
    this.persistGuild(g);
    return {
      level: g.level,
      xp: g.xp,
      xpNext:
        g.level >= this.guildProgression.maxLevel
          ? 0
          : this.guildXpNext(g.level),
      levels,
    };
  }
  setPlayerPersist(fn) {
    this._playerPersist = fn;
  }
  persistParty(party) {
    for (const id of party?.members || []) {
      const m = this._playerLookup?.(id);
      if (m?.hasCharacter) this._playerPersist?.(m);
    }
  }
  rehydrate(players = []) {
    this.parties.clear();
    const groups = new Map<string, any[]>();
    for (const p of players) {
      if (!p.partyId) continue;
      if (!groups.has(p.partyId)) groups.set(p.partyId, []);
      groups.get(p.partyId).push(p);
    }
    for (const [id, members] of groups) {
      const valid = members.filter((m: any) => m?.id);
      if (!valid.length) continue;
      const persistedLeader = valid.find(
        (m: any) => m.partyLeaderId === id,
      )?.id;
      const leader = persistedLeader || valid[0].id;
      this.parties.set(id, {
        id,
        leader,
        members: valid.map((x: any) => x.id),
        chat: [],
      });
      for (const member of valid)
        member.partyLeaderId = member.id === leader ? id : null;
    }
  }
  partyCreate(p) {
    if (p.partyId && !this.parties.has(p.partyId)) {
      p.partyId = null;
      p.partyLeaderId = null;
    }
    if (p.partyId) return [false, "Already in a party."];
    const id = runtimeId("party");
    this.parties.set(id, { id, leader: p.id, members: [p.id], chat: [] });
    p.partyId = id;
    p.partyLeaderId = id;
    this.persistParty(this.parties.get(id));
    return id;
  }
  canInvite(p, target) {
    if (!target || !target.online) return [false, "That player is not online."];
    if (this.isIgnored(target, p.id))
      return [false, "That player is ignoring you."];
    if (target.id === p.id) return [false, "You cannot invite yourself."];
    if (target.partyId) return [false, "That player is already in a party."];
    if (target.zone !== p.zone)
      return [false, "That player is not in your current zone."];
    return [true, ""];
  }
  invite(p, targetId) {
    if (!this.throttle(p, "pinvite", 2000))
      return [false, "Please wait before sending another invitation."];
    const target = this._playerLookup?.(targetId);
    const eligible = this.canInvite(p, target);
    if (!eligible[0]) return eligible;
    if (!p.partyId) {
      const r = this.partyCreate(p);
      if (!r[0]) return r;
    }
    const party = this.parties.get(p.partyId);
    if (!party) return [false, "Party not found."];
    if (party.leader !== p.id) return [false, "Only the leader can invite."];
    if (party.members.length >= 5) return [false, "Party is full."];
    const inviteId = runtimeId("pinv");
    const at = Date.now();
    this.invites.set(targetId, {
      partyId: p.partyId,
      from: p.id,
      at,
      id: inviteId,
    });
    target.pendingPartyInvite = {
      id: inviteId,
      partyId: p.partyId,
      from: p.id,
      at,
    };
    this._playerPersist?.(target);
    this.notify(targetId, "party_invite", `${p.name} invited you to a party.`, {
      partyId: p.partyId,
      fromId: p.id,
      fromName: p.name,
    });
    this._playerPersist?.(p);
    return [true, "Party invitation sent."];
  }
  declineInvite(p, partyId) {
    const inv = this.invites.get(p.id);
    if (inv && inv.partyId === partyId) this.invites.delete(p.id);
    if (p.pendingPartyInvite?.partyId === partyId) p.pendingPartyInvite = null;
    this._playerPersist?.(p);
    return [true, "Party invitation declined."];
  }
  acceptInvite(p, partyId) {
    const persisted = p.pendingPartyInvite;
    const inv = this.invites.get(p.id) || persisted;
    if (!inv || inv.partyId !== partyId) return [false, "No invitation."];
    if (Date.now() - Number(inv.at || 0) > 60000) {
      this.invites.delete(p.id);
      p.pendingPartyInvite = null;
      this._playerPersist?.(p);
      return [false, "That party invitation has expired."];
    }
    const party = this.parties.get(partyId);
    if (!party) return [false, "Party no longer exists."];
    if (party.members.length >= 5) return [false, "Party is full."];
    if (p.partyId) this.partyLeave(p);
    party.members.push(p.id);
    p.partyId = partyId;
    p.partyLeaderId = party.leader === p.id ? partyId : null;
    this.invites.delete(p.id);
    p.pendingPartyInvite = null;
    this.persistParty(party);
    return [true, "Joined party."];
  }
  partyLeave(p) {
    const party = this.parties.get(p.partyId);
    if (party) {
      party.members = party.members.filter((x) => x !== p.id);
      if (party.leader === p.id && party.members.length) {
        party.leader = party.members[0];
        for (const id of party.members) {
          const m = this._playerLookup?.(id);
          if (m) m.partyLeaderId = m.id === party.leader ? party.id : null;
        }
      }
      if (!party.members.length) this.parties.delete(party.id);
      else this.persistParty(party);
    }
    p.partyId = null;
    p.partyLeaderId = null;
    p.partyAssistId = null;
    this._playerPersist?.(p);
  }
  partyKick(p, targetId) {
    const party = this.parties.get(p.partyId);
    if (!party) return [false, "You are not in a party."];
    if (party.leader !== p.id)
      return [false, "Only the leader can remove members."];
    if (targetId === p.id) return [false, "Use Disband Party or Leave Party."];
    if (!party.members.includes(targetId))
      return [false, "That player is not in your party."];
    party.members = party.members.filter((id) => id !== targetId);
    const target = this._playerLookup?.(targetId);
    if (target) {
      target.partyId = null;
      target.partyLeaderId = null;
      this._playerPersist?.(target);
    }
    this.persistParty(party);
    this._playerPersist?.(p);
    return [true, "Player removed from the party.", { targetId }];
  }
  partyDisband(p) {
    const party = this.parties.get(p.partyId);
    if (!party) return [false, "You are not in a party."];
    if (party.leader !== p.id)
      return [false, "Only the leader can disband the party."];
    for (const id of party.members) {
      const member = this._playerLookup?.(id);
      if (member) {
        member.partyId = null;
        member.partyLeaderId = null;
      }
    }
    this.parties.delete(party.id);
    for (const id of party.members) {
      const member = this._playerLookup?.(id);
      if (member) this._playerPersist?.(member);
    }
    return [true, "Party disbanded."];
  }
  onDisconnect(p) {
    const party = this.parties.get(p?.partyId);
    if (!party) return;
  }
  cleanup(now = Date.now()) {
    for (const [id, invite] of this.invites) {
      const ttl = invite.guildId ? 120000 : 60000;
      if (now - Number(invite.at || 0) > ttl) {
        this.invites.delete(id);
        const targetId = invite.guildId
          ? String(id).replace(/^guild:/, "")
          : id;
        const target = this._playerLookup?.(targetId);
        if (target) {
          if (invite.guildId && target.pendingGuildInvite?.id === invite.id)
            target.pendingGuildInvite = null;
          if (!invite.guildId && target.pendingPartyInvite?.id === invite.id)
            target.pendingPartyInvite = null;
          this._playerPersist?.(target);
        }
      }
    }
    for (const p of this._playerLookup
      ? Array.from(this._playerLookup.__all?.() || [])
      : []) {
    }
    for (const [id, party] of this.parties) {
      party.members = party.members.filter((mid) => {
        const m = this._playerLookup?.(mid);
        return !!m && m.partyId === id;
      });
      if (!party.members.length) {
        this.parties.delete(id);
        continue;
      }
      const leader = this._playerLookup?.(party.leader);
      if (!leader || leader.partyId !== id) {
        const next =
          party.members
            .map((mid) => this._playerLookup?.(mid))
            .find((m) => m && m.online) ||
          this._playerLookup?.(party.members[0]);
        if (next) {
          party.leader = next.id;
          for (const mid of party.members) {
            const member = this._playerLookup?.(mid);
            if (member)
              member.partyLeaderId =
                member.id === party.leader ? party.id : null;
          }
        }
      }
    }
  }
  validate(p) {
    if (!p?.partyId) return null;
    const party = this.parties.get(p.partyId);
    if (!party || !party.members.includes(p.id) || party.members.length > 5) {
      p.partyId = null;
      return null;
    }
    return party;
  }
  getParty(id) {
    return id ? this.parties.get(id) || null : null;
  }
  notify(targetId, type, message, detail = {}) {
    const target = this._playerLookup?.(targetId);
    if (!target) return;
    target.socialNotifications = Array.isArray(target.socialNotifications)
      ? target.socialNotifications
      : [];
    target.socialNotifications.push({
      id: runtimeId("social"),
      type,
      message,
      at: Date.now(),
      ...detail,
    });
    target.socialNotifications = target.socialNotifications.slice(-40);
    this._playerPersist?.(target);
  }
  isIgnored(p, targetId) {
    return !!(p?.ignoredPlayers || []).includes(targetId);
  }
  friendAdd(p, targetId) {
    const target = this._playerLookup?.(targetId);
    if (!target || target.id === p.id) return [false, "Invalid player."];
    if (this.isIgnored(p, targetId) || this.isIgnored(target, p.id))
      return [false, "Friend request is blocked by an ignore relationship."];
    if ((p.friends || []).includes(targetId))
      return [true, `${target.name} is already your friend.`];
    target.pendingFriendRequests = Array.isArray(target.pendingFriendRequests)
      ? target.pendingFriendRequests
      : [];
    if (target.pendingFriendRequests.some((r: any) => r.fromId === p.id))
      return [
        true,
        `Friend request already sent to ${target.name}.`,
        { friendRequestId: p.id },
      ];
    if (target.pendingFriendRequests.length >= 50)
      return [false, "That player has too many pending friend requests."];
    const request = { fromId: p.id, at: Date.now() };
    target.pendingFriendRequests.push(request);
    this._playerPersist?.(target);
    this.notify(
      targetId,
      "friend_request",
      `${p.name} sent you a friend request.`,
      { fromId: p.id, fromName: p.name },
    );
    return [
      true,
      `Friend request sent to ${target.name}.`,
      { friendRequestId: p.id },
    ];
  }
  friendDecline(p, targetId) {
    p.pendingFriendRequests = Array.isArray(p.pendingFriendRequests)
      ? p.pendingFriendRequests
      : [];
    const had = p.pendingFriendRequests.some((r: any) => r.fromId === targetId);
    p.pendingFriendRequests = p.pendingFriendRequests.filter(
      (r: any) => r.fromId !== targetId,
    );
    p.socialNotifications = (p.socialNotifications || []).filter(
      (n: any) => !(n.type === "friend_request" && n.fromId === targetId),
    );
    this._playerPersist?.(p);
    return [
      true,
      had ? "Friend request declined." : "Friend request dismissed.",
    ];
  }
  friendAccept(p, targetId) {
    const target = this._playerLookup?.(targetId);
    if (!target || target.id === p.id) return [false, "Invalid player."];
    p.pendingFriendRequests = Array.isArray(p.pendingFriendRequests)
      ? p.pendingFriendRequests
      : [];
    const pending = p.pendingFriendRequests.find(
      (n: any) => n.fromId === targetId,
    );
    if (!pending) return [false, "No friend request from that player."];
    if (Date.now() - Number(pending.at || 0) > 7 * 24 * 60 * 60 * 1000) {
      p.pendingFriendRequests = p.pendingFriendRequests.filter(
        (n: any) => n.fromId !== targetId,
      );
      this._playerPersist?.(p);
      return [false, "That friend request has expired."];
    }
    p.friends = Array.from(new Set([...(p.friends || []), targetId])).slice(
      0,
      100,
    );
    target.friends = Array.from(
      new Set([...(target.friends || []), p.id]),
    ).slice(0, 100);
    p.pendingFriendRequests = p.pendingFriendRequests.filter(
      (n: any) => n.fromId !== targetId,
    );
    p.socialNotifications = p.socialNotifications.filter(
      (n: any) => !(n.type === "friend_request" && n.fromId === targetId),
    );
    this._playerPersist?.(p);
    this._playerPersist?.(target);
    this.notify(
      targetId,
      "friend_accept",
      `${p.name} accepted your friend request.`,
      { fromId: p.id, fromName: p.name },
    );
    return [true, `${target.name} is now your friend.`, { friendId: targetId }];
  }
  friendRemove(p, targetId) {
    const target = this._playerLookup?.(targetId);
    p.friends = (p.friends || []).filter((id) => id !== targetId);
    if (target)
      target.friends = (target.friends || []).filter((id) => id !== p.id);
    this._playerPersist?.(p);
    this._playerPersist?.(target);
    return [true, "Friend removed."];
  }
  searchPlayers(p, query) {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    if (q.length < 2) return [false, "Enter at least 2 characters."];
    const all = this._playerLookup?.__all?.() || [];
    const results = Array.from(all)
      .filter(
        (x: any) =>
          x?.hasCharacter &&
          x.id !== p.id &&
          x.name &&
          String(x.name).toLowerCase().includes(q),
      )
      .sort((a: any, b: any) => {
        const ao = Number(!!a.online),
          bo = Number(!!b.online);
        if (ao !== bo) return bo - ao;
        const ad = String(a.name).toLowerCase().startsWith(q),
          bd = String(b.name).toLowerCase().startsWith(q);
        if (ad !== bd) return Number(bd) - Number(ad);
        return String(a.name).localeCompare(String(b.name));
      })
      .slice(0, 20)
      .map((x: any) => ({
        id: x.id,
        name: x.name,
        online: !!x.online,
        zone: x.zone,
        level: x.level,
        icon: x.icon,
        classId: x.classId,
        role: x.role,
        friend: (p.friends || []).includes(x.id),
        pending: (x.pendingFriendRequests || []).some(
          (r: any) => r.fromId === p.id,
        ),
        ignored: this.isIgnored(p, x.id),
      }));
    return [true, "Player search.", { results }];
  }
  whisper(p, targetId, text) {
    if (!this.throttle(p, "whisper"))
      return [false, "You are sending messages too quickly."];
    const target = this._playerLookup?.(targetId),
      clean = String(text || "")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, 240);
    if (!target || !target.online) return [false, "Player is offline."];
    if (target.id === p.id) return [false, "You cannot whisper yourself."];
    if (!clean) return [false, "Whisper cannot be empty."];
    if ((target.ignoredPlayers || []).includes(p.id))
      return [false, "That player is ignoring you."];
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    p.chatHistory = p.chatHistory || [];
    target.chatHistory = target.chatHistory || [];
    const msg = {
      from: p.name,
      to: target.name,
      fromId: p.id,
      toId: target.id,
      text: clean,
      kind: "whisper",
      at: Date.now(),
      t: now,
    };
    p.chatHistory.push({ ...msg, direction: "out" });
    target.chatHistory.push({ ...msg, direction: "in" });
    p.chatHistory = p.chatHistory.slice(-80);
    target.chatHistory = target.chatHistory.slice(-80);
    this.notify(target.id, "whisper", `${p.name}: ${clean}`, {
      fromId: p.id,
      fromName: p.name,
      text: clean,
    });
    this._playerPersist?.(p);
    this._playerPersist?.(target);
    return [
      true,
      `Whisper sent to ${target.name}.`,
      {
        whisper: {
          toId: target.id,
          toName: target.name,
          text: clean,
          at: Date.now(),
        },
      },
    ];
  }
  ignoreAdd(p, targetId) {
    const target = this._playerLookup?.(targetId);
    if (!target || target.id === p.id) return [false, "Invalid player."];
    p.ignoredPlayers = Array.from(
      new Set([...(p.ignoredPlayers || []), targetId]),
    ).slice(0, 100);
    p.friends = (p.friends || []).filter((id) => id !== targetId);
    this._playerPersist?.(p);
    return [true, `${target.name} is now ignored.`, { ignoreId: targetId }];
  }
  ignoreRemove(p, targetId) {
    p.ignoredPlayers = (p.ignoredPlayers || []).filter((id) => id !== targetId);
    this._playerPersist?.(p);
    return [true, "Player removed from ignore list."];
  }
  transferLeader(p, targetId) {
    const party = this.parties.get(p.partyId);
    if (!party || party.leader !== p.id)
      return [false, "Only the party leader can transfer leadership."];
    if (!party.members.includes(targetId))
      return [false, "That player is not in your party."];
    const target = this._playerLookup?.(targetId);
    if (!target) return [false, "Player not found."];
    party.leader = targetId;
    for (const id of party.members) {
      const m = this._playerLookup?.(id);
      if (m) m.partyLeaderId = m.id === targetId ? party.id : null;
    }
    this.persistParty(party);
    this.notify(
      targetId,
      "party_leader",
      `${p.name} made you the party leader.`,
      { partyId: party.id, fromId: p.id },
    );
    return [
      true,
      `${target.name} is now the party leader.`,
      { leaderId: targetId },
    ];
  }
  setAssist(p, targetId) {
    const party = this.parties.get(p.partyId);
    if (!party || !party.members.includes(targetId))
      return [false, "That player is not in your party."];
    p.partyAssistId = targetId;
    return [
      true,
      `Assist set to ${this._playerLookup?.(targetId)?.name || "party member"}.`,
      { assistId: targetId },
    ];
  }
  partyChat(p, text) {
    if (!this.throttle(p, "pchat"))
      return [false, "You are sending messages too quickly."];
    const party = this.parties.get(p?.partyId);
    const clean = String(text || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .slice(0, 240);
    if (!party || !party.members.includes(p.id))
      return [false, "You are not in a party."];
    if (!clean) return [false, "Empty message."];
    const entry = {
      id: runtimeId("pchat"),
      at: Date.now(),
      fromId: p.id,
      fromName: p.name,
      text: clean,
      kind: "party",
    };
    party.chat = Array.isArray(party.chat) ? party.chat : [];
    party.chat.push(entry);
    party.chat = party.chat.slice(-80);
    return [true, "Party message sent.", { partyMessage: entry }];
  }
  rehydrateGuilds(players = []) {
    this.guilds.clear();
    const groups = new Map<string, any[]>();
    for (const p of players) {
      if (!p?.guildId) continue;
      const id = String(p.guildId);
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(p);
    }
    for (const [id, members] of groups) {
      const valid = members.filter((m: any) => m?.id);
      if (!valid.length) continue;
      const leader =
        valid.find((m: any) => m.guildRank === "leader")?.id || valid[0].id;
      const progressScore = (m: any) =>
        Number(m?.guildLevel || 0) * 1e9 + Number(m?.guildXp || 0);
      const source =
        valid
          .filter((m: any) => m.guildName)
          .reduce(
            (best: any, m: any) =>
              !best || progressScore(m) > progressScore(best) ? m : best,
            null,
          ) || valid[0];
      const name = String(source?.guildName || `Guild ${id.slice(-6)}`).slice(
        0,
        32,
      );
      const g: any = {
        id,
        name,
        leader,
        members: valid.map((m: any) => m.id),
        createdAt: Number(
          valid.find((m: any) => m.guildCreatedAt)?.guildCreatedAt ||
            Date.now(),
        ),
        level: Number(source?.guildLevel || 1),
        xp: Number(source?.guildXp || 0),
        memberCap: Number(source?.guildMemberCap || 50),
        description: String(source?.guildDescription || "").slice(0, 240),
        motd: String(source?.guildMotd || "").slice(0, 180),
      };
      this.guilds.set(id, g);
      for (const m of valid) {
        m.guildName = name;
        m.guildRank =
          m.id === leader
            ? "leader"
            : m.guildRank === "officer"
              ? "officer"
              : "member";
        m.guildCreatedAt = g.createdAt;
        m.guildDescription = g.description;
        m.guildMotd = g.motd;
        m.guildLevel = g.level;
        m.guildXp = g.xp;
        m.guildMemberCap = g.memberCap;
      }
    }
  }
  guildSnapshot(p) {
    const g = this.guilds.get(p?.guildId);
    if (!g) return null;
    return {
      id: g.id,
      name: g.name,
      leader: g.leader,
      createdAt: g.createdAt,
      description: g.description || "",
      motd: g.motd || "",
      level: Number(g.level || 1),
      xp: Number(g.xp || 0),
      xpNext:
        g.level >= this.guildProgression.maxLevel
          ? 0
          : this.guildXpNext(Number(g.level || 1)),
      memberCap: Number(g.memberCap || 50),
      onlineCount: g.members.filter(
        (id: any) => !!this._playerLookup?.(id)?.online,
      ).length,
      members: g.members
        .map((id) => {
          const m = this._playerLookup?.(id);
          return m
            ? {
                id: m.id,
                name: m.name,
                online: !!m.online,
                level: m.level,
                role: m.role,
                guildRank: m.guildRank || "member",
              }
            : null;
        })
        .filter(Boolean),
    };
  }
  guildCreate(p, name) {
    if (p.guildId) return [false, "Already in a guild."];
    const clean = String(name || "")
      .replace(/[\u0000-\u001f\u007f]+/g, " ")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 32);
    if (clean.length < 3)
      return [false, "Guild name must be at least 3 characters."];
    const duplicate = Array.from(this.guilds.values()).some(
      (g: any) => String(g.name).toLowerCase() === clean.toLowerCase(),
    );
    if (duplicate) return [false, "That guild name is already taken."];
    const id = runtimeId("guild");
    const createdAt = Date.now();
    this.guilds.set(id, {
      id,
      name: clean,
      leader: p.id,
      members: [p.id],
      createdAt,
      description: "",
      motd: "",
    });
    p.guildId = id;
    p.guildName = clean;
    p.guildRank = "leader";
    p.guildCreatedAt = createdAt;
    p.guildDescription = "";
    p.guildMotd = "";
    p.guildLevel = 1;
    p.guildXp = 0;
    p.guildMemberCap = 50;
    this._playerPersist?.(p);
    return [true, `Guild ${clean} created.`, this.guildSnapshot(p)];
  }
  guildInvite(p, targetId) {
    if (!this.throttle(p, "ginvite", 2000))
      return [false, "Please wait before sending another invitation."];
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader !== p.id && p.guildRank !== "officer")
      return [false, "Only the guild leader or an officer can invite."];
    if (g.members.length >= Number(g.memberCap || 50))
      return [false, "Guild is full."];
    const target = this._playerLookup?.(targetId);
    if (!target || !target.online) return [false, "That player is not online."];
    if (target.id === p.id) return [false, "You cannot invite yourself."];
    if (target.guildId) return [false, "That player is already in a guild."];
    if (this.isIgnored(target, p.id))
      return [false, "That player is ignoring you."];
    const at = Date.now();
    const inviteId = runtimeId("ginv");
    this.invites.set(`guild:${targetId}`, {
      guildId: g.id,
      from: p.id,
      at,
      id: inviteId,
    });
    target.pendingGuildInvite = { id: inviteId, guildId: g.id, from: p.id, at };
    this._playerPersist?.(target);
    this.notify(
      targetId,
      "guild_invite",
      `${p.name} invited you to ${g.name}.`,
      { guildId: g.id, guildName: g.name, fromId: p.id, fromName: p.name },
    );
    return [true, `Guild invitation sent to ${target.name}.`];
  }
  guildDecline(p) {
    const inv = this.invites.get(`guild:${p.id}`) || p.pendingGuildInvite;
    if (inv) {
      this.invites.delete(`guild:${p.id}`);
      p.pendingGuildInvite = null;
      this._playerPersist?.(p);
    }
    return [true, "Guild invitation declined."];
  }
  guildJoin(p, id) {
    const g = this.guilds.get(id);
    if (!g) return [false, "Guild not found."];
    const persisted = p.pendingGuildInvite;
    const inv = this.invites.get(`guild:${p.id}`) || persisted;
    if (!inv || inv.guildId !== id) return [false, "No guild invitation."];
    if (Date.now() - Number(inv.at || 0) > 120000) {
      this.invites.delete(`guild:${p.id}`);
      p.pendingGuildInvite = null;
      this._playerPersist?.(p);
      return [false, "That guild invitation has expired."];
    }
    if (p.guildId) return [false, "Already in a guild."];
    if (g.members.length >= Number(g.memberCap || 50))
      return [false, "Guild is full."];
    g.members.push(p.id);
    p.guildId = id;
    p.guildName = g.name;
    p.guildRank = "member";
    p.guildCreatedAt = g.createdAt;
    p.guildDescription = g.description || "";
    p.guildMotd = g.motd || "";
    p.pendingGuildInvite = null;
    this.invites.delete(`guild:${p.id}`);
    this._playerPersist?.(p);
    this.persistGuild(g);
    this.notify(g.leader, "guild_join", `${p.name} joined ${g.name}.`, {
      guildId: id,
      memberId: p.id,
    });
    return [true, `Joined ${g.name}.`, this.guildSnapshot(p)];
  }
  guildKick(p, targetId) {
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader !== p.id && p.guildRank !== "officer")
      return [false, "Only the guild leader or an officer can remove members."];
    if (targetId === g.leader)
      return [false, "The guild leader cannot be removed."];
    const target = this._playerLookup?.(targetId);
    if (!target || !g.members.includes(targetId))
      return [false, "That player is not in your guild."];
    if (p.guildRank === "officer" && target.guildRank === "officer")
      return [false, "Officers cannot remove other officers."];
    g.members = g.members.filter((x) => x !== targetId);
    target.guildId = null;
    target.guildName = null;
    target.guildRank = null;
    target.guildCreatedAt = null;
    target.guildDescription = "";
    target.guildMotd = "";
    delete target.guildLevel;
    delete target.guildXp;
    delete target.guildMemberCap;
    this._playerPersist?.(target);
    this.notify(targetId, "guild_removed", `You were removed from ${g.name}.`, {
      guildId: g.id,
    });
    this.persistGuild(g);
    return [true, `${target.name} was removed from the guild.`];
  }
  guildSetDescription(p, text) {
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader !== p.id && p.guildRank !== "officer")
      return [
        false,
        "Only the guild leader or an officer can edit the guild description.",
      ];
    g.description = String(text || "")
      .trim()
      .slice(0, 240);
    this.persistGuild(g);
    return [
      true,
      "Guild description updated.",
      { guild: this.guildSnapshot(p) },
    ];
  }
  guildSetMotd(p, text) {
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader !== p.id && p.guildRank !== "officer")
      return [
        false,
        "Only the guild leader or an officer can edit the guild message of the day.",
      ];
    g.motd = String(text || "")
      .trim()
      .slice(0, 180);
    this.persistGuild(g);
    return [
      true,
      "Guild message of the day updated.",
      { guild: this.guildSnapshot(p) },
    ];
  }
  guildChat(p, text) {
    if (!this.throttle(p, "gchat"))
      return [false, "You are sending messages too quickly."];
    const g = this.guilds.get(p.guildId),
      clean = String(text || "")
        .replace(/[\u0000-\u001f\u007f]+/g, " ")
        .trim()
        .slice(0, 240);
    if (!g) return [false, "You are not in a guild."];
    if (!clean) return [false, "Guild message cannot be empty."];
    const msg = {
      id: runtimeId("gchat"),
      fromId: p.id,
      fromName: p.name,
      text: clean,
      at: Date.now(),
      guildId: g.id,
    };
    for (const id of g.members) {
      const m = this._playerLookup?.(id);
      if (!m || !m.online) continue;
      m.guildChatHistory = Array.isArray(m.guildChatHistory)
        ? m.guildChatHistory
        : [];
      m.guildChatHistory.push(msg);
      m.guildChatHistory = m.guildChatHistory.slice(-60);
      this._playerPersist?.(m);
    }
    return [true, "Guild message sent.", { guildMessage: msg }];
  }
  guildPromote(p, targetId, rank) {
    const g = this.guilds.get(p.guildId);
    if (!g || g.leader !== p.id)
      return [false, "Only the guild leader can manage guild ranks."];
    const target = this._playerLookup?.(targetId);
    if (!target || !g.members.includes(targetId))
      return [false, "That player is not in your guild."];
    const next = rank === "officer" ? "officer" : "member";
    if (target.id === g.leader)
      return [false, "The guild leader cannot change their own rank."];
    target.guildRank = next;
    this._playerPersist?.(target);
    this.notify(
      targetId,
      "guild_rank",
      `Your rank in ${g.name} is now ${next}.`,
      { guildId: g.id, guildRank: next },
    );
    return [true, `${target.name} is now ${next}.`];
  }
  guildTransferLeader(p, targetId) {
    const g = this.guilds.get(p.guildId);
    if (!g || g.leader !== p.id)
      return [false, "Only the guild leader can transfer leadership."];
    if (targetId === p.id) return [false, "You are already the guild leader."];
    if (!g.members.includes(targetId))
      return [false, "That player is not in your guild."];
    const target = this._playerLookup?.(targetId);
    if (!target) return [false, "Player not found."];
    g.leader = targetId;
    for (const id of g.members) {
      const m = this._playerLookup?.(id);
      if (m)
        m.guildRank =
          m.id === targetId
            ? "leader"
            : m.guildRank === "leader"
              ? "member"
              : m.guildRank || "member";
    }
    this.persistGuild(g);
    this.notify(
      targetId,
      "guild_leader",
      `${p.name} made you the leader of ${g.name}.`,
      { guildId: g.id, fromId: p.id },
    );
    return [
      true,
      `${target.name} is now the guild leader.`,
      this.guildSnapshot(target),
    ];
  }
  guildDisband(p) {
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader !== p.id)
      return [false, "Only the guild leader can disband the guild."];
    for (const id of g.members) {
      const m = this._playerLookup?.(id);
      if (m) {
        m.guildId = null;
        m.guildName = null;
        m.guildRank = null;
        m.guildCreatedAt = null;
        m.guildDescription = "";
        m.guildMotd = "";
        delete m.guildLevel;
        delete m.guildXp;
        delete m.guildMemberCap;
        this._playerPersist?.(m);
      }
    }
    this.guilds.delete(g.id);
    return [true, `Guild ${g.name} has been disbanded.`];
  }
  guildLeave(p) {
    const g = this.guilds.get(p.guildId);
    if (!g) return [false, "You are not in a guild."];
    if (g.leader === p.id) {
      if (g.members.length > 1)
        return [false, "Transfer guild leadership before leaving."];
      this.guilds.delete(g.id);
    } else g.members = g.members.filter((x) => x !== p.id);
    const name = g.name;
    p.guildId = null;
    p.guildName = null;
    p.guildRank = null;
    p.guildCreatedAt = null;
    p.guildDescription = "";
    p.guildMotd = "";
    delete p.guildLevel;
    delete p.guildXp;
    delete p.guildMemberCap;
    this._playerPersist?.(p);
    if (g.members.length) this.persistGuild(g);
    return [true, `You left ${name}.`];
  }
  persistGuild(g) {
    for (const id of g?.members || []) {
      const m = this._playerLookup?.(id);
      if (m) {
        m.guildDescription = g.description || "";
        m.guildMotd = g.motd || "";
        m.guildLevel = Number(g.level || 1);
        m.guildXp = Number(g.xp || 0);
        m.guildMemberCap = Number(g.memberCap || 50);
        this._playerPersist?.(m);
      }
    }
  }
}
export { Social };
