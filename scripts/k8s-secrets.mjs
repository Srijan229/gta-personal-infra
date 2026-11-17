import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { local } from "./core.mjs";
import { guardContext } from "./k8s-guard.mjs";
guardContext();
const dir = path.join(local, "k8s");
fs.mkdirSync(dir, { recursive: true });
const url = new URL(
  process.env.GTA_DATABASE_URL || "postgresql://invalid/invalid",
);
if (
  !["/gta_rehearsal", "/gta_personal_k8s"].includes(url.pathname) ||
  url.hostname !== "db-relay"
)
  throw Error("Use the dedicated demo database via db-relay.");
for (const name of ["client_key", "host_key"]) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) {
    const r = spawnSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", file], {
      stdio: "pipe",
    });
    if (r.status) throw Error("SSH key generation failed");
  }
}
const client = fs.readFileSync(path.join(dir, "client_key.pub"), "utf8").trim();
const host = fs.readFileSync(path.join(dir, "host_key.pub"), "utf8").trim();
fs.writeFileSync(
  path.join(dir, "known_hosts"),
  "[127.0.0.1]:2222 " + host + "\n",
);
const b64 = (value) => Buffer.from(value).toString("base64");
for (const secret of [
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "database", namespace: "gta-demo" },
    type: "Opaque",
    data: { url: b64(url.toString()) },
  },
  {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name: "relay-keys", namespace: "gta-demo" },
    type: "Opaque",
    data: {
      host_key: b64(fs.readFileSync(path.join(dir, "host_key"))),
      authorized_keys: b64(
        'restrict,port-forwarding,permitlisten="0.0.0.0:5432" ' + client + "\n",
      ),
    },
  },
]) {
  const r = spawnSync("kubectl", ["apply", "-f", "-"], {
    input: JSON.stringify(secret),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status) throw Error("Could not apply rehearsal secret");
}
console.log("Demo secrets applied; keys remain under ignored .local/k8s.");
