export interface EconomyStateSnapshot {
  auctions: any[];
  mail: Record<string, any[]>;
  saleHistory: any[];
}
export class EconomyStateStore {
  auctions = new Map<string, any>();
  mail = new Map<string, any[]>();
  saleHistory: any[] = [];
  sequence = 0;
  auctionLocks = new Map<string, Promise<void>>();
  playerLocks = new Map<string, Promise<void>>();
  snapshot(): EconomyStateSnapshot {
    return {
      auctions: [...this.auctions.values()],
      mail: Object.fromEntries(this.mail.entries()),
      saleHistory: this.saleHistory.slice(-20000),
    };
  }
}
