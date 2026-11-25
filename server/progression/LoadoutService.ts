import { allocatedStatPoints } from "./Loadouts.js";
import type { PlayerRecord } from "../persistence/Repository.js";

type ItemDefinition = {
  id?: string;
  name?: string;
  class?: string[];
  level?: number;
};

type TalentDefinition = {
  id: string;
  name?: string;
  cost?: number;
  maxRank?: number;
  minLevel?: number;
  buildOnly?: string;
};

type BuildDefinition = {
  id: string;
  name?: string;
  effects?: Record<string, unknown>;
  abilityMultipliers?: Record<string, number>;
};

type BuildTree = {
  buildUnlockLevel?: number;
  builds?: BuildDefinition[];
};

type TalentNode = {
  talentId: string;
  rankCap?: number;
  requires?: string[];
  requiresAny?: string[];
  exclusiveGroup?: string;
  keystone?: boolean;
};

type TalentTreeCatalog = {
  builds?: Record<string, Record<string, TalentNode[]>>;
};

type Loadout = {
  id: string;
  slot?: string;
  name?: string;
  buildId?: string | null;
  stats?: Record<string, number>;
  talents?: Array<{ id: string; rank: number }>;
  equipment?: Record<string, string | null>;
};

type LoadoutPlayer = PlayerRecord & {
  classId?: string;
  level?: number;
  inventory?: Array<{ itemId?: string; qty?: number }>;
  equipment?: Record<string, string | null>;
  loadouts?: Loadout[];
  talents?: Array<{ id: string; rank: number }>;
  talentPoints?: number;
  statPoints?: number;
  stats?: Record<string, number>;
  activeBuildId?: string | null;
  buildBonuses?: Record<string, unknown>;
  activeLoadoutId?: string | null;
  encounterId?: string | null;
  worldCombatMobId?: string | null;
  dungeon?: unknown;
  lastBuildChange?: { type: string; loadoutId: string; at: number };
};

type InventoryService = {
  recalc(player: LoadoutPlayer): void;
};

type LoadoutServiceDependencies = {
  items: Record<string, ItemDefinition>;
  talents: Record<string, TalentDefinition[]>;
  classBuilds: Record<string, BuildTree>;
  talentTrees: TalentTreeCatalog;
  inventory: InventoryService;
  rebuildTalents(player: LoadoutPlayer): void;
};

export class LoadoutService {
  constructor(private readonly deps: LoadoutServiceDependencies) {}

  ensureStarterInventory(player: LoadoutPlayer): void {
    player.inventory = Array.isArray(player.inventory) ? player.inventory : [];
    for (const itemId of [
      "small_health_potion",
      "ashen_tonic",
      "ashen_homeward_stone",
    ]) {
      if (
        !player.inventory.some(
          (item) => item?.itemId === itemId && Number(item.qty || 0) > 0,
        )
      ) {
        player.inventory.push({
          itemId,
          qty: itemId === "ashen_homeward_stone" ? 1 : 2,
        });
      }
    }
  }

  find(player: LoadoutPlayer, id: unknown): Loadout | null {
    const key = String(id ?? "");
    return (
      (player.loadouts || []).find(
        (loadout) => loadout.id === key || loadout.slot === key,
      ) || null
    );
  }

  apply(
    player: LoadoutPlayer,
    loadout: Loadout | null,
  ): [boolean, string, Record<string, unknown>?] {
    if (!loadout) return [false, "Loadout not found."];
    if (player.encounterId || player.worldCombatMobId || player.dungeon) {
      return [
        false,
        "You cannot change loadouts during combat or inside a dungeon.",
      ];
    }

    const gearError = this.validateGear(player, loadout.equipment);
    if (gearError) return [false, gearError];

    const earnedStatPoints = Math.max(0, (Number(player.level || 1) - 1) * 4);
    if (allocatedStatPoints(loadout.stats || {}) > earnedStatPoints) {
      return [
        false,
        "This loadout contains more stat points than this character has earned.",
      ];
    }

    const talentError = this.validateTalents(player, loadout);
    if (talentError) return [false, talentError];

    const swapError = this.swapEquipment(player, loadout.equipment);
    if (swapError) return [false, swapError];

    this.resetTalents(player);
    player.stats = {
      strength: 10,
      agility: 10,
      intellect: 10,
      vitality: 10,
      willpower: 10,
      ...(loadout.stats || {}),
    };
    player.statPoints = Math.max(
      0,
      earnedStatPoints - allocatedStatPoints(player.stats),
    );

    if (loadout.buildId) {
      const tree = this.deps.classBuilds[player.classId || ""];
      const build = tree?.builds?.find(
        (candidate) => candidate.id === loadout.buildId,
      );
      if (!build) return [false, "This specialization is no longer available."];
      player.activeBuildId = build.id;
      player.buildBonuses = {
        ...(build.effects || {}),
        abilityMultipliers: { ...(build.abilityMultipliers || {}) },
      };
    } else {
      player.activeBuildId = null;
      player.buildBonuses = {};
    }

    player.talents = (loadout.talents || [])
      .map((talent) => ({ id: talent.id, rank: Number(talent.rank || 0) }))
      .filter((talent) => talent.rank > 0);

    const spentTalentPoints = player.talents.reduce((total, owned) => {
      const definition = (this.deps.talents[player.classId || ""] || []).find(
        (talent) => talent.id === owned.id,
      );
      return total + Number(owned.rank || 0) * Number(definition?.cost || 1);
    }, 0);
    player.talentPoints = Math.max(
      0,
      Number(player.level || 1) - 1 - spentTalentPoints,
    );
    this.deps.rebuildTalents(player);
    this.deps.inventory.recalc(player);
    player.activeLoadoutId = loadout.id;
    player.lastBuildChange = {
      type: "loadout",
      loadoutId: loadout.id,
      at: Date.now(),
    };
    return [
      true,
      `Applied loadout: ${loadout.name || loadout.id}.`,
      { loadoutId: loadout.id },
    ];
  }

  applyBuild(
    player: LoadoutPlayer,
    buildId: string,
  ): [boolean, string, Record<string, unknown>?] {
    const tree = this.deps.classBuilds[player.classId || ""];
    if (!tree)
      return [
        false,
        "Specializations are temporarily unavailable for this class.",
      ];
    const build = tree.builds?.find((candidate) => candidate.id === buildId);
    if (!build) return [false, "Unknown specialization build."];
    const unlockLevel = Number(tree.buildUnlockLevel || 10);
    if (Number(player.level || 1) < unlockLevel)
      return [false, `Reach level ${unlockLevel} to choose a specialization.`];
    if (player.encounterId || player.worldCombatMobId || player.dungeon)
      return [
        false,
        "You cannot change specialization during combat or inside a dungeon.",
      ];
    if ((player.talents || []).some((talent) => Number(talent.rank || 0) > 0))
      return [
        false,
        "Reset your talents before changing specialization. Your current tree belongs to the active build.",
      ];
    player.activeBuildId = build.id;
    player.buildBonuses = {
      ...(build.effects || {}),
      abilityMultipliers: { ...(build.abilityMultipliers || {}) },
    };
    this.deps.inventory.recalc(player);
    player.lastBuildChange = {
      type: "specialization",
      loadoutId: build.id,
      at: Date.now(),
    };
    return [
      true,
      `Specialization changed to ${build.name || build.id}.`,
      {
        build,
        talentTree:
          this.deps.talentTrees.builds?.[player.classId || ""]?.[build.id] ||
          [],
      },
    ];
  }
  talentDefinition(
    player: LoadoutPlayer,
    id: unknown,
  ): TalentDefinition | null {
    return (
      (this.deps.talents[player.classId || ""] || []).find(
        (talent) => talent.id === String(id),
      ) || null
    );
  }
  talentNode(player: LoadoutPlayer, id: unknown): TalentNode | null {
    const buildId = player.activeBuildId;
    if (!buildId) return null;
    return (
      this.deps.talentTrees.builds?.[player.classId || ""]?.[buildId]?.find(
        (node) => node.talentId === String(id),
      ) || null
    );
  }
  talentRank(player: LoadoutPlayer, id: unknown): number {
    return Number(
      (player.talents || []).find((talent) => talent.id === String(id))?.rank ||
        0,
    );
  }
  canLearnTalent(
    player: LoadoutPlayer,
    talent: TalentDefinition,
    node: TalentNode | null,
  ): [boolean, string?] {
    if (talent.buildOnly && talent.buildOnly !== player.activeBuildId)
      return [false, "That keystone belongs to another specialization."];
    if (player.activeBuildId && !node)
      return [
        false,
        "That talent is not part of your active specialization tree.",
      ];
    if (Number(player.level || 1) < Number(talent.minLevel || 1))
      return [false, `Reach level ${talent.minLevel} first.`];
    const rank = this.talentRank(player, talent.id),
      cap = Number(node?.rankCap || talent.maxRank || 1);
    if (rank >= Math.min(cap, Number(talent.maxRank || cap)))
      return [false, "Talent is maxed for this specialization."];
    for (const requirement of node?.requires || [])
      if (this.talentRank(player, requirement) < 1)
        return [false, "A prerequisite talent is required first."];
    if (
      node?.requiresAny?.length &&
      !node.requiresAny.some(
        (requirement) => this.talentRank(player, requirement) > 0,
      )
    )
      return [false, "Unlock one of the required branch talents first."];
    if (node?.exclusiveGroup) {
      const conflict = (
        this.deps.talentTrees.builds?.[player.classId || ""]?.[
          player.activeBuildId || ""
        ] || []
      ).find(
        (candidate) =>
          candidate.exclusiveGroup === node.exclusiveGroup &&
          candidate.talentId !== talent.id &&
          this.talentRank(player, candidate.talentId) > 0,
      );
      if (conflict)
        return [
          false,
          "Choose one talent in this branch; reset the tree to change paths.",
        ];
    }
    return [true];
  }

  private swapEquipment(
    player: LoadoutPlayer,
    wanted: Record<string, string | null> | undefined,
  ): string | null {
    const slots = Object.keys(wanted || {});
    if (!slots.length) return null;
    const bag = this.deps.inventory as any;
    if (typeof bag.give !== "function" || typeof bag.remove !== "function")
      return "Equipment swapping is unavailable.";
    const before = {
      inventory: JSON.parse(JSON.stringify(player.inventory || [])),
      equipment: { ...(player.equipment || {}) },
    };
    const restore = (message: string) => {
      player.inventory = before.inventory;
      player.equipment = before.equipment;
      return message;
    };
    player.equipment = { ...(player.equipment || {}) };
    for (const slot of slots) {
      const current = player.equipment[slot] || null,
        want = (wanted as any)[slot] || null;
      if (current === want) continue;
      if (current) {
        if (!bag.give(player, current, 1)) return restore("Your bag is full.");
        player.equipment[slot] = null;
      }
    }
    for (const slot of slots) {
      const want = (wanted as any)[slot] || null;
      if (!want || player.equipment[slot] === want) continue;
      if (!bag.remove(player, want, 1))
        return restore(
          "A piece of this loadout is equipped elsewhere or no longer in your bag.",
        );
      player.equipment[slot] = want;
    }
    return null;
  }

  private validateGear(
    player: LoadoutPlayer,
    equipment: Record<string, string | null> | undefined,
  ): string | null {
    const wanted = Object.values(equipment || {})
      .filter(Boolean)
      .map(String);
    const counts = new Map<string, number>();
    for (const item of player.inventory || []) {
      if (item?.itemId && Number(item.qty || 0) > 0)
        counts.set(
          item.itemId,
          (counts.get(item.itemId) || 0) + Number(item.qty || 0),
        );
    }
    for (const id of Object.values(player.equipment || {})) {
      if (id) counts.set(String(id), (counts.get(String(id)) || 0) + 1);
    }
    const used = new Map<string, number>();
    for (const id of wanted) {
      const definition = this.deps.items[id];
      if (!definition) return `Loadout item ${id} no longer exists.`;
      if (
        definition.class?.length &&
        !definition.class.includes(String(player.classId || ""))
      ) {
        return `${definition.name || id} is not made for your class.`;
      }
      if (Number(definition.level || 1) > Number(player.level || 1)) {
        return `${definition.name || id} requires level ${definition.level}.`;
      }
      used.set(id, (used.get(id) || 0) + 1);
      if ((used.get(id) || 0) > (counts.get(id) || 0))
        return `You no longer own enough copies of ${definition.name || id}.`;
    }
    return null;
  }

  private validateTalents(
    player: LoadoutPlayer,
    loadout: Loadout,
  ): string | null {
    if (!loadout.buildId) return null;
    const tree = this.deps.classBuilds[player.classId || ""];
    const build = tree?.builds?.find(
      (candidate) => candidate.id === loadout.buildId,
    );
    if (!build) return "This specialization is no longer available.";
    if (Number(player.level || 1) < Number(tree.buildUnlockLevel || 10)) {
      return `Reach level ${tree.buildUnlockLevel || 10} to use this specialization.`;
    }
    const nodes =
      this.deps.talentTrees.builds?.[player.classId || ""]?.[loadout.buildId] ||
      [];
    const ranks = new Map<string, number>();
    for (const owned of loadout.talents || []) {
      const definition = (this.deps.talents[player.classId || ""] || []).find(
        (talent) => talent.id === owned.id,
      );
      if (!definition) return `Talent ${owned.id} is no longer available.`;
      const node = nodes.find(
        (candidate) => candidate.talentId === definition.id,
      );
      if (definition.buildOnly && definition.buildOnly !== loadout.buildId)
        return `${definition.name || owned.id} belongs to another specialization.`;
      if (Number(player.level || 1) < Number(definition.minLevel || 1))
        return `${definition.name || owned.id} requires level ${definition.minLevel}.`;
      const cap = Math.min(
        Number(node?.rankCap || definition.maxRank || 1),
        Number(definition.maxRank || 99),
      );
      if (Number(owned.rank || 0) > cap)
        return `${definition.name || owned.id} exceeds its rank cap.`;
      ranks.set(definition.id, Number(owned.rank || 0));
    }
    for (const owned of loadout.talents || []) {
      const node = nodes.find((candidate) => candidate.talentId === owned.id);
      for (const requirement of node?.requires || [])
        if ((ranks.get(requirement) || 0) < 1)
          return `Loadout prerequisite missing for ${owned.id}.`;
      if (
        node?.requiresAny?.length &&
        !node.requiresAny.some((id) => (ranks.get(id) || 0) > 0)
      )
        return `Loadout branch prerequisite missing for ${owned.id}.`;
    }
    return null;
  }

  private resetTalents(player: LoadoutPlayer): void {
    let refund = 0;
    for (const talent of player.talents || []) {
      const definition = (this.deps.talents[player.classId || ""] || []).find(
        (candidate) => candidate.id === talent.id,
      );
      if (definition)
        refund += Number(talent.rank || 0) * Number(definition.cost || 1);
    }
    player.talentPoints = Number(player.talentPoints || 0) + refund;
    player.talents = [];
  }
}
