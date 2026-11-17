import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { local } from "./core.mjs";
import { guardContext } from "./k8s-guard.mjs";
guardContext();
const started = Date.now();
const samples = [];
function kube(args, json = false) {
  const r = spawnSync("kubectl", ["-n", "gta-demo", ...args], {
    encoding: "utf8",
  });
  if (r.status)
    throw Error("kubectl operation failed: " + args.slice(0, 2).join(" "));
  return json ? JSON.parse(r.stdout) : r.stdout;
}
async function waitFor(label, test, seconds = 150) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const hpa = kube(["get", "hpa", "backend", "-o", "json"], true);
    const deployment = kube(
      ["get", "deployment", "backend", "-o", "json"],
      true,
    );
    const policy = kube(
      ["get", "asp", "application-window", "-o", "json"],
      true,
    );
    const sample = {
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      step: label,
      minReplicas: hpa.spec.minReplicas,
      desiredReplicas: hpa.status?.desiredReplicas || 0,
      readyReplicas: deployment.status?.readyReplicas || 0,
      cpuPercent:
        hpa.status?.currentMetrics?.[0]?.resource?.current
          ?.averageUtilization ?? null,
      windowState: policy.status?.windowState,
      ready: policy.status?.conditions?.[0]?.status,
    };
    samples.push(sample);
    if (test(sample)) {
      console.log(JSON.stringify(sample));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw Error("Timed out waiting for " + label);
}
const output = path.join(local, "evidence");
fs.mkdirSync(output, { recursive: true });
try {
  await waitFor(
    "idle",
    (s) => s.minReplicas === 1 && s.ready === "True" && s.readyReplicas >= 1,
  );
  kube(["exec", "deployment/backend", "--", "node", "scenario.cjs", "open"]);
  await waitFor(
    "application-open",
    (s) =>
      s.minReplicas === 3 && s.readyReplicas >= 3 && s.windowState === "Open",
  );
  kube(["exec", "deployment/backend", "--", "node", "scenario.cjs", "close"]);
  await waitFor(
    "cooldown-complete",
    (s) =>
      s.minReplicas === 1 &&
      s.windowState === "Idle" &&
      s.desiredReplicas === 1 &&
      s.readyReplicas === 1 &&
      s.cpuPercent != null,
  );
  // Exercise actual request handling while HPA remains the replica writer.
  const job = {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: { name: "request-load", namespace: "gta-demo" },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: 120,
      template: {
        spec: {
          restartPolicy: "Never",
          automountServiceAccountToken: false,
          containers: [
            {
              name: "load",
              image: "node:20-bookworm-slim",
              command: [
                "node",
                "-e",
                `const end=Date.now()+90000;Promise.all(Array.from({length:24},async()=>{while(Date.now()<end){try{await(await fetch('http://backend:3001/api/applications')).text()}catch{}}})).then(()=>console.log('load-complete'));`,
              ],
              resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "300m", memory: "128Mi" },
              },
              securityContext: {
                runAsNonRoot: true,
                runAsUser: 1000,
                allowPrivilegeEscalation: false,
                capabilities: { drop: ["ALL"] },
              },
            },
          ],
        },
      },
    },
  };
  const r = spawnSync("kubectl", ["apply", "-f", "-"], {
    input: JSON.stringify(job),
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (r.status) throw Error("Could not create request load");
  await waitFor(
    "traffic-autoscaling",
    (s) => s.cpuPercent > 60 && s.desiredReplicas > 1,
    150,
  );
  console.log("Availability policy and CPU autoscaling demonstrations passed.");
} finally {
  fs.writeFileSync(
    path.join(output, "scaling.json"),
    JSON.stringify(
      {
        context:
          process.env.GTA_CLOUD_APPROVED === "true"
            ? "eks-demo"
            : process.env.GTA_LOCAL_MINIKUBE === "true" ? "minikube" : "kind-rehearsal",
        startedAt: new Date(started).toISOString(),
        samples,
      },
      null,
      2,
    ),
  );
  kube(["delete", "job", "request-load", "--ignore-not-found"]);
}
