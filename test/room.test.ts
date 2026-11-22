import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { autoPlay, newClient, startTestServer } from "./helpers";

describe("ludo room", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  it("plays a full 2-player game; the server rolls the dice and ranks players", async () => {
    const a = await newClient(server.url).joinOrCreate("ludo", { userId: "a", name: "Asha", players: 2 });
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "b", name: "Ben", players: 2 });
    assert.equal(a.roomId, b.roomId);

    const [resA, resB] = await Promise.all([autoPlay(a, "a"), autoPlay(b, "b")]);
    assert.deepEqual(resA, resB);
    assert.equal(resA.placements.length, 2);
    assert.deepEqual(resA.placements.map((p) => p.placement), [1, 2]);
    assert.deepEqual(resA.placements.map((p) => p.seat).sort(), [0, 2]);

    await a.leave();
    await b.leave();
  });

  it("ignores actions taken out of turn and dice values sent by clients", async () => {
    const a = await newClient(server.url).joinOrCreate("ludo", { userId: "c", players: 2 });
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "d", players: 2 });
    await new Promise((r) => setTimeout(r, 200));

    const state = a.state as any;
    assert.equal(state.phase, "roll");
    assert.equal(state.currentSeat, 0);

    // Player d (seat 2) tries to roll and move out of turn; a fake dice value is ignored.
    b.send("roll", { dice: 6 });
    b.send("move", { piece: 0 });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(state.phase, "roll");
    assert.equal(state.currentSeat, 0);
    assert.equal(state.dice, 0);

    await a.leave();
    await b.leave();
  });
});
