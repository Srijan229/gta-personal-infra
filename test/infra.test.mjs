import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  config,
  databaseSettings,
  runtimeEnv,
  insideSource,
} from "../scripts/core.mjs";
import { startGateway } from "../scripts/gateway.mjs";

test("database guard rejects reference databases, remote servers and invalid targets", () => {
  for (const name of [
    "gta_app",
    "gta_ui_test",
    "gta_search_demo",
    "postgres",
  ]) {
    assert.throws(() =>
      databaseSettings("postgresql://test:pass@127.0.0.1/" + name),
    );
  }
  assert.throws(() =>
    databaseSettings("postgresql://test:pass@example.test/gta_personal"),
  );
  assert.throws(() =>
    databaseSettings("https://test:pass@localhost/gta_personal"),
  );
  assert.throws(() =>
    databaseSettings(
      "postgresql://test:pass@localhost/gta_personal?schema=other",
    ),
  );
  assert.equal(
    databaseSettings("postgresql://test:pass@localhost/gta_personal").name,
    "gta_personal",
  );
});

test("runtime clears inherited external integration settings", () => {
  const keys = [
    "FLOW_WEBHOOK_URL",
    "OIDC_CLIENT_SECRET",
    "BASIC_AUTH_PASS",
    "SESSION_SECRET",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  try {
    keys.forEach((key) => {
      process.env[key] = "test-fixture";
    });
    const env = runtimeEnv();
    keys.forEach((key) => assert.equal(env[key], undefined));
    assert.equal(env.NODE_ENV, "development");
  } finally {
    keys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
});

test("source path stays within its checkout and application ports are distinct", () => {
  assert.throws(() => insideSource("../outside"));
  assert.match(insideSource("backend"), /backend$/);
  assert.equal(config.bindAddress, "127.0.0.1");
  assert.notEqual(config.gatewayPort, config.backendPort);
  assert.ok(![3001, 5173].includes(config.backendPort));
});

test("gateway serves SPA routes and forwards API bodies and auth cookies", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gta-infra-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html>Personal app</html>");
  fs.writeFileSync(path.join(dir, "app.js"), 'console.log("test")');
  fs.writeFileSync(path.join(dir, ".env"), "hidden");
  const upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Set-Cookie", "session=test; HttpOnly; SameSite=Lax");
      res.end(JSON.stringify({ url: req.url, body }));
    });
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const gateway = startGateway({
    dist: dir,
    port: 0,
    backendPort: upstream.address().port,
  });
  await once(gateway, "listening");
  t.after(async () => {
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((resolve) => gateway.close(resolve)),
      new Promise((resolve) => upstream.close(resolve)),
    ]);
    if (dir.startsWith(path.join(os.tmpdir(), "gta-infra-test-")))
      fs.rmSync(dir, { recursive: true });
  });
  const base = "http://127.0.0.1:" + gateway.address().port;
  assert.match(await (await fetch(base + "/profile")).text(), /Personal app/);
  const js = await fetch(base + "/app.js");
  assert.equal(js.headers.get("content-type"), "text/javascript");
  assert.equal((await fetch(base + "/missing.js")).status, 404);
  assert.equal((await fetch(base + "/.env")).status, 404);
  const result = await fetch(base + "/api/example?x=1", {
    method: "POST",
    body: "payload",
  });
  assert.deepEqual(await result.json(), {
    url: "/api/example?x=1",
    body: "payload",
  });
  assert.match(result.headers.get("set-cookie"), /HttpOnly/);
  assert.equal((await (await fetch(base + "/auth/me")).json()).url, "/auth/me");
  assert.equal((await fetch(base + "/healthz")).status, 200);
});
