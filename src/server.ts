import { createServer } from "http";
import express from "express";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LudoRoom } from "./rooms/LudoRoom";

export function createGameServer() {
  const app = express();
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "ludo-game-server" });
  });

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });
  gameServer.define("ludo", LudoRoom);

  return { app, httpServer, gameServer };
}
