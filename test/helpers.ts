import { Client, Room } from "colyseus.js";
import { createGameServer } from "../src/server";

export async function startTestServer() {
  const { gameServer } = createGameServer();
  const port = 20000 + Math.floor(Math.random() * 10000);
  await gameServer.listen(port);
  return {
    url: `ws://localhost:${port}`,
    httpUrl: `http://localhost:${port}`,
    stop: () => gameServer.gracefullyShutdown(false),
  };
}

export interface GameOver {
  placements: { seat: number; placement: number; userId?: string; name?: string; isBot: boolean }[];
}

/**
 * Attach a simple auto-player to a room: rolls when it is its turn and moves the
 * first legal piece. Resolves with the game_over payload.
 */
export function autoPlay(room: Room, userId: string): Promise<GameOver> {
  return new Promise((resolve) => {
    room.onMessage("game_over", (msg: GameOver) => resolve(msg));
    let lastSeq = -1;
    room.onStateChange((state: any) => {
      if (state.seq === lastSeq) return;
      lastSeq = state.seq;
      const me = state.players.find((p: any) => p.userId === userId);
      if (!me || state.currentSeat !== me.seat) return;
      if (state.phase === "roll") room.send("roll");
      else if (state.phase === "move") room.send("move", { piece: state.legalMoves[0] });
    });
  });
}

export function newClient(url: string): Client {
  return new Client(url);
}
