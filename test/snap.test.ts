import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newClient, startTestServer } from "./helpers";

describe("json snapshots for the native app", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  it("sends the full state as plain JSON on join and again when it changes", async () => {
    const room = await newClient(server.url).create("ludo", { userId: "snapper", players: 2, vsBots: true });
    const snaps: any[] = [];
    room.onMessage("snap", (s: any) => snaps.push(s));
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(snaps.length >= 1, "got a snapshot");
    const last = snaps[snaps.length - 1];
    assert.equal(last.players.length, 2);
    assert.equal(typeof last.phase, "string");
    assert.ok(Array.isArray(last.players[0].pieces));
    assert.ok("currentSeat" in last && "legalMoves" in last && "turnDeadline" in last);
    await room.leave();
  });
});
