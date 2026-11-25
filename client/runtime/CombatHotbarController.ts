export interface CombatHotbarControllerOptions {
  getState: () => any;
  onChanged: () => void;
  notify: (message: string) => void;
}

export class CombatHotbarController {
  private readonly key = "ashenfall.hotbar.v125";
  constructor(private readonly o: CombatHotbarControllerOptions) {}

  loadout(): any[] {
    const state = this.o.getState();
    const abilities = state?.player?.abilityIds || [];
    const allowed = new Set(abilities);
    try {
      const raw = JSON.parse(localStorage.getItem(this.key) || "null");
      if (
        raw &&
        raw.classId === state?.player?.classId &&
        Array.isArray(raw.slots) &&
        raw.slots.length === 18
      ) {
        const cleaned = raw.slots.map((slot: any) => {
          if (!slot) return null;
          if (slot.kind === "ability" && !allowed.has(slot.id)) return null;
          if (slot.kind === "item" && !state.catalog.items[slot.id])
            return null;
          return slot;
        });
        if (
          cleaned.filter((x: any) => x?.kind === "ability").length <
          Math.min(3, abilities.length)
        ) {
          let index = 0;
          for (const id of abilities.slice(0, 3)) {
            if (cleaned.some((x: any) => x?.kind === "ability" && x.id === id))
              continue;
            while (index < 18 && cleaned[index]) index++;
            if (index < 18) cleaned[index] = { kind: "ability", id };
          }
        }
        if (
          cleaned.some(
            (value: any, i: number) =>
              JSON.stringify(value) !== JSON.stringify(raw.slots[i]),
          )
        )
          this.save(cleaned);
        return cleaned;
      }
    } catch {}
    const defaults = Array(18).fill(null);
    abilities
      .slice(0, 3)
      .forEach(
        (id: string, i: number) => (defaults[i] = { kind: "ability", id }),
      );
    this.save(defaults);
    return defaults;
  }

  save(slots: any[]): void {
    const state = this.o.getState();
    localStorage.setItem(
      this.key,
      JSON.stringify({ classId: state?.player?.classId || "vanguard", slots }),
    );
  }

  clear(slot: number): void {
    const slots = this.loadout();
    if (slot < 0 || slot >= slots.length) return;
    slots[slot] = null;
    this.save(slots);
    this.o.onChanged();
  }

  assign(kind: string, id: string, slot: number): void {
    const slots = this.loadout();
    if (slot < 0 || slot >= slots.length) return;
    slots[slot] = { kind, id };
    this.save(slots);
    this.o.onChanged();
    this.o.notify(
      `${kind === "item" ? "Item" : "Skill"} placed in slot ${(slot % 9) + 1}.`,
    );
  }
}
