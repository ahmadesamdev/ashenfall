export interface ClientWindowControllerDeps {
  getOpenModals: () => HTMLElement[];
}

export class ClientWindowController {
  constructor(private readonly d: ClientWindowControllerDeps) {}

  constrainOpenWindows(): void {
    for (const modal of this.d.getOpenModals()) {
      const card = modal.querySelector<HTMLElement>(".modal-card");
      if (!card || card.classList.contains("dragging")) continue;
      const r = card.getBoundingClientRect();
      const maxX = Math.max(8, innerWidth - r.width - 8);
      const maxY = Math.max(8, innerHeight - r.height - 8);
      if (card.classList.contains("is-drag-positioned")) {
        card.style.setProperty(
          "left",
          `${Math.min(maxX, Math.max(8, r.left))}px`,
          "important",
        );
        card.style.setProperty(
          "top",
          `${Math.min(maxY, Math.max(8, r.top))}px`,
          "important",
        );
      }
    }
  }
}
