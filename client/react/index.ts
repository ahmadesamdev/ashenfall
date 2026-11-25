import { mountBottomMenu, renderBottomMenu } from "./mountBottomMenu.js";
import { mountWindows } from "./mountWindows.js";
import { mountOnboarding } from "./Onboarding.js";
import { mountUtilityOverlays } from "./UtilityOverlays.js";
import { mountWorldMap } from "./WorldMap.js";
import { mountContextMenu } from "./ContextMenu.js";
import { mountWorldIntel } from "./WorldIntel.js";

mountBottomMenu();
mountWindows();
mountUtilityOverlays();
mountWorldMap();
mountContextMenu();
mountWorldIntel();
mountOnboarding();

window.addEventListener("ashenfall-ui-state", renderBottomMenu);
