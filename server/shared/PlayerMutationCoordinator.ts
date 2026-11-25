import { AsyncLocalStorage } from "node:async_hooks";

export class PlayerMutationCoordinator {
  private tails = new Map<string, Promise<void>>();
  private readonly heldKeys = new AsyncLocalStorage<Set<string>>();

  async withPlayer<T>(playerId: string, fn: () => Promise<T> | T): Promise<T> {
    const key = String(playerId);
    const held = this.heldKeys.getStore();
    if (held?.has(key)) return await fn();

    const prior = this.tails.get(key) || Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prior.then(() => gate);
    this.tails.set(key, tail);
    return this.heldKeys.run(new Set([...(held || []), key]), async () => {
      await prior;
      try {
        return await fn();
      } finally {
        release();
        if (this.tails.get(key) === tail) this.tails.delete(key);
      }
    });
  }

  async withPlayers<T>(
    playerIds: unknown[],
    fn: () => Promise<T> | T,
  ): Promise<T> {
    const ids = [
      ...new Set((playerIds || []).filter((x) => x != null).map(String)),
    ].sort();
    const acquire = (index: number): Promise<T> =>
      index >= ids.length
        ? Promise.resolve().then(fn)
        : this.withPlayer(ids[index], () => acquire(index + 1));
    return acquire(0);
  }

  isLocked(playerId: string): boolean {
    return this.tails.has(String(playerId));
  }

  get pendingKeys(): number {
    return this.tails.size;
  }
}
