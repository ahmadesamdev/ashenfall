import packageMetadata from "../../package.json" with { type: "json" };

export const GAME_VERSION = String(packageMetadata.version || "0.5.0");
export const GAME_VERSION_LABEL = `v${GAME_VERSION}`;
