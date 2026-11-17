import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, local, source, config } from "./core.mjs";
function run(file, args, cwd = root) {
  const result = spawnSync(file, args, { cwd, stdio: "inherit" });
  if (result.error || result.status) throw Error(file + " failed");
}
const build = path.join(local, "build");
fs.mkdirSync(build, { recursive: true });
if (!fs.existsSync(source)) {
  run("git", ["init", source]);
  run("git", ["remote", "add", "origin", config.sourceRepository], source);
  run("git", ["fetch", "--depth=1", "origin", config.sourceRevision], source);
  run("git", ["checkout", "--detach", "FETCH_HEAD"], source);
}
const actual = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: source,
  encoding: "utf8",
});
if (actual.stdout.trim() !== config.sourceRevision)
  throw Error("Source pin mismatch");
const archive = path.join(build, "source.tar");
run(
  "git",
  ["archive", "--format=tar", "--output=" + archive, config.sourceRevision],
  source,
);
const stage = path.join(build, "source");
fs.mkdirSync(stage, { recursive: true });
run("tar", ["-xf", archive, "-C", stage]);
for (const file of ["backend-bootstrap.cjs", "scenario.cjs", "expire.cjs"])
  fs.copyFileSync(
    path.join(root, "containers", file),
    path.join(stage, "backend", file),
  );
fs.copyFileSync(
  path.join(root, "containers", "portfolio-gateway.mjs"),
  path.join(stage, "frontend", "portfolio-gateway.mjs"),
);
for (const component of ["backend", "frontend", "controller", "relay"]) {
  const context = ["backend", "frontend"].includes(component)
    ? path.join(stage, component)
    : root;
  run("docker", [
    "build",
    "-t",
    `gta-${component}:demo`,
    "-f",
    path.join(root, "containers", component + ".Dockerfile"),
    context,
  ]);
}
fs.writeFileSync(
  path.join(build, "provenance.json"),
  JSON.stringify(
    {
      applicationRevision: config.sourceRevision,
      infrastructureRevision: spawnSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim(),
      builtAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
