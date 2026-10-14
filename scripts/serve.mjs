import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { encodeContent, decodeContent } from "../github.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT || 4173),
  testApi = process.argv.includes("--test-api"),
  testCloud = process.argv.includes("--test-cloud");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".geojson": "application/json",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
};
let atlas = JSON.parse(
    await readFile(path.join(root, "data/atlas.json"), "utf8"),
  ),
  vault = null,
  dataSha = "test-data-1",
  vaultSha,
  sequence = 1;
const json = (response, status, data) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
};
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    // Isolated password-backend fixture. All changes stay in process memory.
    if (testCloud && pathname.startsWith("/cloud-fixture/")) {
      if (
        !["/cloud-fixture/api/auth", "/cloud-fixture/api/atlas"].includes(
          pathname,
        )
      )
        return json(response, 404, {});
      if (request.method === "GET" && pathname.endsWith("/atlas"))
        return json(response, 200, { document: atlas, revision: dataSha });
      if (request.method !== "POST") return json(response, 405, {});
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2000000) return json(response, 413, {});
      }
      const value = JSON.parse(body);
      if (value.password !== "2468")
        return json(response, 401, { error: "测试密码不正确。" });
      if (pathname.endsWith("/auth"))
        return json(response, 200, { authenticated: true });
      if (value.baselineRevision !== dataSha)
        return json(response, 409, {
          error: "云端记录已变化，请重新检查并合并。",
        });
      atlas = value.document;
      dataSha = "test-cloud-" + ++sequence;
      return json(response, 200, {
        published: true,
        document: atlas,
        revision: dataSha,
      });
    }
    if (testApi && pathname.startsWith("/api-fixture/")) {
      const isVault = pathname.endsWith("admin.vault.json"),
        state = isVault ? vault : atlas,
        sha = isVault ? vaultSha : dataSha;
      if (
        ![
          "/api-fixture/data/atlas.json",
          "/api-fixture/data/admin.vault.json",
        ].includes(pathname)
      )
        return json(response, 404, {});
      if (request.method === "GET")
        return state
          ? json(response, 200, {
              sha,
              content: encodeContent(JSON.stringify(state)),
            })
          : json(response, 404, {});
      if (request.method !== "PUT") return json(response, 405, {});
      if (
        !request.headers.authorization?.startsWith(
          "Bearer github_pat_TestOnlyNoPermissions",
        )
      )
        return json(response, 401, {});
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2000000) return json(response, 413, {});
      }
      const value = JSON.parse(body);
      if (value.sha !== sha) return json(response, 409, {});
      const next = JSON.parse(decodeContent(value.content)),
        nextSha = "test-" + ++sequence;
      if (isVault) {
        vault = next;
        vaultSha = nextSha;
      } else {
        atlas = next;
        dataSha = nextSha;
      }
      return json(response, 200, {
        content: { sha: nextSha },
        commit: { sha: "abcdef0123456789abcdef0123456789abcdef01" },
      });
    }
    if (testApi && pathname === "/data/atlas.json")
      return json(response, 200, atlas);
    if (testApi && pathname === "/data/admin.vault.json")
      return vault ? json(response, 200, vault) : json(response, 404, {});
    const filename = path.resolve(
      root,
      "." + (pathname === "/" ? "/index.html" : pathname),
    );
    const relative = path.relative(root, filename);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).some((part) => part.startsWith("."))
    ) {
      response.writeHead(403);
      return response.end();
    }
    let content = await readFile(filename);
    if (testCloud && pathname === "/app.js")
      content = Buffer.from(
        content
          .toString()
          .replace(
            "new PasswordClient()",
            "new PasswordClient((url, options) => fetch(url.replace('https://travel-atlas-publish-warren.neoncorgi.chatgpt.site', '/cloud-fixture'), options))",
          ),
      );
    // Local QA substitutes only the network transport. All app behavior and
    // encryption still run unchanged; simulated writes never touch GitHub.
    if (testApi && pathname === "/app.js")
      content = Buffer.from(
        content
          .toString()
          .replaceAll(
            "new GitHubClient()",
            "new GitHubClient((url, options) => fetch(url.replace('https://api.github.com/repos/Warren-xh/travel-atlas/contents/', '/api-fixture/'), options))",
          ),
      );
    response.writeHead(200, {
      "Content-Type":
        mime[path.extname(filename)] || "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch (error) {
    response.writeHead(error.code === "ENOENT" ? 404 : 500);
    response.end("Resource unavailable");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    "Local: http://127.0.0.1:" +
      port +
      (testApi || testCloud ? " (isolated QA API)" : ""),
  ),
);
