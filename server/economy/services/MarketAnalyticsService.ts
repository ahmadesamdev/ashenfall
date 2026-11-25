export interface MarketAnalyticsHost {
  marketStats(...args: any[]): any;
  sellerHistory(...args: any[]): any;
  recordSale(...args: any[]): any;
}
export class MarketAnalyticsService {
  constructor(private readonly host: MarketAnalyticsHost) {}
  stats(...args: any[]) {
    return this.host.marketStats(...args);
  }
  sellerHistory(...args: any[]) {
    return this.host.sellerHistory(...args);
  }
  recordSale(...args: any[]) {
    return this.host.recordSale(...args);
  }
}
