import test from "node:test";
import assert from "node:assert/strict";
import {
  encryptToken,
  decryptToken,
  generatePassword,
  strongPassword,
  validateVault,
} from "../auth.mjs";
const token = "github_pat_TestOnlyNoPermissions12345678901234567890";
const password = "Atlas-Test-Only-2026-Strong!";
test("vault encrypts a token and contains neither token nor password", async () => {
  const vault = await encryptToken(token, password);
  assert.equal(JSON.stringify(vault).includes(token), false);
  assert.equal(JSON.stringify(vault).includes(password), false);
  assert.equal(vault.iterations, 600000);
  assert.equal(await decryptToken(vault, password), token);
});
test("wrong passwords and tampered ciphertext fail authenticated decryption", async () => {
  const vault = await encryptToken(token, password);
  await assert.rejects(() => decryptToken(vault, password + "wrong"));
  const bytes = Buffer.from(vault.ciphertext, "base64");
  bytes[0] ^= 1;
  await assert.rejects(() =>
    decryptToken({ ...vault, ciphertext: bytes.toString("base64") }, password),
  );
});
test("new encryption uses fresh salt and IV every time", async () => {
  const a = await encryptToken(token, password),
    b = await encryptToken(token, password);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});
test("weak passwords and broadly scoped classic tokens are rejected", async () => {
  assert.equal(strongPassword("1234567890123456"), false);
  await assert.rejects(() => encryptToken(token, "short"));
  await assert.rejects(() =>
    encryptToken("ghp_broadClassicToken1234567890", password),
  );
});
test("vault cannot downgrade KDF or be reused for a different repository", async () => {
  const v = await encryptToken(token, password);
  assert.throws(() => validateVault({ ...v, iterations: 1000 }));
  assert.throws(() => validateVault({ ...v, repo: "attacker/repo" }));
  assert.throws(() => validateVault({ ...v, iterations: 1e9 }));
});
test("generated password has 24 characters and adequate variation", () => {
  for (let i = 0; i < 15; i++) {
    const p = generatePassword();
    assert.equal(p.length, 24);
    assert.ok(strongPassword(p));
    assert.ok(/^[A-Za-z2-9]+$/.test(p));
  }
});
