import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { config } from "../src/config";
import {
  ActiveGamesStore,
  MemoryActiveGamesStore,
  RedisActiveGamesStore,
  setActiveGamesStore,
} from "../src/limits/activeGames";
import { autoPlay, newClient, startTestServer } from "./helpers";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function exerciseStore(store: ActiveGamesStore, user: string) {
  assert.equal(await store.tryAdd(user, "g1"), true);
  assert.equal(await store.tryAdd(user, "g2"), true);
  assert.equal(await store.tryAdd(user, "g3"), true);
  assert.equal(await store.tryAdd(user, "g4"), false, "4th game must be refused");
  assert.equal(await store.tryAdd(user, "g2"), true, "re-adding an existing game is allowed");
  assert.equal(await store.count(user), 3);
  await store.remove(user, "g1");
  assert.equal(await store.count(user), 2);
  assert.equal(await store.tryAdd(user, "g4"), true, "a freed slot can be reused");
  // Concurrent adds never exceed the limit.
  const results = await Promise.all(
    ["c1", "c2", "c3", "c4", "c5", "c6"].map((g) => store.tryAdd(`${user}-race`, g)),
  );
  assert.equal(results.filter(Boolean).length, 3);
}

describe("active games store", () => {
  it("memory store enforces the limit", async () => {
    await exerciseStore(new MemoryActiveGamesStore(3), "mem-user");
  });

  const hasRedis = existsSync("/usr/bin/redis-server") || existsSync("/usr/local/bin/redis-server");
  describe("redis store", { skip: !hasRedis && "redis-server not installed" }, () => {
    let proc: ChildProcess;
    let store: RedisActiveGamesStore;
    const port = 30000 + Math.floor(Math.random() * 10000);

    before(async () => {
      proc = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], {
        stdio: "ignore",
      });
      await sleep(600);
      store = new RedisActiveGamesStore(`redis://127.0.0.1:${port}`, 3);
    });
    after(async () => {
      await store?.close();
      proc?.kill();
    });

    it("enforces the limit atomically", async () => {
      await exerciseStore(store, "redis-user");
    });
  });
});

describe("3-game limit in rooms", () => {
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

  it("refuses a 4th concurrent game and frees a slot when the user leaves one", async () => {
    const client = newClient(server.url);
    const rooms = [];
    for (let i = 0; i < 3; i++) {
      rooms.push(await client.create("ludo", { userId: "multi", players: 2 }));
    }
    await assert.rejects(client.create("ludo", { userId: "multi", players: 2 }), (err: any) => {
      assert.equal(err.code, 4003);
      return true;
    });

    await rooms[0].leave();
    await sleep(150);
    const again = await client.create("ludo", { userId: "multi", players: 2 });
    assert.ok(again.roomId);

    await again.leave();
    await rooms[1].leave();
    await rooms[2].leave();
  });

  it("frees the slot when a game finishes", async () => {
    const client = newClient(server.url);
    const first = await client.create("ludo", { userId: "finisher", players: 2 });
    const second = await client.create("ludo", { userId: "finisher", players: 2 });
    const third = await client.create("ludo", { userId: "finisher", players: 2 });

    const over = autoPlay(first, "finisher");
    first.send("start");
    await over;
    await sleep(150);

    const fourth = await client.create("ludo", { userId: "finisher", players: 2 });
    assert.ok(fourth.roomId);
    for (const r of [first, second, third, fourth]) await r.leave();
  });

  it("does not let the same user take two seats in one room", async () => {
    const a = await newClient(server.url).create("ludo", { userId: "twin", players: 2 });
    await assert.rejects(
      newClient(server.url).joinById(a.roomId, { userId: "twin", players: 2 }),
      (err: any) => {
        assert.equal(err.code, 4004);
        return true;
      },
    );
    await a.leave();
  });
});
