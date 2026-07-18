import assert from "node:assert/strict";
import test from "node:test";

import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

test("ClawHub search and detail requests use the authenticated local relay", async () => {
  const requests = [];
  const loader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "proxy_get_server_info");
          return {
            baseUrl: "http://127.0.0.1:18080",
            token: "relay-token",
          };
        },
      },
    },
  });
  const clawHub = loader.loadModule("src/lib/skills/clawHub.ts");
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), headers: options?.headers ?? {} });
    const isDetail = String(url).includes("/api/v1/skills/owner%2Fcalendar");
    return {
      ok: true,
      status: 200,
      async json() {
        return isDetail
          ? { skill: { slug: "owner/calendar", displayName: "Calendar" } }
          : { results: [{ slug: "owner/calendar", displayName: "Calendar" }] };
      },
    };
  };

  try {
    await clawHub.searchClawHubSkills({ query: "calendar", limit: 12 });
    await clawHub.getClawHubSkillDetail("owner/calendar");
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url,
    "http://127.0.0.1:18080/proxy/clawhub/api/v1/search?q=calendar&limit=12&nonSuspiciousOnly=true"
  );
  assert.equal(
    requests[1].url,
    "http://127.0.0.1:18080/proxy/clawhub/api/v1/skills/owner%2Fcalendar"
  );
  for (const request of requests) {
    assert.equal(request.headers.Accept, "application/json");
    assert.equal(
      request.headers["x-liveagent-upstream-origin"],
      "https://clawhub.ai"
    );
    assert.equal(request.headers["x-liveagent-proxy-token"], "relay-token");
  }
});
