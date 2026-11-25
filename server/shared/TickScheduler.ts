export function createFixedTickScheduler(
  task: (scheduledAt: number) => void,
  intervalMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let nextAt = 0;

  const schedule = () => {
    if (!running) return;
    const delay = Math.max(0, nextAt - Date.now());
    timer = setTimeout(run, delay);
    (timer as any).unref?.();
  };

  const run = () => {
    if (!running) return;
    const scheduledAt = nextAt;
    nextAt += intervalMs;
    try {
      task(scheduledAt);
    } finally {
      const now = Date.now();
      if (nextAt < now - intervalMs * 4) nextAt = now + intervalMs;
      schedule();
    }
  };

  return {
    start() {
      if (running) return;
      running = true;
      nextAt = Date.now() + intervalMs;
      schedule();
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
