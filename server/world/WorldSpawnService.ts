import crypto from "node:crypto";
import { COMBAT_RANGES } from "../combat/CombatRanges.js";
import type { World } from "./World.js";

const uid = (prefix: string) =>
  `${prefix}_${crypto.randomBytes(5).toString("hex")}`;

export class WorldSpawnService {
  constructor(private readonly world: World) {}

  spawnAll() {
    const world: any = this.world;
    for (const zone of world.zones) {
      if (zone.city) continue;
      const defs =
        world.mobDefsForZone?.(zone.id) ||
        world.mobDefs.filter((m: any) => (m.zones || []).includes(zone.id));
      for (const def of defs) {
        const rawAreas = (def.spawnAreas && def.spawnAreas[zone.id]) || [
          { x: 0.5, y: 0.5, r: 0.28, count: def.count || 5 },
        ];
        const areas = rawAreas.filter((a: any) => Number(a.r || 0) >= 0.03);
        let idx = 0;
        for (const area of areas) {
          const rare = !!def.rare;
          const count = rare
            ? 1
            : Math.max(
                4,
                Math.min(12, Math.floor(area.count || def.count || 5)),
              );
          for (let j = 0; j < count; j++)
            this.spawnMob(def, zone.id, idx++, area);
          if (rare) break;
        }
      }
    }
  }

  spawnMob(def: any, zoneId: string, idx: number, area: any) {
    const world: any = this.world;
    const angle = (idx * 2.399 + Math.random() * 0.45) % (Math.PI * 2);
    const radius = (0.18 + 0.62 * ((idx * 0.618) % 1)) * (area.r || 0.2);
    const x = Math.max(
      0.04,
      Math.min(0.96, (area.x || 0.5) + Math.cos(angle) * radius),
    );
    const y = Math.max(
      0.05,
      Math.min(0.95, (area.y || 0.5) + Math.sin(angle) * radius),
    );
    const zoneBand = (world.zoneProgression?.zones || []).find(
      (z: any) => z.id === zoneId,
    );
    const baseLevel = Math.max(1, Number(def.level) || 1);
    const zoneMin = Number(zoneBand?.minLevel || baseLevel),
      zoneMax = Number(zoneBand?.maxLevel || baseLevel);
    const baseLevels = world.zoneBaseLevels.get(zoneId) || [];
    const baseIndex = Math.max(0, baseLevels.indexOf(baseLevel));
    const zoneLevel =
      zoneBand && zoneMax > zoneMin && baseLevels.length > 1
        ? Math.max(
            zoneMin,
            Math.min(
              zoneMax,
              Math.round(
                zoneMin +
                  (baseIndex / (baseLevels.length - 1)) * (zoneMax - zoneMin),
              ),
            ),
          )
        : baseLevel;
    const levelDelta = zoneLevel - baseLevel;
    const statScale =
      Math.pow(1.075, Math.max(0, levelDelta)) +
      Math.min(0, levelDelta) * 0.025;
    const xpScale = Math.pow(1.1, Math.max(0, levelDelta));
    const maxHp = Math.max(1, Math.round(Number(def.maxHp || 1) * statScale));
    const attack = Math.max(
      1,
      Math.round(
        Number(def.attack || 1) * (1 + Math.max(0, levelDelta) * 0.045),
      ),
    );
    const armor = Math.max(
      0,
      Math.round(Number(def.armor || 0) * (1 + Math.max(0, levelDelta) * 0.04)),
    );
    const xp = Math.max(1, Math.round(Number(def.xp || 1) * xpScale));
    const mob: any = {
      id: uid("mob"),
      type: def.type,
      name: def.name,
      icon: def.icon,
      level: zoneLevel,
      maxHp,
      hp: maxHp,
      attack,
      armor,
      xp,
      gold: Math.max(
        0,
        Math.round(
          Number(def.gold || 0) * (1 + Math.max(0, levelDelta) * 0.035),
        ),
      ),
      temper: def.temper,
      ai: def.ai || "normal",
      rare: !!def.rare,
      aggroRangeMeters: Number(
        def.aggroRangeMeters ?? COMBAT_RANGES.mobAggroMeters,
      ),
      baseAggroRangeMeters: Number(
        def.aggroRangeMeters ?? COMBAT_RANGES.mobAggroMeters,
      ),
      ranged: !!def.ranged,
      leader: !!def.leader,
      aoe: def.aoe || null,
      radius: def.radius,
      speedMeters: Number(def.speedMeters ?? (def.ranged ? 6 : 5.5)),
      attackRangeMeters: Number(
        def.ranged
          ? (def.attackRangeMeters ?? COMBAT_RANGES.rangedMobAttackMeters)
          : COMBAT_RANGES.meleeMeters,
      ),
      respawn: def.rare
        ? Math.max(300, Number(def.respawn || 600))
        : Math.max(10, Number(def.respawn) || 30),
      drops: def.drops || [],
      leashRadius: def.leashRadius || 0.16,
      zone: zoneId,
      x,
      y,
      targetX: x,
      targetY: y,
      homeX: x,
      homeY: y,
      velocityX: 0,
      velocityY: 0,
      state: "idle",
      attackers: {},
      aggroTarget: null,
      ignoredAggroPlayers: {},
      deadUntil: 0,
      wanderUntil: Date.now() + Math.random() * 4000,
      stunnedUntil: 0,
      lastAttack: 0,
      returning: false,
      statuses: [],
      spawnArea: {
        id: area.id || `${def.type}_${zoneId}_${idx}`,
        x: area.x,
        y: area.y,
        r: area.r || 0.2,
      },
    };
    world.mobBehavior.initialize(mob, def);
    world.mobs.set(mob.id, mob);
    return mob;
  }
}
