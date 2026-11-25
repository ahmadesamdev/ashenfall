import crypto from "node:crypto";

export class DurableOutboxWorker {
  private readonly consumerId = `ashenfall-outbox-${crypto.randomUUID()}`;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private idlePolls = 0;
  private stopped = false;
  private readonly repo: any;
  private readonly worldSimulation: any;
  private readonly isOwner: () => boolean;
  private readonly intervalMs: number;
  constructor(
    repo: any,
    worldSimulation: any,
    isOwner: () => boolean,
    intervalMs = 1000,
  ) {
    this.repo = repo;
    this.worldSimulation = worldSimulation;
    this.isOwner = isOwner;
    this.intervalMs = intervalMs;
  }

  start() {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
    this.timer.unref?.();
    void this.drain();
  }

  async drain() {
    if (
      this.running ||
      this.stopped ||
      !this.isOwner() ||
      typeof this.repo.claimOutbox !== "function"
    )
      return;
    // Back off while the queue is empty (every 5th poll) so an idle server doesn't query the database every second.
    if (this.idlePolls > 0) {
      this.idlePolls--;
      return;
    }
    this.running = true;
    try {
      const events = await this.repo.claimOutbox(
        this.consumerId,
        25,
        Date.now(),
      );
      this.idlePolls = events.length ? 0 : 4;
      for (const event of events) {
        if (!this.isOwner()) break;
        try {
          await this.consume(event);
          await this.repo.completeOutbox(event.id, this.consumerId, Date.now());
        } catch (error: any) {
          await this.repo.failOutbox(
            event.id,
            this.consumerId,
            String(error?.stack || error?.message || error),
            Date.now(),
          );
        }
      }
    } catch (error) {
      console.warn("Durable outbox polling failed:", error);
    } finally {
      this.running = false;
    }
  }

  private async consume(event: any) {
    const payload =
      event?.payload && typeof event.payload === "object" ? event.payload : {};
    const player =
      payload.player && typeof payload.player === "object"
        ? payload.player
        : null;
    const playerId = String(payload.playerId || player?.id || "");
    const zone = String(player?.zone || payload.zone || "");
    const dungeon = event.type === "dungeon.completion_committed";
    if (event.type !== "reward.player_committed" && !dungeon) {
      throw new Error(
        `No idempotent consumer is registered for outbox event type "${String(event.type)}".`,
      );
    }
    if (typeof this.worldSimulation?.record !== "function")
      throw new Error("World simulation cannot consume durable outbox events.");
    const now = Date.now();
    this.worldSimulation.record({
      id: `outbox:${event.id}`,
      type: dungeon ? "dungeon_completion_committed" : "reward_committed",
      source: "durable_outbox",
      actorId:
        playerId ||
        (Array.isArray(payload.memberIds)
          ? String(payload.memberIds[0] || "")
          : null) ||
        null,
      regionId: null,
      simulationTick: Number(
        this.worldSimulation?.snapshot?.()?.simulationTick || 0,
      ),
      worldTime: now,
      payload: dungeon
        ? {
            zone,
            dungeonId: payload.dungeonId || payload.result?.dungeonId || null,
            instanceId: payload.instanceId || null,
            participantIds: payload.memberIds || [],
            outcome: "completed",
            reconciliation: true,
          }
        : {
            rewardKey: payload.rewardKey || null,
            playerId,
            zone,
            outcome: "committed",
            reconciliation: true,
          },
      causes: [],
      consequenceIds: [],
      severity: dungeon ? "historical" : "local",
    });
    await this.worldSimulation?.checkpoint?.(Date.now());
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
