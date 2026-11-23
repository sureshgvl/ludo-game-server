import { createHmac, timingSafeEqual } from "node:crypto";

export interface TokenClaims { sub: string; name: string }

/** Verifies an HS256 token issued by ludo-api (same JWT_SECRET). Returns null when invalid or expired. */
export function verifyToken(token: unknown, secret: string, now = Date.now()): TokenClaims | null {
  if (!secret || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const head = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    const c = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (head.alg !== "HS256" || typeof c.sub !== "string" || !c.sub || typeof c.exp !== "number" || c.exp * 1000 < now) return null;
    return { sub: c.sub, name: typeof c.name === "string" ? c.name : "Player" };
  } catch {
    return null;
  }
}
