import test from "node:test";
import assert from "node:assert/strict";
import {
  GitHubClient,
  DATA_PATH,
  VAULT_PATH,
  encodeContent,
  decodeContent,
} from "../github.mjs";
test("Unicode data including emoji survives GitHub base64 round trip", () => {
  const note = "都柏林 🇮🇪\n海边 <script>只是文字</script>";
  assert.equal(decodeContent(encodeContent(note)), note);
});
test("locked clients cannot write and public reads send no authorization", async () => {
  const seen = [];
  const api = new GitHubClient(async (url, options) => {
    seen.push(options);
    return new Response(
      JSON.stringify({ sha: "abc", content: encodeContent("{}") }),
    );
  });
  await assert.rejects(() => api.write(DATA_PATH, {}, "abc", "test"));
  await api.read(DATA_PATH, false);
  assert.equal(seen[0].headers.Authorization, undefined);
});
test("only data and encrypted vault can be published with matching SHA", async () => {
  let seen;
  const api = new GitHubClient(async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify({ commit: { sha: "def" } }));
  });
  api.unlock("github_pat_fakeTestCredential");
  await api.write(DATA_PATH, { note: "中文" }, "abc", "Update records");
  const body = JSON.parse(seen.options.body);
  assert.equal(body.sha, "abc");
  assert.equal(body.branch, "main");
  assert.ok(seen.url.endsWith("/data/atlas.json"));
  assert.ok(seen.options.headers.Authorization.startsWith("Bearer "));
  await assert.rejects(() => api.write("index.html", {}, "abc", "unsafe"));
  api.lock();
  assert.equal(api.unlocked, false);
});
test("missing public vault enters first-time setup; missing data stays an error", async () => {
  const api = new GitHubClient(async () => new Response("{}", { status: 404 }));
  assert.equal(await api.read(VAULT_PATH, false), null);
  await assert.rejects(() => api.read(DATA_PATH, false));
});
test("conflict and revoked-token failures do not clear authorization or publish state", async () => {
  for (const code of [401, 403, 409, 422]) {
    const api = new GitHubClient(
      async () => new Response("{}", { status: code }),
    );
    api.unlock("fake");
    await assert.rejects(() => api.write(DATA_PATH, {}, "old", "test"));
    assert.equal(api.unlocked, true);
  }
});
test("fetch failures have actionable messages without leaking credentials", async () => {
  const api = new GitHubClient(async () => {
    throw Error("network");
  });
  api.unlock("secret-token");
  await assert.rejects(
    () => api.read(DATA_PATH),
    (e) => e.message.includes("草稿") && !e.message.includes("secret-token"),
  );
});
