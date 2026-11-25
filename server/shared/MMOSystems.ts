import { integrationSummary } from "./IntegrationCoordinator.js";

export class MMOSystems {
  constructor(public data: any = {}) {}
  zoneProgression(level: number, zoneId: string) {
    const z = (this.data.worldZoneProgression?.zones || []).find(
      (x: any) => x.id === zoneId,
    );
    if (!z) return { eligible: false, reason: "unknown_zone" };
    const lv = Math.floor(Number(level) || 1);
    return {
      eligible: lv >= z.minLevel,
      band: z.band,
      minLevel: z.minLevel,
      maxLevel: z.maxLevel,
      next: z.next || [],
      overLevel: lv > z.maxLevel,
    };
  }
  dungeonTier(level: number) {
    const lv = Math.floor(Number(level) || 1);
    const tiers = this.data.dungeonProgression?.tiers || [];
    return (
      [...tiers].reverse().find((t: any) => lv >= t.minLevel) ||
      tiers[0] ||
      null
    );
  }
  snapshot(p: any) {
    return {
      version: 1,
      world: this.zoneProgression(p?.level, p?.zone),
      dungeonTier: this.dungeonTier(p?.level),
      exploration: {
        discoveries: Array.isArray(p?.regionDiscoveries)
          ? p.regionDiscoveries.length
          : 0,
      },
      professions: {
        levels: p?.profession || {},
        specializations: p?.professionSpecializations || {},
      },
      economy: { gold: Number(p?.gold || 0) },
      endgame: {
        levelCap: Number(this.data.endgameProgression?.levelCap || 60),
        level60: Number(p?.level || 1) >= 60,
        ...integrationSummary(p),
      },
      pvp: {
        honor: Number(p?.pvpStats?.honor || 0),
        kills: Number(p?.pvpStats?.kills || 0),
        deaths: Number(p?.pvpStats?.deaths || 0),
      },
      worldEvent: null,
      achievements: {
        version: this.data.achievementsCollections?.version || 1,
      },
      ui: { contractVersion: this.data.uiUx?.stateContractVersion || 1 },
    };
  }
}
