import * as React from "react";
import { createRoot } from "react-dom/client";

const e = React.createElement;

function WorldMap({ data }: { data: any }) {
  const d = data || { mode: "zone", zone: "", zones: [], legend: "" };
  const select = (value: string) => {
    (window as any).__ashenfallWorldMapZoneChange?.(value);
  };
  const mode = (value: "world" | "zone") => {
    (window as any).__ashenfallWorldMapMode?.(value);
  };
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "modal-head" },
      e(
        "div",
        null,
        e("h2", null, "🗺️ The Realms of Ashenfall"),
        e(
          "div",
          { className: "muted" },
          "Cities, wilderness regions, roads, hubs and quest destinations.",
        ),
      ),
      e(
        "button",
        {
          type: "button",
          "data-action": "close-modal",
          "data-modal": "worldMapModal",
        },
        "×",
      ),
    ),
    e(
      "div",
      { className: "world-map-toolbar" },
      e(
        "button",
        {
          type: "button",
          id: "worldMapWorldBtn",
          className: d.mode === "world" ? "active" : "",
          onClick: () => mode("world"),
        },
        "🌐 World",
      ),
      e(
        "button",
        {
          type: "button",
          id: "worldMapZoneBtn",
          className: d.mode === "zone" ? "active" : "",
          onClick: () => mode("zone"),
        },
        "📍 Current Zone",
      ),
      e(
        "select",
        {
          id: "worldMapZoneSelect",
          value: d.zone || "",
          onChange: (ev: any) => select(String(ev.target.value)),
          "aria-label": "Choose zone",
        },
        ...(d.zones || []).map((z: any) =>
          e("option", { key: z.id, value: z.id }, z.name),
        ),
      ),
    ),
    e(
      "div",
      { className: "world-map-wrap" },
      e("canvas", { id: "worldMapCanvas", width: 1100, height: 650 }),
      e(
        "div",
        { id: "worldMapLegend", className: "world-map-legend" },
        d.legend || "",
      ),
    ),
  );
}

let root: any = null;
let mounted = false;
const state: any = { mode: "zone", zone: "", zones: [], legend: "" };

export function syncWorldMapState(patch: any) {
  Object.assign(state, patch);
  root?.render(e(WorldMap, { data: state }));
}
export function mountWorldMap() {
  if (mounted) return;
  mounted = true;
  const host = document.getElementById("worldMapModal");
  const mount = host?.querySelector(".modal-card");
  if (!mount) return;
  mount.innerHTML = "";
  root = createRoot(mount);
  (window as any).__ashenfallReactWorldMapMounted = true;
  (window as any).__ashenfallReactWorldMapSync = (patch: any) =>
    syncWorldMapState(patch);
  (window as any).__ashenfallReactWorldMapRender = () =>
    root?.render(e(WorldMap, { data: state }));
  window.dispatchEvent(new Event("ashenfall-react-world-map-mounted"));
  root.render(e(WorldMap, { data: state }));
}
