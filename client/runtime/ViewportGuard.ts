export const MIN_VIEWPORT_WIDTH = 1360;
export const MIN_VIEWPORT_HEIGHT = 560;

function install() {
  const guard = document.createElement("div");
  guard.id = "viewportGuard";
  guard.setAttribute("role", "alertdialog");
  guard.setAttribute("aria-live", "assertive");
  guard.hidden = true;

  const card = document.createElement("div");
  card.className = "viewport-guard-card";

  const icon = document.createElement("div");
  icon.className = "viewport-guard-icon";
  icon.textContent = "⚔️";

  const title = document.createElement("h2");
  title.textContent = "Window too small";

  const message = document.createElement("p");
  message.textContent = `Ashenfall needs a window of at least ${MIN_VIEWPORT_WIDTH} × ${MIN_VIEWPORT_HEIGHT} pixels to display and play correctly.`;

  const current = document.createElement("p");
  current.className = "viewport-guard-size";

  const hint = document.createElement("p");
  hint.className = "viewport-guard-hint";
  hint.textContent =
    "Enlarge or maximize the window, or zoom the page out (Ctrl and −). The game returns automatically once the window is large enough.";

  card.append(icon, title, message, current, hint);
  guard.append(card);
  document.body.append(guard);

  let blocked = false;

  const update = () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const tooSmall = width < MIN_VIEWPORT_WIDTH || height < MIN_VIEWPORT_HEIGHT;
    blocked = tooSmall;
    guard.hidden = !tooSmall;
    document.documentElement.classList.toggle("viewport-too-small", tooSmall);
    if (tooSmall) current.textContent = `Current size: ${width} × ${height}`;
  };

  const swallowInput = (event: KeyboardEvent) => {
    if (!blocked) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^F\d+$/.test(event.key)) return;
    event.stopImmediatePropagation();
  };

  window.addEventListener("keydown", swallowInput, true);
  window.addEventListener("keyup", swallowInput, true);
  window.addEventListener("keypress", swallowInput, true);
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  update();
}

if (document.body) install();
else document.addEventListener("DOMContentLoaded", install, { once: true });
