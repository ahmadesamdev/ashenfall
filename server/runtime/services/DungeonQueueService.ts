export class DungeonQueueService {
  constructor(private readonly queue: any) {}
  enqueue(...args: any[]) {
    return this.queue.enqueueDungeon(...args);
  }
  enqueueParty(...args: any[]) {
    return this.queue.enqueueParty(...args);
  }
  leave(...args: any[]) {
    return this.queue.leavePartyQueue(...args);
  }
  accept(...args: any[]) {
    return this.queue.acceptDungeonMatch(...args);
  }
  decline(...args: any[]) {
    return this.queue.declineDungeonMatch(...args);
  }
  snapshot(...args: any[]) {
    return this.queue.dungeonSnapshot(...args);
  }
  tryMatch(...args: any[]) {
    return this.queue.tryMatchDungeon(...args);
  }
}
