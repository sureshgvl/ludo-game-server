import { ArraySchema, Schema, type } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("number") seat = 0;
  @type("string") userId = "";
  @type("string") name = "";
  @type("boolean") isBot = false;
  @type("boolean") connected = true;
  @type("boolean") forfeited = false;
  /** 1 = winner. 0 until the game is over. */
  @type("number") placement = 0;
  @type(["number"]) pieces = new ArraySchema<number>(-1, -1, -1, -1);
}

export class LudoState extends Schema {
  /** lobby | roll | move | finished */
  @type("string") phase = "lobby";
  @type("number") playerCount = 2;
  /** Private rooms are joined by room id (the share code) and never matched automatically. */
  @type("boolean") isPrivate = false;
  /** Epoch ms when empty seats are filled with bots in a public lobby (0 = no countdown). */
  @type("number") fillDeadline = 0;
  @type("number") currentSeat = -1;
  @type("number") dice = 0;
  /** Piece indexes the current player may move (only in the move phase). */
  @type(["number"]) legalMoves = new ArraySchema<number>();
  /** Epoch ms when the current human turn times out (0 when nobody is on the clock). */
  @type("number") turnDeadline = 0;
  /** Increments on every change so clients can act exactly once per update. */
  @type("number") seq = 0;
  @type([PlayerState]) players = new ArraySchema<PlayerState>();
}
