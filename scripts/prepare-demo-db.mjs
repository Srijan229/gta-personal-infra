import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { local, source, databaseSettings } from "./core.mjs";
const admin = databaseSettings(process.env.DATABASE_URL);
const dir = path.join(local, "k8s");
fs.mkdirSync(dir, { recursive: true });
const credentials = path.join(dir, "database.json");
const name = "gta_personal_k8s";
const user = "gta_portfolio_demo";
const pg = (program) =>
  process.env.PG_BIN
    ? path.join(
        process.env.PG_BIN,
        program + (process.platform === "win32" ? ".exe" : ""),
      )
    : program;
function query(sql) {
  const result = spawnSync(
    pg("psql"),
    [
      "-h",
      admin.host,
      "-p",
      admin.port,
      "-U",
      admin.user,
      "-d",
      "postgres",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    {
      input: sql,
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: admin.password },
    },
  );
  if (result.error || result.status)
    throw Error(
      "Personal database setup failed; the local role must be able to create a role and database.",
    );
  return result.stdout.trim();
}
let owned;
if (fs.existsSync(credentials)) {
  owned = JSON.parse(fs.readFileSync(credentials, "utf8"));
  if (owned.database !== name || owned.user !== user)
    throw Error("Saved database configuration mismatch");
} else {
  if (
    query(`SELECT 1 FROM pg_database WHERE datname='${name}';`) ||
    query(`SELECT 1 FROM pg_roles WHERE rolname='${user}';`)
  )
    throw Error(
      "Demo database or role already exists without this project configuration; refusing to take ownership.",
    );
  owned = {
    database: name,
    user,
    password: crypto.randomBytes(24).toString("hex"),
  };
  fs.writeFileSync(credentials, JSON.stringify(owned), { mode: 0o600 });
}
if (!query(`SELECT 1 FROM pg_roles WHERE rolname='${user}';`))
  query(
    `CREATE ROLE "${user}" LOGIN PASSWORD '${owned.password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT CONNECTION LIMIT 30;`,
  );
if (!query(`SELECT 1 FROM pg_database WHERE datname='${name}';`)) {
  const r = spawnSync(
    pg("createdb"),
    [
      "-h",
      admin.host,
      "-p",
      admin.port,
      "-U",
      admin.user,
      "--owner=" + user,
      name,
    ],
    { stdio: "pipe", env: { ...process.env, PGPASSWORD: admin.password } },
  );
  if (r.status)
    throw Error("Could not create the dedicated portfolio database");
}
const direct = new URL(
  `postgresql://${user}:${owned.password}@127.0.0.1:${admin.port}/${name}?connection_limit=3`,
);
const cluster = new URL(direct);
cluster.hostname = "db-relay";
cluster.port = "5432";
fs.writeFileSync(
  path.join(dir, "laptop.env"),
  `DATABASE_URL=${direct}\nGTA_DATABASE_URL=${cluster}\n`,
  { mode: 0o600 },
);
for (const args of [["validate"], ["migrate", "deploy"]]) {
  const r = spawnSync(
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
    {
      cwd: path.join(source, "backend"),
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: direct.toString() },
    },
  );
  if (r.status) throw Error("Demo schema preparation failed");
}
console.log(
  "Dedicated portfolio database prepared. Credentials remain in ignored .local/k8s.",
);
