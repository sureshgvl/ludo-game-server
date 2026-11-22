export const config = {
  port: Number(process.env.PORT ?? 2567),
  redisUrl: process.env.REDIS_URL ?? "",
  // A user may be in at most this many active games at once.
  maxActiveGamesPerUser: 3,
  // Seconds a player has to act before the server auto-plays the turn.
  turnTimeoutSeconds: 15,
  // Auto-played turns in a row before a player forfeits.
  maxMissedTurns: 3,
  // Seconds a public lobby waits for real players before bots fill the empty seats.
  lobbyFillSeconds: 20,
  // Seconds a dropped player has to reconnect before a bot takes the seat.
  reconnectSeconds: 30,
  // Pause before a bot (or a disconnected player's auto-play) acts.
  botDelayMs: 900,
  // Pause before the server plays a forced move (only one legal piece).
  autoMoveDelayMs: 450,
  // How long a finished room stays open so clients can read the result.
  finishedCloseMs: 15000,
};
