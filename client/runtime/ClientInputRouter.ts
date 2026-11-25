export interface ClientInputRouterDeps {
  root?: Document;
  onClick?: (event: MouseEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
  onPointerDown?: (event: PointerEvent) => void;
  onPointerMove?: (event: PointerEvent) => void;
  onPointerUp?: (event: PointerEvent) => void;
  onPointerCancel?: (event: PointerEvent) => void;
  onPointerOver?: (event: PointerEvent) => void;
  onPointerOut?: (event: PointerEvent) => void;
  onPointerMoveTooltip?: (event: PointerEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  onKeyUp?: (event: KeyboardEvent) => void;
  onBlur?: (event: FocusEvent) => void;
}

export class ClientInputRouter {
  private bound = false;
  constructor(private readonly d: ClientInputRouterDeps) {}

  bind(): void {
    if (this.bound) return;
    this.bound = true;
    const root = this.d.root || document;
    if (this.d.onClick) root.addEventListener("click", this.d.onClick);
    root.addEventListener("contextmenu", this.d.onContextMenu, true);
    if (this.d.onPointerDown)
      root.addEventListener("pointerdown", this.d.onPointerDown, true);
    if (this.d.onPointerMove)
      root.addEventListener("pointermove", this.d.onPointerMove, true);
    if (this.d.onPointerUp)
      root.addEventListener("pointerup", this.d.onPointerUp, true);
    if (this.d.onPointerCancel)
      root.addEventListener("pointercancel", this.d.onPointerCancel, true);
    if (this.d.onPointerOver)
      root.addEventListener("pointerover", this.d.onPointerOver);
    if (this.d.onPointerOut)
      root.addEventListener("pointerout", this.d.onPointerOut);
    if (this.d.onPointerMoveTooltip)
      root.addEventListener("pointermove", this.d.onPointerMoveTooltip);
    if (this.d.onKeyDown) window.addEventListener("keydown", this.d.onKeyDown);
    if (this.d.onKeyUp) window.addEventListener("keyup", this.d.onKeyUp);
    if (this.d.onBlur) window.addEventListener("blur", this.d.onBlur);
  }

  unbind(): void {
    if (!this.bound) return;
    this.bound = false;
  }
}
