import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config, source } from "./core.mjs";

export function startGateway({
  dist = path.join(source, "frontend", "dist"),
  port = config.gatewayPort,
  backendPort = config.backendPort,
} = {}) {
  const mime = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  const server = http.createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.url === "/healthz") {
      res.end("ok");
      return;
    }
    if (/^\/(api|auth)(\/|\?|$)/.test(req.url) || req.url === "/health") {
      const upstream = http.request(
        {
          hostname: config.bindAddress,
          port: backendPort,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: "127.0.0.1:" + backendPort },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end("Backend unavailable");
      });
      req.on("aborted", () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    let target = path.resolve(dist, "." + pathname);
    if (!target.startsWith(dist + path.sep) && target !== dist) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (pathname.split(/[\\/]/).some((part) => part.startsWith("."))) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      if (path.extname(pathname)) {
        res.writeHead(404);
        res.end();
        return;
      }
      target = path.join(dist, "index.html");
    }
    if (!fs.existsSync(target)) {
      res.writeHead(503);
      res.end("Run prepare first");
      return;
    }
    res.setHeader(
      "Content-Type",
      mime[path.extname(target)] || "application/octet-stream",
    );
    res.setHeader(
      "Cache-Control",
      target.includes(path.sep + "assets" + path.sep)
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    if (req.method === "HEAD") res.end();
    else
      fs.createReadStream(target)
        .on("error", () => res.destroy())
        .pipe(res);
  });
  server.listen(port, config.bindAddress);
  return server;
}
