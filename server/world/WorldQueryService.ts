export class WorldQueryService {
  private readonly mobTypes: Set<string>;
  constructor(private readonly world: any) {
    this.mobTypes = new Set(
      (world.mobDefs || [])
        .map((d: any) => String(d?.type || ""))
        .filter(Boolean),
    );
  }
  sameDungeonInstance(m: any, p: any): boolean {
    if (!m?.dungeonId) return true;
    return (
      !!p?.dungeon?.instanceId && m.dungeonInstanceId === p.dungeon.instanceId
    );
  }
  isRenderableMob(m: any, p: any = null): boolean {
    return (
      !!m &&
      m.state !== "dead" &&
      Number.isFinite(Number(m.x)) &&
      Number.isFinite(Number(m.y)) &&
      Number.isFinite(Number(m.hp)) &&
      Number(m.hp) > 0 &&
      Number.isFinite(Number(m.maxHp)) &&
      Number(m.maxHp) > 0 &&
      !!m.type &&
      this.mobTypes.has(String(m.type)) &&
      this.sameDungeonInstance(m, p)
    );
  }
  zoneMobs(zone: string, p: any = null): any[] {
    return [...this.world.mobs.values()].filter(
      (m: any) => m.zone === zone && this.isRenderableMob(m, p),
    );
  }
  zoneLoot(zone: string): any[] {
    return [...this.world.lootPiles.values()].filter(
      (x: any) => x.zone === zone,
    );
  }
  zoneNpcs(zone: string): any[] {
    return this.world.npcs.filter((n: any) => n.zone === zone);
  }
  zoneGates(zone: string): any[] {
    return this.world.gates[zone] || [];
  }
  byIdMob(id: string): any {
    return this.world.mobs.get(id);
  }
}
