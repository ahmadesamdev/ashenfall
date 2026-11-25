import { MOVEMENT_SPEEDS } from "../../world/Movement.js";
import { finiteNumber } from "../../shared/Hardening.js";

export interface MovementCommandContext {
  world: any;
}
export type CommandResult = [boolean, string, any?];

export function createMovementCommands(ctx: MovementCommandContext) {
  const { world } = ctx;
  return {
    move(player: any, command: any): CommandResult {
      const x = finiteNumber(command.x),
        y = finiteNumber(command.y);
      if (x === undefined || y === undefined)
        return [false, "Invalid movement coordinates."];
      const mode = command.mode === "run" ? "run" : "walk";
      if (
        player.combat?.state === "recovery" &&
        Date.now() <= Number(player.combat.cancelWindowUntil || 0)
      ) {
        player.combat.state = "ready";
        player.combat.stateSince = Date.now();
        player.combat.currentActionId = null;
        player.combat.currentAbilityId = null;
      }
      const result = world.move(player, x, y, mode);
      if (result[0]) {
        player.combat.manualMove = true;
        player.combat.autoApproach = false;
      }
      return result;
    },
    moveInput(player: any, command: any): CommandResult {
      const dx = finiteNumber(command.dx),
        dy = finiteNumber(command.dy);
      if (dx === undefined || dy === undefined)
        return [false, "Invalid movement input."];
      const result = world.setMoveInput(player, dx, dy, command.mode);
      if (result[0]) {
        player.combat.manualMove = true;
        player.combat.autoApproach = false;
      }
      return result;
    },
    stop(player: any): CommandResult {
      const result = world.stop(player);
      if (result[0]) {
        player.combat.manualMove = false;
        player.combat.autoApproach = false;
      }
      return result;
    },
    toggleRun(player: any): CommandResult {
      player.movementMode = player.movementMode === "run" ? "walk" : "run";
      player.movementPreferenceInitialized = true;
      player.movementPreferenceVersion = 2;
      player.speed = MOVEMENT_SPEEDS.walk;
      player.runSpeed = MOVEMENT_SPEEDS.run;
      return [true, `Movement mode: ${player.movementMode}.`];
    },
  };
}
