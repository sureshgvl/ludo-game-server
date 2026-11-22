import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HOME_PROGRESS, LudoGame, pickBotMove, SEAT_START, YARD } from "../src/engine/ludo";

function game2(): LudoGame {
  return new LudoGame([0, 2]);
}

describe("ludo engine", () => {
  it("needs a 6 to leave the yard and passes the turn otherwise", () => {
    const g = game2();
    const r = g.roll(3);
    assert.equal(r.passed, true);
    assert.equal(r.reason, "no-moves");
    assert.equal(g.turn, 2);
    assert.equal(g.phase, "roll");
  });

  it("a 6 releases a piece onto the start square and gives another roll", () => {
    const g = game2();
    const r = g.roll(6);
    assert.deepEqual(r.legal, [0, 1, 2, 3]);
    const m = g.move(0);
    assert.equal(m.to, 0);
    assert.equal(m.extraTurn, true);
    assert.equal(g.turn, 0);
    assert.equal(g.phase, "roll");
  });

  it("rejects moves in the wrong phase or with an illegal piece", () => {
    const g = game2();
    assert.throws(() => g.move(0));
    g.roll(6);
    g.pieces[0][1] = 10;
    assert.throws(() => g.move(9));
    assert.throws(() => g.roll(2));
  });

  it("requires an exact roll to finish", () => {
    const g = game2();
    g.pieces[0][0] = 54;
    assert.deepEqual(g.legalMoves(0, 3), []);
    assert.deepEqual(g.legalMoves(0, 2), [0]);
    g.roll(2);
    const m = g.move(0);
    assert.equal(m.to, HOME_PROGRESS);
    assert.equal(m.reachedHome, true);
    assert.equal(m.extraTurn, true);
  });

  it("captures an opponent on a non-safe square", () => {
    const g = game2();
    g.pieces[0][0] = 3; // abs 3
    g.pieces[2][0] = (3 + 2 - SEAT_START[2] + 52) % 52; // seat 2 piece on abs 5
    g.roll(2);
    const m = g.move(0);
    assert.deepEqual(m.captured, [{ seat: 2, piece: 0 }]);
    assert.equal(g.pieces[2][0], YARD);
    assert.equal(m.extraTurn, true);
  });

  it("does not capture on a safe square", () => {
    const g = game2();
    g.pieces[0][0] = 6; // abs 6, moving 2 lands on star square 8
    g.pieces[2][0] = (8 - SEAT_START[2] + 52) % 52;
    g.roll(2);
    const m = g.move(0);
    assert.equal(m.captured.length, 0);
    assert.notEqual(g.pieces[2][0], YARD);
  });

  it("does not capture pieces that are in the home column", () => {
    const g = game2();
    g.pieces[0][0] = 48;
    g.pieces[2][0] = 53;
    g.roll(2);
    assert.equal(g.move(0).captured.length, 0);
  });

  it("forfeits the turn after three sixes in a row", () => {
    const g = game2();
    g.roll(6);
    g.move(0);
    g.roll(6);
    g.move(0);
    const r = g.roll(6);
    assert.equal(r.passed, true);
    assert.equal(r.reason, "three-sixes");
    assert.equal(g.turn, 2);
  });

  it("finishes the game and ranks players", () => {
    const g = game2();
    g.pieces[0] = [56, 56, 56, 55];
    g.roll(1);
    const m = g.move(3);
    assert.equal(m.seatFinished, true);
    assert.equal(m.gameOver, true);
    assert.equal(g.phase, "finished");
    assert.deepEqual(g.placements(), [0, 2]);
  });

  it("forfeit hands the win to the last player standing", () => {
    const g = new LudoGame([0, 1, 2, 3]);
    assert.equal(g.forfeit(1), false);
    assert.equal(g.forfeit(2), false);
    assert.equal(g.forfeit(3), true);
    assert.equal(g.phase, "finished");
    assert.deepEqual(g.placements(), [0, 3, 2, 1]);
  });

  it("forfeiting on your own turn moves play to the next seat", () => {
    const g = new LudoGame([0, 1, 2]);
    g.forfeit(0);
    assert.equal(g.turn, 1);
    assert.equal(g.phase, "roll");
  });

  it("simulates complete random games for 2, 3 and 4 players", () => {
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const layouts = [[0, 2], [0, 1, 2], [0, 1, 2, 3], [1, 3]];
    for (let n = 0; n < 200; n++) {
      const seats = layouts[n % layouts.length];
      const g = new LudoGame(seats);
      let steps = 0;
      while (g.phase !== "finished") {
        if (++steps > 200000) assert.fail("game did not terminate");
        if (g.phase === "roll") {
          g.roll(1 + Math.floor(rnd() * 6));
        } else {
          const piece = n % 2 === 0 ? pickBotMove(g) : g.legal[Math.floor(rnd() * g.legal.length)];
          g.move(piece);
        }
      }
      const placements = g.placements();
      assert.equal(placements.length, seats.length);
      assert.deepEqual([...placements].sort(), [...seats].sort());
    }
  });
});
