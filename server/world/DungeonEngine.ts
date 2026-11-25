import { runtimeId } from "../shared/Ids.js";

class DungeonEngine {
  dungeons: any[];
  combat: any;
  inv: any;
  quest: any;
  defaults: any;
  instances: Map<string, any>;
  constructor(
    dungeons: any[],
    combat: any,
    inv: any,
    quest: any,
    defaults: any = {},
  ) {
    this.dungeons = dungeons;
    this.combat = combat;
    this.inv = inv;
    this.quest = quest;
    this.defaults = defaults;
    this.instances = new Map();
  }
  instanceId(dungeonId: string) {
    return runtimeId(`dinst_${dungeonId}`);
  }
  getInstance(id: string) {
    return id ? this.instances.get(id) || null : null;
  }
  getPlayerInstance(p: any) {
    return this.getInstance(p?.dungeon?.instanceId);
  }
  createInstance(p: any, d: any, members: any[]) {
    const existing = members
      .map((m) => this.getPlayerInstance(m))
      .find(Boolean);
    if (existing)
      return [
        false,
        "One or more party members are already assigned to a dungeon instance.",
      ];
    const id = this.instanceId(d.id),
      now = Date.now();
    const instance = {
      id,
      dungeonId: d.id,
      ownerId: p.id,
      partyId: p.partyId || null,
      memberIds: members.map((m) => m.id),
      state: "CREATING",
      createdAt: now,
      activatedAt: null,
      closedAt: null,
      lastActivityAt: now,
      entryState: "PENDING",
      wipeCount: 0,
      recovery: { state: "ACTIVE", wipeCount: 0 },
    };
    this.instances.set(id, instance);
    return [true, instance];
  }
  activateInstance(instance: any) {
    instance.state = "ACTIVE";
    instance.entryState = "ENTERED";
    instance.activatedAt = Date.now();
    instance.lastActivityAt = Date.now();
  }
  closeInstance(instance: any, reason = "closed") {
    if (!instance) return;
    instance.state = "CLOSED";
    instance.closedAt = Date.now();
    instance.closeReason = reason;
    instance.lastActivityAt = instance.closedAt;
    this.instances.delete(instance.id);
  }
  markDisconnected(p: any) {
    const i = this.getPlayerInstance(p);
    if (!i) return;
    i.lastActivityAt = Date.now();
    i.disconnectedAt = i.disconnectedAt || {};
    i.disconnectedAt[p.id] = Date.now();
    const graceMs = 60000;
    i.disconnectGraceMs = graceMs;
    for (const e of this.combat.encounters.values()) {
      if (e.partyExecution?.expectedMemberIds?.includes(p.id)) {
        e.partyExecution.members[p.id] &&
          ((e.partyExecution.members[p.id].online = false),
          (e.partyExecution.members[p.id].disconnectedAt = Date.now()));
        e.partyExecution.timeline.push({
          at: Date.now(),
          type: "party_disconnect",
          playerId: p.id,
          name: p.name,
          graceMs,
        });
        e.partyExecution.timeline = e.partyExecution.timeline.slice(-160);
      }
    }
  }
  markReconnected(p: any) {
    const i = this.getPlayerInstance(p);
    if (!i) return [false, "Dungeon instance no longer exists."];
    if (i.state !== "ACTIVE")
      return [false, "Dungeon instance is no longer active."];
    delete i.disconnectedAt?.[p.id];
    i.lastActivityAt = Date.now();
    return [true, i];
  }
  reconnect(p: any) {
    if (!p?.dungeon?.id) return [true, null];
    if (p.dungeon.suspended) {
      p.dungeon = null;
      return [true, { suspended: true, returned: true }];
    }
    const i = this.getPlayerInstance(p);
    if (!i) {
      const home = p.dungeon.fromZone || p.homeCity || "stonehold";
      p.zone = home;
      p.x = Number(p.dungeon.fromX ?? p.x ?? 0.5);
      p.y = Number(p.dungeon.fromY ?? p.y ?? 0.55);
      p.targetX = p.x;
      p.targetY = p.y;
      p.dungeon = null;
      return [
        true,
        { suspended: true, returned: true, reason: "instance_unavailable" },
      ];
    }
    const d = this.dungeons.find((x) => x.id === i.dungeonId);
    if (!d) {
      this.closeInstance(i, "dungeon_definition_missing");
      p.dungeon = null;
      return [true, { suspended: true, returned: true }];
    }
    this.combat.world.registerRuntimeZone(i.dungeonId, {
      ...this.dungeonConfig(),
      dungeonData: d,
    });
    const r = this.markReconnected(p);
    if (!r[0]) return r;
    p.dungeon.instanceId = i.id;
    p.dungeon.instanceState = i.state;
    p.dungeon.entryState = "ENTERED";
    p.dungeon.reconnectedAt = Date.now();
    const combatResume = this.combat.reconnectPartyMember?.(p) || [true, null];
    return [
      true,
      {
        resumed: true,
        instanceId: i.id,
        dungeonId: i.dungeonId,
        state: i.state,
        combat: combatResume[1] || null,
      },
    ];
  }

  dungeonConfig() {
    return {
      worldMeters: 12000,
      dungeonBounds: { minX: 0.06, maxX: 0.94, minY: 0.02, maxY: 0.98 },
      dungeon: true,
    };
  }
  stageType(d, stage) {
    return d.stageTypes?.[stage] || d.rooms?.[stage]?.type || "trash";
  }
  partyMembers(p) {
    return (this.combat.world?.players || []).filter(
      (x) => x && x.online && x.partyId && x.partyId === p.partyId && !x.dead,
    );
  }
  stateForMember(m) {
    m.dungeon = m.dungeon || {};
    m.dungeon.discoveredRooms = Array.from(
      new Set([
        ...(m.dungeon.discoveredRooms || []),
        Number(m.dungeon.roomId || 1),
      ]),
    );
    m.dungeon.routeChoices = m.dungeon.routeChoices || [];
    m.dungeon.optionalCleared = m.dungeon.optionalCleared || [];
    m.dungeon.shortcutsUnlocked = m.dungeon.shortcutsUnlocked || [];
    m.dungeon.availableRoutes = m.dungeon.availableRoutes || [];
  }
  instanceMembers(p: any) {
    const instance = this.getPlayerInstance(p);
    if (!instance) return this.partyMembers(p);
    return (this.combat.world?.players || []).filter(
      (x: any) => x && x.online && x.dungeon?.instanceId === instance.id,
    );
  }
  runtimeMembers(p: any) {
    return this.getPlayerInstance(p)
      ? this.instanceMembers(p)
      : this.partyMembers(p);
  }
  removeInstanceMobs(instanceId: string) {
    const world = this.combat.world;
    for (const [id, m] of world?.mobs || [])
      if (m.dungeonInstanceId === instanceId) world.mobs.delete(id);
  }
  clearPartyCombat(members: any[]) {
    for (const m of members) {
      if (m.encounterId) this.combat.encounters.delete(m.encounterId);
      m.encounterId = null;
      m.combat.autoAttack = false;
      m.combat.autoApproach = false;
      m.combat.manualMove = false;
      m.combat.queuedAbility = null;
      m.combat.queuedWorldAbility = null;
      m.worldCombatMobId = null;
    }
  }
  resetAfterWipe(p: any) {
    const instance = this.getPlayerInstance(p);
    if (!instance) return [false, "Dungeon instance no longer exists."];
    if (instance.state !== "ACTIVE")
      return [false, "Dungeon instance is not active."];
    if (!instance.wipePending && !p.dungeon?.wipePending)
      return [false, "The dungeon has not been wiped."];
    const d = this.dungeons.find((x) => x.id === instance.dungeonId);
    if (!d) return [false, "Dungeon definition is unavailable."];
    const members = this.instanceMembers(p);
    const memberIds = new Set(members.map((m: any) => m.id));
    for (const [id, e] of this.combat.encounters || []) {
      const sameDungeon = e?.dungeonId === instance.dungeonId;
      const sameParty = (e?.partyExecution?.expectedMemberIds || []).some(
        (mid: any) => memberIds.has(mid),
      );
      if (sameDungeon && sameParty) this.combat.encounters.delete(id);
    }
    this.clearPartyCombat(members);
    this.removeInstanceMobs(instance.id);
    for (const m of members) {
      if (m.dungeon) m.dungeon.patrolsSpawned = false;
    }
    instance.wipePending = false;
    instance.wipeCount = Number(instance.wipeCount || 0) + 1;
    instance.lastActivityAt = Date.now();
    instance.recovery = instance.recovery || { state: "ACTIVE", wipeCount: 0 };
    instance.recovery.state = "RESETTING";
    instance.recovery.wipeCount = instance.wipeCount;
    instance.recovery.lastResetAt = Date.now();
    instance.recoveryState = "RESETTING";
    const checkpointStage = Math.max(0, Number(p.dungeon.stage) || 0);
    for (const m of members) {
      m.dungeon.wipePending = false;
      m.dungeon.wipeReason = null;
      m.dungeon.lastResetAt = Date.now();
      m.dungeon.recoveryState = "RESETTING";
      m.dead = false;
      m.respawnReady = false;
      m.hp = m.maxHp;
      m.resolve = m.maxResolve;
      m.x = Number(m.dungeon.checkpointX ?? d.entrance?.x ?? 0.5);
      m.y = Number(
        m.dungeon.checkpointY ?? d.rooms?.[checkpointStage]?.y ?? 0.9,
      );
      m.targetX = m.x;
      m.targetY = m.y;
      m.moveState = "idle";
      m.velocityX = 0;
      m.velocityY = 0;
      m.dungeon.roomMobIds = [];
      m.dungeon.roomCleared = false;
      m.dungeon.nextStageUnlocked = false;
      m.dungeon.activeEvent = null;
      m.dungeon.activeOptionalRoom = null;
      m.combat.autoAttack = false;
      m.combat.autoApproach = false;
      m.combat.manualMove = false;
      m.combat.queuedAbility = null;
      m.combat.queuedWorldAbility = null;
    }
    this.spawnPatrols(p, d);
    const result = this.startStage(p, false);
    for (const m of members) {
      m.dungeon.recoveryState = "RECOVERED";
      m.dungeon.recoveryCheckpointStage = checkpointStage;
    }
    instance.recovery.state = "RECOVERED";
    instance.recoveryState = "ACTIVE";
    instance.lastActivityAt = Date.now();
    return [
      true,
      {
        message:
          "The party was wiped. The encounter, room mobs, and boss state have reset at the checkpoint.",
        wipeCount: instance.wipeCount,
        stage: checkpointStage + 1,
        checkpoint: {
          x: p.dungeon.checkpointX,
          y: p.dungeon.checkpointY,
          stage: checkpointStage + 1,
        },
        recoveryState: instance.recovery.state,
        result: result?.[1] || null,
      },
    ];
  }
  triggerEvent(p, d, room) {
    const spec = (d.events || []).find(
      (x: any) =>
        Number(x.afterRoom) === Number(room?.id) &&
        !p.dungeon.completedEvents?.includes(x.id),
    );
    if (!spec) return null;
    const members = this.instanceMembers(p);
    const instance = this.getPlayerInstance(p);
    const event: any = {
      id: spec.id,
      name: spec.name,
      type: spec.type || "ambush",
      state: "ACTIVE",
      afterRoom: Number(room.id),
      startedAt: Date.now(),
      endsAt: Date.now() + Number(spec.durationMs || 90000),
      message: spec.message || "A dungeon event has begun.",
      mobIds: [],
    };
    const def = this.combat.world.mobDefs.find(
      (x: any) => x.type === spec.enemy,
    );
    if (def) {
      const count = Math.max(1, Math.min(6, Number(spec.count || 3)));
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const area = {
          id: `event_${instance.id}_${spec.id}_${i}`,
          x: Number(room.x),
          y: Number(room.y),
          r: 0.035,
        };
        const m = this.combat.world.spawnMob(def, p.zone, 50000 + i, area);
        m.dungeonId = d.id;
        m.dungeonInstanceId = instance.id;
        m.dungeonEventId = spec.id;
        m.dungeonEvent = true;
        m.dungeonStage = p.dungeon.stage;
        m.homeX = Number(room.x) + Math.cos(ang) * 0.045;
        m.homeY = Number(room.y) + Math.sin(ang) * 0.045;
        m.x = m.homeX;
        m.y = m.homeY;
        m.targetX = m.x;
        m.targetY = m.y;
        m.respawn = 0;
        m.deadUntil = Infinity;
        m.temper = "aggressive";
        m.aggroRangeMeters = 120;
        m.baseAggroRangeMeters = 120;
        event.mobIds.push(m.id);
      }
    }
    instance.activeEvent = event;
    for (const m of members) {
      this.stateForMember(m);
      m.dungeon.activeEvent = {
        id: event.id,
        name: event.name,
        type: event.type,
        state: event.state,
        endsAt: event.endsAt,
        message: event.message,
      };
      m.dungeon.roomMobIds = [...event.mobIds];
      m.dungeon.roomCleared = false;
    }
    return event;
  }
  updateEvent(p, d, room) {
    const instance = this.getPlayerInstance(p),
      event = instance?.activeEvent;
    if (!event) return null;
    const alive = event.mobIds.some((id: string) => {
      const m = this.combat.world.byIdMob(id);
      return m && m.state !== "dead";
    });
    if (alive && Date.now() < event.endsAt) return { eventActive: true, event };
    if (Date.now() >= event.endsAt) {
      for (const id of event.mobIds) {
        this.combat.world.mobs.delete(id);
      }
    }
    for (const m of this.instanceMembers(p)) {
      this.stateForMember(m);
      m.dungeon.completedEvents = m.dungeon.completedEvents || [];
      if (!m.dungeon.completedEvents.includes(event.id))
        m.dungeon.completedEvents.push(event.id);
      m.dungeon.activeEvent = null;
      m.dungeon.roomCleared = true;
      m.dungeon.nextStageUnlocked = true;
    }
    instance.activeEvent = null;
    instance.lastActivityAt = Date.now();
    this.quest?.onDungeonStage(p, p.dungeon.id, 1);
    return { eventComplete: true, eventId: event.id, name: event.name };
  }
  discoverRoom(p, roomId) {
    for (const m of this.runtimeMembers(p))
      (this.stateForMember(m), m.dungeon.discoveredRooms.push(Number(roomId)));
  }
  clearRoomMobs(p) {
    const ids = p.dungeon?.roomMobIds || [];
    return (
      ids.length === 0 ||
      ids.every((id) => {
        const m = this.combat.world?.byIdMob(id);
        return !m || m.state === "dead";
      })
    );
  }
  spawnPatrols(p, d) {
    if (p.dungeon?.patrolsSpawned) return;
    const world = this.combat.world;
    for (const spec of d.patrols || []) {
      const def = world.mobDefs.find((x) => x.type === spec.enemy);
      if (!def) continue;
      const area = {
        id: `patrol_${d.id}_${spec.enemy}`,
        x: Number(spec.x),
        y: Number(spec.y),
        r: 0.01,
      };
      const m = world.spawnMob(
        def,
        p.zone,
        90000 + Math.floor(Math.random() * 10000),
        area,
      );
      m.dungeonId = d.id;
      m.dungeonInstanceId = p.dungeon?.instanceId;
      m.dungeonPatrol = true;
      m.dungeonRoute = spec.route || [];
      m.dungeonRouteIndex = 0;
      m.speedMeters = Number(spec.speed || 7);
      m.respawn = 0;
      m.deadUntil = Infinity;
      m.temper = "aggressive";
      m.aggroRangeMeters = 90;
      m.baseAggroRangeMeters = 90;
    }
    p.dungeon.patrolsSpawned = true;
  }
  spawnTrashRoom(p, d, stage, room) {
    const world = this.combat.world;
    const configured = d.trashPools || {};
    const fallback = this.defaults?.trashPools || {};
    const pool = {
      trash: configured.trash || fallback.trash || [],
      elite: configured.elite || fallback.elite || [],
    };
    const types: any[] = pool[this.stageType(d, stage)] || pool.trash;
    const defs = types
      .map((id) => world.mobDefs.find((x) => x.type === id))
      .filter(Boolean);
    if (!defs.length)
      throw new Error(
        `Dungeon ${d.id} stage ${stage} has no valid trash mob definitions.`,
      );
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const def = defs[i % defs.length];
      const ang = (i / 5) * Math.PI * 2 + 0.2;
      const rr = 0.08 + (i % 2) * 0.025;
      const area = {
        id: `dungeon_${d.id}_${stage}_${i}`,
        x: room.x,
        y: room.y,
        r: 0.035,
      };
      const m = world.spawnMob(def, p.zone, 10000 + stage * 20 + i, area);
      const delta = Math.max(
        0,
        Number(p.level || d.level || 1) - Number(def.level || d.level || 1),
      );
      const tierModifier = Math.max(1, Number(d.tierModifier || 1));
      const scaleHp = Math.pow(1.055, delta) * (1 + (tierModifier - 1) * 0.55),
        scaleAtk = Math.pow(1.035, delta) * (1 + (tierModifier - 1) * 0.28),
        scaleArmor = Math.pow(1.028, delta) * (1 + (tierModifier - 1) * 0.22);
      m.level = Math.max(Number(d.level || 1), Number(p.level || 1));
      m.maxHp = Math.max(
        1,
        Math.round(Number(def.maxHp || m.maxHp || 1) * scaleHp),
      );
      m.hp = m.maxHp;
      m.attack = Math.max(
        1,
        Math.round(Number(def.attack || m.attack || 1) * scaleAtk),
      );
      m.armor = Math.max(
        0,
        Math.round(Number(def.armor || m.armor || 0) * scaleArmor),
      );
      m.xp = Math.max(
        1,
        Math.round(Number(def.xp || m.xp || 1) * Math.pow(1.07, delta)),
      );
      m.gold = Math.max(
        0,
        Math.round(Number(def.gold || m.gold || 0) * Math.pow(1.03, delta)),
      );
      m.dungeonId = d.id;
      m.dungeonInstanceId = p.dungeon?.instanceId;
      m.dungeonStage = stage;
      m.homeX = room.x + Math.cos(ang) * rr;
      m.homeY = room.y + Math.sin(ang) * rr;
      m.x = m.homeX;
      m.y = m.homeY;
      m.targetX = m.x;
      m.targetY = m.y;
      m.speedMeters = Math.max(14, Number(m.speedMeters || 14));
      m.attackRangeMeters = 18;
      m.temper = "aggressive";
      m.aggroRangeMeters = 120;
      m.baseAggroRangeMeters = 120;
      m.respawn = 0;
      m.deadUntil = Infinity;
      m.drops = [...(def.loot || def.drops || [])];
      ids.push(m.id);
    }
    p.dungeon.roomMobIds = ids;
    p.dungeon.roomMode = "trash";
    p.dungeon.roomCleared = false;
    for (const member of this.runtimeMembers(p)) {
      if (member.dungeon?.id === d.id) {
        this.stateForMember(member);
        member.dungeon.stage = stage;
        member.dungeon.roomId = room?.id || member.dungeon.roomId;
        member.dungeon.roomMobIds = [...ids];
        member.dungeon.roomMode = "trash";
        member.dungeon.roomCleared = false;
      }
    }
  }
  start(p, id) {
    if (p.encounterId || p.worldCombatMobId)
      return [false, "Cannot enter a dungeon during combat."];
    const d = this.dungeons.find((x) => x.id === id);
    if (!d) return [false, "Unknown dungeon."];
    if (p.level < d.level)
      return [false, `You need level ${d.level} to enter ${d.name}.`];
    this.combat.world.registerRuntimeZone(id, {
      ...this.dungeonConfig(),
      dungeonData: d,
    });
    const party = p.partyId
      ? this.combat.world?.players?.filter(
          (x) => x && x.online && x.partyId === p.partyId && !x.dead,
        ) || [p]
      : [p];
    const existing = party.map((x) => this.getPlayerInstance(x)).find(Boolean);
    if (existing)
      return [
        false,
        "Your party is already assigned to an active dungeon instance.",
      ];
    for (const member of party) {
      if (member.id !== p.id && member.level < d.level)
        return [false, `${member.name} needs level ${d.level}.`];
      if (member.id !== p.id && (member.encounterId || member.worldCombatMobId))
        return [false, `${member.name} is already in combat.`];
    }
    const created = this.createInstance(p, d, party);
    if (!created[0]) return created;
    const instance: any = created[1];
    for (const member of party) {
      member.dungeon = {
        id,
        instanceId: instance.id,
        instanceState: "CREATING",
        entryState: "TELEPORTING",
        stage: 0,
        startedAt: Date.now(),
        fromZone: member.zone || member.homeCity || "stonehold",
        fromX: member.x,
        fromY: member.y,
        leaderId: p.id,
        roomMobIds: [],
        roomCleared: false,
        nextStageUnlocked: false,
        discoveredRooms: [1],
        routeChoices: [],
        optionalCleared: [],
        shortcutsUnlocked: [],
        selectedRoute: null,
        patrolsSpawned: false,
        wipePending: false,
        wipeReason: null,
        recoveryState: "ACTIVE",
        completedEvents: [],
        activeEvent: null,
        checkpointX: Number(d.entrance?.x ?? d.rooms?.[0]?.x ?? 0.5),
        checkpointY: Number(d.entrance?.y ?? 0.965),
      };
      const first = d.rooms?.[0];
      member.zone = id;
      member.x = Number(d.entrance?.x ?? first?.x ?? 0.5);
      member.y = Number(d.entrance?.y ?? 0.965);
      member.targetX = member.x;
      member.targetY = member.y;
      member.moveState = "idle";
      member.velocityX = 0;
      member.velocityY = 0;
      member.targetMobId = null;
      member.targetPlayerId = null;
      member.worldCombatMobId = null;
      member.combat.autoAttack = false;
      member.combat.manualMove = false;
      member.combat.autoApproach = false;
      member.mining = null;
      this.quest?.onDungeon(member, id);
    }
    this.spawnPatrols(p, d);
    this.activateInstance(instance);
    for (const member of party) {
      if (member.dungeon?.instanceId === instance.id) {
        member.dungeon.instanceState = "ACTIVE";
        member.dungeon.entryState = "ENTERED";
      }
    }
    return this.startStage(p);
  }
  startStage(p, placePlayer = true) {
    const d = this.dungeons.find((x) => x.id === p.dungeon?.id);
    if (!d) return [false, "Dungeon not active."];
    const stage = p.dungeon.stage;
    const enemyId = d.stages[stage];
    if (!enemyId) return [false, "Dungeon complete."];
    const room = d.rooms?.[Math.min(stage, d.rooms.length - 1)];
    if (room) {
      this.discoverRoom(p, room.id);
      p.dungeon.roomId = room.id;
      p.dungeon.availableRoutes = (d.routeChoices || [])
        .filter((x) => Number(x.afterRoom) === Number(room.id))
        .map((x) => x.id);
      if (placePlayer && stage === 0) {
        p.x = Number(d.entrance?.x ?? room.x);
        p.y = Number(d.entrance?.y ?? 0.965);
        p.targetX = p.x;
        p.targetY = p.y;
        p.moveState = "idle";
      }
      p.dungeon.roomMobIds = [];
      p.dungeon.roomCleared = false;
      p.dungeon.nextStageUnlocked = false;
      p.dungeon.selectedRoute = null;
    }
    const type = this.stageType(d, stage);
    p.dungeon.checkpointX = Number(room?.x ?? p.dungeon.checkpointX ?? 0.5);
    p.dungeon.checkpointY = Number(room?.y ?? p.dungeon.checkpointY ?? 0.9);
    if (type === "trash" || type === "elite") {
      this.spawnTrashRoom(p, d, stage, room || { x: 0.5, y: 0.5 });
      return [
        true,
        {
          room: room?.id,
          stage: stage + 1,
          total: d.stages.length,
          type,
          roomMobs: p.dungeon.roomMobIds,
        },
      ];
    }
    const override =
      d.bossMechanicOverride && stage === d.stages.length - 1
        ? d.bossMechanicOverride
        : null;
    const started = this.combat.start(p, enemyId, {
      dungeonId: d.id,
      stage,
      room,
      mechanicsOverride: override,
      dungeonTierModifier: Number(d.tierModifier || 1),
    });
    if (!started[0]) return started;
    const sharedId = p.encounterId;
    for (const member of this.runtimeMembers(p)) {
      if (member.id === p.id || member.dungeon?.id !== d.id) continue;
      if (member.encounterId) this.combat.encounters.delete(member.encounterId);
      member.encounterId = sharedId;
      member.dungeon.stage = stage;
      member.dungeon.roomId = room?.id || member.dungeon.roomId;
      member.dungeon.roomMobIds = [];
      member.combat.autoAttack = true;
      member.combat.manualMove = false;
    }
    return started;
  }
  chooseRoute(p, routeId) {
    if (!p.dungeon) return [false, "You are not in a dungeon."];
    const d = this.dungeons.find((x) => x.id === p.dungeon.id);
    const party = this.runtimeMembers(p);
    if (p.partyId && p.dungeon.leaderId !== p.id)
      return [false, "Only the party leader chooses the route."];
    if (p.encounterId || !p.dungeon.roomCleared)
      return [false, "Clear the current area before choosing a route."];
    const r = (d.routeChoices || []).find(
      (x) =>
        x.id === routeId && Number(x.afterRoom) === Number(p.dungeon.roomId),
    );
    if (!r) return [false, "That route is not available from this area."];
    const next = d.rooms?.find((x) => Number(x.id) === Number(r.nextRoom));
    if (!next) return [false, "Route destination is invalid."];
    for (const m of party.length ? party : [p]) {
      this.stateForMember(m);
      m.dungeon.selectedRoute = r.id;
      m.dungeon.routeChoices = [r.id];
      m.dungeon.discoveredRooms.push(Number(next.id));
      m.dungeon.routeDestination = Number(next.id);
    }
    return [
      true,
      `Route chosen: ${r.label}.`,
      { route: r.id, nextRoom: next.id, label: r.label },
    ];
  }
  enterOptional(p, roomId) {
    if (!p.dungeon) return [false, "You are not in a dungeon."];
    const d = this.dungeons.find((x) => x.id === p.dungeon.id);
    if (p.dungeon.leaderId !== p.id)
      return [false, "Only the party leader can open an optional route."];
    if (p.encounterId || !p.dungeon.roomCleared)
      return [false, "Clear the current area first."];
    const room = (d.optionalRooms || []).find(
      (x) => x.id === roomId && !p.dungeon.optionalCleared?.includes(x.id),
    );
    if (!room) return [false, "That optional area is unavailable."];
    if (Number(p.dungeon.roomId) !== Number(room.requiresRoom))
      return [
        false,
        "Reach the correct area before entering this optional route.",
      ];
    const def = this.combat.world.mobDefs.find((x) => x.type === room.enemy);
    if (!def) return [false, "Optional encounter is misconfigured."];
    this.discoverRoom(p, room.id);
    p.dungeon.activeOptionalRoom = room.id;
    const started = this.combat.start(p, room.enemy, {
      dungeonId: d.id,
      optionalRoomId: room.id,
      room,
    });
    if (!started[0]) return started;
    const eid = p.encounterId;
    for (const m of this.runtimeMembers(p)) {
      if (m.id === p.id) continue;
      m.encounterId = eid;
      m.combat.autoAttack = true;
    }
    return [
      true,
      `Entering optional area: ${room.name}.`,
      { optionalRoom: room.id },
    ];
  }
  unlockShortcut(p, shortcutId) {
    if (!p.dungeon) return [false, "You are not in a dungeon."];
    const d = this.dungeons.find((x) => x.id === p.dungeon.id);
    const s = (d.shortcuts || []).find(
      (x) =>
        x.id === shortcutId && Number(x.afterRoom) === Number(p.dungeon.roomId),
    );
    if (!s) return [false, "That shortcut is unavailable."];
    if (p.dungeon.leaderId !== p.id)
      return [false, "Only the party leader can unlock the shortcut."];
    for (const m of this.runtimeMembers(p)) {
      this.stateForMember(m);
      if (!m.dungeon.shortcutsUnlocked.includes(s.id))
        m.dungeon.shortcutsUnlocked.push(s.id);
      m.dungeon.discoveredRooms.push(Number(s.toRoom));
      m.dungeon.routeDestination = Number(s.toRoom);
      m.dungeon.roomCleared = true;
    }
    return [true, `${s.label} unlocked.`, { shortcut: s.id, toRoom: s.toRoom }];
  }
  updatePatrols(p) {
    const d = this.dungeons.find((x) => x.id === p.dungeon?.id);
    if (!d) return;
    for (const m of this.combat.world?.mobs?.values?.() || []) {
      if (
        !m.dungeonPatrol ||
        m.dungeonId !== d.id ||
        m.dungeonInstanceId !== p.dungeon?.instanceId ||
        m.state === "dead" ||
        m.aggroTarget
      )
        continue;
      const route = m.dungeonRoute || [];
      if (!route.length) continue;
      const q = route[m.dungeonRouteIndex % route.length];
      const dx = q[0] - m.x,
        dy = q[1] - m.y,
        dist = Math.hypot(dx, dy);
      if (dist < 0.012) {
        m.dungeonRouteIndex = (m.dungeonRouteIndex + 1) % route.length;
        continue;
      }
      const speed =
        Number(m.speedMeters || 7) /
        (this.combat.world.worldMetersFor(p.zone) || 12000);
      m.velocityX = (dx / dist) * speed;
      m.velocityY = (dy / dist) * speed;
      m.x += m.velocityX * 0.05;
      m.y += m.velocityY * 0.05;
      m.targetX = q[0];
      m.targetY = q[1];
    }
  }
  tick(p) {
    if (!p?.dungeon || p.encounterId) return null;
    if (p.partyId && p.dungeon.leaderId && p.dungeon.leaderId !== p.id)
      return null;
    this.updatePatrols(p);
    const d = this.dungeons.find((x) => x.id === p.dungeon.id);
    if (!d) return null;
    const room = d.rooms?.[Number(p.dungeon.stage) || 0];
    if (!room) return null;
    const instance = this.getPlayerInstance(p);
    if (instance?.wipePending || p.dungeon.wipePending) return null;
    if (instance?.activeEvent) return this.updateEvent(p, d, room);
    if (!p.dungeon.roomCleared) {
      if (
        this.stageType(d, p.dungeon.stage) === "boss" ||
        this.stageType(d, p.dungeon.stage) === "mini_boss"
      )
        return null;
      if (!this.clearRoomMobs(p)) return null;
      p.dungeon.roomCleared = true;
      p.dungeon.nextStageUnlocked = true;
      p.dungeon.availableRoutes = (d.routeChoices || [])
        .filter((x) => Number(x.afterRoom) === Number(room.id))
        .map((x) => x.id);
      const linearRoutes = (d.routeChoices || []).filter(
        (x) => Number(x.afterRoom) === Number(room.id),
      );
      const linearNext = d.rooms?.[Number(p.dungeon.stage) + 1];
      if (!linearRoutes.length && linearNext) {
        for (const m of this.runtimeMembers(p).length
          ? this.runtimeMembers(p)
          : [p]) {
          this.stateForMember(m);
          m.dungeon.discoveredRooms.push(Number(linearNext.id));
          m.dungeon.routeDestination = Number(linearNext.id);
        }
      }
      this.quest?.onDungeonStage(p, p.dungeon.id, 1);
      const event = this.triggerEvent(p, d, room);
      if (event)
        return {
          roomCleared: false,
          eventStarted: true,
          event: {
            id: event.id,
            name: event.name,
            type: event.type,
            endsAt: event.endsAt,
            message: event.message,
          },
        };
      return {
        roomCleared: true,
        stage: p.dungeon.stage,
        total: d.stages.length,
        nextRoom: d.rooms?.[p.dungeon.stage + 1]?.id || null,
        routeChoices: (d.routeChoices || []).filter(
          (x) => Number(x.afterRoom) === Number(room.id),
        ),
        optionalRooms: (d.optionalRooms || []).filter(
          (x) =>
            Number(x.requiresRoom) === Number(room.id) &&
            !p.dungeon.optionalCleared?.includes(x.id),
        ),
        shortcuts: (d.shortcuts || []).filter(
          (x) =>
            Number(x.afterRoom) === Number(room.id) &&
            !p.dungeon.shortcutsUnlocked?.includes(x.id),
        ),
      };
    }
    const routeOptions = (d.routeChoices || []).filter(
      (x) => Number(x.afterRoom) === Number(room.id),
    );
    if (
      routeOptions.length &&
      !p.dungeon.routeDestination &&
      !p.dungeon.selectedRoute
    )
      return {
        routeChoiceRequired: true,
        room: room.id,
        routeChoices: routeOptions,
      };
    const nextId =
      p.dungeon.routeDestination || d.rooms?.[Number(p.dungeon.stage) + 1]?.id;
    const next = d.rooms?.find((x) => Number(x.id) === Number(nextId));
    if (!next) return null;
    const dist = Math.hypot(p.x - next.x, p.y - next.y);
    if (dist > 0.075) return null;
    const nextIndex = d.rooms.findIndex(
      (x) => Number(x.id) === Number(next.id),
    );
    if (nextIndex < 0) return null;
    p.dungeon.stage = nextIndex;
    p.dungeon.routeDestination = null;
    p.dungeon.roomMobIds = [];
    p.dungeon.roomCleared = false;
    p.dungeon.nextStageUnlocked = false;
    return this.startStage(p, false)[1];
  }
  onVictory(p, e) {
    if (!p.dungeon) return null;
    const d = this.dungeons.find((x) => x.id === p.dungeon.id);
    if (!d) return null;
    if (e?.optionalRoomId) {
      const room = (d.optionalRooms || []).find(
        (x) => x.id === e.optionalRoomId,
      );
      const members = p.dungeon?.instanceId
        ? this.instanceMembers(p)
        : p.partyId
          ? this.partyMembers(p)
          : [p];
      for (const m of members) {
        this.stateForMember(m);
        if (!m.dungeon.optionalCleared.includes(e.optionalRoomId))
          m.dungeon.optionalCleared.push(e.optionalRoomId);
        m.dungeon.activeOptionalRoom = null;
        m.dungeon.roomCleared = true;
      }
      for (const m of members) {
        if (m.encounterId) {
          this.combat.encounters.delete(m.encounterId);
          m.encounterId = null;
        }
      }
      return {
        complete: false,
        optionalComplete: true,
        optionalRoomId: e.optionalRoomId,
        optionalReward: room?.reward || {},
        members: members.map((m) => m.name),
      };
    }
    const members = p.dungeon?.instanceId
      ? this.instanceMembers(p)
      : p.partyId
        ? this.partyMembers(p)
        : [p];
    const currentRoom = d.rooms?.[Number(p.dungeon.stage)];
    const activeInstance = this.getPlayerInstance(p);
    if (
      currentRoom?.type === "mini_boss" &&
      (d.shortcuts || []).some(
        (x) => Number(x.afterRoom) === Number(currentRoom.id),
      )
    ) {
      for (const m of members) {
        this.stateForMember(m);
        m.dungeon.roomCleared = true;
        m.dungeon.nextStageUnlocked = true;
        m.dungeon.availableRoutes = [];
        if (m.encounterId) {
          this.combat.encounters.delete(m.encounterId);
          m.encounterId = null;
        }
      }
      return {
        complete: false,
        miniBossComplete: true,
        stage: p.dungeon.stage + 1,
        total: d.stages.length,
        room: currentRoom.id,
        shortcuts: (d.shortcuts || []).filter(
          (x) =>
            Number(x.afterRoom) === Number(currentRoom.id) &&
            !p.dungeon.shortcutsUnlocked?.includes(x.id),
        ),
        members: members.map((m) => m.name),
      };
    }
    const nextStage = p.dungeon.stage + 1;
    if (nextStage >= d.stages.length) {
      const leaderLevel = Math.max(
        Number(p.level || d.level || 1),
        ...members.map((m) => Number(m.level || d.level || 1)),
      );
      const tier = Number(
        d.tierModifier ||
          (leaderLevel >= 51
            ? 2.3
            : leaderLevel >= 36
              ? 1.9
              : leaderLevel >= 26
                ? 1.55
                : leaderLevel >= 16
                  ? 1.25
                  : 1),
      );
      const levelFactor = Math.max(
        1,
        Math.min(
          2,
          0.85 + (leaderLevel / Math.max(1, Number(d.level || 1))) * 0.15,
        ),
      );
      const reward = {
        ...(d.reward || {}),
        gearRolls: Number(d.lootGearRolls || d.reward?.gearRolls || 1),
        lootLevel: Number(d.lootLevel || leaderLevel),
        xp: Math.max(
          0,
          Math.round(Number(d.reward?.xp || 0) * tier * levelFactor),
        ),
        gold: Math.max(
          0,
          Math.round(
            Number(d.reward?.gold || 0) *
              (0.9 + (leaderLevel / Math.max(1, Number(d.level || 1))) * 0.1),
          ),
        ),
      };
      const homeById = new Map(
        members.map((m) => [
          m.id,
          m.dungeon?.fromZone || m.homeCity || "stonehold",
        ]),
      );
      for (const m of members) {
        if (m.encounterId) {
          this.combat.encounters.delete(m.encounterId);
          m.encounterId = null;
        }
        const instance = this.getPlayerInstance(m);
        m.dungeon = null;
        m.worldCombatMobId = null;
        m.targetMobId = null;
        m.combat.autoAttack = false;
        m.combat.autoApproach = false;
        m.combat.manualMove = false;
      }
      this.closeInstance(activeInstance, "completed");
      return {
        complete: true,
        name: d.name,
        reward,
        rewardMemberIds: members.map((m) => m.id),
        returnZones: Object.fromEntries(homeById),
        instanceId: activeInstance?.id || null,
      };
    }
    for (const m of members) {
      if (m.encounterId) {
        this.combat.encounters.delete(m.encounterId);
        m.encounterId = null;
      }
      m.dungeon.stage = nextStage;
      m.dungeon.availableRoutes = [];
      m.dungeon.roomCleared = false;
      m.combat.autoAttack = false;
      m.combat.autoApproach = false;
      m.combat.manualMove = false;
      m.dungeon.roomCleared = false;
    }
    return {
      complete: false,
      stage: nextStage + 1,
      total: d.stages.length,
      next: d.stages[nextStage],
      members: members.map((m) => m.name),
    };
  }
  abandon(p) {
    if (p.encounterId)
      return [false, "Leave combat before abandoning the dungeon."];
    const instance = this.getPlayerInstance(p);
    const home = p.dungeon?.fromZone || p.homeCity || "stonehold";
    const wasLeader = p.dungeon?.leaderId === p.id;
    const remaining = instance
      ? (this.combat.world?.players || []).filter(
          (x: any) =>
            x && x !== p && x.online && x.dungeon?.instanceId === instance.id,
        )
      : [];
    p.dungeon = null;
    if (instance && remaining.length) {
      instance.memberIds = (instance.memberIds || []).filter(
        (id: string) => id !== p.id,
      );
      instance.lastActivityAt = Date.now();
      if (
        wasLeader ||
        !remaining.some((x: any) => x.dungeon?.leaderId === x.id)
      ) {
        const next = remaining[0];
        for (const m of remaining) {
          if (m.dungeon) m.dungeon.leaderId = next.id;
        }
        if (instance.ownerId === p.id) instance.ownerId = next.id;
      }
      return [
        true,
        "You left the dungeon.",
        { returnZone: home, instanceId: instance.id, instanceRemains: true },
      ];
    }
    if (instance) this.removeInstanceMobs(instance.id);
    this.closeInstance(instance, "abandoned");
    return [
      true,
      "Dungeon abandoned.",
      { returnZone: home, instanceId: instance?.id || null },
    ];
  }
}
export { DungeonEngine };
