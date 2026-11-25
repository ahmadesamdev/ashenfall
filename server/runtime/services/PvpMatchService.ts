export class PvpMatchService {
  constructor(private readonly queue: any) {}
  enqueueArena(...args: any[]) {
    return this.queue.enqueueArena(...args);
  }
  leaveArena(...args: any[]) {
    return this.queue.leaveArenaQueue(...args);
  }
  startBattleground(...args: any[]) {
    return this.queue.startBattleground(...args);
  }
  snapshot(...args: any[]) {
    return this.queue.pvpSnapshot(...args);
  }
  finishDuel(...args: any[]) {
    return this.queue.finishDuel(...args);
  }
  finishArena(...args: any[]) {
    return this.queue.finishArena(...args);
  }
}
