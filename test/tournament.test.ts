import assert from "node:assert/strict";
import { createServer, Server as HttpServer } from "node:http";
import { after, before, describe, it } from "node:test";
import { apiConfig } from "../src/config";
import { autoPlay, newClient, startTestServer } from "./helpers";

/** A stand-in for ludo-api's internal endpoints. */
function startFakeApi(registered: Set<string>) {
  const reports: any[] = [];
  let failNext = 0;
  const server: HttpServer = createServer((req, res) => {
    if (req.headers["x-internal-key"] !== "k") {
      res.writeHead(401).end();
      return;
    }
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { "content-type": "application/json" }).end(JSON.stringify(body));
    };
    const m = req.url!.match(/^\/api\/internal\/tournaments\/([^/]+)\/eligibility\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const ok = m[1] === "t-running" && registered.has(decodeURIComponent(m[2]));
      return send(200, { eligible: ok, reason: ok ? null : "not_registered", playersPerGame: 2 });
    }
    if (req.method === "POST" && req.url === "/api/internal/games") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        if (failNext > 0) {
          failNext--;
          return send(503, {});
        }
        reports.push(JSON.parse(raw));
        send(200, { status: "applied" });
      });
      return;
    }
    send(404, {});
  });
  return new Promise<{ url: string; reports: any[]; failNext: (n: number) => void; stop: () => void }>((resolve) =>
    server.listen(0, () => {
      const port = (server.address() as any).port;
      resolve({
        url: `http://localhost:${port}`,
        reports,
        failNext: (n) => (failNext = n),
        stop: () => server.close(),
      });
    }),
  );
}

describe("tournament rooms", () => {
  let server: Awaited<ReturnType<typeof startTestServer>>;
  let api: Awaited<ReturnType<typeof startFakeApi>>;
  const registered = new Set(["p1", "p2"]);

  before(async () => {
    api = await startFakeApi(registered);
    server = await startTestServer();
    apiConfig.reportRetryMs = 50;
  });
  after(async () => {
    api.stop();
    await server.stop();
    apiConfig.url = "";
    apiConfig.internalKey = "";
  });

  const join = (userId: string, tournamentId = "t-running") =>
    newClient(server.url).joinOrCreate("ludo", { userId, players: 2, tournamentId });

  it("refuses tournament games when ludo-api is not configured", async () => {
    apiConfig.url = "";
    apiConfig.internalKey = "";
    await assert.rejects(join("p1"), (e: any) => e.code === 4005);
  });

  it("only admits registered players of a running tournament", async () => {
    apiConfig.url = api.url;
    apiConfig.internalKey = "k";
    await assert.rejects(join("stranger"), (e: any) => e.code === 4006);
    await assert.rejects(join("p1", "t-other"), (e: any) => e.code === 4006);
    apiConfig.url = "http://localhost:1"; // API down
    await assert.rejects(join("p1"), (e: any) => e.code === 4005);
    apiConfig.url = api.url;
  });

  it("reports the finished game to the API, retrying on failure", async () => {
    apiConfig.url = api.url;
    apiConfig.internalKey = "k";
    api.failNext(2);
    const a = await join("p1");
    const b = await join("p2");
    assert.equal(a.roomId, b.roomId);
    assert.equal((a.state as any).tournamentId, "t-running");

    const [over] = await Promise.all([autoPlay(a, "p1"), autoPlay(b, "p2")]);
    for (let i = 0; i < 60 && api.reports.length === 0; i++) await new Promise((r) => setTimeout(r, 100));

    assert.equal(api.reports.length, 1);
    const report = api.reports[0];
    assert.equal(report.tournamentId, "t-running");
    assert.equal(report.gameId, a.roomId);
    assert.deepEqual(
      report.placements.map((p: any) => [p.userId, p.placement, p.isBot]).sort(),
      over.placements.map((p) => [p.userId, p.placement, false]).sort(),
    );
    await a.leave();
    await b.leave();
  });

  it("does not mix tournament and casual players in one room", async () => {
    apiConfig.url = api.url;
    apiConfig.internalKey = "k";
    const casual = await newClient(server.url).joinOrCreate("ludo", { userId: "c1", players: 2 });
    const t = await join("p1");
    assert.notEqual(casual.roomId, t.roomId);
    await casual.leave();
    await t.leave();
  });
});
