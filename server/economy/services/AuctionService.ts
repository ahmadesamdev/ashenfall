export interface AuctionServiceHost {
  list(...args: any[]): Promise<any>;
  cancel(...args: any[]): Promise<any>;
  bid(...args: any[]): Promise<any>;
  buy(...args: any[]): Promise<any>;
  search(...args: any[]): any;
  cleanup(...args: any[]): Promise<any>;
}
export class AuctionService {
  constructor(private readonly host: AuctionServiceHost) {}
  search(filters: any = {}) {
    return this.host.search(filters);
  }
  list(...args: any[]) {
    return this.host.list(...args);
  }
  cancel(...args: any[]) {
    return this.host.cancel(...args);
  }
  bid(...args: any[]) {
    return this.host.bid(...args);
  }
  buy(...args: any[]) {
    return this.host.buy(...args);
  }
  cleanup(...args: any[]) {
    return this.host.cleanup(...args);
  }
}
