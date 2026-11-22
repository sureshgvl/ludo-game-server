import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { config } from "../src/config";
import { MemoryActiveGamesStore, setActiveGamesStore } from "../src/limits/activeGames";
import { autoPlay, newClient, startTestServer } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("lobby", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  const saved = { ...config };

  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });
  beforeEach(() => {
    setActiveGamesStore(new MemoryActiveGamesStore(3));
    config.botDelayMs = 0;
    config.autoMoveDelayMs = 0;
  });
  afterEach(() => {
    Object.assign(config, saved);
    setActiveGamesStore(null);
  });

  it("quick match pairs players by requested player count", async () => {
    const two1 = await newClient(server.url).joinOrCreate("ludo", { userId: "m1", players: 2 });
    const four1 = await newClient(server.url).joinOrCreate("ludo", { userId: "m2", players: 4 });
    const two2 = await newClient(server.url).joinOrCreate("ludo", { userId: "m3", players: 2 });
    const two3 = await newClient(server.url).joinOrCreate("ludo", { userId: "m4", players: 2 });

    assert.equal(two1.roomId, two2.roomId, "2-player seekers share a room");
    assert.notEqual(four1.roomId, two1.roomId, "4-player seeker gets another room");
    assert.notEqual(two3.roomId, two1.roomId, "a full, started room is not reused");

    for (const r of [two1, four1, two2, two3]) await r.leave();
  });

  it("private rooms are only joinable by code", async () => {
    const host = await newClient(server.url).create("ludo", { userId: "p1", players: 2, private: true });
    const stranger = await newClient(server.url).joinOrCreate("ludo", { userId: "p2", players: 2 });
    assert.notEqual(stranger.roomId, host.roomId, "quick match never lands in a private room");

    const friend = await newClient(server.url).joinById(host.roomId, { userId: "p3", players: 2 });
    await sleep(150);
    assert.equal((host.state as any).phase, "roll", "game starts when the friend joins");
    assert.equal((friend.state as any).isPrivate, true);

    for (const r of [host, stranger, friend]) await r.leave();
  });

  it("a public lobby fills empty seats with bots after the wait and starts by itself", async () => {
    config.lobbyFillSeconds = 0.2;
    const room = await newClient(server.url).joinOrCreate("ludo", { userId: "solo", players: 4 });
    const over = autoPlay(room, "solo");
    const result = await over;
    assert.equal(result.placements.length, 4);
    assert.equal(result.placements.filter((p) => p.isBot).length, 3);
    await room.leave();
  });

  it("a private room waits for the host instead of auto-filling", async () => {
    config.lobbyFillSeconds = 0.2;
    const room = await newClient(server.url).create("ludo", { userId: "waiter", players: 2, private: true });
    await sleep(500);
    assert.equal((room.state as any).phase, "lobby");
    room.send("start");
    await sleep(200);
    assert.notEqual((room.state as any).phase, "lobby");
    await room.leave();
  });
});
