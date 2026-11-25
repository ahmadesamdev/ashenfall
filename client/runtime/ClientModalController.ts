export interface ClientModalControllerDeps {
  getElement: (id: string) => HTMLElement | null;
  modalIds: readonly string[];
  getInteractionAnchorId: () => string | null;
  clearInteractionAnchor: () => void;
  setWorldMapOpen: (open: boolean) => void;
}

export class ClientModalController {
  private stack: string[] = [];
  constructor(private readonly d: ClientModalControllerDeps) {}

  getOpenModals(): HTMLElement[] {
    return this.d.modalIds
      .map((id) => this.d.getElement(id))
      .filter((m): m is HTMLElement => !!m && !m.classList.contains("hidden"));
  }

  syncZOrder(): void {
    this.stack = this.stack.filter((id) => {
      const modal = this.d.getElement(id);
      return !!modal && !modal.classList.contains("hidden");
    });
    this.stack.forEach((id, index) =>
      this.d
        .getElement(id)
        ?.style.setProperty("z-index", String(1001 + index), "important"),
    );
  }

  bringToFront(id: string): void {
    const modal = this.d.getElement(id);
    if (!modal || modal.classList.contains("hidden")) return;
    this.stack = this.stack.filter((existing) => existing !== id);
    this.stack.push(id);
    this.syncZOrder();
  }

  open(id: string): HTMLElement | null {
    const modal = this.d.getElement(id);
    if (!modal) return null;
    const wasHidden = modal.classList.contains("hidden");
    const card = modal.querySelector<HTMLElement>(".modal-card");
    if (wasHidden) this.resetPosition(card);
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    this.bringToFront(id);
    document.body.classList.add("modal-open");
    window.dispatchEvent(
      new CustomEvent("ashenfall-modal-state", { detail: { id, open: true } }),
    );
    return modal;
  }

  close(id: string): void {
    const modal = this.d.getElement(id);
    if (!modal) return;
    if (
      [
        "npcModal",
        "shopModal",
        "trainerModal",
        "questModal",
        "auctionModal",
      ].includes(id) &&
      this.d.getInteractionAnchorId()
    ) {
      this.d.clearInteractionAnchor();
    }
    this.stack = this.stack.filter((existing) => existing !== id);
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
    modal.style.zIndex = "";
    this.resetPosition(modal.querySelector<HTMLElement>(".modal-card"));
    if (id === "worldMapModal") this.d.setWorldMapOpen(false);
    this.syncZOrder();
    if (!this.getOpenModals().length)
      document.body.classList.remove("modal-open");
    window.dispatchEvent(
      new CustomEvent("ashenfall-modal-state", { detail: { id, open: false } }),
    );
  }

  closeTop(): boolean {
    this.syncZOrder();
    while (this.stack.length) {
      const id = this.stack[this.stack.length - 1];
      const modal = this.d.getElement(id);
      this.stack.pop();
      if (modal && !modal.classList.contains("hidden")) {
        this.close(id);
        return true;
      }
    }
    const open = this.getOpenModals();
    if (!open.length) return false;
    this.bringToFront(open[open.length - 1].id);
    this.close(open[open.length - 1].id);
    return true;
  }

  closeAll(): void {
    this.getOpenModals().forEach((modal) => this.close(modal.id));
    this.stack = [];
  }

  resetPosition(card: HTMLElement | null): void {
    if (!card) return;
    card.style.position = "";
    card.style.removeProperty("left");
    card.style.removeProperty("top");
    card.style.margin = "";
    card.style.transform = "";
    card.style.willChange = "";
    card.classList.remove("dragging", "is-drag-positioned");
  }

  bindMovableWindows(): void {
    document.querySelectorAll<HTMLElement>(".modal-card").forEach((card) => {
      const head = card.querySelector<HTMLElement>(".modal-head");
      if (!head || head.dataset.dragBound) return;
      head.dataset.dragBound = "1";
      let drag: {
        offsetX: number;
        offsetY: number;
        pointerId: number;
        nextLeft: number;
        nextTop: number;
      } | null = null;
      let raf = 0;
      const flush = () => {
        raf = 0;
        if (!drag) return;
        card.style.setProperty(
          "left",
          `${Math.round(drag.nextLeft)}px`,
          "important",
        );
        card.style.setProperty(
          "top",
          `${Math.round(drag.nextTop)}px`,
          "important",
        );
      };
      const endDrag = () => {
        if (!drag) return;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        card.style.setProperty(
          "left",
          `${Math.round(drag.nextLeft)}px`,
          "important",
        );
        card.style.setProperty(
          "top",
          `${Math.round(drag.nextTop)}px`,
          "important",
        );
        card.style.transform = "none";
        card.style.margin = "0";
        card.style.willChange = "";
        head.releasePointerCapture?.(drag.pointerId);
        card.classList.remove("dragging");
        head.classList.remove("dragging-window");
        document.body.classList.remove("ashen-window-dragging");
        drag = null;
      };
      head.addEventListener("pointerdown", (event: PointerEvent) => {
        if (
          event.button !== 0 ||
          (event.target as HTMLElement | null)?.closest(
            "button,input,select,textarea,a",
          )
        )
          return;
        const rect = card.getBoundingClientRect();
        drag = {
          offsetX: event.clientX - rect.left,
          offsetY: event.clientY - rect.top,
          pointerId: event.pointerId,
          nextLeft: rect.left,
          nextTop: rect.top,
        };
        card.style.position = "fixed";
        card.style.setProperty(
          "left",
          `${Math.round(rect.left)}px`,
          "important",
        );
        card.style.setProperty("top", `${Math.round(rect.top)}px`, "important");
        card.style.margin = "0";
        card.style.transform = "none";
        card.style.willChange = "left, top";
        card.classList.add("dragging", "is-drag-positioned");
        head.classList.add("dragging-window");
        document.body.classList.add("ashen-window-dragging");
        head.setPointerCapture?.(event.pointerId);
        event.preventDefault();
        event.stopPropagation();
      });
      head.addEventListener("pointermove", (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.nextLeft = event.clientX - drag.offsetX;
        drag.nextTop = event.clientY - drag.offsetY;
        if (!raf) raf = requestAnimationFrame(flush);
        event.preventDefault();
        event.stopPropagation();
      });
      head.addEventListener("pointerup", endDrag);
      head.addEventListener("pointercancel", endDrag);
      head.addEventListener("lostpointercapture", endDrag);
      window.addEventListener(
        "pointerup",
        (event) => {
          if (drag && event.pointerId === drag.pointerId) endDrag();
        },
        { passive: true },
      );
    });
  }
}
