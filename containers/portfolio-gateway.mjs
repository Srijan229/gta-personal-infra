import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import telemetry from './telemetry.cjs';
const originalEmit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
  if (event === 'request' && this.address()?.port === 8080)
    return telemetry.track(args[0], args[1], 'frontend', () => originalEmit.call(this, event, ...args));
  return originalEmit.call(this, event, ...args);
};
http.createServer((req, res) => {
  if (req.url !== '/telemetry') {res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','application/json');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(telemetry.snapshot()));
}).listen(8082, '0.0.0.0');
const dist = "/app/dist";
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
http
  .createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.url === "/healthz") {
      res.end("ok");
      return;
    }
    if (/^\/(api|auth)(\/|\?|$)/.test(req.url) || req.url === "/health") {
      const upstream = http.request(
        {
          hostname: "backend",
          port: 3001,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: "backend:3001", ...(telemetry.context.getStore() ? {'x-gta-trace':telemetry.context.getStore().traceId, 'x-gta-parent':telemetry.context.getStore().spanId} : {}) },
        },
        (reply) => {
          res.writeHead(reply.statusCode, reply.headers);
          reply.pipe(res);
        },
      );
      upstream.setTimeout(30000, () => upstream.destroy());
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
    let file = path.resolve(dist, "." + pathname);
    if (!file.startsWith(dist + "/") && file !== dist) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (pathname.split(/[\\/]/).some((part) => part.startsWith("."))) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      if (path.extname(pathname)) {
        res.writeHead(404);
        res.end();
        return;
      }
      file = path.join(dist, "index.html");
    }
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader(
      "Cache-Control",
      file.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    if (req.method === "HEAD") res.end();
    else
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
  })
  .listen(8080, "0.0.0.0");
