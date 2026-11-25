export class InventoryStorage {
  constructor(private readonly inventory: any) {}
  give(...args: any[]) {
    return this.inventory.give(...args);
  }
  remove(...args: any[]) {
    return this.inventory.remove(...args);
  }
  has(...args: any[]) {
    return this.inventory.has(...args);
  }
  canGive(...args: any[]) {
    return this.inventory.canGive(...args);
  }
  canGiveMany(...args: any[]) {
    return this.inventory.canGiveMany(...args);
  }
}
