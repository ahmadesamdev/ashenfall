export interface AccountSessionControllerDeps {
  getElement?: (id: string) => HTMLElement | null;
  onState?: (state: {
    sessions: Array<{ createdAt?: unknown; expiresAt?: unknown }>;
    status: string;
  }) => void;
  fetcher?: typeof fetch;
  reload: () => void;
}

export class AccountSessionController {
  private readonly fetcher: typeof fetch;
  constructor(private readonly d: AccountSessionControllerDeps) {
    // Wrap the global: calling a bare `fetch` stored on an object throws "Illegal invocation" (wrong `this`).
    this.fetcher =
      d.fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  async load(): Promise<void> {
    const list = this.d.getElement?.("accountSessionList");
    const status = this.d.getElement?.("accountSettingsStatus");
    try {
      const response = await this.fetcher("/api/auth/sessions", {
        credentials: "include",
      });
      const data = (await response.json()) as {
        ok?: boolean;
        sessions?: Array<{ createdAt?: unknown; expiresAt?: unknown }>;
      };
      if (!response.ok || !data.ok) {
        this.d.onState?.({
          sessions: [],
          status: "Guest mode has no account sessions.",
        });
        if (list) list.textContent = "Guest mode has no account sessions.";
        return;
      }
      const sessions = data.sessions ?? [];
      this.d.onState?.({ sessions, status: "" });
      if (list) {
        const sessionDate = (value: unknown) => {
          const timestamp = Number(value);
          return Number.isFinite(timestamp) && timestamp > 0
            ? new Date(timestamp).toLocaleString()
            : "Unavailable";
        };
        list.innerHTML =
          sessions
            .map(
              (session, index) =>
                `<div class="account-session-row"><b>Session ${index + 1}</b><span>Created ${sessionDate(session.createdAt)}</span><span>Expires ${sessionDate(session.expiresAt)}</span></div>`,
            )
            .join("") || '<div class="muted">No active sessions.</div>';
      }
      if (status) status.textContent = "";
    } catch {
      this.d.onState?.({ sessions: [], status: "Unable to load sessions." });
      if (list) list.textContent = "Unable to load sessions.";
    }
  }

  async logoutAll(): Promise<void> {
    const status = this.d.getElement?.("accountSettingsStatus");
    try {
      const response = await this.fetcher("/api/auth/logout-all", {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok)
        throw new Error(data.error || "Could not revoke sessions.");
      this.d.onState?.({
        sessions: [],
        status: "All sessions revoked. Reloading…",
      });
      if (status) status.textContent = "All sessions revoked. Reloading…";
      setTimeout(() => this.d.reload(), 400);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not revoke sessions.";
      this.d.onState?.({ sessions: [], status: message });
      if (status) status.textContent = message;
    }
  }
}
