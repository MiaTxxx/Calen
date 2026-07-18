import { invoke } from "@tauri-apps/api/core";

import type { ProviderId } from "../settings";

export const LIVEAGENT_PROXY_TOKEN_HEADER = "x-liveagent-proxy-token";
export const LIVEAGENT_UPSTREAM_ORIGIN_HEADER = "x-liveagent-upstream-origin";

type ProxyServerInfo = {
  baseUrl: string;
  token: string;
};

export type PreparedProxyRequest = {
  baseUrl: string;
  headers: Record<string, string>;
};

export type PreparedRelayRequest = {
  url: string;
  headers: Record<string, string>;
};

let proxyServerInfoPromise: Promise<ProxyServerInfo> | null = null;

function normalizeProxyServerInfo(info: ProxyServerInfo): ProxyServerInfo {
  const baseUrl = String(info.baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const token = String(info.token ?? "").trim();

  if (!baseUrl) {
    throw new Error("Local proxy base URL is empty");
  }
  if (!token) {
    throw new Error("Local proxy token is empty");
  }

  return {
    baseUrl,
    token,
  };
}

async function getProxyServerInfo(): Promise<ProxyServerInfo> {
  if (!proxyServerInfoPromise) {
    proxyServerInfoPromise = invoke<ProxyServerInfo>("proxy_get_server_info")
      .then(normalizeProxyServerInfo)
      .catch((error) => {
        proxyServerInfoPromise = null;
        throw new Error(
          `Failed to get local proxy info: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  return proxyServerInfoPromise;
}

export function buildProxyBaseUrl(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  proxyServerBaseUrl: string,
): { baseUrl: string; upstreamOrigin: string } {
  const normalizedUpstream = upstreamBaseUrl.trim();
  if (!normalizedUpstream) {
    throw new Error("Base URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedUpstream);
  } catch (error) {
    throw new Error(
      `Base URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error("Base URL cannot include embedded username or password");
  }
  if (parsed.search || parsed.hash) {
    throw new Error("Base URL cannot include query parameters or fragments");
  }

  const normalizedProxyServerBaseUrl = proxyServerBaseUrl.trim().replace(/\/+$/, "");
  const pathname = parsed.pathname.replace(/\/+$/, "");

  return {
    baseUrl: `${normalizedProxyServerBaseUrl}/proxy/${providerId}${pathname}`,
    upstreamOrigin: parsed.origin,
  };
}

export function buildImageProxyUrl(imageUrl: string, proxyServerBaseUrl: string): string {
  const normalizedImageUrl = imageUrl.trim();
  if (!normalizedImageUrl) {
    throw new Error("Image URL cannot be empty");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedImageUrl);
  } catch (error) {
    throw new Error(
      `Image URL must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Image URL must start with http:// or https://");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image URL cannot include embedded username or password");
  }

  const normalizedProxyServerBaseUrl = proxyServerBaseUrl.trim().replace(/\/+$/, "");
  if (!normalizedProxyServerBaseUrl) {
    throw new Error("Local proxy base URL is empty");
  }
  return `${normalizedProxyServerBaseUrl}/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
}

export function buildRelayRequest(
  routeId: string,
  targetUrl: string,
  proxyServerBaseUrl: string,
  token: string,
  headers: Record<string, string> = {},
): PreparedRelayRequest {
  const normalizedRouteId = routeId.trim();
  if (!/^[a-z0-9_-]+$/i.test(normalizedRouteId)) {
    throw new Error("Relay route ID may contain only letters, numbers, underscores, and hyphens");
  }

  let target: URL;
  try {
    target = new URL(targetUrl.trim());
  } catch (error) {
    throw new Error(
      `Relay target must be an absolute URL: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("Relay target must start with http:// or https://");
  }
  if (target.username || target.password) {
    throw new Error("Relay target cannot include embedded username or password");
  }
  if (target.hash) {
    throw new Error("Relay target cannot include a fragment");
  }

  const baseUrl = proxyServerBaseUrl.trim().replace(/\/+$/, "");
  const normalizedToken = token.trim();
  if (!baseUrl || !normalizedToken) {
    throw new Error("Local relay information is incomplete");
  }

  return {
    url: `${baseUrl}/proxy/${normalizedRouteId}${target.pathname}${target.search}`,
    headers: {
      ...headers,
      [LIVEAGENT_UPSTREAM_ORIGIN_HEADER]: target.origin,
      [LIVEAGENT_PROXY_TOKEN_HEADER]: normalizedToken,
    },
  };
}

export async function prepareImageProxyUrl(imageUrl: string): Promise<string> {
  const proxyServerInfo = await getProxyServerInfo();
  return buildImageProxyUrl(imageUrl, proxyServerInfo.baseUrl);
}

export async function prepareRelayRequest(
  routeId: string,
  targetUrl: string,
  headers: Record<string, string> = {},
): Promise<PreparedRelayRequest> {
  const proxyServerInfo = await getProxyServerInfo();
  return buildRelayRequest(
    routeId,
    targetUrl,
    proxyServerInfo.baseUrl,
    proxyServerInfo.token,
    headers,
  );
}

export async function prepareProxyRequest(
  providerId: ProviderId,
  upstreamBaseUrl: string,
  headers: Record<string, string>,
): Promise<PreparedProxyRequest> {
  const proxyServerInfo = await getProxyServerInfo();
  const { baseUrl, upstreamOrigin } = buildProxyBaseUrl(
    providerId,
    upstreamBaseUrl,
    proxyServerInfo.baseUrl,
  );

  return {
    baseUrl,
    headers: {
      ...headers,
      [LIVEAGENT_UPSTREAM_ORIGIN_HEADER]: upstreamOrigin,
      [LIVEAGENT_PROXY_TOKEN_HEADER]: proxyServerInfo.token,
    },
  };
}
