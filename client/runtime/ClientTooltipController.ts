export interface ClientTooltipControllerOptions {
  getElement: (id: string) => any;
  getState: () => any;
  getTip: () => any;
  getItemTooltip: (item: any) => string;
}
export class ClientTooltipController {
  constructor(private readonly o: ClientTooltipControllerOptions) {}
  show(el: any, e: MouseEvent) {
    const tip = this.o.getTip();
    if (!tip) return;
    const state = this.o.getState();
    const itemId = el?.dataset?.itemTip;
    const item = itemId ? state?.catalog?.items?.[itemId] : null;
    const label =
      el?.dataset?.tip ||
      el?.getAttribute?.("aria-label") ||
      el?.querySelector?.("span")?.textContent?.trim() ||
      el?.getAttribute?.("title");
    if (!item && !label) {
      tip.style.display = "none";
      return;
    }
    if (item) tip.innerHTML = this.o.getItemTooltip(item);
    else tip.textContent = label;
    tip.style.display = "block";
    const width = Math.min(
      360,
      Math.max(220, tip.getBoundingClientRect().width || 260),
    );
    const height = Math.max(40, tip.getBoundingClientRect().height || 48);
    const gap = 12;
    let x = Number(e.clientX || 0) + 14;
    let y = Number(e.clientY || 0) - height - gap;
    if (y < 8) y = Number(e.clientY || 0) + 14;
    x = Math.min(innerWidth - width - 8, Math.max(8, x));
    y = Math.min(innerHeight - height - 8, Math.max(8, y));
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
}
