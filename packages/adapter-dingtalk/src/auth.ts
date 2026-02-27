/**
 * DingTalk OAuth2 access token management.
 *
 * Provides token caching with automatic refresh before expiry.
 * @see https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app
 */

import type { Logger } from "chat";
import type { DingTalkAdapterConfig, DingTalkTokenResponse } from "./types";

interface TokenCache {
  accessToken: string;
  /** Expiry timestamp in milliseconds. */
  expiry: number;
}

/** Token cache keyed by clientId for multi-account support. */
const tokenCacheMap = new Map<string, TokenCache>();

/** Refresh token 60 seconds before expiry to avoid near-expiry failures. */
const REFRESH_MARGIN_MS = 60_000;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 500;

/**
 * Get DingTalk access token with clientId-scoped cache and retry.
 */
export async function getAccessToken(
  config: DingTalkAdapterConfig,
  logger?: Logger,
): Promise<string> {
  const cacheKey = config.clientId;
  const now = Date.now();
  const cached = tokenCacheMap.get(cacheKey);

  if (cached && cached.expiry > now + REFRESH_MARGIN_MS) {
    return cached.accessToken;
  }

  const apiBase = (config.apiBaseUrl ?? "https://api.dingtalk.com").replace(
    /\/+$/,
    "",
  );

  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(
        `${apiBase}/v1.0/oauth2/accessToken`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appKey: config.clientId,
            appSecret: config.clientSecret,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `DingTalk token request failed: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as DingTalkTokenResponse;

      tokenCacheMap.set(cacheKey, {
        accessToken: data.accessToken,
        expiry: now + data.expireIn * 1000,
      });

      return data.accessToken;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger?.warn?.("DingTalk token request failed, retrying", {
        attempt: attempt + 1,
        error: lastError.message,
      });

      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, INITIAL_BACKOFF_MS * 2 ** attempt),
        );
      }
    }
  }

  throw lastError ?? new Error("Failed to get DingTalk access token");
}

/**
 * Clear token cache (for testing).
 */
export function clearTokenCache(): void {
  tokenCacheMap.clear();
}
