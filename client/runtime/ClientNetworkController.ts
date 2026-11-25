export interface ClientNetworkControllerOptions {
  getSocket: () => WebSocket | null;
  setSocket: (socket: WebSocket | null) => void;
  getSavedCharacterId: () => string;
  getReconnectAttempt: () => number;
  setReconnectAttempt: (value: number) => void;
  getCommandQueue: () => any[];
  setCommandQueue: (queue: any[]) => void;
  shouldQueueAfterDisconnect: (action: string) => boolean;
  onMotion: (motion: any) => void;
  onStateMessage: (data: any) => void;
  onCommandResult: (data: any) => void;
  onError: (message: string) => void;
  onConnected: () => void;
  onDisconnected: () => void;
  onConnectionError: () => void;
  onPing: (rtt: number) => void;
  onRefreshAuth: () => Promise<void>;
}

export class ClientNetworkController {
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private requestSeq = 0;
  private connectionGeneration = 0;

  constructor(private readonly o: ClientNetworkControllerOptions) {}

  scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const attempt = Math.max(1, this.o.getReconnectAttempt());
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        this.connect();
      },
      Math.min(5000, 500 * attempt),
    );
  }

  send(action: string, data: Record<string, any> = {}): string | false {
    const requestId = `${Date.now()}-${++this.requestSeq}`;
    const payload = { action, requestId, ...data };
    const socket = this.o.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      if (this.o.shouldQueueAfterDisconnect(action)) {
        const queue = this.o.getCommandQueue();
        queue.push(payload);
        this.o.setCommandQueue(queue);
      } else if (action) {
        console.info(
          `[Ashenfall] Dropping transient command while disconnected: ${action}`,
        );
      }
      this.scheduleReconnect();
      return false;
    }
    try {
      socket.send(JSON.stringify(payload));
      return requestId;
    } catch (error) {
      console.warn("WebSocket send failed", error);
      if (this.o.shouldQueueAfterDisconnect(action)) {
        const queue = this.o.getCommandQueue();
        queue.unshift(payload);
        this.o.setCommandQueue(queue);
      }
      try {
        socket.close();
      } catch {}
      return false;
    }
  }

  connect(): void {
    const current = this.o.getSocket();
    if (
      current &&
      (current.readyState === WebSocket.OPEN ||
        current.readyState === WebSocket.CONNECTING)
    )
      return;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `${protocol}://${location.host}/ws`,
        "ashenfall-v1",
      );
    } catch (error) {
      console.error(error);
      this.scheduleReconnect();
      return;
    }
    this.o.setSocket(socket);
    const generation = ++this.connectionGeneration;

    socket.onopen = () => {
      this.o.setReconnectAttempt(0);
      this.o.onConnected();
      this.startHeartbeat(socket);
      this.flushSafeQueue(socket);
    };

    socket.onerror = () => {
      if (
        generation !== this.connectionGeneration ||
        this.o.getSocket() !== socket
      )
        return;
      this.o.onConnectionError();
    };

    socket.onclose = async (event) => {
      if (
        generation !== this.connectionGeneration ||
        this.o.getSocket() !== socket
      )
        return;
      this.stopHeartbeat();
      this.o.onDisconnected();
      if (event.code === 4401) {
        await this.o.onRefreshAuth();
        this.scheduleReconnect();
        return;
      }
      if (event.code === 4409 || event.code === 4411) {
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.o.setReconnectAttempt(0);
        this.o.onError(
          event.code === 4411
            ? "Signed in elsewhere. This account is active in another tab or browser."
            : "Signed in elsewhere or your session was revoked. Please sign in again.",
        );
        return;
      }
      this.scheduleReconnect();
    };

    socket.onmessage = (event) => {
      if (
        generation !== this.connectionGeneration ||
        this.o.getSocket() !== socket
      )
        return;
      this.handleMessage(event.data);
    };
  }

  private startHeartbeat(socket: WebSocket): void {
    this.stopHeartbeat();
    const sendPing = () => {
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: "ping", clientSentAt: performance.now() }),
          );
        }
      } catch {}
    };
    sendPing();
    this.heartbeatTimer = setInterval(sendPing, 5000);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private flushSafeQueue(socket: WebSocket): void {
    const queued = this.o
      .getCommandQueue()
      .splice(0)
      .filter((payload) => this.o.shouldQueueAfterDisconnect(payload?.action));
    for (const payload of queued) {
      try {
        socket.send(JSON.stringify(payload));
      } catch {
        const queue = this.o.getCommandQueue();
        queue.unshift(payload);
        this.o.setCommandQueue(queue);
        try {
          socket.close();
        } catch {}
        break;
      }
    }
  }

  private handleMessage(raw: any): void {
    try {
      const message = JSON.parse(raw);
      if (message.type === "pong") {
        if (message.clientSentAt != null)
          this.o.onPing(performance.now() - Number(message.clientSentAt));
        return;
      }
      if (message.type === "welcome") return;
      if (message.type === "motion") {
        if (message.data) this.o.onMotion(message.data);
        return;
      }
      if (message.type === "state") {
        this.o.onStateMessage(message.data);
        return;
      }
      if (message.type === "command_result") {
        this.o.onCommandResult(message.data || {});
        return;
      }
      if (message.type === "error") {
        this.o.onError(message.data?.message || "Server error.");
      }
    } catch (error) {
      console.error("Ashenfall network message error", error);
    }
  }
}
