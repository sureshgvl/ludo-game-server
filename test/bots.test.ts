import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { config } from "../src/config";
import { autoPlay, newClient, startTestServer } from "./helpers";

function waitFor<T>(room: any, event: string): Promise<T> {
  return new Promise((resolve) => room.onMessage(event, (m: T) => resolve(m)));
}

describe("bots, timers and reconnect", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  const saved = { ...config };

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });
  beforeEach(() => {
    config.botDelayMs = 0;
    config.autoMoveDelayMs = 0;
  });
  afterEach(() => {
    Object.assign(config, saved);
  });

  it("host can start early and bots fill the empty seats", async () => {
    const room = await newClient(server.url).create("ludo", { userId: "h1", name: "Hana", players: 2 });
    const over = autoPlay(room, "h1");
    room.send("start");
    const result = await over;
    assert.equal(result.placements.length, 2);
    assert.equal(result.placements.filter((p) => p.isBot).length, 1);
    await room.leave();
  });

  it("a player who never acts forfeits after three missed turns", async () => {
    config.turnTimeoutSeconds = 0.12;
    const room = await newClient(server.url).create("ludo", { userId: "idle", players: 2 });
    const forfeit = waitFor<{ seat: number; reason: string }>(room, "forfeit");
    const over = waitFor<{ placements: { userId: string; placement: number }[] }>(room, "game_over");
    room.send("start");

    assert.equal((await forfeit).reason, "timeout");
    const result = await over;
    const idle = result.placements.find((p) => p.userId === "idle")!;
    assert.equal(idle.placement, 2);
    await room.leave();
  });

  it("a dropped player is auto-played, then replaced by a bot if they stay away", async () => {
    config.reconnectSeconds = 0.4;
    config.botDelayMs = 15;
    const a = await newClient(server.url).joinOrCreate("ludo", { userId: "drop", players: 2 });
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "stay", players: 2 });
    const over = autoPlay(b, "stay");
    await a.leave(false); // connection lost, not a deliberate leave
    const result = await over;
    const dropped = result.placements.find((p) => p.userId === "drop")!;
    assert.equal(dropped.isBot, true);
    await b.leave();
  });

  it("a dropped player can reconnect within the window and stays human", async () => {
    config.reconnectSeconds = 5;
    config.botDelayMs = 40;
    const client = newClient(server.url);
    const a = await client.joinOrCreate("ludo", { userId: "back", players: 2 });
    const b = await newClient(server.url).joinOrCreate("ludo", { userId: "other", players: 2 });
    const over = autoPlay(b, "other");
    const token = a.reconnectionToken;
    await a.leave(false);
    await new Promise((r) => setTimeout(r, 100));
    const a2 = await client.reconnect(token);
    const me = autoPlay(a2, "back");
    const [result] = await Promise.all([over, me]);
    const back = result.placements.find((p) => p.userId === "back")!;
    assert.equal(back.isBot, false);
    await a2.leave();
    await b.leave();
  });
});
