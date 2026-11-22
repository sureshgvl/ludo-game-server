import { randomInt } from "node:crypto";
import { Client, Room, ServerError } from "@colyseus/core";
import { config } from "../config";
import { LudoGame } from "../engine/ludo";
import { LudoState, PlayerState } from "./LudoState";

export interface JoinOptions {
  userId?: string;
  name?: string;
  /** 2 or 4 */
  players?: number;
  private?: boolean;
}

interface AuthData {
  userId: string;
  name: string;
}

/**
 * One room = one game. The room is authoritative: clients only send "roll" and
 * "move"; the server rolls the dice and validates every move with the engine.
 */
export class LudoRoom extends Room<LudoState> {
  maxClients = 2;
  private game: LudoGame | null = null;
  private seatList: number[] = [0, 2];
  private seatBySession = new Map<string, number>();

  onCreate(options: JoinOptions): void {
    const players = options.players === 4 ? 4 : 2;
    this.seatList = players === 4 ? [0, 1, 2, 3] : [0, 2];
    this.maxClients = players;

    const state = new LudoState();
    state.playerCount = players;
    this.setState(state);

    this.onMessage("roll", (client) => this.handleRoll(client));
    this.onMessage("move", (client, message: { piece?: number }) =>
      this.handleMove(client, message?.piece),
    );
  }

  onAuth(_client: Client, options: JoinOptions): AuthData {
    const userId = typeof options?.userId === "string" ? options.userId.trim() : "";
    if (!userId || userId.length > 64) throw new ServerError(4001, "userId required");
    const name = (typeof options.name === "string" ? options.name.trim() : "").slice(0, 20);
    return { userId, name: name || "Player" };
  }

  onJoin(client: Client, _options: JoinOptions, auth: AuthData): void {
    const seat = this.seatList.find((s) => !this.state.players.some((p) => p.seat === s));
    if (seat === undefined) throw new ServerError(4002, "room full");

    const player = new PlayerState();
    player.seat = seat;
    player.userId = auth.userId;
    player.name = auth.name;
    this.state.players.push(player);
    this.seatBySession.set(client.sessionId, seat);
    this.touch();

    if (this.state.players.length === this.seatList.length) this.startGame();
  }

  private startGame(): void {
    this.game = new LudoGame(this.seatList);
    this.lock();
    this.syncState();
  }

  private playerBySeat(seat: number): PlayerState | undefined {
    return this.state.players.find((p) => p.seat === seat);
  }

  private seatOf(client: Client): number | undefined {
    return this.seatBySession.get(client.sessionId);
  }

  private handleRoll(client: Client): void {
    const game = this.game;
    const seat = this.seatOf(client);
    if (!game || seat === undefined || game.phase !== "roll" || game.turn !== seat) return;
    this.rollFor(seat);
  }

  private handleMove(client: Client, piece: unknown): void {
    const game = this.game;
    const seat = this.seatOf(client);
    if (!game || seat === undefined || game.phase !== "move" || game.turn !== seat) return;
    if (typeof piece !== "number" || !game.legal.includes(piece)) return;
    this.moveFor(seat, piece);
  }

  /** The server rolls the dice with a CSPRNG; the client never sends a value. */
  private rollFor(seat: number): void {
    const game = this.game!;
    const result = game.roll(randomInt(1, 7));
    this.broadcast("rolled", {
      seat,
      dice: result.dice,
      passed: result.passed,
      reason: result.reason ?? null,
    });
    this.syncState();
  }

  private moveFor(seat: number, piece: number): void {
    const game = this.game!;
    const result = game.move(piece);
    this.broadcast("moved", {
      seat,
      piece,
      from: result.from,
      to: result.to,
      captured: result.captured,
      reachedHome: result.reachedHome,
      seatFinished: result.seatFinished,
    });
    this.syncState();
    if (result.gameOver) this.endGame();
  }

  private endGame(): void {
    const game = this.game!;
    const placements = game.placements();
    placements.forEach((seat, i) => {
      const player = this.playerBySeat(seat);
      if (player) player.placement = i + 1;
    });
    this.touch();
    this.broadcast("game_over", {
      placements: placements.map((seat, i) => {
        const p = this.playerBySeat(seat);
        return { seat, placement: i + 1, userId: p?.userId, name: p?.name, isBot: !!p?.isBot };
      }),
    });
    this.clock.setTimeout(() => this.disconnect(), config.finishedCloseMs);
  }

  /** Mirror engine state into the synchronised schema. */
  private syncState(): void {
    const game = this.game;
    if (!game) return;
    this.state.phase = game.phase;
    this.state.currentSeat = game.phase === "finished" ? -1 : game.turn;
    this.state.dice = game.dice;
    this.state.legalMoves.clear();
    game.legal.forEach((p) => this.state.legalMoves.push(p));
    for (const player of this.state.players) {
      game.pieces[player.seat].forEach((value, i) => {
        player.pieces[i] = value;
      });
    }
    this.touch();
  }

  private touch(): void {
    this.state.seq += 1;
  }
}
