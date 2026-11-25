export class ItemStatService {
  constructor(private readonly inventory: any) {}
  enhancementStats(...args: any[]) {
    return this.inventory.enhancementStats(...args);
  }
  itemGearScore(...args: any[]) {
    return this.inventory.itemGearScore(...args);
  }
  itemBuildScore(...args: any[]) {
    return this.inventory.itemBuildScore(...args);
  }
  gearSetBonuses(...args: any[]) {
    return this.inventory.gearSetBonuses(...args);
  }
  gearSynergyFor(...args: any[]) {
    return this.inventory.gearSynergyFor(...args);
  }
  gearEffectState(...args: any[]) {
    return this.inventory.gearEffectState(...args);
  }
}
