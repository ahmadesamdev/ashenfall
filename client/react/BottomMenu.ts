import * as React from "react";

export type BottomMenuItem = {
  icon: string;
  label: string;
  action: string;
  id?: string;
  className?: string;
  badge?: { id: string; hidden: boolean; value: number };
};

export const BOTTOM_MENU_ITEMS: BottomMenuItem[] = [
  { icon: "🧙", label: "Character", action: "open-character" },
  { icon: "🎒", label: "Bag", action: "open-bag" },
  { icon: "✨", label: "Skills", action: "open-skills" },
  { icon: "📜", label: "Quests", action: "open-quests" },
  { icon: "✦", label: "Talents", action: "open-build" },
  { icon: "👥", label: "Party", action: "open-party" },
  { icon: "🤝", label: "Social", action: "open-social" },
  { icon: "⚔️", label: "PvP", action: "open-pvp" },
  { icon: "🏰", label: "Dungeon", action: "open-dungeon" },
  { icon: "🗺️", label: "World Map", action: "open-world-map" },
  { icon: "⚙️", label: "Settings", action: "open-settings" },
  { icon: "🌍", label: "World Intel", action: "open-world-intel" },
  {
    icon: "✉️",
    label: "Mail",
    action: "open-mail",
    className: "mail-menu-btn",
    badge: { id: "mailBadge", hidden: true, value: 0 },
  },
  { icon: "⚖️", label: "Auction", action: "open-auction" },
  { icon: "⛏️", label: "Professions", action: "open-professions" },
  { icon: "🚶", label: "Walk", action: "toggle-run", id: "bottomRunBtn" },
  { icon: "🧙", label: "Trainer", action: "open-trainer" },
];

export function BottomMenu({
  unreadMail = 0,
  running = false,
}: {
  unreadMail?: number;
  running?: boolean;
}) {
  return React.createElement(
    React.Fragment,
    null,
    BOTTOM_MENU_ITEMS.map((item) => {
      const isRun = item.action === "toggle-run";
      const icon = isRun ? (running ? "🏃" : "🚶") : item.icon;
      const label = isRun ? (running ? "Run" : "Walk") : item.label;
      const children: any[] = [icon];

      if (item.badge) {
        children.push(
          React.createElement(
            "span",
            { key: `${item.action}-label` },
            label,
            React.createElement(
              "b",
              {
                id: item.badge.id,
                className: `menu-badge${unreadMail > 0 ? "" : " hidden"}`,
              },
              unreadMail,
            ),
          ),
        );
      } else {
        children.push(
          React.createElement("span", { key: `${item.action}-label` }, label),
        );
      }

      return React.createElement(
        "button",
        {
          key: item.action,
          id: item.id,
          type: "button",
          className: item.className,
          "data-action": item.action,
          "data-tip": label,
          "aria-label": label,
        },
        children,
      );
    }),
  );
}
