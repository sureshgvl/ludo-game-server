import { Schema, type } from "@colyseus/schema";

export class LudoState extends Schema {
  @type("string") phase: "waiting" | "playing" | "finished" = "waiting";
  @type("number") currentSeat = 0;
  @type("number") lastDice = 0;
}
