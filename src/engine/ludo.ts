/**
 * Pure Ludo rules engine. No I/O, no randomness: the caller supplies dice values,
 * so the room can use a server-side CSPRNG and tests can script exact games.
 *
 * Progress model for one piece:
 *   -1        in the yard
 *   0..50     on the shared 52-square track, relative to the seat's start square
 *   51..55    on the seat's private home column
 *   56        home (finished)
 */

export const TRACK_LENGTH = 52;
export const LAST_TRACK_PROGRESS = 50;
export const HOME_PROGRESS = 56;
export const PIECES_PER_PLAYER = 4;
export const YARD = -1;

/** Absolute track index where each seat's pieces enter the board. */
export const SEAT_START = [0, 13, 26, 39];

/** Start squares plus the star squares; pieces here cannot be captured. */
export const SAFE_SQUARES: ReadonlySet<number> = new Set([0, 8, 13, 21, 26, 34, 39, 47]);

export type Phase = "roll" | "move" | "finished";
export type PassReason = "no-moves" | "three-sixes";

export interface RollResult {
  dice: number;
  legal: number[];
  passed: boolean;
  reason?: PassReason;
}

export interface Capture {
  seat: number;
  piece: number;
}

export interface MoveResult {
  seat: number;
  piece: number;
  dice: number;
  from: number;
  to: number;
  captured: Capture[];
  reachedHome: boolean;
  seatFinished: boolean;
  extraTurn: boolean;
  gameOver: boolean;
}

/** Absolute track square for a progress value, or null when off the shared track. */
export function absoluteSquare(seat: number, progress: number): number | null {
  if (progress < 0 || progress > LAST_TRACK_PROGRESS) return null;
  return (SEAT_START[seat] + progress) % TRACK_LENGTH;
}

export class LudoGame {
  readonly seats: number[];
  pieces: number[][];
  turn: number;
  phase: Phase = "roll";
  dice = 0;
  sixes = 0;
  legal: number[] = [];
  finishOrder: number[] = [];
  forfeited: number[] = [];

  constructor(seats: number[], firstSeat?: number) {
    if (seats.length < 2 || seats.length > 4) throw new Error("Ludo needs 2 to 4 seats");
    if (new Set(seats).size !== seats.length) throw new Error("Duplicate seats");
    if (seats.some((s) => !Number.isInteger(s) || s < 0 || s > 3)) throw new Error("Invalid seat");
    this.seats = [...seats];
    this.pieces = [0, 1, 2, 3].map(() => new Array(PIECES_PER_PLAYER).fill(YARD));
    this.turn = firstSeat ?? this.seats[0];
    if (!this.seats.includes(this.turn)) throw new Error("First seat is not in the game");
  }

  isActive(seat: number): boolean {
    return (
      this.seats.includes(seat) &&
      !this.finishOrder.includes(seat) &&
      !this.forfeited.includes(seat)
    );
  }

  activeSeats(): number[] {
    return this.seats.filter((s) => this.isActive(s));
  }

  private nextSeat(from: number): number {
    const idx = this.seats.indexOf(from);
    for (let i = 1; i <= this.seats.length; i++) {
      const seat = this.seats[(idx + i) % this.seats.length];
      if (this.isActive(seat)) return seat;
    }
    return from;
  }

  legalMoves(seat: number, dice: number): number[] {
    const moves: number[] = [];
    this.pieces[seat].forEach((p, i) => {
      if (p === YARD) {
        if (dice === 6) moves.push(i);
      } else if (p < HOME_PROGRESS && p + dice <= HOME_PROGRESS) {
        moves.push(i);
      }
    });
    return moves;
  }

  /** Opponent pieces that would be captured if `seat`'s `piece` moved `dice` squares. */
  previewCaptures(seat: number, piece: number, dice: number): Capture[] {
    const from = this.pieces[seat][piece];
    const to = from === YARD ? 0 : from + dice;
    const abs = absoluteSquare(seat, to);
    if (abs === null || SAFE_SQUARES.has(abs)) return [];
    const captured: Capture[] = [];
    for (const other of this.seats) {
      if (other === seat) continue;
      this.pieces[other].forEach((p, i) => {
        if (absoluteSquare(other, p) === abs) captured.push({ seat: other, piece: i });
      });
    }
    return captured;
  }

  private passTurn(): void {
    this.turn = this.nextSeat(this.turn);
    this.sixes = 0;
    this.phase = "roll";
    this.legal = [];
  }

  roll(dice: number): RollResult {
    if (this.phase !== "roll") throw new Error("Not waiting for a roll");
    if (!Number.isInteger(dice) || dice < 1 || dice > 6) throw new Error("Invalid dice");
    this.dice = dice;
    this.sixes = dice === 6 ? this.sixes + 1 : 0;

    if (this.sixes >= 3) {
      this.passTurn();
      return { dice, legal: [], passed: true, reason: "three-sixes" };
    }
    const legal = this.legalMoves(this.turn, dice);
    if (legal.length === 0) {
      this.passTurn();
      return { dice, legal: [], passed: true, reason: "no-moves" };
    }
    this.legal = legal;
    this.phase = "move";
    return { dice, legal, passed: false };
  }

  move(piece: number): MoveResult {
    if (this.phase !== "move") throw new Error("Not waiting for a move");
    if (!this.legal.includes(piece)) throw new Error("Illegal move");

    const seat = this.turn;
    const dice = this.dice;
    const from = this.pieces[seat][piece];
    const captured = this.previewCaptures(seat, piece, dice);
    const to = from === YARD ? 0 : from + dice;

    this.pieces[seat][piece] = to;
    for (const c of captured) this.pieces[c.seat][c.piece] = YARD;

    const reachedHome = to === HOME_PROGRESS;
    const seatFinished = this.pieces[seat].every((p) => p === HOME_PROGRESS);
    if (seatFinished) this.finishOrder.push(seat);

    const extraTurn = !seatFinished && (dice === 6 || captured.length > 0 || reachedHome);
    const gameOver = this.activeSeats().length <= 1;

    this.legal = [];
    if (gameOver) {
      this.phase = "finished";
    } else if (extraTurn) {
      this.phase = "roll";
    } else {
      this.passTurn();
    }
    return { seat, piece, dice, from, to, captured, reachedHome, seatFinished, extraTurn, gameOver };
  }

  /** Remove a seat from play (quit or too many missed turns). Returns true if the game ended. */
  forfeit(seat: number): boolean {
    if (!this.isActive(seat) || this.phase === "finished") return this.phase === "finished";
    this.forfeited.push(seat);
    this.pieces[seat].fill(YARD);
    if (this.activeSeats().length <= 1) {
      this.phase = "finished";
      this.legal = [];
      return true;
    }
    if (this.turn === seat) this.passTurn();
    return false;
  }

  /** Seats from best to worst. Complete once the game is finished. */
  placements(): number[] {
    const remaining = this.activeSeats();
    return [...this.finishOrder, ...remaining, ...[...this.forfeited].reverse()];
  }
}

/** Score-based move choice used by bots and by auto-play after a timeout. */
export function pickBotMove(game: LudoGame): number {
  const seat = game.turn;
  let best = game.legal[0];
  let bestScore = -Infinity;
  for (const piece of game.legal) {
    const from = game.pieces[seat][piece];
    const to = from === YARD ? 0 : from + game.dice;
    let score = to; // prefer advancing the piece that is furthest along
    if (to === HOME_PROGRESS) score += 100;
    if (game.previewCaptures(seat, piece, game.dice).length > 0) score += 80;
    if (from === YARD) score += 50;
    const abs = absoluteSquare(seat, to);
    if (abs !== null && SAFE_SQUARES.has(abs)) score += 20;
    if (to > LAST_TRACK_PROGRESS) score += 10; // safe in the home column
    if (score > bestScore) {
      bestScore = score;
      best = piece;
    }
  }
  return best;
}
