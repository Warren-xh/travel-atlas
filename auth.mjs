import { REPO } from "./core.mjs";

const ITERATIONS = 600000;
const AAD = new TextEncoder().encode("travel-atlas/admin-vault/v1/" + REPO);
const base64 = (bytes) =>
  btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
const unbase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function strongPassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 16 ||
    password.length > 200 ||
    new Set(password).size < 8 ||
    /^\d+$/.test(password)
  )
    return false;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) =>
    pattern.test(password),
  ).length;
  return (
    classes >= 3 ||
    password.length >= 24 ||
    password.trim().split(/\s+/).length >= 5
  );
}

export function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const values = new Uint8Array(32);
  let password = "";
  while (password.length < 24) {
    crypto.getRandomValues(values);
    for (const n of values)
      if (n < 256 - (256 % alphabet.length) && password.length < 24)
        password += alphabet[n % alphabet.length];
  }
  return password;
}

async function keyFor(password, salt, iterations, usage) {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export function validateVault(vault) {
  if (
    !vault ||
    vault.version !== 1 ||
    vault.repo !== REPO ||
    vault.algorithm !== "AES-256-GCM" ||
    vault.kdf !== "PBKDF2-SHA256" ||
    !Number.isInteger(vault.iterations) ||
    vault.iterations < ITERATIONS ||
    vault.iterations > 2000000 ||
    typeof vault.salt !== "string" ||
    typeof vault.iv !== "string" ||
    typeof vault.ciphertext !== "string" ||
    vault.ciphertext.length > 10000
  )
    throw new Error("管理授权文件格式不正确。");
  try {
    if (
      unbase64(vault.salt).length !== 16 ||
      unbase64(vault.iv).length !== 12 ||
      unbase64(vault.ciphertext).length < 17
    )
      throw new Error();
  } catch {
    throw new Error("管理授权文件已损坏。");
  }
  return vault;
}

export async function encryptToken(token, password) {
  if (!strongPassword(password))
    throw new Error("请使用至少 16 位的长密码，或点击生成随机密码。");
  if (
    typeof token !== "string" ||
    !/^github_pat_[A-Za-z0-9_]{20,}$/.test(token)
  )
    throw new Error(
      "请使用只授权 travel-atlas 的 GitHub 细粒度 Token（github_pat_ 开头）。",
    );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, ITERATIONS, "encrypt");
  const plaintext = new TextEncoder().encode(
    JSON.stringify({ token, repo: REPO }),
  );
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 },
      key,
      plaintext,
    );
    return {
      version: 1,
      repo: REPO,
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: base64(salt),
      iv: base64(iv),
      ciphertext: base64(new Uint8Array(ciphertext)),
      configuredAt: new Date().toISOString(),
    };
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptToken(vault, password) {
  validateVault(vault);
  if (typeof password !== "string" || password.length > 200)
    throw new Error("密码不正确，无法解锁。");
  let bytes;
  try {
    const key = await keyFor(
      password,
      unbase64(vault.salt),
      vault.iterations,
      "decrypt",
    );
    bytes = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unbase64(vault.iv),
          additionalData: AAD,
          tagLength: 128,
        },
        key,
        unbase64(vault.ciphertext),
      ),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (
      payload.repo !== REPO ||
      !/^github_pat_[A-Za-z0-9_]{20,}$/.test(payload.token)
    )
      throw new Error();
    return payload.token;
  } catch {
    throw new Error("密码不正确，或管理授权文件已损坏。");
  } finally {
    bytes?.fill(0);
  }
}
