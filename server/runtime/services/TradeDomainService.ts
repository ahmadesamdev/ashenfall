export class TradeDomainService {
  constructor(private readonly trade: any) {}
  state(...args: any[]) {
    return this.trade.tradeState(...args);
  }
  offer(...args: any[]) {
    return this.trade.tradeOffer(...args);
  }
  complete(...args: any[]) {
    return this.trade.completeTrade(...args);
  }
  distanceOk(...args: any[]) {
    return this.trade.tradeDistanceOk(...args);
  }
}
