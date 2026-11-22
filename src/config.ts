export const config = {
  port: Number(process.env.PORT ?? 2567),
  redisUrl: process.env.REDIS_URL ?? "",
  // A user may be in at most this many active games at once.
  maxActiveGamesPerUser: 3,
  // Seconds a player has to act before the server auto-plays the turn.
  turnTimeoutSeconds: 15,
  // How long a finished room stays open so clients can read the result.
  finishedCloseMs: 15000,
};
