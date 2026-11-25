import * as React from "react";
import { createRoot } from "react-dom/client";

const e = React.createElement;
const pct = (v: any) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const esc = (v: any) => String(v ?? "");

function Meter({
  label,
  value,
  cls,
}: {
  label: string;
  value: any;
  cls?: string;
}) {
  const p = pct(value);
  return e(
    "div",
    { className: "intel-meter" },
    e("div", null, e("span", null, label), e("b", null, p)),
    e("i", { className: cls || "", style: { width: `${p}%` } }),
  );
}
function WorldIntel({ data }: { data: any }) {
  const d = data || {};
  const region = d.region || {},
    zone = d.zoneInfo || {},
    eco = d.regionalEconomy || {},
    integration = d.worldIntegration || {},
    guild = d.guildWorld;
  const risk = Number(zone.danger || 0),
    ex = region.exploration || {};
  const factions = (d.worldFactions || []).slice(0, 6),
    events = (d.emergentWorldEvents?.active || []).slice(-6);
  const recent = (d.chronicle?.entries || []).slice(-5).reverse();
  const opportunities = (integration.opportunities || []).slice(-8).reverse();
  const knowledge = (integration.knowledge || []).slice(-8);
  const contracts = (integration.contracts || []).slice(-3).reverse();
  const marketKeys = Object.keys(eco.prices || {}).slice(0, 6);
  const species = d.worldIntegration?.ecology?.species || [];
  const opportunityHistory =
    integration.contractHistory || integration.contracts || [];
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "intel-hero" },
      e(
        "div",
        null,
        e("div", { className: "eyebrow" }, "CURRENT REGION"),
        e("h2", null, zone.name || region.name || zone.id || ""),
        e(
          "p",
          null,
          zone.description ||
            "The region is part of the living world simulation.",
        ),
      ),
      e(
        "div",
        { className: "intel-status" },
        e(
          "b",
          null,
          risk >= 70 ? "⚠ HIGH RISK" : risk >= 40 ? "◈ UNSTABLE" : "✓ STABLE",
        ),
        e("span", null, `Danger ${risk}`),
        e(
          "span",
          null,
          `${Number(ex.discoveredCount || 0)}/${Number(ex.totalDiscoveries || 0)} discoveries`,
        ),
      ),
    ),
    e(
      "div",
      { className: "intel-grid" },
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "⚠️ Situation"),
          e("span", { className: "muted" }, "live simulation"),
        ),
        e(Meter, { label: "Regional danger", value: risk }),
        e(Meter, { label: "Economic scarcity", value: eco.scarcity }),
        e(Meter, { label: "Guild influence", value: guild?.influence }),
        e(
          "div",
          { className: "intel-facts" },
          e(
            "span",
            null,
            "🧭 Condition: ",
            e(
              "b",
              null,
              String(region.runtime?.condition || "normal").replace(/-/g, " "),
            ),
          ),
          e(
            "span",
            null,
            "🌿 Active ecology signals: ",
            e("b", null, species.length),
          ),
          e(
            "span",
            null,
            "🚚 Caravans nearby: ",
            e(
              "b",
              null,
              (eco.caravans || []).filter((c: any) => c.state === "traveling")
                .length,
            ),
          ),
        ),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "🏴 Factions"),
          e("span", { className: "muted" }, "regional influence"),
        ),
        factions.length
          ? factions.map((f: any) =>
              e(
                "div",
                { className: "intel-row", key: f.id },
                e(
                  "div",
                  null,
                  e("b", null, f.name || f.id),
                  e(
                    "small",
                    null,
                    `Influence ${pct(f.influence)} • Pressure ${pct(f.pressure)}`,
                  ),
                ),
                e(
                  "span",
                  null,
                  f.activeOperations?.length
                    ? `⚔ ${f.activeOperations.length} operation${f.activeOperations.length === 1 ? "" : "s"}`
                    : "Quiet",
                ),
              ),
            )
          : e(
              "div",
              { className: "muted" },
              "No faction data is available for this region.",
            ),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "🔥 Emerging situations"),
          e("span", { className: "muted" }, "derived from world state"),
        ),
        events.length
          ? events.map((x: any, i: number) =>
              e(
                "div",
                { className: "intel-event", key: `event-${i}` },
                e("b", null, x.title || x.kind || "World Event"),
                e(
                  "p",
                  null,
                  x.description || "A situation is developing in the region.",
                ),
                e(
                  "small",
                  null,
                  `${x.severity || "regional"} • cause ${(x.causes || []).length ? `${x.causes.length} recorded signals` : "simulation state"}`,
                ),
              ),
            )
          : e(
              "div",
              { className: "muted" },
              "No emergent situation is active.",
            ),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "🧭 Opportunities"),
          e("span", { className: "muted" }, "things you can act on"),
        ),
        opportunities.length
          ? opportunities.map((o: any) => {
              const related = opportunityHistory.find(
                (c: any) => c.opportunityId === o.id,
              );
              const badge =
                related?.status === "active"
                  ? "ACTIVE"
                  : related?.status === "completed"
                    ? "COMPLETED"
                    : related?.status === "failed"
                      ? "FAILED"
                      : null;
              return e(
                "div",
                { className: "intel-event opportunity", key: o.id },
                e(
                  "div",
                  null,
                  e("b", null, o.title || "World opportunity"),
                  e("p", null, o.description || "The world has changed here."),
                  e(
                    "small",
                    null,
                    `${o.kind || "opportunity"} • ${o.severity || "local"}`,
                  ),
                ),
                badge
                  ? e(
                      "span",
                      {
                        className: `intel-badge ${badge === "COMPLETED" ? "success" : badge === "FAILED" ? "danger" : ""}`,
                      },
                      badge,
                    )
                  : e(
                      "button",
                      {
                        className: "primary compact",
                        "data-action": "world-opportunity-accept",
                        "data-opportunity-id": o.id,
                      },
                      "Accept",
                    ),
              );
            })
          : e(
              "div",
              { className: "muted" },
              "Nothing is currently calling for your attention.",
            ),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "📜 Active contracts"),
          e("span", { className: "muted" }, "your commitments"),
        ),
        contracts.length
          ? contracts.map((c: any) => {
              const step = Math.max(0, Number(c.objectiveIndex || 0)),
                steps = Array.isArray(c.objectives) ? c.objectives : [],
                objective =
                  steps[step] || c.label || "Respond to the changing world.",
                done = step >= Math.max(0, steps.length - 1);
              return e(
                "div",
                { className: "intel-event contract", key: c.id },
                e(
                  "div",
                  null,
                  e("b", null, c.title || "World contract"),
                  e("p", null, objective),
                  e(
                    "small",
                    null,
                    `${c.kind || "contract"}${c.targetName ? ` • ${c.targetName}` : ""} • Step ${Math.min(step + 1, Math.max(1, steps.length))}/${Math.max(1, steps.length)}`,
                  ),
                ),
                e(
                  "button",
                  {
                    className: "primary compact",
                    "data-action": "world-contract-action",
                    "data-contract-id": c.id,
                  },
                  done ? "Resolve" : "Continue",
                ),
              );
            })
          : e("div", { className: "muted" }, "No active world contracts."),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "⚖️ Regional market"),
          e("span", { className: "muted" }, "current prices"),
        ),
        marketKeys.length
          ? marketKeys.map((k: string) =>
              e(
                "div",
                { className: "intel-row", key: k },
                e(
                  "div",
                  null,
                  e("b", null, k.replace(/_/g, " ")),
                  e(
                    "small",
                    null,
                    `Supply ${Math.round(Number(eco.supply?.[k] || 0))} • Demand ${Math.round(Number(eco.demand?.[k] || 0))}`,
                  ),
                ),
                e(
                  "strong",
                  null,
                  `${Number(eco.prices?.[k] || 0).toFixed(2)}g`,
                ),
              ),
            )
          : e("div", { className: "muted" }, "No regional market data."),
      ),
      e(
        "section",
        { className: "intel-card" },
        e(
          "div",
          { className: "section-head" },
          e("h3", null, "📜 Recent history"),
          e("span", { className: "muted" }, "Chronicle"),
        ),
        recent.length
          ? recent.map((x: any, i: number) =>
              e(
                "div",
                { className: "intel-row", key: `history-${i}` },
                e(
                  "div",
                  null,
                  e("b", null, x.title || "Recorded event"),
                  e("small", null, x.summary || ""),
                ),
                e("span", null, `${Number(x.significance || 0)} significance`),
              ),
            )
          : e(
              "div",
              { className: "muted" },
              "The Chronicle has no recent entries for you.",
            ),
      ),
    ),
    e(
      "div",
      { className: "intel-footer" },
      e(
        "div",
        null,
        e("b", null, "What you know"),
        e(
          "span",
          null,
          knowledge.length
            ? knowledge.map((x: any, i: number) =>
                e("em", { key: i }, esc(x).replace(/_/g, " ")),
              )
            : "No regional knowledge recorded yet.",
        ),
      ),
      e(
        "button",
        { type: "button", "data-action": "open-world-map" },
        "Open World Map",
      ),
    ),
  );
}
let root: any = null;
let mounted = false;
let state: any = {};
export function syncWorldIntelState(patch: any) {
  state = { ...state, ...patch };
  root?.render(e(WorldIntel, { data: state }));
}
export function mountWorldIntel() {
  if (mounted) return;
  mounted = true;
  const host = document.getElementById("worldIntelBody");
  if (!host) return;
  host.innerHTML = "";
  root = createRoot(host);
  (window as any).__ashenfallReactWorldIntelMounted = true;
  (window as any).__ashenfallReactWorldIntelSync = (patch: any) =>
    syncWorldIntelState(patch);
  root.render(e(WorldIntel, { data: state }));
}
