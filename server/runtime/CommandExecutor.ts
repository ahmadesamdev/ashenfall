import { createCommandHandlers } from "./CommandHandlers.js";
import { COMBAT_ACTIONS, isCommandAction } from "./CommandActions.js";

export function createCommandExecutor(ctx: any) {
  const { bus } = ctx;
  const handlers = createCommandHandlers(ctx);

  return async function handle(player: any, command: any) {
    const action = command?.action;
    bus.emit("command.received", { playerId: player.id, action, command });

    if (isCommandAction(action) && COMBAT_ACTIONS.has(action)) {
      player.combat = player.combat || {};
      player.combat.currentActionId = String(
        command.requestId || `${Date.now()}-${Math.random()}`,
      );
    }

    if (!isCommandAction(action)) return [false, "Unknown command."];

    const handler = handlers[action];
    if (!handler) return [false, "Command is not registered."];
    return handler(player, command);
  };
}
