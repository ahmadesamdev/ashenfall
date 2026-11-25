export interface ClientRenderLoopOptions {
  expirePrediction: () => void;
  enforceInteractionRange: () => void;
  getHitStopUntil: () => number;
  drawWorld: (time: number) => void;
  drawFallbackWorld: () => void;
  isUiDirty: () => boolean;
  setUiDirty: (value: boolean) => void;
  getLastUiRender: () => number;
  setLastUiRender: (value: number) => void;
  renderUi: () => void;
}

export class ClientRenderLoop {
  private running = false;
  constructor(private readonly o: ClientRenderLoopOptions) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
  }

  private frame(time: number): void {
    if (!this.running) return;
    try {
      this.o.expirePrediction();
    } catch (error) {
      console.error("Ashenfall prediction cleanup failed", error);
    }
    try {
      this.o.enforceInteractionRange();
    } catch (error) {
      console.error("Ashenfall interaction range check failed", error);
    }

    const hitStop = this.o.getHitStopUntil();
    const visualTime =
      hitStop > performance.now() ? time - (hitStop - performance.now()) : time;
    try {
      this.o.drawWorld(visualTime);
    } catch (error: any) {
      console.error("Ashenfall render error", error);
      (window as any).__ashenfallRenderError = String(error?.stack || error);
      try {
        this.o.drawFallbackWorld();
      } catch {}
    }

    try {
      if (this.o.isUiDirty() && time - this.o.getLastUiRender() > 120) {
        this.o.setLastUiRender(time);
        this.o.setUiDirty(false);
        this.o.renderUi();
      }
    } catch (error) {
      console.error("Ashenfall UI render error", error);
      this.o.setUiDirty(true);
    }
    requestAnimationFrame((nextTime) => this.frame(nextTime));
  }
}
