import { test } from "node:test";
import assert from "node:assert/strict";
import { PasswordClient, DATA_PATH } from "../cloud.mjs";

const response = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
test("password client keeps the native fetch receiver and public reads omit credentials", async () => {
  const client = new PasswordClient(function (url, options) {
    assert.equal(this, globalThis);
    assert.ok(url.endsWith("/api/atlas"));
    assert.equal(options.method, "GET");
    assert.equal(options.body, undefined);
    return response({ document: { countries: {} }, revision: "r1" });
  });
  assert.deepEqual(await client.read(DATA_PATH), {
    data: { countries: {} },
    sha: "r1",
  });
  await assert.rejects(client.write(DATA_PATH, {}, "r1"), /管理密码/);
});
test("successful server authentication is required; rejected passwords never unlock", async () => {
  const client = new PasswordClient(async () =>
    response({ authenticated: false }),
  );
  await assert.rejects(client.unlock("test-password"), /未确认/);
  assert.equal(client.unlocked, false);
});
test("publishing sends the expected revision; locking immediately revokes the local session", async () => {
  const calls = [];
  const client = new PasswordClient(async (url, options) => {
    calls.push({ url, ...options });
    const body = JSON.parse(options.body);
    if (url.endsWith("/auth")) return response({ authenticated: true });
    assert.equal(body.password, "test-password");
    assert.equal(body.baselineRevision, "r1");
    assert.ok(body.requestId);
    assert.deepEqual(body.document, { countries: {} });
    return response({
      published: true,
      document: body.document,
      revision: "r2",
    });
  });
  await client.unlock("test-password");
  assert.equal(client.unlocked, true);
  assert.equal(
    (await client.write(DATA_PATH, { countries: {} }, "r1")).sha,
    "r2",
  );
  client.lock();
  await assert.rejects(client.write(DATA_PATH, {}, "r2"), /管理密码/);
  assert.equal(calls.length, 2);
});
test("a cloud conflict is an error and never a successful publish", async () => {
  const client = new PasswordClient(async (url) =>
    url.endsWith("/auth")
      ? response({ authenticated: true })
      : response({ error: "版本冲突" }, 409),
  );
  await client.unlock("test-password");
  await assert.rejects(client.write(DATA_PATH, {}, "stale"), /版本冲突/);
  assert.equal(client.unlocked, true);
});
test("timeouts and invalid responses keep the error actionable without echoing passwords", async () => {
  const client = new PasswordClient(async () => {
    throw new DOMException("private transport detail", "TimeoutError");
  });
  await assert.rejects(client.unlock("secret-test"), /超时.*草稿/);
  assert.equal(client.unlocked, false);
  const malformed = new PasswordClient(async () => new Response("not-json"));
  await assert.rejects(malformed.read(DATA_PATH), /无效数据/);
  await assert.rejects(malformed.read("data/admin.vault.json"), /不支持/);
});
