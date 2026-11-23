import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { config } from "../src/config";
import { newClient, startTestServer } from "./helpers";

function token(sub: string, secret: string, exp = Math.floor(Date.now() / 1000) + 600) {
  const h = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const b = Buffer.from(JSON.stringify({ sub, name: "Asha", exp })).toString("base64url");
  return `${h}.${b}.${createHmac("sha256", secret).update(`${h}.${b}`).digest("base64url")}`;
}

describe("login tokens", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  before(async () => { config.jwtSecret = "shared"; server = await startTestServer(); });
  after(async () => { config.jwtSecret = ""; await server.stop(); });

  it("rejects joining without a valid token", async () => {
    await assert.rejects(newClient(server.url).joinOrCreate("ludo", { userId: "x", players: 2 }), /login_required/);
    await assert.rejects(newClient(server.url).joinOrCreate("ludo", { token: token("u1", "wrong"), players: 2 }), /login_required/);
    await assert.rejects(newClient(server.url).joinOrCreate("ludo", { token: token("u1", "shared", 1), players: 2 }), /login_required/);
  });

  it("takes identity from the token, ignoring a spoofed userId", async () => {
    const room = await newClient(server.url).joinOrCreate("ludo", { userId: "spoof", token: token("real-user", "shared"), players: 2, private: true });
    await new Promise((r) => setTimeout(r, 200));
    const p = (room.state as any).players[0];
    assert.equal(p.userId, "real-user");
    assert.equal(p.name, "Asha");
    await room.leave();
  });
});
