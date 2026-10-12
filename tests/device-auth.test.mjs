import test from "node:test";
import assert from "node:assert/strict";
import { createDeviceKey, devicePassword, validPin } from "../device-auth.mjs";
import { encryptToken, decryptToken } from "../auth.mjs";

test("short PINs are accepted only by device mode", async () => {
  assert.equal(validPin("0000"), true);
  assert.equal(validPin("12345678"), true);
  for (const pin of ["123", "123456789", "abcd", " 1234", 1234])
    assert.equal(validPin(pin), false);
  await assert.rejects(() =>
    encryptToken(
      "github_pat_TestOnlyNoPermissions12345678901234567890",
      "0000",
    ),
  );
});

test("device key is non-exportable and each device derives a different password", async () => {
  const a = await createDeviceKey(),
    b = await createDeviceKey();
  assert.equal(a.extractable, false);
  await assert.rejects(() => crypto.subtle.exportKey("raw", a));
  assert.equal(
    await devicePassword(a, "0000"),
    await devicePassword(a, "0000"),
  );
  assert.notEqual(
    await devicePassword(a, "0000"),
    await devicePassword(b, "0000"),
  );
  assert.notEqual(
    await devicePassword(a, "0000"),
    await devicePassword(a, "0001"),
  );
});

test("local ciphertext requires both the PIN and its device key", async () => {
  const token = "github_pat_TestOnlyNoPermissions12345678901234567890";
  const key = await createDeviceKey();
  const vault = await encryptToken(token, await devicePassword(key, "0000"));
  assert.equal(JSON.stringify(vault).includes(token), false);
  assert.equal(
    await decryptToken(vault, await devicePassword(key, "0000")),
    token,
  );
  await assert.rejects(() => decryptToken(vault, "0000"));
  await assert.rejects(async () =>
    decryptToken(vault, await devicePassword(key, "0001")),
  );
  await assert.rejects(async () =>
    decryptToken(vault, await devicePassword(await createDeviceKey(), "0000")),
  );
});
