import { REPO } from "./core.mjs";
import { decryptToken } from "./auth.mjs";

const DATABASE = "travel-atlas-device-access-v1";
const STORE = "access";
export const validPin = (pin) =>
  typeof pin === "string" && /^\d{4,8}$/.test(pin);

export async function createDeviceKey() {
  return crypto.subtle.generateKey(
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign"],
  );
}

export async function devicePassword(key, pin) {
  if (!validPin(pin)) throw Error("请输入 4 至 8 位数字 PIN。");
  if (!key || key.extractable || key.algorithm?.name !== "HMAC")
    throw Error("本机授权密钥不正确，请重新配置。");
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode("travel-atlas/device/v1/" + REPO + "/" + pin),
    ),
  );
  try {
    return btoa(
      Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
    );
  } finally {
    bytes.fill(0);
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        Error("此浏览器不支持本机授权存储。请选择跨设备长密码模式。"),
      );
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(Error("无法打开本机授权存储。请检查浏览器存储设置。"));
    request.onblocked = () =>
      reject(Error("本机授权存储正在被其他页面更新，请关闭其他地图标签页。"));
  });
}

async function accessTransaction(mode, update) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode),
        store = transaction.objectStore(STORE);
      const request = store.get(REPO);
      let result, failure;
      request.onsuccess = () => {
        try {
          result = update(request.result, store);
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () =>
        reject(failure || Error("无法保存本机授权，请检查可用存储空间。"));
    });
  } finally {
    database.close();
  }
}

export async function hasDeviceAccess() {
  return accessTransaction("readonly", (row) => !!row);
}

export async function saveDeviceAccess(client, pin) {
  const key = await createDeviceKey();
  const vault = await client.seal(await devicePassword(key, pin));
  await accessTransaction("readwrite", (_row, store) => {
    store.put({ key, vault, attempts: 0, retryAt: 0 }, REPO);
  });
}

export async function removeDeviceAccess() {
  await accessTransaction("readwrite", (_row, store) => store.delete(REPO));
}

export async function unlockDevice(pin) {
  if (!validPin(pin)) throw Error("请输入 4 至 8 位数字 PIN。");
  const row = await accessTransaction("readwrite", (current, store) => {
    if (!current) throw Error("此浏览器还未配置发布授权，请先配置一次。");
    if (current.retryAt > Date.now())
      throw Error(
        "PIN 尝试过于频繁，请在 " +
          Math.ceil((current.retryAt - Date.now()) / 1000) +
          " 秒后重试。",
      );
    current.attempts = (current.attempts || 0) + 1;
    current.retryAt = current.attempts >= 5 ? Date.now() + 60000 : 0;
    store.put(current, REPO);
    return current;
  });
  try {
    const token = await decryptToken(
      row.vault,
      await devicePassword(row.key, pin),
    );
    await accessTransaction("readwrite", (current, store) => {
      if (current && current.vault.configuredAt === row.vault.configuredAt)
        store.put({ ...current, attempts: 0, retryAt: 0 }, REPO);
    });
    return token;
  } catch {
    throw Error("PIN 不正确，或本机授权已损坏。连续 5 次尝试后需等待 1 分钟。");
  }
}
