class ProfessionEngine {
  private recipes: any[];
  private items: Record<string, any>;
  private specializations: Record<string, Record<string, any>>;
  constructor(recipes, items) {
    this.recipes = recipes;
    this.items = items;
    this.specializations = {
      mining: {
        prospector: {
          name: "Prospector",
          description: "+25% chance for an extra ore on successful mining.",
        },
        veinwalker: {
          name: "Veinwalker",
          description: "Depleted veins respawn 25% faster.",
        },
        deepDelver: {
          name: "Deep Delver",
          description:
            "Higher-tier veins have a 12% chance to yield an extra ore.",
        },
      },
      skinning: {
        hideworker: {
          name: "Hideworker",
          description: "+20% chance for an extra hide component.",
        },
        trophyHunter: {
          name: "Trophy Hunter",
          description: "+15% chance for a rare trophy from beasts.",
        },
        fieldDresser: {
          name: "Field Dresser",
          description: "Skinning awards 20% more profession XP.",
        },
      },
      alchemy: {
        distiller: {
          name: "Distiller",
          description: "Alchemy crafts have +10% quality weighting.",
        },
        reagentSaver: {
          name: "Reagent Saver",
          description: "10% chance to save one crafting material.",
        },
        battleBrewer: {
          name: "Battle Brewer",
          description:
            "Combat consumables gain +8% effect from crafting quality.",
        },
      },
      cooking: {
        campfireChef: {
          name: "Campfire Chef",
          description: "Cooking crafts have +10% quality weighting.",
        },
        heartyMeals: {
          name: "Hearty Meals",
          description: "Food restores +8% more from crafting quality.",
        },
        efficientCook: {
          name: "Efficient Cook",
          description: "10% chance to save one cooking material.",
        },
      },
      blacksmith: {
        weaponsmith: {
          name: "Weaponsmith",
          description: "Weapon crafts gain +8% power from crafting quality.",
        },
        armorsmith: {
          name: "Armorsmith",
          description: "Armor crafts gain +8% armor from crafting quality.",
        },
        efficientSmith: {
          name: "Efficient Smith",
          description: "10% chance to save one unit of each crafting material.",
        },
      },
    };
  }
  ensure(p) {
    p.profession = p.profession || { mining: 1, blacksmith: 1 };
    p.professionXp = p.professionXp || { mining: 0, blacksmith: 0 };
    p.professions = p.professions || [];
    p.professionSpecializations = p.professionSpecializations || {
      mining: null,
      blacksmith: null,
    };
    p.knownRecipes =
      p.knownRecipes ||
      this.recipes.filter((r) => Number(r.level || 1) <= 1).map((r) => r.id);
  }
  xpRequired(profession, level) {
    return Math.max(80, Number(level || 1) * 100);
  }
  awardXp(p, profession, amount) {
    this.ensure(p);
    const before = Number(p.profession?.[profession] || 1);
    p.professionXp[profession] = Math.max(
      0,
      Number(p.professionXp?.[profession] || 0) +
        Math.max(0, Number(amount || 0)),
    );
    const discoveries = [];
    while (
      p.professionXp[profession] >=
      this.xpRequired(profession, p.profession[profession])
    ) {
      p.professionXp[profession] -= this.xpRequired(
        profession,
        p.profession[profession],
      );
      p.profession[profession]++;
      if (
        ["blacksmith", "skinning", "alchemy", "cooking"].includes(profession)
      ) {
        for (const r of this.recipes.filter(
          (x) =>
            x.profession === profession &&
            Number(x.level || 1) === p.profession[profession],
        )) {
          if (!p.knownRecipes.includes(r.id)) {
            p.knownRecipes.push(r.id);
            discoveries.push(r.id);
          }
        }
      }
    }
    return {
      level: p.profession[profession],
      gainedLevels: p.profession[profession] - before,
      discoveries,
    };
  }
  canUseSpecialization(p, profession, id) {
    this.ensure(p);
    return (
      !!this.specializations[profession]?.[id] &&
      Number(p.profession?.[profession] || 1) >= 5
    );
  }
  setSpecialization(p, profession, id) {
    if (!this.canUseSpecialization(p, profession, id))
      return [false, `Reach ${profession} 5 to choose a specialization.`];
    const current = p.professionSpecializations[profession];
    if (current === id)
      return [
        true,
        `${this.specializations[profession][id].name} is already your specialization.`,
      ];
    if (current)
      return [false, "Your profession specialization is already chosen."];
    p.professionSpecializations[profession] = id;
    return [
      true,
      `Specialized as ${this.specializations[profession][id].name}.`,
    ];
  }
  knownRecipe(p, recipe) {
    this.ensure(p);
    return p.knownRecipes.includes(recipe.id);
  }
  qualityFor(p, recipe) {
    const skill = Number(p.profession?.[recipe.profession] || 1),
      difficulty = Number(recipe.level || 1);
    let weights: Array<[string, number]> =
      skill >= difficulty + 3
        ? [
            ["poor", 2],
            ["standard", 28],
            ["fine", 48],
            ["masterwork", 22],
          ]
        : skill >= difficulty + 1
          ? [
              ["poor", 5],
              ["standard", 45],
              ["fine", 38],
              ["masterwork", 12],
            ]
          : [
              ["poor", 10],
              ["standard", 55],
              ["fine", 27],
              ["masterwork", 8],
            ];
    if (
      p.professionSpecializations?.blacksmith === "weaponsmith" &&
      this.isWeaponRecipe(recipe)
    )
      weights = weights.map(([q, w]) => [q, q === "masterwork" ? w + 6 : w]);
    if (
      p.professionSpecializations?.blacksmith === "armorsmith" &&
      this.isArmorRecipe(recipe)
    )
      weights = weights.map(([q, w]) => [q, q === "masterwork" ? w + 6 : w]);
    if (
      p.professionSpecializations?.alchemy === "distiller" &&
      recipe.profession === "alchemy"
    )
      weights = weights.map(([q, w]) => [q, q === "masterwork" ? w + 8 : w]);
    if (
      p.professionSpecializations?.cooking === "campfireChef" &&
      recipe.profession === "cooking"
    )
      weights = weights.map(([q, w]) => [q, q === "masterwork" ? w + 8 : w]);
    const total = weights.reduce((n, x) => n + x[1], 0);
    let r = Math.random() * total;
    for (const [q, w] of weights) {
      r -= w;
      if (r <= 0) return q;
    }
    return "standard";
  }
  isWeaponRecipe(recipe) {
    const it = this.items[recipe.output];
    return ["weapon", "shield"].includes(it?.type);
  }
  isArmorRecipe(recipe) {
    const it = this.items[recipe.output];
    return ["helmet", "chest", "shoulders", "gloves", "boots"].includes(
      it?.type,
    );
  }
  materialPlan(p, recipe) {
    const efficient =
      p.professionSpecializations?.blacksmith === "efficientSmith";
    const saveChance = efficient ? 0.1 : 0;
    return (recipe.materials || []).map((m) => {
      const required = Math.max(1, Number(m.qty || 1));
      const saved =
        efficient && required > 1 && Math.random() < saveChance ? 1 : 0;
      return { itemId: m.itemId, qty: Math.max(1, required - saved), saved };
    });
  }
  miningYield(p, ore) {
    this.ensure(p);
    let qty = ore.level >= 6 ? 2 : 1;
    if (
      p.professionSpecializations?.mining === "prospector" &&
      Math.random() < 0.25
    )
      qty++;
    if (
      p.professionSpecializations?.mining === "deepDelver" &&
      ore.level >= 5 &&
      Math.random() < 0.12
    )
      qty++;
    return qty;
  }
  skinningYield(p, mob) {
    this.ensure(p);
    let qty = 1;
    if (
      p.professionSpecializations?.skinning === "hideworker" &&
      Math.random() < 0.2
    )
      qty++;
    return qty;
  }
  skinningXp(p, base) {
    return (
      Number(base || 10) *
      (p.professionSpecializations?.skinning === "fieldDresser" ? 1.2 : 1)
    );
  }
  materialPlanForRecipe(p, recipe) {
    const saver = ["efficientSmith", "reagentSaver", "efficientCook"].includes(
      p.professionSpecializations?.[recipe.profession],
    );
    return (recipe.materials || []).map((m) => {
      const required = Math.max(1, Number(m.qty || 1));
      const saved = saver && required > 1 && Math.random() < 0.1 ? 1 : 0;
      return { itemId: m.itemId, qty: Math.max(1, required - saved), saved };
    });
  }
  miningRespawn(p, ore) {
    const base = Number(ore.baseRespawn || ore.respawn || 15000);
    return Math.round(
      base * (p.professionSpecializations?.mining === "veinwalker" ? 0.75 : 1),
    );
  }
}
export { ProfessionEngine };
