import { apiConfig } from "../config";

export interface Eligibility {
  eligible: boolean;
  reason: string | null;
  playersPerGame: number | null;
}

export interface GameReport {
  tournamentId: string;
  gameId: string;
  placements: { userId: string; placement: number; isBot: boolean; captures?: number; home?: number }[];
}

export function tournamentsEnabled(): boolean {
  return apiConfig.url !== "" && apiConfig.internalKey !== "";
}

function headers() {
  return { "content-type": "application/json", "x-internal-key": apiConfig.internalKey };
}

/** Throws when ludo-api cannot be reached, so the caller can refuse the join. */
export async function checkEligibility(tournamentId: string, userId: string): Promise<Eligibility> {
  const url = `${apiConfig.url}/api/internal/tournaments/${encodeURIComponent(tournamentId)}/eligibility/${encodeURIComponent(userId)}`;
  const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`eligibility check failed: HTTP ${res.status}`);
  return (await res.json()) as Eligibility;
}

/** Reports a finished game, retrying on failure. The API ignores repeats of the same gameId. */
export async function reportGame(report: GameReport): Promise<boolean> {
  for (let attempt = 1; attempt <= apiConfig.reportRetries; attempt++) {
    try {
      const res = await fetch(`${apiConfig.url}/api/internal/games`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) {
        console.error(`[tournament] result rejected (HTTP ${res.status}) for game ${report.gameId}`);
        return false; // retrying a rejected report will not help
      }
    } catch {
      // network error: retry below
    }
    if (attempt < apiConfig.reportRetries) await new Promise((r) => setTimeout(r, apiConfig.reportRetryMs));
  }
  console.error(`[tournament] gave up reporting game ${report.gameId}`);
  return false;
}

export interface ResultReport {
  gameId: string;
  placements: { userId: string; placement: number; isBot: boolean }[];
}

/** Reports any finished game (tournament or not) for coins and XP. Best effort, idempotent per gameId. */
export async function reportResult(report: ResultReport): Promise<boolean> {
  if (!tournamentsEnabled()) return false;
  for (let attempt = 1; attempt <= apiConfig.reportRetries; attempt++) {
    try {
      const res = await fetch(`${apiConfig.url}/api/internal/results`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(report),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return true;
      if (res.status >= 400 && res.status < 500) return false;
    } catch {
      // retry
    }
    if (attempt < apiConfig.reportRetries) await new Promise((r) => setTimeout(r, apiConfig.reportRetryMs));
  }
  return false;
}
