import { createServer } from "http";
import path from "node:path";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LudoRoom } from "./rooms/LudoRoom";

export function createGameServer() {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ludo-game-server" });
  });

  // Playable web client (works from both src/ and dist/).
  const root = path.join(__dirname, "..");
  app.get("/vendor/colyseus.js", (_req, res) => {
    res.sendFile(path.join(root, "node_modules", "colyseus.js", "dist", "colyseus.js"));
  });
  app.use(express.static(path.join(root, "public")));

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  // Quick match: joinOrCreate pairs players who asked for the same player count.
  gameServer.define("ludo", LudoRoom).filterBy(["players", "tournamentId", "waitForHumans"]);

  return { app, httpServer, gameServer };
}
