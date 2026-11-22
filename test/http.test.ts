import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { startTestServer } from "./helpers";

describe("http", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.stop();
  });

  it("serves a health check", async () => {
    const res = await fetch(`${server.httpUrl}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "ok", service: "ludo-game-server" });
  });

  it("serves the web client and the Colyseus browser bundle", async () => {
    const page = await fetch(`${server.httpUrl}/`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<canvas id="board"/);

    const lib = await fetch(`${server.httpUrl}/vendor/colyseus.js`);
    assert.equal(lib.status, 200);
    assert.match(await lib.text(), /Colyseus/);

    const app = await fetch(`${server.httpUrl}/app.js`);
    assert.equal(app.status, 200);
  });
});
