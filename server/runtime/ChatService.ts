export class ChatService {
  private readonly byZone = new Map<string, any[]>();
  private sequence = 0;
  constructor(zones: any[]) {
    for (const zone of zones) this.byZone.set(zone.id, []);
  }
  add(zoneId: string, message: any) {
    const list = this.byZone.get(zoneId) || [];
    const entry = {
      id: `chat_${++this.sequence}`,
      ts: Date.now(),
      t: new Date().toLocaleTimeString(),
      from: String(message?.from || "Ashenfall"),
      text: String(message?.text || ""),
      ...message,
    };
    list.push(entry);
    if (list.length > 80) list.splice(0, list.length - 80);
    this.byZone.set(zoneId, list);
    return entry;
  }
  history(zoneId: string) {
    return this.byZone.get(zoneId) || [];
  }
}
