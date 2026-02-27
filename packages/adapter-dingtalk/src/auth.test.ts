import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, getAccessToken } from "./auth";
import type { DingTalkAdapterConfig } from "./types";

const mockFetch = vi.fn<typeof fetch>();

const testConfig: DingTalkAdapterConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
};

function tokenOk(accessToken: string, expireIn: number): Response {
  return new Response(JSON.stringify({ accessToken, expireIn }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  mockFetch.mockReset();
  clearTokenCache();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getAccessToken", () => {
  it("fetches a new token from DingTalk API", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk("token-abc", 7200));

    const token = await getAccessToken(testConfig);

    expect(token).toBe("token-abc");
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.dingtalk.com/v1.0/oauth2/accessToken");
    expect(JSON.parse(options.body as string)).toEqual({
      appKey: "test-client-id",
      appSecret: "test-client-secret",
    });
  });

  it("returns cached token on subsequent calls", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk("token-abc", 7200));

    const token1 = await getAccessToken(testConfig);
    const token2 = await getAccessToken(testConfig);

    expect(token1).toBe("token-abc");
    expect(token2).toBe("token-abc");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("uses custom apiBaseUrl", async () => {
    mockFetch.mockResolvedValueOnce(tokenOk("token-custom", 7200));

    const config: DingTalkAdapterConfig = {
      ...testConfig,
      apiBaseUrl: "https://custom.api.dingtalk.com/",
    };

    await getAccessToken(config);

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://custom.api.dingtalk.com/v1.0/oauth2/accessToken",
    );
  });

  it("retries on failure", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(tokenOk("token-retry", 7200));

    const token = await getAccessToken(testConfig);

    expect(token).toBe("token-retry");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockRejectedValueOnce(new Error("fail 3"));

    await expect(getAccessToken(testConfig)).rejects.toThrow("fail 3");
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    );

    await expect(getAccessToken(testConfig)).rejects.toThrow(
      "DingTalk token request failed: 401",
    );
  });

  it("isolates cache by clientId", async () => {
    mockFetch
      .mockResolvedValueOnce(tokenOk("token-a", 7200))
      .mockResolvedValueOnce(tokenOk("token-b", 7200));

    const configA: DingTalkAdapterConfig = {
      clientId: "client-a",
      clientSecret: "secret-a",
    };
    const configB: DingTalkAdapterConfig = {
      clientId: "client-b",
      clientSecret: "secret-b",
    };

    const tokenA = await getAccessToken(configA);
    const tokenB = await getAccessToken(configB);

    expect(tokenA).toBe("token-a");
    expect(tokenB).toBe("token-b");
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
