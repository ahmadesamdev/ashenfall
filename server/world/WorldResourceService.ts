import { runtimeId } from "../shared/Ids.js";

const uid = (prefix: string) => runtimeId(prefix);

export class WorldResourceService {
  readonly ores = new Map<string, any>();
  constructor(private readonly world: any) {}

  spawnOres(): void {
    const specs: any[] = [
      [
        "copper_ore",
        "Copper Vein",
        "⛏️",
        1,
        ["gloamwood", "marches_of_dawn"],
        15000,
        [14, 14],
      ],
      [
        "iron_ore",
        "Iron Vein",
        "⛓️",
        2,
        ["gloamwood", "marches_of_dawn"],
        16000,
        [12, 12],
      ],
      [
        "umbral_iron_ore",
        "Umbral Iron Vein",
        "🪨",
        3,
        ["gloamwood", "marches_of_dawn"],
        18000,
        [10, 10],
      ],
      [
        "silver_ore",
        "Silver Vein",
        "🥈",
        4,
        ["gloamwood", "marches_of_dawn", "ashen_wastes"],
        20000,
        [8, 8, 5],
      ],
      [
        "star_iron_ore",
        "Star-Iron Vein",
        "✨",
        5,
        [
          "gloamwood",
          "marches_of_dawn",
          "ashen_wastes",
          "eastern_reach",
          "old_kingdom",
        ],
        22000,
        [6, 6, 8, 7, 5],
      ],
      [
        "blacksteel_ore",
        "Blacksteel Vein",
        "⬛",
        6,
        ["marches_of_dawn", "ashen_wastes", "eastern_reach", "old_kingdom"],
        26000,
        [5, 8, 6, 7],
      ],
      [
        "dreadsilver_ore",
        "Dreadsilver Vein",
        "🩶",
        8,
        ["ashen_wastes", "old_kingdom", "hollow_expanse"],
        32000,
        [7, 6, 9],
      ],
    ];
    const camps: any = {
      gloamwood: [
        [0.25, 0.3, 0.12],
        [0.48, 0.34, 0.11],
        [0.72, 0.28, 0.1],
        [0.34, 0.72, 0.12],
        [0.68, 0.7, 0.12],
        [0.82, 0.52, 0.09],
      ],
      marches_of_dawn: [
        [0.22, 0.25, 0.11],
        [0.48, 0.3, 0.12],
        [0.75, 0.25, 0.1],
        [0.28, 0.68, 0.12],
        [0.62, 0.62, 0.12],
      ],
      ashen_wastes: [
        [0.24, 0.28, 0.12],
        [0.52, 0.25, 0.11],
        [0.78, 0.3, 0.12],
        [0.3, 0.7, 0.12],
        [0.6, 0.7, 0.12],
        [0.8, 0.66, 0.1],
      ],
      eastern_reach: [
        [0.18, 0.25, 0.11],
        [0.42, 0.3, 0.12],
        [0.72, 0.28, 0.1],
        [0.28, 0.68, 0.12],
        [0.58, 0.72, 0.11],
        [0.82, 0.58, 0.09],
      ],
      old_kingdom: [
        [0.2, 0.28, 0.11],
        [0.48, 0.24, 0.12],
        [0.78, 0.3, 0.11],
        [0.26, 0.68, 0.12],
        [0.58, 0.72, 0.11],
        [0.8, 0.64, 0.1],
      ],
      hollow_expanse: [
        [0.14, 0.5, 0.12],
        [0.36, 0.42, 0.11],
        [0.62, 0.5, 0.12],
        [0.78, 0.68, 0.1],
        [0.84, 0.3, 0.09],
      ],
    };
    for (const [type, name, icon, level, zones, respawn, counts] of specs) {
      zones.forEach((zone: string, zi: number) => {
        const c = camps[zone] || [[0.5, 0.5, 0.2]];
        const count = Number(counts[Math.min(zi, counts.length - 1)] || 5);
        for (let i = 0; i < count; i++) {
          const camp = c[i % c.length],
            angle = (i * 2.399 + level * 0.7) % (Math.PI * 2),
            radius = (0.35 + ((i * 0.618) % 1) * 0.45) * camp[2];
          const x = Math.max(
            0.05,
            Math.min(0.95, camp[0] + Math.cos(angle) * radius),
          );
          const y = Math.max(
            0.06,
            Math.min(0.94, camp[1] + Math.sin(angle) * radius),
          );
          const id = uid("ore");
          this.ores.set(id, {
            id,
            type,
            name,
            icon,
            level,
            miningLevel: level,
            zone,
            x,
            y,
            spawnX: x,
            spawnY: y,
            spawnRadius: Math.max(0.015, camp[2] * 0.55),
            respawn,
            baseRespawn: respawn,
            state: "ready",
            source: "camp",
            claimedBy: null,
          });
        }
        const scattered = Math.max(8, Math.floor(count * 1.5));
        for (let i = 0; i < scattered; i++) {
          const seed =
            (i * 0.61803398875 + level * 0.137 + zone.length * 0.071) % 1;
          const x = Math.max(
            0.06,
            Math.min(0.94, 0.08 + ((seed * 7.31) % 1) * 0.84),
          );
          const y = Math.max(
            0.07,
            Math.min(0.93, 0.08 + ((seed * 13.17 + 0.31) % 1) * 0.84),
          );
          const tooClose = c.some(
            (camp: any) =>
              Math.hypot(x - camp[0], y - camp[1]) <
              Math.max(0.025, camp[2] * 0.35),
          );
          if (tooClose) continue;
          const id = uid("ore");
          this.ores.set(id, {
            id,
            type,
            name,
            icon,
            level,
            miningLevel: level,
            zone,
            x,
            y,
            spawnX: x,
            spawnY: y,
            spawnRadius: 0.045,
            respawn,
            baseRespawn: respawn,
            state: "ready",
            source: "scattered",
            claimedBy: null,
          });
        }
      });
    }
  }

  zoneOres(zone: string): any[] {
    return [...this.ores.values()].filter(
      (o) => o.zone === zone && o.state !== "depleted",
    );
  }

  mineOre(p: any, id: string): any {
    const o = this.ores.get(id);
    if (!o || o.zone !== p.zone || o.state === "depleted")
      return [false, "That ore vein is unavailable."];
    if (o.claimedBy && o.claimedBy !== p.id)
      return [false, "Another miner is already working this vein."];
    if ((p.profession?.mining || 0) < o.level)
      return [false, `Mining ${o.level} is required for ${o.name}.`];
    if (p.worldCombatMobId || p.encounterId)
      return [false, "Combat interrupts mining."];
    if (p.mining?.oreId === id)
      return [
        true,
        {
          mining: true,
          endsAt: p.mining.endsAt,
          message: "Already mining this vein.",
        },
      ];
    if (p.mining) return [false, "You are already mining."];
    p.pendingOre = null;
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    if (d > this.world.normalizedMeters(p.zone, 8)) {
      p.combat.autoApproach = false;
      p.combat.queuedWorldAbility = null;
      p.pendingGate = null;
      p.pendingNpc = null;
      p.pendingLoot = null;
      p.pendingOre = id;
      p.movementIntent = "interaction";
      p.targetX = o.x;
      p.targetY = o.y;
      p.movementMode = "run";
      p.moveState = "moving";
      return [
        true,
        { approaching: true, message: "Approaching the ore vein." },
      ];
    }
    const startedAt = Date.now(),
      duration = 2800 + o.level * 350;
    o.claimedBy = p.id;
    p.mining = { oreId: id, startedAt, endsAt: startedAt + duration };
    p.targetX = p.x;
    p.targetY = p.y;
    p.moveState = "idle";
    p.velocityX = 0;
    p.velocityY = 0;
    p.movementMode = "walk";
    return [
      true,
      {
        mining: true,
        endsAt: p.mining.endsAt,
        duration,
        message: `Mining ${o.name}…`,
      },
    ];
  }

  completeMining(p: any, id: string): any {
    const o = this.ores.get(id);
    if (!p.mining || p.mining.oreId !== id)
      return [false, "You are not mining that vein."];
    if (!o) {
      p.mining = null;
      return [false, "The ore vein is no longer available."];
    }
    if (p.worldCombatMobId || p.encounterId) {
      o.claimedBy = null;
      p.mining = null;
      return [false, "Mining interrupted by combat."];
    }
    if (o.zone !== p.zone || o.state === "depleted") {
      o.claimedBy = null;
      p.mining = null;
      return [false, "The ore vein is no longer available."];
    }
    if (
      Math.hypot(p.x - o.x, p.y - o.y) > this.world.normalizedMeters(p.zone, 10)
    ) {
      o.claimedBy = null;
      p.mining = null;
      return [false, "You moved too far from the vein."];
    }
    if (Date.now() < p.mining.endsAt)
      return [false, "Mining is still in progress."];
    p.mining = null;
    o.claimedBy = null;
    o.state = "depleted";
    const respawnMult =
      p.professionSpecializations?.mining === "veinwalker" ? 0.75 : 1;
    o.respawnAt =
      Date.now() + Math.round(Number(o.respawn || 15000) * respawnMult);
    const qty = o.level >= 6 ? 2 : 1;
    return [
      true,
      {
        ore: o.type,
        qty,
        xp: 10 + o.level * 5,
        respawnAt: o.respawnAt,
        message: `Mined ${qty} × ${o.name}.`,
      },
    ];
  }
}
