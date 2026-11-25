export class Telemetry {
  startedAt = Date.now();
  commands = { total: 0, accepted: 0, rejected: 0, errors: 0 };
  websocket = { connections: 0, accepted: 0, rejected: 0, closed: 0 };
  persistence = { checkpoints: 0, failures: 0, lastFailureAt: 0 };
  tick = { samples: 0, totalMs: 0, maxMs: 0, overruns: 0 };
  commandRejections = new Map<string, number>();
  recordCommand(action: string, ok: boolean, error = false) {
    this.commands.total++;
    if (ok) this.commands.accepted++;
    else {
      this.commands.rejected++;
      const k = String(action || "unknown");
      this.commandRejections.set(k, (this.commandRejections.get(k) || 0) + 1);
    }
    if (error) this.commands.errors++;
  }
  recordSocket(accepted: boolean) {
    if (accepted) {
      this.websocket.connections++;
      this.websocket.accepted++;
    } else this.websocket.rejected++;
  }
  recordClose() {
    this.websocket.connections = Math.max(0, this.websocket.connections - 1);
    this.websocket.closed++;
  }
  recordCheckpoint(ok: boolean) {
    if (ok) this.persistence.checkpoints++;
    else {
      this.persistence.failures++;
      this.persistence.lastFailureAt = Date.now();
    }
  }
  recordTick(ms: number, overrun: boolean) {
    this.tick.samples++;
    this.tick.totalMs += Math.max(0, Number(ms) || 0);
    this.tick.maxMs = Math.max(this.tick.maxMs, Number(ms) || 0);
    if (overrun) this.tick.overruns++;
  }
  snapshot() {
    return {
      uptimeMs: Date.now() - this.startedAt,
      commands: {
        ...this.commands,
        rejectionTop: [...this.commandRejections.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      },
      websocket: { ...this.websocket },
      persistence: { ...this.persistence },
      tick: {
        ...this.tick,
        avgMs: this.tick.samples ? this.tick.totalMs / this.tick.samples : 0,
      },
    };
  }
}
