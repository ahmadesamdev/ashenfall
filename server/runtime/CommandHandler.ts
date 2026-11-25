import { createCommandExecutor } from "./CommandExecutor.js";

export function createCommandHandler(ctx: any) {
  const execute = createCommandExecutor(ctx);
  return async function handleCommand(player: any, command: any) {
    return execute(player, command);
  };
}
