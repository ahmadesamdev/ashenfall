import * as React from "react";
import { createRoot } from "react-dom/client";

const e = React.createElement;

type AuthPanel =
  "landing" | "login" | "register" | "verify" | "reset" | "resetConfirm";
type AuthState = {
  panel: AuthPanel;
  status: string;
  ok: boolean;
  loading: boolean;
  hidden: boolean;
};

type ClassDef = {
  id: string;
  name: string;
  role?: string;
  icon?: string;
  resource?: string;
  description?: string;
  portrait?: string;
  cardPortrait?: string;
};

type CreateState = {
  classes: ClassDef[];
  selected: string;
  creating: boolean;
  visible: boolean;
};

const authApi = async (path: string, body: any = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === "AbortError")
      throw new Error("The server took too long to respond. Please try again.");
    throw new Error(
      "Could not reach the Ashenfall server. Please check your connection.",
    );
  } finally {
    clearTimeout(timeout);
  }
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: "Invalid server response" }));
  if (!response.ok || !data.ok)
    throw new Error(data.error || "Request failed.");
  return data;
};

function AuthScreen() {
  const [state, setState] = React.useState({
    panel: "landing" as AuthPanel,
    status: "",
    ok: false,
    loading: false,
    hidden: false,
  });
  const [fields, setFields] = React.useState({} as Record<string, string>);
  const setField = (key: string, value: string) =>
    setFields((prev) => ({ ...prev, [key]: value }));
  const status = (text: string, ok = false) =>
    setState((prev) => ({ ...prev, status: text, ok }));
  const show = (panel: AuthPanel) =>
    setState((prev) => ({ ...prev, panel, status: "", ok: false }));
  const setLoading = (loading: boolean) =>
    setState((prev) => ({ ...prev, loading }));
  const hide = () => {
    setState((prev) => ({ ...prev, hidden: true, loading: false }));
    (window as any).__ashenfallAuthAuthenticated = true;
    window.dispatchEvent(new Event("ashenfall-auth-ready"));
  };
  const guestHint = () => {
    try {
      return localStorage.getItem("ashenfall.guestSessionHint");
    } catch {
      return null;
    }
  };
  const claimGuest = async () => {
    if (!guestHint()) return;
    try {
      const d = await authApi("/api/auth/claim-guest", {});
      if (d.claimed) {
        localStorage.removeItem("ashenfall.guestSessionHint");
        status("Your guest character is now protected by your account.", true);
      }
    } catch (error) {
      console.warn("Guest claim skipped:", error);
    }
  };
  const val = (id: string) => {
    const els = Array.from(
      document.querySelectorAll(`[id="${id}"]`),
    ) as HTMLInputElement[];
    const live =
      els.find((el) => el.offsetParent !== null) || els[els.length - 1];
    const v = live?.value;
    return v !== undefined && v !== "" ? v : fields[id] || "";
  };
  const action = async (kind: string) => {
    setLoading(true);
    try {
      if (kind === "guest") {
        status("Opening a temporary guest account…");
        const d = await authApi("/api/auth/guest", {});
        localStorage.setItem("ashenfall.guestSessionHint", d.guestId);
        hide();
        return;
      }
      if (kind === "login") {
        status("Signing in…");
        await authApi("/api/auth/login", {
          email: val("loginEmail"),
          password: val("loginPassword"),
        });
        await claimGuest();
        status("Signed in.", true);
        hide();
        return;
      }
      if (kind === "register") {
        status("Creating your account…");
        const email = val("registerEmail");
        if (val("registerPassword") !== val("registerPasswordConfirm")) {
          status("Passwords do not match. Please re-enter them.", true);
          return;
        }
        const d = await authApi("/api/auth/register", {
          email,
          password: val("registerPassword"),
        });
        if (d.alreadyRegistered) {
          setField("loginEmail", email);
          show("login");
          status(
            d.message ||
              "An account with this email already exists. Sign in instead.",
            true,
          );
        } else {
          setField("verifyEmail", email);
          show("verify");
          status("Verification code sent. Check your email.", true);
        }
        return;
      }
      if (kind === "verify") {
        status("Verifying your email…");
        const email = val("verifyEmail");
        await authApi("/api/auth/verify", { email, code: val("verifyCode") });
        setField("loginEmail", email);
        show("login");
        status("Email verified. Sign in to enter Ashenfall.", true);
        return;
      }
      if (kind === "resend") {
        status("Sending a new code…");
        await authApi("/api/auth/resend", { email: val("verifyEmail") });
        status("A new verification code was sent.", true);
        return;
      }
      if (kind === "reset-request") {
        status("Requesting password reset…");
        const email = val("resetEmail");
        await authApi("/api/auth/password-reset/request", { email });
        setField("resetConfirmEmail", email);
        show("resetConfirm");
        status("If the account exists, a reset code was sent.", true);
        return;
      }
      if (kind === "reset-confirm") {
        if (val("resetPassword") !== val("resetPasswordConfirm")) {
          status("Passwords do not match. Please re-enter them.", true);
          return;
        }
        status("Changing password…");
        await authApi("/api/auth/password-reset/confirm", {
          email: val("resetConfirmEmail"),
          code: val("resetCode"),
          password: val("resetPassword"),
        });
        show("login");
        status("Password changed. You can sign in now.", true);
        return;
      }
      if (kind === "signout") {
        status("Signing out…");
        await authApi("/api/auth/logout", {});
        localStorage.removeItem("ashenfall.playerId");
        localStorage.removeItem("ashenfall.guestSessionHint");
        window.location.reload();
        return;
      }
    } catch (error: any) {
      status(error?.message || "Request failed.");
    } finally {
      setLoading(false);
    }
  };

  const actionRef = React.useRef(action);
  actionRef.current = action;

  React.useEffect(() => {
    const onAuthClick = (ev: any) => {
      const b = ev.target?.closest?.("[data-auth-action]");
      if (!b) return;
      if (!document.getElementById("authScreen")?.contains(b)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const kind = String(b.dataset.authAction || "");
      if (!kind) return;
      if (kind.startsWith("show-")) show(kind.slice(5) as AuthPanel);
      else actionRef.current(kind);
    };
    document.addEventListener("click", onAuthClick, true);
    document.body.classList.add("auth-gate");
    const host = document.getElementById("authScreen");
    host?.classList.remove("hidden");
    (window as any).__ashenfallAuthAuthenticated = false;
    (window as any).__ashenfallAuthSignOut = () => actionRef.current("signout");
    let cancelled = false;
    const check = async () => {
      // One quiet probe (always HTTP 200): is there a live session, or one the refresh cookie can renew?
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        let r: Response;
        try {
          r = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: "{}",
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (r.ok) {
          const d = await r.json();
          if (d.ok && d.authenticated && !cancelled) {
            hide();
            return;
          }
        }
      } catch {}
    };
    check();
    return () => {
      cancelled = true;
      document.removeEventListener("click", onAuthClick, true);
      delete (window as any).__ashenfallAuthSignOut;
    };
  }, []);

  React.useEffect(() => {
    document
      .getElementById("authScreen")
      ?.classList.toggle("hidden", state.hidden);
  }, [state.hidden]);
  if (state.hidden) return null;
  const input = (
    id: string,
    type: string,
    autocomplete: string,
    placeholder: string,
  ) =>
    e("input", {
      id,
      type,
      autoComplete: autocomplete,
      placeholder,
      value: fields[id] || "",
      onChange: (ev: any) => setField(id, ev.target.value),
      disabled: state.loading,
    });
  const button = (label: string, kind: string, cls = "primary wide") =>
    e(
      "button",
      {
        type: "submit",
        className: cls,
        "data-auth-action": kind,
        disabled: state.loading,
      },
      label,
    );
  const links = (items: [string, AuthPanel | string][]) =>
    e(
      "div",
      { className: "auth-links" },
      items.map(([label, target], i) => {
        const kind =
          typeof target === "string" && target.startsWith("action:")
            ? target.slice(7)
            : `show-${target}`;
        return e(
          "button",
          {
            type: "button",
            key: i,
            "data-auth-action": kind,
            disabled: state.loading,
          },
          label,
        );
      }),
    );
  const card = (
    panel: AuthPanel,
    icon: string,
    eyebrow: string,
    title: string,
    body: any,
  ) =>
    e(
      "section",
      {
        id: panel === "resetConfirm" ? "resetConfirmPanel" : `${panel}Panel`,
        className: `auth-panel auth-card ${state.panel === panel ? "" : "hidden"}`,
      },
      e(
        "div",
        { className: "auth-card-head" },
        e("div", { className: "landing-mark small" }, icon),
        e(
          "div",
          null,
          e("div", { className: "eyebrow" }, eyebrow),
          e("h2", null, title),
        ),
      ),
      e(
        "form",
        {
          className: "auth-form",
          noValidate: true,
          onSubmit: (ev: any) => ev.preventDefault(),
        },
        body,
      ),
    );
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "auth-backdrop" },
      e("div", { className: "auth-glow auth-glow-a" }),
      e("div", { className: "auth-glow auth-glow-b" }),
      e(
        "div",
        { className: "auth-particles" },
        "✦　·　✧　　·　✦　　·　✧　·　✦",
      ),
    ),
    e(
      "div",
      { className: "auth-shell" },
      e(
        "section",
        {
          id: "landingPanel",
          className: `auth-panel landing-panel ${state.panel === "landing" ? "" : "hidden"}`,
        },
        e("div", { className: "landing-mark" }, "⚔️"),
        e("div", { className: "eyebrow" }, "A DARK-FANTASY MMO"),
        e("h1", null, "ASHENFALL"),
        e(
          "p",
          { className: "landing-lead" },
          "Enter a living world of ancient corruption, dangerous roads, deep dungeons and player-driven progression.",
        ),
        e(
          "div",
          { className: "landing-features" },
          [
            "⚔️ Authoritative combat",
            "🏰 Dungeons",
            "⛏️ Professions",
            "⚖️ Player economy",
            "🗺️ Persistent world",
            "🔥 PvP",
          ].map((x) => e("span", { key: x }, x)),
        ),
        e(
          "div",
          { className: "landing-actions" },
          button("Enter Ashenfall", "show-login", "primary wide auth-primary"),
          button("Create Account", "show-register", "secondary wide"),
          button("Continue as Guest", "guest", "ghost wide"),
        ),
        e(
          "p",
          { className: "auth-footnote" },
          "Create an account to keep your characters and progression across devices. Guest mode stores its session locally in this browser.",
        ),
      ),
      card(
        "login",
        "⚔️",
        "WELCOME BACK",
        "Sign in",
        e(
          React.Fragment,
          null,
          e(
            "label",
            null,
            "Email",
            input("loginEmail", "email", "email", "you@example.com"),
          ),
          e(
            "label",
            null,
            "Password",
            input(
              "loginPassword",
              "password",
              "current-password",
              "Your password",
            ),
          ),
          button("Sign In", "login"),
          links([
            ["Create account", "register"],
            ["Verify email", "verify"],
            ["Forgot password?", "reset"],
            ["Guest mode", "action:guest"],
          ]),
        ),
      ),
      card(
        "register",
        "✦",
        "JOIN THE WORLD",
        "Create account",
        e(
          React.Fragment,
          null,
          e(
            "label",
            null,
            "Email",
            input("registerEmail", "email", "email", "you@example.com"),
          ),
          e(
            "label",
            null,
            "Password",
            input(
              "registerPassword",
              "password",
              "new-password",
              "At least 8 characters",
            ),
          ),
          e(
            "label",
            null,
            "Confirm password",
            input(
              "registerPasswordConfirm",
              "password",
              "new-password",
              "Re-enter your password",
            ),
          ),
          e(
            "p",
            { className: "auth-hint" },
            "We'll send a six-digit verification code to your email.",
          ),
          button("Create Account", "register"),
          links([
            ["Already have an account?", "login"],
            ["Guest mode", "action:guest"],
          ]),
        ),
      ),
      card(
        "verify",
        "✉️",
        "ONE LAST STEP",
        "Verify your email",
        e(
          React.Fragment,
          null,
          e(
            "label",
            null,
            "Email",
            input("verifyEmail", "email", "email", "you@example.com"),
          ),
          e(
            "label",
            null,
            "Verification code",
            input("verifyCode", "text", "one-time-code", "123456"),
          ),
          button("Verify Email", "verify"),
          links([
            ["Send new code", "action:resend"],
            ["Back to sign in", "login"],
          ]),
        ),
      ),
      card(
        "reset",
        "🔐",
        "ACCOUNT RECOVERY",
        "Reset password",
        e(
          React.Fragment,
          null,
          e(
            "label",
            null,
            "Email",
            input("resetEmail", "email", "email", "you@example.com"),
          ),
          e(
            "p",
            { className: "auth-hint" },
            "We'll email a short-lived reset code if the account exists.",
          ),
          button("Send reset code", "reset-request"),
          links([["Back to sign in", "login"]]),
        ),
      ),
      card(
        "resetConfirm",
        "🗝️",
        "NEW CREDENTIALS",
        "Choose a new password",
        e(
          React.Fragment,
          null,
          e(
            "label",
            null,
            "Email",
            input("resetConfirmEmail", "email", "email", ""),
          ),
          e(
            "label",
            null,
            "Reset code",
            input("resetCode", "text", "one-time-code", "123456"),
          ),
          e(
            "label",
            null,
            "New password",
            input(
              "resetPassword",
              "password",
              "new-password",
              "At least 8 characters",
            ),
          ),
          e(
            "label",
            null,
            "Confirm new password",
            input(
              "resetPasswordConfirm",
              "password",
              "new-password",
              "Re-enter your new password",
            ),
          ),
          button("Change Password", "reset-confirm"),
          links([["Back to sign in", "login"]]),
        ),
      ),
      e(
        "div",
        {
          id: "authStatus",
          className: `auth-status ${state.status ? (state.ok ? "ok" : "error") : ""}`,
          "aria-live": "polite",
        },
        state.status,
      ),
    ),
  );
}

function describe(c: ClassDef) {
  return (
    String(c.description || "Choose this class to begin your journey.")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 92)
      .replace(/\s+\S*$/, "") + "…"
  );
}
function CreateCharacter({ data }: { data: CreateState }) {
  const classes = data.classes || [];
  const selected = data.selected || classes[0]?.id || "";
  const c: ClassDef = classes.find((x) => x.id === selected) ||
    classes[0] || { id: "", name: "" };
  const selectClass = (id: string) => {
    (window as any).__ashenfallCreateSelectedClass = id;
    window.dispatchEvent(
      new CustomEvent("ashenfall-create-class-selected", { detail: { id } }),
    );
  };
  const form = e(
    "div",
    { className: "form-grid" },
    e(
      "label",
      null,
      "Name",
      e("input", {
        id: "charname",
        maxLength: 20,
        placeholder: "Character name",
        autoComplete: "nickname",
        onKeyDown: (ev: any) => {
          if (ev.key === "Enter") {
            ev.preventDefault();
            (
              document.querySelector(
                '[data-action="create-character"]',
              ) as HTMLButtonElement | null
            )?.click();
          }
        },
      }),
    ),
    e(
      "label",
      null,
      "Class",
      e(
        "select",
        {
          id: "classid",
          value: selected,
          onChange: (ev: any) => selectClass(ev.target.value),
          "aria-label": "Class",
        },
        classes.map((x) =>
          e(
            "option",
            { key: x.id, value: x.id },
            `${x.icon || "⚔️"} ${x.name}  -  ${x.role || "Adventurer"}`,
          ),
        ),
      ),
    ),
  );
  const preview = e(
    "div",
    { className: "class-preview-shell" },
    e("div", {
      id: "classPreviewImage",
      className: "class-preview-image",
      style: {
        backgroundImage: c.id
          ? `url('/assets/ashenfall/classes/${String(c.portrait || c.id).replace(/\.png$/i, "")}.png')`
          : "none",
      },
    }),
    e(
      "div",
      { className: "class-preview-copy" },
      e("div", { className: "eyebrow" }, "YOUR PATH"),
      e("h2", { id: "classPreviewName" }, c.name || "Choose a class"),
      e(
        "div",
        { id: "classPreviewRole", className: "class-preview-role" },
        c.role || "Adventurer",
      ),
      e("p", { id: "classPreviewDescription" }, describe(c)),
      e(
        "div",
        { id: "classPreviewResource", className: "class-preview-resource" },
        c.resource ? `Primary resource • ${c.resource}` : "Primary resource",
      ),
    ),
  );
  const choices = e(
    "div",
    {
      id: "classChoices",
      className: "class-choices",
      "aria-label": "Choose a class",
    },
    classes.map((x) =>
      e(
        "button",
        {
          type: "button",
          key: x.id,
          className: `class-choice ${x.id === selected ? "selected" : ""}`,
          title: `Choose ${x.name}`,
          onClick: () => selectClass(x.id),
        },
        x.portrait
          ? e("img", {
              src: `/assets/ashenfall/classes/${x.cardPortrait || x.portrait}`,
              alt: "",
              decoding: "async",
            })
          : e("span", { className: "class-icon" }, x.icon || "⚔️"),
        e(
          "span",
          null,
          e("b", null, x.name),
          e(
            "span",
            { className: "class-role" },
            `${x.role || "Adventurer"} • ${x.resource || "Resource"}`,
          ),
          e("span", { className: "class-desc" }, describe(x)),
        ),
        e(
          "span",
          { className: "class-check", "aria-hidden": "true" },
          x.id === selected ? "✓" : "",
        ),
      ),
    ),
  );
  const enter = e(
    "button",
    {
      className: "primary wide enter-world-button",
      "data-action": "create-character",
      type: "button",
      disabled: data.creating,
    },
    e("span", null, data.creating ? "Entering Ashenfall…" : "Enter the World"),
    e("small", null, "Begin your journey"),
  );
  return e(
    "div",
    { className: "modal-card intro-card" },
    e("h1", null, "⚔️ Enter Ashenfall"),
    e(
      "p",
      { className: "muted" },
      "Choose your name and class. Your first two abilities are available immediately; the rest are learned as you grow. ",
      e(
        "button",
        {
          type: "button",
          className: "create-signout",
          onClick: () => {
            (window as any).__ashenfallAuthSignOut?.();
          },
        },
        "Sign out",
      ),
    ),
    form,
    preview,
    choices,
    enter,
  );
}

function SessionLoading({ text }: { text: string }) {
  return e(
    "div",
    {
      className: "session-loading-card",
      role: "status",
      "aria-live": "polite",
    },
    e("div", { className: "session-spinner" }),
    e("h2", null, "Restoring Ashenfall…"),
    e("p", { id: "sessionLoadingText" }, text),
  );
}

let roots: { [key: string]: any } = {};
let mounted = false;
function mount(id: string, component: any) {
  const host = document.getElementById(id);
  if (!host) return null;
  host.innerHTML = "";
  const root = createRoot(host);
  roots[id] = root;
  (host as any).__ashenfallReactRoot = root;
  return root;
}
export function mountOnboarding() {
  if (mounted) return;
  mounted = true;
  const authHost = document.getElementById("authScreen");
  const authRoot = authHost ? mount("authScreen", AuthScreen) : null;
  const createRootRef = mount("create", () => null);
  const loadingRoot = mount("sessionLoading", () => null);
  const renderCreate = () => {
    const data = (window as any).__ashenfallCreateUiState || {
      classes: [],
      selected: "",
      creating: false,
      visible: false,
    };
    const host = document.getElementById("create") as any;
    host?.classList.toggle("hidden", !data.visible);
    host?.setAttribute("aria-hidden", data.visible ? "false" : "true");
    createRootRef?.render(e(CreateCharacter, { data }));
  };
  const renderLoading = () => {
    const d = (window as any).__ashenfallSessionLoading || {
      visible: false,
      text: "Loading your character.",
    };
    loadingRoot?.render(e(SessionLoading, d));
  };
  (window as any).__ashenfallCreateUiRender = renderCreate;
  (window as any).__ashenfallSessionLoadingRender = renderLoading;
  window.addEventListener("ashenfall-create-ui-state", renderCreate);
  window.addEventListener("ashenfall-session-loading", renderLoading);
  window.addEventListener("ashenfall-create-class-selected", (ev: any) => {
    const id = ev.detail?.id;
    if (!id) return;
    (window as any).__ashenfallCreateUiState = {
      ...((window as any).__ashenfallCreateUiState || {}),
      selected: id,
    };
    renderCreate();
  });
  window.dispatchEvent(new Event("ashenfall-react-onboarding-mounted"));
  authRoot?.render(e(AuthScreen));
  renderCreate();
  renderLoading();
}
