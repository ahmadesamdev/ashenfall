export type EventHandler = (payload: any) => void;
export class EventBus {
  listeners = new Map<string, Set<EventHandler>>();
  on(name: string, fn: EventHandler) {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return () => set?.delete(fn);
  }
  once(name: string, fn: EventHandler) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }
  off(name: string, fn: EventHandler) {
    this.listeners.get(name)?.delete(fn);
  }
  emit(name: string, payload: any = {}) {
    for (const fn of this.listeners.get(name) || [])
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus:${name}]`, err);
      }
  }
  clear(name?: string) {
    if (name) this.listeners.delete(name);
    else this.listeners.clear();
  }
}
