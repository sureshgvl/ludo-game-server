import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newClient, startTestServer } from "./helpers";

describe("play modes", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  it("vs computer starts at once with computer players in the other seats", async () => {
    const room = await newClient(server.url).create("ludo", { userId: "solo", players: 4, vsBots: true });
    await new Promise((r) => setTimeout(r, 200));
    const st = room.state as any;
    assert.notEqual(st.phase, "lobby");
    assert.equal(st.players.length, 4);
    assert.equal(st.players.filter((p: any) => p.isBot).length, 3);
    assert.equal(st.isPrivate, true);
    await room.leave();
  });

  it("online play waits for real players and never adds computer players by itself", async () => {
    const a = await newClient(server.url).joinOrCreate("ludo", { userId: "w1", players: 2, waitForHumans: true });
    await new Promise((r) => setTimeout(r, 300));
    const st = a.state as any;
    assert.equal(st.phase, "lobby");
    assert.equal(st.fillDeadline, 0);
    assert.equal(st.players.length, 1);
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "w2", players: 2, waitForHumans: true });
    assert.equal(a.roomId, b.roomId);
    await new Promise((r) => setTimeout(r, 200));
    assert.notEqual((a.state as any).phase, "lobby");
    await a.leave();
    await b.leave();
  });

  it("plays a human's only legal move automatically after a short pause", async () => {
    const a = await newClient(server.url).joinOrCreate("ludo", { userId: "m1", players: 2, waitForHumans: true, });
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "m2", players: 2, waitForHumans: true });
    await new Promise((r) => setTimeout(r, 200));
    // roll until a roll leaves exactly one legal move, then make sure the server plays it
    let checked = false;
    for (let i = 0; i < 60 && !checked; i++) {
      const st = a.state as any;
      const turnRoom = st.currentSeat === st.players.find((p: any) => p.userId === "m1").seat ? a : b;
      const s2 = turnRoom.state as any;
      if (s2.phase === "roll") turnRoom.send("roll");
      await new Promise((r) => setTimeout(r, 120));
      const s3 = turnRoom.state as any;
      if (s3.phase === "move" && s3.legalMoves.length === 1) {
        const seq = s3.seq;
        await new Promise((r) => setTimeout(r, 1200)); // longer than the forced-move delay
        assert.notEqual((turnRoom.state as any).seq, seq, "the only legal move should have been played");
        checked = true;
      } else if (s3.phase === "move") {
        turnRoom.send("move", { piece: s3.legalMoves[0] });
        await new Promise((r) => setTimeout(r, 60));
      }
    }
    assert.ok(checked, "never saw a single-legal-move situation");
    await a.leave();
    await b.leave();
  });
});
