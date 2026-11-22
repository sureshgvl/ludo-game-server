export const config = {
  port: Number(process.env.PORT ?? 2567),
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // A user may be in at most this many active games at once.
  maxActiveGamesPerUser: 3,
  // Seconds a player has to act before the server auto-plays the turn.
  turnTimeoutSeconds: 15,
  maxPlayersPerRoom: 4,
};
