export class ClientAuthoritativeState {
  private value: any = null;
  private revision = -1;
  private lastAt = 0;

  constructor(private readonly clock = () => performance.now()) {}

  get(): any {
    return this.value;
  }
  getRevision(): number {
    return this.revision;
  }
  getLastAt(): number {
    return this.lastAt;
  }

  normalizeCatalog(catalog: any): any {
    if (!catalog || typeof catalog !== "object") return catalog;
    const index = (value: any) => {
      if (!Array.isArray(value)) return value;
      for (const entry of value) {
        if (entry && entry.id != null) {
          try {
            value[String(entry.id)] = entry;
          } catch {}
        }
      }
      return value;
    };
    for (const key of [
      "classes",
      "abilities",
      "items",
      "dungeons",
      "quests",
      "recipes",
      "storyline",
      "worldStory",
      "worldPoi",
      "worldZoneProgression",
      "talentTransformations",
      "classBuilds",
      "buildEncounterProfiles",
      "combatResources",
      "combatRotations",
    ]) {
      if (key in catalog) index(catalog[key]);
    }
    return catalog;
  }

  normalize(next: any): any {
    if (!next || typeof next !== "object") return next;
    if (next.catalog) next.catalog = this.normalizeCatalog(next.catalog);
    if (Array.isArray(next.zones))
      next.zones = next.zones.filter((z: any) => z && z.id);
    if (next.player && typeof next.player === "object") {
      next.player.achievements = Array.isArray(next.player.achievements)
        ? next.player.achievements
        : [];
      next.player.inventory = Array.isArray(next.player.inventory)
        ? next.player.inventory
        : [];
      next.player.quests =
        next.player.quests && typeof next.player.quests === "object"
          ? next.player.quests
          : {};
      next.player.abilityIds = Array.isArray(next.player.abilityIds)
        ? next.player.abilityIds
        : [];
      next.player.learnedSkills = Array.isArray(next.player.learnedSkills)
        ? next.player.learnedSkills
        : [];
    }
    return next;
  }

  apply(next: any): boolean {
    if (!next || typeof next !== "object") return false;
    next = this.normalize(next);
    const incoming = Number(next.stateRevision ?? -1);
    if (incoming >= 0 && incoming < this.revision) return false;
    const previous = this.value;
    this.value =
      previous && typeof previous === "object"
        ? {
            ...previous,
            ...next,
            catalog: this.normalizeCatalog(next.catalog ?? previous.catalog),
            zones: next.zones ?? previous.zones,
            worldRegions: next.worldRegions ?? previous.worldRegions,
            worldMapNpcs: next.worldMapNpcs ?? previous.worldMapNpcs,
            worldMapGates: next.worldMapGates ?? previous.worldMapGates,
            auctions: next.auctions ?? previous.auctions,
            myAuctions: next.myAuctions ?? previous.myAuctions,
            mail: next.mail ?? previous.mail,
            chat: next.chat ?? previous.chat,
          }
        : next;
    if (incoming >= 0) this.revision = incoming;
    this.lastAt = this.clock();
    return true;
  }

  replace(value: any): void {
    this.value = this.normalize(value);
  }
}
