export function finiteNumber(
  value: unknown,
  fallback?: number,
): number | undefined {
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(n)) return n;
  return fallback;
}

export function boundedInt(
  value: unknown,
  min: number,
  max: number,
  fallback = min,
): number {
  const n = finiteNumber(value, fallback) ?? fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export function boundedString(
  value: unknown,
  maxLength: number,
  fallback = "",
): string {
  if (typeof value !== "string") return fallback;
  return value.slice(0, maxLength);
}

export function assertUniqueIds(items: unknown, label: string): void {
  const visit = (value: unknown, path = label): void => {
    if (Array.isArray(value)) {
      const seen = new Set<string>();
      for (let i = 0; i < value.length; i++) {
        const entry = value[i];
        if (entry && typeof entry === "object" && !Array.isArray(entry)) {
          const record = entry as Record<string, unknown>;
          const hasRecordId =
            Object.prototype.hasOwnProperty.call(record, "id") ||
            Object.prototype.hasOwnProperty.call(record, "type");
          if (hasRecordId) {
            const rawId = record.id ?? record.type;
            const id = String(rawId ?? "").trim();
            if (!id) throw new Error(`${path}[${i}]: entry is missing an id.`);
            if (seen.has(id))
              throw new Error(`${label}: duplicate id "${id}" in ${path}.`);
            seen.add(id);
            continue;
          }
        }
        visit(entry, `${path}[${i}]`);
      }
      return;
    }
    if (!value || typeof value !== "object") return;

    const record = value as Record<string, unknown>;
    const hasRecordId =
      Object.prototype.hasOwnProperty.call(record, "id") ||
      Object.prototype.hasOwnProperty.call(record, "type");
    if (hasRecordId) {
      const rawId = record.id ?? record.type;
      const id = String(rawId ?? "").trim();
      if (!id) throw new Error(`${path}: entry is missing an id.`);
      return;
    }

    for (const [key, child] of Object.entries(record)) {
      visit(child, `${path}.${key}`);
    }
  };

  visit(items);
}

export function createRequestDedupe(limit = 256, ttlMs = 30_000) {
  const seen = new Map<string, { value: any; expiresAt: number }>();
  const prune = (now: number) => {
    for (const [key, entry] of seen) {
      if (entry.expiresAt <= now) seen.delete(key);
      else break;
    }
  };
  return {
    get(id: unknown, now = Date.now()) {
      if (!id) return undefined;
      prune(now);
      const entry = seen.get(String(id));
      return entry && entry.expiresAt > now ? entry.value : undefined;
    },
    set(id: unknown, value: any, now = Date.now()) {
      if (!id) return;
      prune(now);
      const key = String(id);
      seen.delete(key);
      seen.set(key, { value, expiresAt: now + ttlMs });
      while (seen.size > limit) seen.delete(seen.keys().next().value!);
    },
  };
}

export function createSerialExecutor(maxQueueDepth = 256) {
  let tail: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    get pending() {
      return pending;
    },
    run<T>(task: () => Promise<T> | T): Promise<T> {
      if (pending >= maxQueueDepth)
        return Promise.reject(new Error("Command queue is full."));
      pending++;
      const next = tail.then(task, task);
      tail = next.then(
        () => undefined,
        () => undefined,
      );
      return next.finally(() => {
        pending--;
      });
    },
  };
}

export function createWindowRateLimiter(limit = 120, windowMs = 1000) {
  const hits: number[] = [];
  return {
    allow(now = Date.now()) {
      while (hits.length && hits[0] <= now - windowMs) hits.shift();
      if (hits.length >= limit) return false;
      hits.push(now);
      return true;
    },
    remaining(now = Date.now()) {
      while (hits.length && hits[0] <= now - windowMs) hits.shift();
      return Math.max(0, limit - hits.length);
    },
  };
}
