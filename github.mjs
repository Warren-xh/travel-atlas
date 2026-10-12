import { REPO, BRANCH } from "./core.mjs";
import { encryptToken } from "./auth.mjs";

export const DATA_PATH = "data/atlas.json";
export const VAULT_PATH = "data/admin.vault.json";
export const decodeContent = (text) =>
  new TextDecoder().decode(
    Uint8Array.from(atob(text.replace(/\s/g, "")), (c) => c.charCodeAt(0)),
  );
export const encodeContent = (text) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export class GitHubClient {
  #token = "";
  #fetch;
  constructor(fetcher = fetch) {
    this.#fetch = fetcher;
  }
  get unlocked() {
    return !!this.#token;
  }
  unlock(token) {
    this.#token = token;
  }
  lock() {
    this.#token = "";
  }
  seal(password) {
    return encryptToken(this.#token, password);
  }
  async request(path, method = "GET", body, authenticated = true) {
    if (![DATA_PATH, VAULT_PATH].includes(path))
      throw new Error("不支持发布这个文件。");
    if (!["GET", "PUT"].includes(method))
      throw new Error("不支持这个 GitHub 操作。");
    if (method !== "GET" && !this.unlocked)
      throw new Error("请先用管理密码解锁。");
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    };
    if (authenticated && this.unlocked)
      headers.Authorization = "Bearer " + this.#token;
    if (body) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await this.#fetch(
        "https://api.github.com/repos/" +
          REPO +
          "/contents/" +
          path +
          (method === "GET" ? "?ref=" + BRANCH : ""),
        {
          method,
          cache: "no-store",
          headers,
          signal: AbortSignal.timeout(25000),
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
    } catch {
      throw new Error(
        "连接 GitHub 超时或网络不可用。草稿仍保留在本机，请稍后重试。",
      );
    }
    if (
      response.status === 404 &&
      method === "GET" &&
      path === VAULT_PATH &&
      !authenticated
    )
      return null;
    if (!response.ok) {
      const messages = {
        401: "GitHub 授权已过期或被撤销。请在管理设置中更新授权。",
        403: "GitHub 拒绝访问，请确认 Token 的 Contents 权限为 Read and write；也可能触发了请求频率限制。",
        404: "无法访问该仓库文件。请确认 Token 仅授权 travel-atlas，且文件仍存在。",
        409: "另一台设备刚发布了更新。你的草稿未丢失，请再次检查并发布。",
        422: "GitHub 未接受保存。请检查仓库权限和分支保护设置。",
      };
      throw new Error(
        messages[response.status] ||
          "GitHub 请求失败（" + response.status + "）。",
      );
    }
    return response.json();
  }
  async read(path, authenticated = true) {
    const file = await this.request(path, "GET", undefined, authenticated);
    return file
      ? { data: JSON.parse(decodeContent(file.content)), sha: file.sha }
      : null;
  }
  write(path, data, sha, message) {
    return this.request(path, "PUT", {
      message,
      content: encodeContent(JSON.stringify(data, null, 2) + "\n"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    });
  }
}
