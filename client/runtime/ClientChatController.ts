export interface ClientChatControllerOptions {
  getState: () => any;
  getSelectedPlayerId: () => string | null;
  send: (action: string, data?: any) => any;
  toast: (message: string, ok?: boolean) => any;
  getElement: (id: string) => any;
  getSystemMessages: () => any[];
  setSystemMessages: (messages: any[]) => void;
  markDirty: () => void;
}
export class ClientChatController {
  channel = "say";
  whisperTargetId: string | null = null;
  constructor(private readonly o: ClientChatControllerOptions) {}
  setChannel(channel: string, targetId: string | null = null) {
    this.channel = channel;
    if (targetId) this.whisperTargetId = targetId;
    const sel = this.o.getElement("mapChatChannel");
    if (sel) sel.value = channel;
    const input = this.o.getElement("mapChatInput");
    if (input) {
      input.placeholder =
        channel === "whisper"
          ? this.whisperTargetId
            ? "Whisper privately…"
            : "Select a player to whisper to…"
          : channel === "party"
            ? "Party chat…"
            : "Say something…";
      input.focus();
    }
    return this.channel;
  }
  send() {
    const input = this.o.getElement("mapChatInput");
    const state = this.o.getState();
    if (!input || !state) return;
    const text = String(input.value || "").trim();
    if (!text) return;
    if (this.channel === "whisper") {
      const targetId = this.whisperTargetId || this.o.getSelectedPlayerId();
      if (!targetId)
        return this.o.toast("Select a player before sending a whisper.", false);
      this.o.send("whisper", { targetId, text });
    } else if (this.channel === "party") this.o.send("party_chat", { text });
    else this.o.send("chat", { text });
    input.value = "";
  }
  addSystemMessage(text: string) {
    const value = String(text ?? "").trim();
    if (!value) return;
    const messages = [
      ...this.o.getSystemMessages(),
      { text: value, ts: Date.now() },
    ].slice(-40);
    this.o.setSystemMessages(messages);
    this.o.markDirty();
  }
}
