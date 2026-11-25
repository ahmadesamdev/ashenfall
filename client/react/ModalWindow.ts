import * as React from "react";

export type ModalWindowProps = {
  id: string;
  cardClassName?: string;
  title: any;
  children: any;
  visible: boolean;
  subtitle?: any;
  screenLabel?: string;
};

export function ModalWindow({
  id,
  cardClassName = "",
  title,
  subtitle,
  screenLabel,
  children,
  visible,
}: ModalWindowProps) {
  return React.createElement(
    "div",
    {
      id,
      className: `modal${visible ? "" : " hidden"}`,
      "aria-hidden": visible ? "false" : "true",
    },
    React.createElement(
      "div",
      { className: `modal-card ${cardClassName}`.trim() },
      React.createElement(
        "div",
        { className: "modal-head" },
        subtitle
          ? React.createElement(
              "div",
              null,
              React.createElement("h2", null, title),
              React.createElement("div", { className: "muted" }, subtitle),
            )
          : React.createElement("h2", null, title),
        screenLabel
          ? React.createElement(
              "span",
              { className: "ashen-screen-label" },
              screenLabel,
            )
          : null,
        React.createElement(
          "button",
          {
            type: "button",
            "data-action": "close-modal",
            "data-modal": id,
            "aria-label": "Close",
          },
          "×",
        ),
      ),
      children,
    ),
  );
}
