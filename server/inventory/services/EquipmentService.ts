export class EquipmentService {
  constructor(private readonly inventory: any) {}
  equippedIds(...args: any[]) {
    return this.inventory.equippedIds(...args);
  }
  gearSlotForItem(...args: any[]) {
    return this.inventory.gearSlotForItem(...args);
  }
  socketGem(...args: any[]) {
    return this.inventory.socketGem(...args);
  }
  removeGem(...args: any[]) {
    return this.inventory.removeGem(...args);
  }
  enchantItem(...args: any[]) {
    return this.inventory.enchantItem(...args);
  }
  clearEnchant(...args: any[]) {
    return this.inventory.clearEnchant(...args);
  }
  recalc(...args: any[]) {
    return this.inventory.recalc(...args);
  }
}
