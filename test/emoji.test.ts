import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { newClient, startTestServer } from "./helpers";

describe("emoji reactions", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => { server = await startTestServer(); });
  after(async () => { await server.stop(); });

  it("relays allowed emojis, ignores others and rate limits", async () => {
    const room = await newClient(server.url).create("ludo", { userId: "emo", players: 2, vsBots: true });
    const got: any[] = [];
    room.onMessage("emoji", (m: any) => got.push(m));
    room.send("emoji", { e: "🔥" });
    room.send("emoji", { e: "<script>" });
    room.send("emoji", { e: "👍" }); // within one second of the first: dropped
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(got.length, 1);
    assert.equal(got[0].e, "🔥");
    assert.equal(typeof got[0].seat, "number");
    await room.leave();
  });
});
