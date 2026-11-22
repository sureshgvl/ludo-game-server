import Redis from "ioredis";
import { config } from "../config";

/**
 * Tracks which games each user is currently in, so a user can be in at most
 * `config.maxActiveGamesPerUser` games at once.
 */
export interface ActiveGamesStore {
  /** Adds the game for the user. Returns false (and adds nothing) if they are at the limit. */
  tryAdd(userId: string, gameId: string): Promise<boolean>;
  remove(userId: string, gameId: string): Promise<void>;
  count(userId: string): Promise<number>;
  close(): Promise<void>;
}

export class MemoryActiveGamesStore implements ActiveGamesStore {
  private games = new Map<string, Set<string>>();

  constructor(private readonly max: number = config.maxActiveGamesPerUser) {}

  async tryAdd(userId: string, gameId: string): Promise<boolean> {
    const set = this.games.get(userId) ?? new Set<string>();
    if (set.has(gameId)) return true;
    if (set.size >= this.max) return false;
    set.add(gameId);
    this.games.set(userId, set);
    return true;
  }

  async remove(userId: string, gameId: string): Promise<void> {
    const set = this.games.get(userId);
    if (!set) return;
    set.delete(gameId);
    if (set.size === 0) this.games.delete(userId);
  }

  async count(userId: string): Promise<number> {
    return this.games.get(userId)?.size ?? 0;
  }

  async close(): Promise<void> {}
}

// Atomic check-and-add so two servers cannot both push a user past the limit.
const TRY_ADD_SCRIPT = `
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 1 end
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1
`;

/** Safety net: stale entries (for example after a crash) disappear on their own. */
const KEY_TTL_SECONDS = 6 * 60 * 60;

export class RedisActiveGamesStore implements ActiveGamesStore {
  private readonly redis: Redis;

  constructor(
    url: string,
    private readonly max: number = config.maxActiveGamesPerUser,
  ) {
    this.redis = new Redis(url);
  }

  private key(userId: string): string {
    return `ludo:active-games:${userId}`;
  }

  async tryAdd(userId: string, gameId: string): Promise<boolean> {
    const result = await this.redis.eval(
      TRY_ADD_SCRIPT,
      1,
      this.key(userId),
      gameId,
      String(this.max),
      String(KEY_TTL_SECONDS),
    );
    return result === 1;
  }

  async remove(userId: string, gameId: string): Promise<void> {
    await this.redis.srem(this.key(userId), gameId);
  }

  async count(userId: string): Promise<number> {
    return this.redis.scard(this.key(userId));
  }

  async close(): Promise<void> {
    await this.redis.quit();
  }
}

let store: ActiveGamesStore | null = null;

/** Redis when REDIS_URL is set, otherwise in-memory (fine for one server process). */
export function getActiveGamesStore(): ActiveGamesStore {
  if (!store) {
    store = config.redisUrl
      ? new RedisActiveGamesStore(config.redisUrl)
      : new MemoryActiveGamesStore();
  }
  return store;
}

export function setActiveGamesStore(next: ActiveGamesStore | null): void {
  store = next;
}
