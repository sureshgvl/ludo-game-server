function num(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export const config = {
  port: num("PORT", 2567),
  redisUrl: process.env.REDIS_URL ?? "",
  // A user may be in at most this many active games at once.
  maxActiveGamesPerUser: num("MAX_ACTIVE_GAMES", 3),
  // Seconds a player has to act before the server auto-plays the turn.
  turnTimeoutSeconds: num("TURN_TIMEOUT_SECONDS", 15),
  // Auto-played turns in a row before a player forfeits.
  maxMissedTurns: num("MAX_MISSED_TURNS", 3),
  // Seconds a public lobby waits for real players before bots fill the empty seats.
  lobbyFillSeconds: num("LOBBY_FILL_SECONDS", 20),
  // Seconds a dropped player has to reconnect before a bot takes the seat.
  reconnectSeconds: num("RECONNECT_SECONDS", 30),
  // Pause before a bot (or a disconnected player's auto-play) acts.
  botDelayMs: num("BOT_DELAY_MS", 900),
  // When true the server plays a human's move for them if only one piece can move. Off: the player taps it.
  autoSingleMove: (process.env.AUTO_SINGLE_MOVE ?? "false") === "true",
  // Pause before the server plays a forced move (only one legal piece).
  autoMoveDelayMs: num("AUTO_MOVE_DELAY_MS", 450),
  // How long a finished room stays open so clients can read the result.
  finishedCloseMs: num("FINISHED_CLOSE_MS", 15000),
};

// Tournament integration with ludo-api. Leave API_URL empty to disable tournaments.
export const apiConfig = {
  url: (process.env.API_URL ?? "").replace(/\/+$/, ""),
  internalKey: process.env.INTERNAL_API_KEY ?? "",
  // Attempts and pause when reporting a finished game fails.
  reportRetries: num("REPORT_RETRIES", 5),
  reportRetryMs: num("REPORT_RETRY_MS", 2000),
};
