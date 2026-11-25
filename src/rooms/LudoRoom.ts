import { randomInt } from "node:crypto";
import { Client, Delayed, Room, ServerError } from "@colyseus/core";
import { verifyToken } from "../auth";
import { config } from "../config";
import { LudoGame, pickBotMove } from "../engine/ludo";
import { getActiveGamesStore } from "../limits/activeGames";
import { checkEligibility, reportGame, reportResult, tournamentsEnabled } from "../tournaments/api";
import { LudoState, PlayerState } from "./LudoState";

export interface JoinOptions {
  userId?: string;
  name?: string;
  /** Login token from ludo-api (required when JWT_SECRET is set). */
  token?: string;
  /** 2 or 4 */
  players?: number;
  private?: boolean;
  /** Play a counted game in this tournament (ludo-api must be configured). */
  tournamentId?: string;
  /** Start straight away against computer players (private room, only this player). */
  vsBots?: boolean;
  /** Public lobby waits for real players; computer players are never added automatically. */
  waitForHumans?: boolean;
}

interface AuthData {
  userId: string;
  name: string;
}

/**
 * One room = one game. The room is authoritative: clients only send "roll" and
 * "move"; the server rolls the dice and validates every move with the engine.
 */
/** Allowed quick reactions (the app shows the same set). */
export const REACTIONS = ["😀", "😂", "😎", "😡", "😭", "👍", "👏", "🔥"];

export class LudoRoom extends Room<LudoState> {
  maxClients = 2;
  private game: LudoGame | null = null;
  private captureCount = new Map<number, number>();
  private seatList: number[] = [0, 2];
  private seatBySession = new Map<string, number>();
  private hostSession: string | null = null;
  private missedTurns = new Map<number, number>();
  private turnTimer: Delayed | null = null;
  private lobbyTimer: Delayed | null = null;
  /** Users holding one of their (limited) active-game slots through this room. */
  private heldUsers = new Set<string>();
  private tournamentId = "";
  private vsBots = false;
  private waitForHumans = false;
  private lastSnap = "";

  /**
   * Plain JSON copy of the game state, sent as a "snap" message whenever it changes.
   * Lets the native app read the game without decoding Colyseus' binary state format.
   */
  private pushSnap(): void {
    const json = JSON.stringify(this.state.toJSON());
    if (json === this.lastSnap) return;
    this.lastSnap = json;
    this.broadcast("snap", JSON.parse(json));
  }

  onCreate(options: JoinOptions): void {
    const players = options.players === 4 ? 4 : 2;
    this.seatList = players === 4 ? [0, 1, 2, 3] : [0, 2];
    this.maxClients = players;

    const state = new LudoState();
    state.playerCount = players;
    this.vsBots = options.vsBots === true;
    this.waitForHumans = options.waitForHumans === true;
    if (options.private || this.vsBots) {
      state.isPrivate = true;
      this.setPrivate(true);
    }
    if (typeof options.tournamentId === "string" && options.tournamentId) {
      this.tournamentId = options.tournamentId;
      state.tournamentId = options.tournamentId;
    }
    this.setState(state);
    this.clock.setInterval(() => this.pushSnap(), 100);

    this.onMessage("roll", (client) => this.handleRoll(client));
    this.onMessage("move", (client, message: { piece?: number }) =>
      this.handleMove(client, message?.piece),
    );
    this.onMessage("start", (client) => this.handleStart(client));
    this.onMessage("emoji", (client, message: { e?: unknown }) => this.handleEmoji(client, message?.e));
  }

  private lastEmojiAt = new Map<number, number>();

  /** Quick reactions: only a fixed set of emojis, at most one per second per player. */
  private handleEmoji(client: Client, e: unknown): void {
    const seat = this.seatOf(client);
    if (seat === undefined || typeof e !== "string" || !REACTIONS.includes(e)) return;
    const now = Date.now();
    if (now - (this.lastEmojiAt.get(seat) ?? 0) < 1000) return;
    this.lastEmojiAt.set(seat, now);
    this.broadcast("emoji", { seat, e });
  }

  /**
   * Validates the player and reserves one of their active-game slots.
   * With JWT_SECRET set the identity comes from the signed login token; otherwise (dev) from options.userId.
   */
  async onAuth(_client: Client, options: JoinOptions): Promise<AuthData> {
    let userId = typeof options?.userId === "string" ? options.userId.trim() : "";
    let name = (typeof options?.name === "string" ? options.name.trim() : "").slice(0, 20);
    if (config.jwtSecret) {
      const claims = verifyToken(options?.token, config.jwtSecret);
      if (!claims) throw new ServerError(4008, "login_required");
      userId = claims.sub;
      name = claims.name.slice(0, 20);
    }
    if (!userId || userId.length > 64) throw new ServerError(4001, "userId required");

    if (this.tournamentId) await this.requireEligible(userId);

    if (this.heldUsers.has(userId)) throw new ServerError(4004, "already_in_room");
    this.heldUsers.add(userId);
    let allowed = false;
    try {
      allowed = await getActiveGamesStore().tryAdd(userId, this.roomId);
    } catch {
      this.heldUsers.delete(userId);
      throw new ServerError(5000, "limit_check_failed");
    }
    if (!allowed) {
      this.heldUsers.delete(userId);
      throw new ServerError(4003, "max_active_games");
    }
    return { userId, name: name || "Player" };
  }

  /** Tournament rooms only admit registered players while the tournament is running. */
  private async requireEligible(userId: string): Promise<void> {
    if (!tournamentsEnabled()) throw new ServerError(4005, "tournaments_unavailable");
    let result;
    try {
      result = await checkEligibility(this.tournamentId, userId);
    } catch {
      throw new ServerError(4005, "tournaments_unavailable");
    }
    if (!result.eligible) throw new ServerError(4006, `not_eligible:${result.reason}`);
    if (result.playersPerGame !== this.state.playerCount) {
      throw new ServerError(4007, `wrong_game_size:${result.playersPerGame}`);
    }
  }

  private humanCount(): number {
    return this.state.players.filter((p) => !p.isBot).length;
  }

  /** Give a user's active-game slot back (idempotent). */
  private release(userId: string): void {
    if (!this.heldUsers.delete(userId)) return;
    getActiveGamesStore()
      .remove(userId, this.roomId)
      .catch(() => {});
  }

  onJoin(client: Client, _options: JoinOptions, auth: AuthData): void {
    const seat = this.seatList.find((s) => !this.state.players.some((p) => p.seat === s));
    if (seat === undefined) {
      this.release(auth.userId);
      throw new ServerError(4002, "room full");
    }

    const player = new PlayerState();
    player.seat = seat;
    player.userId = auth.userId;
    player.name = auth.name;
    this.state.players.push(player);
    this.seatBySession.set(client.sessionId, seat);
    this.hostSession ??= client.sessionId;
    client.send("snap", this.state.toJSON());
    this.armLobbyTimer();
    this.touch();

    if (this.state.players.length === this.seatList.length) this.startGame();
    else if (this.vsBots && !this.game) {
      this.fillWithBots();
      this.startGame();
    }
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    const seat = this.seatOf(client);
    if (seat === undefined) return;
    const player = this.playerBySeat(seat);
    if (!player) return;

    // Before the game starts, leaving just frees the seat.
    if (!this.game) {
      const idx = this.state.players.findIndex((p) => p.seat === seat);
      if (idx >= 0) this.state.players.splice(idx, 1);
      this.seatBySession.delete(client.sessionId);
      if (this.hostSession === client.sessionId) {
        this.hostSession = [...this.seatBySession.keys()][0] ?? null;
      }
      this.release(player.userId);
      this.touch();
      return;
    }

    if (this.game.phase === "finished") {
      player.connected = false;
      this.touch();
      return;
    }

    // Leaving on purpose forfeits the game.
    if (consented) {
      this.forfeitSeat(seat, "left");
      return;
    }

    // A dropped connection: auto-play for them while we wait for a reconnect.
    player.connected = false;
    this.scheduleTurn();
    this.touch();
    try {
      await this.allowReconnection(client, config.reconnectSeconds);
      player.connected = true;
      this.lastSnap = ""; // force a fresh snapshot to everyone
      this.scheduleTurn();
      this.touch();
    } catch {
      // Did not come back in time: a bot takes over the seat.
      if (this.isRunning() && !player.forfeited) {
        player.isBot = true;
        this.release(player.userId);
        this.broadcast("bot_takeover", { seat });
        this.scheduleTurn();
        this.touch();
      }
    }
  }

  onDispose(): void {
    this.turnTimer?.clear();
    for (const userId of [...this.heldUsers]) this.release(userId);
  }

  // ---- lobby -------------------------------------------------------------

  private handleStart(client: Client): void {
    if (this.game || client.sessionId !== this.hostSession) return;
    if (this.tournamentId && this.humanCount() < 2) return;
    this.fillWithBots();
    this.startGame();
  }

  /** Public lobbies start with bots after a wait; private rooms wait for the host. */
  private armLobbyTimer(): void {
    if (this.lobbyTimer || this.game || this.state.isPrivate || this.waitForHumans) return;
    const ms = config.lobbyFillSeconds * 1000;
    this.state.fillDeadline = Date.now() + ms;
    this.lobbyTimer = this.clock.setTimeout(() => {
      this.lobbyTimer = null;
      if (this.game || this.state.players.length === 0) return;
      if (this.tournamentId && this.humanCount() < 2) {
        this.armLobbyTimer(); // a counted game needs two real players: keep waiting
        return;
      }
      this.fillWithBots();
      this.startGame();
    }, ms);
  }

  private fillWithBots(): void {
    let n = 1;
    for (const seat of this.seatList) {
      if (this.state.players.some((p) => p.seat === seat)) continue;
      const bot = new PlayerState();
      bot.seat = seat;
      bot.userId = `bot-${seat}`;
      bot.name = `Bot ${n++}`;
      bot.isBot = true;
      this.state.players.push(bot);
    }
  }

  private startGame(): void {
    if (this.game) return;
    this.lobbyTimer?.clear();
    this.lobbyTimer = null;
    this.state.fillDeadline = 0;
    this.game = new LudoGame(this.seatList);
    this.lock();
    this.syncState();
  }

  // ---- player actions ----------------------------------------------------

  /** True while a game exists and has not finished (read fresh, safe across awaits). */
  private isRunning(): boolean {
    return this.game !== null && this.game.phase !== "finished";
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
    this.missedTurns.set(seat, 0);
    this.rollFor(seat);
  }

  private handleMove(client: Client, piece: unknown): void {
    const game = this.game;
    const seat = this.seatOf(client);
    if (!game || seat === undefined || game.phase !== "move" || game.turn !== seat) return;
    if (typeof piece !== "number" || !game.legal.includes(piece)) return;
    this.missedTurns.set(seat, 0);
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
    if (result.captured.length > 0) this.captureCount.set(seat, (this.captureCount.get(seat) ?? 0) + result.captured.length);
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

  // ---- clock, bots, auto-play -------------------------------------------

  /** Decide who acts next and when: bots and dropped players act after a short pause, humans get the turn clock. */
  private scheduleTurn(): void {
    this.turnTimer?.clear();
    this.turnTimer = null;
    this.state.turnDeadline = 0;
    const game = this.game;
    if (!game || game.phase === "finished") return;

    const seat = game.turn;
    const player = this.playerBySeat(seat);
    if (!player) return;

    if (player.isBot || !player.connected) {
      this.turnTimer = this.clock.setTimeout(() => this.botStep(seat), config.botDelayMs);
      return;
    }

    if (config.autoSingleMove && game.phase === "move" && game.legal.length === 1) {
      const piece = game.legal[0];
      this.turnTimer = this.clock.setTimeout(() => {
        if (this.game?.turn === seat && this.game.phase === "move") this.moveFor(seat, piece);
      }, config.autoMoveDelayMs);
      return;
    }

    const ms = config.turnTimeoutSeconds * 1000;
    this.state.turnDeadline = Date.now() + ms;
    this.turnTimer = this.clock.setTimeout(() => this.onTurnTimeout(seat), ms);
  }

  /** One bot action: roll, or choose a move. Each action reschedules the next. */
  private botStep(seat: number): void {
    const game = this.game;
    if (!game || game.turn !== seat) return;
    if (game.phase === "roll") this.rollFor(seat);
    else if (game.phase === "move") this.moveFor(seat, pickBotMove(game));
  }

  private onTurnTimeout(seat: number): void {
    const game = this.game;
    if (!game || game.turn !== seat || game.phase === "finished") return;

    const missed = (this.missedTurns.get(seat) ?? 0) + 1;
    this.missedTurns.set(seat, missed);
    if (missed >= config.maxMissedTurns) {
      this.forfeitSeat(seat, "timeout");
      return;
    }

    // Play the whole turn for them.
    if (game.phase === "roll") this.rollFor(seat);
    if (this.game && this.game.turn === seat && this.game.phase === "move") {
      this.moveFor(seat, pickBotMove(this.game));
    }
  }

  private forfeitSeat(seat: number, reason: "timeout" | "left"): void {
    const game = this.game;
    const player = this.playerBySeat(seat);
    if (!game || !player || player.forfeited) return;
    const ended = game.forfeit(seat);
    player.forfeited = true;
    this.release(player.userId);
    this.broadcast("forfeit", { seat, reason });
    this.syncState();
    if (ended) this.endGame();
  }

  /** Captures made and pawns that reached home for a seat, used by tournament scoring. */
  private stats(seat: number): { captures: number; home: number } {
    const pieces = this.game?.pieces[seat] ?? [];
    return { captures: this.captureCount.get(seat) ?? 0, home: pieces.filter((x) => x === 56).length };
  }

  private endGame(): void {
    const game = this.game!;
    const placements = game.placements();
    placements.forEach((seat, i) => {
      const player = this.playerBySeat(seat);
      if (player) player.placement = i + 1;
    });
    this.turnTimer?.clear();
    this.state.turnDeadline = 0;
    for (const p of this.state.players) this.release(p.userId);
    this.touch();
    this.broadcast("game_over", {
      placements: placements.map((seat, i) => {
        const p = this.playerBySeat(seat);
        return { seat, placement: i + 1, userId: p?.userId, name: p?.name, isBot: !!p?.isBot };
      }),
    });
    if (this.tournamentId) {
      void reportGame({
        tournamentId: this.tournamentId,
        gameId: this.roomId,
        placements: placements.map((seat, i) => {
          const p = this.playerBySeat(seat);
          return { userId: p?.userId ?? `seat-${seat}`, placement: i + 1, isBot: !!p?.isBot, ...this.stats(seat) };
        }),
      });
    }
    void reportResult({
      gameId: this.roomId,
      placements: placements.map((seat, i) => {
        const p = this.playerBySeat(seat);
        return { userId: p?.userId ?? `seat-${seat}`, placement: i + 1, isBot: !!p?.isBot, ...this.stats(seat) };
      }),
    });
    this.clock.setTimeout(() => this.disconnect(), config.finishedCloseMs);
  }

  /** Mirror engine state into the synchronised schema and arm the next turn. */
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
    this.scheduleTurn();
    this.touch();
  }

  private touch(): void {
    this.state.seq += 1;
  }
}
