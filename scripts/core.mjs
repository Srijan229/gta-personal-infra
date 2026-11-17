import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const local = path.join(root, ".local");
export const source = path.join(local, "source");
export const config = JSON.parse(
  fs.readFileSync(path.join(root, "config/local.json"), "utf8"),
);

export function databaseSettings(raw) {
  const url = new URL(raw || "postgresql://invalid/invalid");
  if (
    !["postgresql:", "postgres:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    decodeURIComponent(url.pathname.slice(1)) !== config.databaseName ||
    !url.username ||
    !url.password ||
    /YOUR_/.test(raw || "")
  ) {
    throw Error(
      "Set DATABASE_URL to a local PostgreSQL database named " +
        config.databaseName +
        ".",
    );
  }
  if (url.search)
    throw Error(
      "This local profile does not accept database URL query options.",
    );
  return {
    url,
    host: url.hostname,
    port: url.port || "5432",
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    name: config.databaseName,
  };
}

export function runtimeEnv(extra = {}) {
  const result = { ...process.env };
  for (const key of Object.keys(result)) {
    if (
      /^(OIDC_|FLOW_|BASIC_AUTH_|CORS_|INITIAL_ADMIN|SESSION_SECRET|DATABASE_URL$)/.test(
        key,
      )
    )
      delete result[key];
  }
  return {
    ...result,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: "development",
    ...extra,
  };
}

export function ensureNode() {
  if (Number(process.versions.node.split(".")[0]) !== config.nodeMajor)
    throw Error(
      "Use Node " + config.nodeMajor + " for this pinned application.",
    );
}

export function insideSource(relative) {
  const target = path.resolve(source, relative);
  if (target !== source && !target.startsWith(source + path.sep))
    throw Error("Path leaves the application checkout.");
  return target;
}

export function readState(role) {
  const file = path.join(local, role + ".json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}
