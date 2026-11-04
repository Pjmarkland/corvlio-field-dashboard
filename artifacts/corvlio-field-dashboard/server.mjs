import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, extname, resolve, sep } from "node:path";
import { dashboardCsp } from "./security-policy.mjs";

let publicDirectory;
try {
  publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "dist/public");
} catch {
  // Vitest's transformed module URL is not a file URL; tests pass an explicit
  // temporary public directory to createDashboardServer.
  publicDirectory = resolve(process.cwd(), "dist/public");
}

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
]);

function setSecurityHeaders(request, response) {
  response.setHeader("Content-Security-Policy", dashboardCsp);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (request.headers["x-forwarded-proto"]?.split(",")[0]?.trim() === "https") {
    response.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
}

function reply(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(body);
}

export function createDashboardServer(root = publicDirectory) {
  const safeRoot = resolve(root);

  return createServer(async (request, response) => {
    setSecurityHeaders(request, response);

    if (request.method !== "GET" && request.method !== "HEAD") {
      reply(response, 405, "Method not allowed", { Allow: "GET, HEAD" });
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(request.url ?? "/", "http://localhost").pathname,
      );
    } catch {
      reply(response, 400, "Bad request");
      return;
    }
    if (pathname.includes("\0")) {
      reply(response, 400, "Bad request");
      return;
    }

    let filePath = resolve(safeRoot, `.${pathname}`);
    if (filePath !== safeRoot && !filePath.startsWith(`${safeRoot}${sep}`)) {
      reply(response, 403, "Forbidden");
      return;
    }

    let fileInfo;
    try {
      fileInfo = await stat(filePath);
      if (fileInfo.isDirectory()) {
        filePath = resolve(filePath, "index.html");
        fileInfo = await stat(filePath);
      }
    } catch {
      if (request.headers.accept?.includes("text/html")) {
        filePath = resolve(safeRoot, "index.html");
        try {
          fileInfo = await stat(filePath);
        } catch {
          reply(response, 404, "Not found");
          return;
        }
      } else {
        reply(response, 404, "Not found");
        return;
      }
    }

    if (!fileInfo.isFile()) {
      reply(response, 404, "Not found");
      return;
    }

    const extension = extname(filePath).toLowerCase();
    const isMutableAsset = [".html", ".webmanifest"].includes(extension)
      || filePath.endsWith("/sw.js");
    response.writeHead(200, {
      "Content-Type": contentTypes.get(extension) ?? "application/octet-stream",
      "Content-Length": fileInfo.size,
      "Cache-Control": isMutableAsset
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    });

    if (request.method === "HEAD") {
      response.end();
      return;
    }

    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (response.headersSent) {
        response.destroy();
      } else {
        reply(response, 500, "Internal server error");
      }
    });
    stream.pipe(response);
  });
}

if (
  process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT ?? 5000);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  createDashboardServer().listen(port, "0.0.0.0");
}
