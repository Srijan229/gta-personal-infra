import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  root,
  local,
  source,
  config,
  databaseSettings,
  runtimeEnv,
  ensureNode,
  readState,
} from "./core.mjs";

const worker = path.join(root, "scripts", "worker.mjs");
const command = process.argv[2] || "plan";
function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: root,
    env: runtimeEnv(),
    stdio: "inherit",
    ...options,
  });
  if (result.error || result.status !== 0)
    throw Error(path.basename(file) + " failed (exit " + result.status + ").");
  return result;
}
function pg(name) {
  return process.env.PG_BIN
    ? path.join(
        process.env.PG_BIN,
        name + (process.platform === "win32" ? ".exe" : ""),
      )
    : name;
}
function pgArgs(db) {
  return ["-h", db.host, "-p", db.port, "-U", db.user];
}
function pgEnv(db) {
  return { ...runtimeEnv(), PGPASSWORD: db.password };
}
function prisma(args) {
  run(
    process.execPath,
    [
      path.join(
        source,
        "backend",
        "node_modules",
        "prisma",
        "build",
        "index.js",
      ),
      ...args,
    ],
    { cwd: path.join(source, "backend") },
  );
}
function npm(folder, args) {
  const candidates = [
    process.env.NPM_CLI,
    process.env.npm_execpath,
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    ),
    path.resolve(
      path.dirname(process.execPath),
      "../lib/node_modules/npm/bin/npm-cli.js",
    ),
  ];
  const cli = candidates.find((file) => file && fs.existsSync(file));
  if (!cli)
    throw Error(
      "Cannot find npm-cli.js. Set NPM_CLI in your local environment.",
    );
  run(process.execPath, [cli, ...args], { cwd: path.join(source, folder) });
}
function query(db, sql, database = "postgres") {
  const result = spawnSync(
    pg("psql"),
    [
      ...pgArgs(db),
      "-d",
      database,
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { env: pgEnv(db), encoding: "utf8" },
  );
  if (result.error || result.status)
    throw Error(
      "PostgreSQL query failed; verify your local role and PostgreSQL service.",
    );
  return result.stdout.trim();
}
function owns(state) {
  if (
    !state ||
    !Number.isSafeInteger(state.pid) ||
    !/^[a-f0-9-]{36}$/.test(state.token)
  )
    return false;
  try {
    process.kill(state.pid, 0);
    if (process.platform === "win32") {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          '(Get-CimInstance Win32_Process -Filter "ProcessId = ' +
            state.pid +
            '").CommandLine',
        ],
        { encoding: "utf8" },
      );
      return (
        result.status === 0 &&
        result.stdout.includes(worker) &&
        result.stdout.includes(state.token)
      );
    }
    const line = fs.readFileSync("/proc/" + state.pid + "/cmdline", "utf8");
    return line.includes(worker) && line.includes(state.token);
  } catch {
    return false;
  }
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const test = net.createServer();
    test.once("error", () => reject(Error("Port " + port + " is occupied.")));
    test.listen(port, config.bindAddress, () => test.close(resolve));
  });
}
async function health(port, route) {
  try {
    const r = await fetch("http://127.0.0.1:" + port + route, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}
async function waitHealth(port, route) {
  for (let i = 0; i < 60; i++) {
    if (await health(port, route)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw Error("Startup health check failed; inspect .local logs.");
}
async function stop() {
  for (const role of ["gateway", "backend"]) {
    const state = readState(role);
    if (owns(state)) {
      if (process.platform === "win32")
        run("taskkill.exe", ["/PID", String(state.pid), "/T", "/F"]);
      else process.kill(state.pid, "SIGTERM");
    }
    fs.rmSync(path.join(local, role + ".json"), { force: true });
  }
}
async function main() {
  ensureNode();
  if (command === "plan") {
    console.log(
      JSON.stringify(
        {
          sourceRepository: config.sourceRepository,
          revision: config.sourceRevision,
          database: config.databaseName,
          application: "http://127.0.0.1:" + config.gatewayPort,
          backend: "127.0.0.1:" + config.backendPort,
          runtime: "Native Node 20 / PostgreSQL 18",
          externalIntegrations: "disabled",
          commands: ["doctor", "prepare", "start", "status", "stop", "backup"],
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "stop") {
    await stop();
    return;
  }
  if (command === "status") {
    console.log(
      JSON.stringify(
        {
          backendOwned: owns(readState("backend")),
          gatewayOwned: owns(readState("gateway")),
          backendHealthy: await health(config.backendPort, "/health"),
          gatewayHealthy: await health(config.gatewayPort, "/healthz"),
        },
        null,
        2,
      ),
    );
    return;
  }
  const db = databaseSettings(process.env.DATABASE_URL);
  if (command === "doctor") {
    run("git", ["--version"]);
    run(pg("psql"), ["--version"]);
    if (
      Math.floor(Number(query(db, "SHOW server_version_num")) / 10000) !==
      config.postgresMajor
    )
      throw Error("Use PostgreSQL " + config.postgresMajor + ".");
    console.log(
      "Node and PostgreSQL checks passed; personal database target validated.",
    );
    return;
  }
  if (command === "prepare") {
    if (owns(readState("backend")) || owns(readState("gateway")))
      throw Error("Stop the personal application before preparing it.");
    fs.mkdirSync(local, { recursive: true });
    if (!fs.existsSync(source))
      run("git", ["clone", config.sourceRepository, source]);
    const dirty = spawnSync("git", ["status", "--porcelain"], {
      cwd: source,
      encoding: "utf8",
    });
    if (dirty.status !== 0 || dirty.stdout.trim())
      throw Error(
        "The personal source checkout has changes; preserve them before preparing.",
      );
    run("git", ["fetch", "origin"], { cwd: source });
    run("git", ["checkout", "--detach", config.sourceRevision], {
      cwd: source,
    });
    if (
      !query(
        db,
        "SELECT 1 FROM pg_database WHERE datname='" + config.databaseName + "'",
      )
    ) {
      run(
        pg("createdb"),
        [...pgArgs(db), "--maintenance-db=postgres", db.name],
        { env: pgEnv(db) },
      );
    }
    npm("backend", ["ci", "--no-audit", "--no-fund"]);
    npm("frontend", ["ci", "--no-audit", "--no-fund"]);
    prisma(["validate"]);
    fs.mkdirSync(path.join(local, "backups"), { recursive: true });
    run(
      pg("pg_dump"),
      [
        ...pgArgs(db),
        "-d",
        db.name,
        "-Fc",
        "-f",
        path.join(local, "backups", "before-prepare-" + Date.now() + ".dump"),
      ],
      { env: pgEnv(db) },
    );
    prisma(["migrate", "deploy"]);
    npm("frontend", ["run", "build"]);
    fs.writeFileSync(
      path.join(local, "prepared.json"),
      JSON.stringify({
        revision: config.sourceRevision,
        preparedAt: new Date().toISOString(),
      }),
    );
    console.log(
      "Personal application prepared. No sample records were loaded.",
    );
    return;
  }
  if (command === "backup") {
    fs.mkdirSync(path.join(local, "backups"), { recursive: true });
    const target = path.join(
      local,
      "backups",
      "gta-personal-" + Date.now() + ".dump",
    );
    run(pg("pg_dump"), [...pgArgs(db), "-d", db.name, "-Fc", "-f", target], {
      env: pgEnv(db),
    });
    console.log("Backup saved under .local/backups.");
    return;
  }
  if (command === "start") {
    const prepared = JSON.parse(
      fs.readFileSync(path.join(local, "prepared.json"), "utf8"),
    );
    if (prepared.revision !== config.sourceRevision)
      throw Error("Run prepare for the pinned revision first.");
    if (owns(readState("backend")) || owns(readState("gateway")))
      throw Error("Personal workers already running. Use status or stop.");
    await freePort(config.backendPort);
    await freePort(config.gatewayPort);
    try {
      for (const role of ["backend", "gateway"]) {
        const token = crypto.randomUUID();
        const out = fs.openSync(path.join(local, role + ".log"), "a");
        const child = spawn(
          process.execPath,
          [worker, role, "--token", token],
          {
            cwd: root,
            env: runtimeEnv({ PORT: String(config.backendPort) }),
            detached: true,
            windowsHide: true,
            stdio: ["ignore", out, out],
          },
        );
        if (!child.pid) throw Error("Could not start " + role);
        fs.writeFileSync(
          path.join(local, role + ".json"),
          JSON.stringify({ pid: child.pid, token }),
        );
        fs.closeSync(out);
        child.unref();
        await waitHealth(
          role === "backend" ? config.backendPort : config.gatewayPort,
          role === "backend" ? "/health" : "/healthz",
        );
      }
    } catch (error) {
      await stop();
      throw error;
    }
    console.log(
      "Personal application ready: http://127.0.0.1:" + config.gatewayPort,
    );
    return;
  }
  throw Error("Unknown command: " + command);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(
      error.message.includes("postgresql://")
        ? "Operation failed; verify local configuration."
        : error.message,
    );
    process.exitCode = 1;
  });
}
