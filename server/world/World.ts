import { COMBAT_RANGES } from "../combat/CombatRanges.js";
import * as WorldGeometry from "./WorldGeometry.js";

import { MobBehaviorEngine } from "./MobBehaviorEngine.js";
import { NpcScheduleEngine } from "./NpcScheduleEngine.js";
import { WorldMovementService } from "./WorldMovementService.js";
import { WorldResourceService } from "./WorldResourceService.js";
import { WorldCombatService } from "./WorldCombatService.js";
import { WorldQueryService } from "./WorldQueryService.js";
import { MobSimulationService } from "./MobSimulationService.js";
import { WorldTravelService } from "./WorldTravelService.js";
import { WorldMaintenanceService } from "./WorldMaintenanceService.js";
import { WorldRegionalBehaviorService } from "./WorldRegionalBehaviorService.js";
import { WorldNavigationService } from "./WorldNavigationService.js";
import { WorldSpawnService } from "./WorldSpawnService.js";
import { WorldConfigurationService } from "./WorldConfigurationService.js";
class World {
  playerMutations: any = null;
  zones: any[];
  layout: any;
  byId: Record<string, any>;
  runtimeZones: Map<string, any>;
  zoneProgression: any;
  worldEventState: any;
  mobDefs: any[];
  npcs: any[];
  npcSchedule: NpcScheduleEngine;
  gates: Record<string, any[]>;
  mobs: Map<string, any>;
  lootPiles: Map<string, any>;
  ores: Map<string, any>;
  players: any[];
  movementService: WorldMovementService;
  resourceService: WorldResourceService;
  combatService: WorldCombatService;
  queryService: WorldQueryService;
  mobBehavior: MobBehaviorEngine;
  mobSimulationService: MobSimulationService;
  travelService: WorldTravelService;
  maintenanceService: WorldMaintenanceService;
  regionalBehaviorService: WorldRegionalBehaviorService;
  navigationService: WorldNavigationService;
  spawnService: WorldSpawnService;
  configurationService: WorldConfigurationService;
  geometry = WorldGeometry;
  mobBehaviorProfiles: any;
  regionTraversalProfiles: any;
  zoneBaseLevels: Map<string, number[]>;
  constructor(
    zones: any[],
    mobDefs: any[],
    npcs: any[] = [],
    gates: any = {},
    layout: any = {},
    zoneProgression: any = {},
    mobBehaviorProfiles: any = {},
    npcScheduleProfiles: any = {},
    regionTraversalProfiles: any = {},
  ) {
    this.zones = zones;
    this.worldEventState = {};
    this.layout = layout || {};
    this.zoneProgression = zoneProgression || {};
    this.mobBehaviorProfiles = mobBehaviorProfiles || {};
    this.regionTraversalProfiles = regionTraversalProfiles || {};
    this.byId = Object.assign(
      Object.create(null),
      Object.fromEntries(zones.map((z) => [z.id, z])),
    );
    this.mobDefs = mobDefs;
    this.zoneBaseLevels = new Map(
      zones.map((z) => [
        z.id,
        [
          ...new Set(
            this.mobDefsForZone(z.id).map((m: any) =>
              Math.max(1, Number(m.level) || 1),
            ),
          ),
        ].sort((a: number, b: number) => a - b),
      ]),
    );
    this.runtimeZones = new Map();
    this.npcs = npcs;
    this.npcSchedule = new NpcScheduleEngine(npcScheduleProfiles);
    this.configurationService = new WorldConfigurationService(this);
    this.gates = this.normalizeGates(gates);
    this.mobs = new Map();
    this.lootPiles = new Map();
    this.resourceService = new WorldResourceService(this);
    this.combatService = new WorldCombatService(this);
    this.ores = this.resourceService.ores;
    this.queryService = new WorldQueryService(this);
    this.players = [];
    this.movementService = new WorldMovementService(this);
    this.mobBehavior = new MobBehaviorEngine(this, this.mobBehaviorProfiles, {
      combatFleeEnabled: true,
    });
    this.mobSimulationService = new MobSimulationService(this);
    this.travelService = new WorldTravelService(this);
    this.maintenanceService = new WorldMaintenanceService(this);
    this.regionalBehaviorService = new WorldRegionalBehaviorService(this);
    this.navigationService = new WorldNavigationService(this);
    this.spawnService = new WorldSpawnService(this);
    this.spawnAll();
    this.spawnOres();
  }

  normalizeGates(input: any) {
    return this.configurationService.normalizeGates(input);
  }

  private mobDefsForZone(zoneId: string) {
    return this.mobDefs.filter((m: any) => (m.zones || []).includes(zoneId));
  }

  spawnAll() {
    return this.spawnService.spawnAll();
  }
  spawnMob(def: any, zoneId: string, idx: number, area: any) {
    return this.spawnService.spawnMob(def, zoneId, idx, area);
  }

  spawnOres() {
    return this.resourceService.spawnOres();
  }
  zoneOres(zone) {
    return this.resourceService.zoneOres(zone);
  }
  mineOre(p, id) {
    return this.resourceService.mineOre(p, id);
  }
  completeMining(p, id) {
    return this.resourceService.completeMining(p, id);
  }

  registerRuntimeZone(id: string, config: any = {}) {
    return this.configurationService.registerRuntimeZone(id, config);
  }
  zoneConfig(zoneId: string): any {
    return this.configurationService.zoneConfig(zoneId);
  }
  respawnPoints(zoneId: string) {
    return this.travelService.respawnPoints(zoneId);
  }
  nearestRespawnPoint(zoneId: string, x: number, y: number) {
    return this.travelService.nearestRespawnPoint(zoneId, x, y);
  }
  sameDungeonInstance(m, p) {
    return this.queryService.sameDungeonInstance(m, p);
  }
  isRenderableMob(m: any, p: any = null) {
    return this.queryService.isRenderableMob(m, p);
  }
  zoneMobs(zone, p = null) {
    return this.queryService.zoneMobs(zone, p);
  }
  zoneLoot(zone) {
    return this.queryService.zoneLoot(zone);
  }
  cleanup(now = Date.now()) {
    return this.maintenanceService.cleanup(now);
  }
  updateNpcs(dt = 0.05, now = Date.now()) {
    return this.maintenanceService.updateNpcs(dt, now);
  }
  zoneNpcs(zone) {
    return this.queryService.zoneNpcs(zone);
  }
  zoneGates(zone) {
    return this.queryService.zoneGates(zone);
  }
  byIdMob(id) {
    return this.queryService.byIdMob(id);
  }

  travel(p, id, viaGate = false, entryGateId = null) {
    return this.travelService.travel(p, id, viaGate, entryGateId);
  }

  move(p, x, y, mode) {
    return this.movementService.move(p, x, y, mode);
  }

  stop(p) {
    return this.movementService.stop(p);
  }

  setMoveInput(p, dx, dy, mode) {
    return this.movementService.setMoveInput(p, dx, dy, mode);
  }

  layoutFor(zoneId: string) {
    return this.configurationService.layoutFor(zoneId);
  }
  pointNearPolyline(x: number, y: number, pts: number[][], threshold: number) {
    return this.geometry.pointNearPolyline(x, y, pts, threshold);
  }
  pointInRect(x: number, y: number, r: number[], pad = 0) {
    return this.geometry.pointInRect(x, y, r, pad);
  }
  isBlocked(zoneId, x, y, p = null) {
    return this.navigationService.isBlocked(zoneId, x, y, p);
  }
  resolveWalkableStep(zoneId, x, y, nx, ny, p = null) {
    return this.navigationService.resolveWalkableStep(zoneId, x, y, nx, ny, p);
  }
  worldMetersFor(zoneId: string) {
    return this.configurationService.worldMetersFor(zoneId);
  }
  normalizedMeters(zoneId: string, meters: number) {
    return this.configurationService.normalizedMeters(zoneId, meters);
  }
  approachPoint(
    p: any,
    target: any,
    stopDistanceMeters: number = COMBAT_RANGES.stopMeters,
  ) {
    return this.movementService.approachPoint(p, target, stopDistanceMeters);
  }

  updatePlayers(dt) {
    return this.maintenanceService.updatePlayers(dt);
  }

  regionalTraversalFor(zoneId: string) {
    return this.regionalBehaviorService.regionalTraversalFor(zoneId);
  }
  distanceToRoadFor(p: any) {
    return this.regionalBehaviorService.distanceToRoadFor(p);
  }
  regionalMobModifier(m: any, now: number) {
    return this.regionalBehaviorService.regionalMobModifier(m, now);
  }

  updateMobs(dt, players) {
    return this.mobSimulationService.update(dt, players);
  }
  combatRangeNormalized(zoneId) {
    return this.combatService.combatRangeNormalized(zoneId);
  }
  combatStopDistanceNormalized(zoneId) {
    return this.combatService.combatStopDistanceNormalized(zoneId);
  }
  combatDisengageNormalized(zoneId) {
    return this.combatService.combatDisengageNormalized(zoneId);
  }
  combatReturnDistanceNormalized(zoneId) {
    return this.combatService.combatReturnDistanceNormalized(zoneId);
  }
  combatRangeMeters(player: any = null) {
    return this.combatService.combatRangeMeters(player);
  }
  combatDisengageMeters() {
    return this.combatService.combatDisengageMeters();
  }
  isSafeWorldEntry(zoneId, x, y) {
    return this.combatService.isSafeWorldEntry(zoneId, x, y);
  }
  addMobThreat(m, p, amount) {
    return this.combatService.addMobThreat(m, p, amount);
  }
  addHealingThreat(target, healer, amount) {
    return this.combatService.addHealingThreat(target, healer, amount);
  }
  mobThreat(m) {
    return this.combatService.mobThreat(m);
  }
  engageMobAgainstPlayer(p, m) {
    return this.combatService.engageMobAgainstPlayer(p, m);
  }
  enterWorldCombat(p, m) {
    return this.combatService.enterWorldCombat(p, m);
  }
  finalizeMobDeath(p, m) {
    return this.combatService.finalizeMobDeath(p, m);
  }
  attackMob(p, mobId, damage, rangeMeters) {
    return this.combatService.attackMob(p, mobId, damage, rangeMeters);
  }
  provokeMob(p, m) {
    return this.combatService.provokeMob(p, m);
  }
  disengagePlayer(p) {
    return this.combatService.disengagePlayer(p);
  }
  pickupLoot(p, pileId) {
    return this.combatService.pickupLoot(p, pileId);
  }
}
export { World };
