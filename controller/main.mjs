import fs from "node:fs";
import https from "node:https";
import http from "node:http";
import { reconcile } from "./policy.mjs";

const namespace = process.env.POD_NAMESPACE || "gta-demo";
const account = "/var/run/secrets/kubernetes.io/serviceaccount/";
const ca = fs.readFileSync(account + "ca.crt");
const host = process.env.KUBERNETES_SERVICE_HOST;
const port = process.env.KUBERNETES_SERVICE_PORT_HTTPS || 443;
let lastPoll = 0;
let stopped = false;
function request(path, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        port,
        path,
        method,
        ca,
        headers: {
          Authorization:
            "Bearer " + fs.readFileSync(account + "token", "utf8").trim(),
          ...(body ? { "Content-Type": "application/merge-patch+json" } : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
          if (text.length > 1000000) req.destroy(Error("Response too large"));
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300)
            reject(Error("Kubernetes API status " + res.statusCode));
          else {
            try {
              resolve(JSON.parse(text || "{}"));
            } catch {
              reject(Error("Invalid API response"));
            }
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy(Error("Kubernetes API timeout")));
    req.on("error", reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const base = `/apis/portfolio.gta.dev/v1alpha1/namespaces/${namespace}/applicationscalingpolicies`;
async function poll() {
  try {
    const list = await request(base);
    for (const policy of list.items) {
      const hpaPath = `/apis/autoscaling/v2/namespaces/${namespace}/horizontalpodautoscalers/backend`;
      try {
        await reconcile(policy, {
          signal: async () => {
            const res = await fetch(
              `http://backend.${namespace}.svc:3002/scaling-signal`,
              { signal: AbortSignal.timeout(5000) },
            );
            if (!res.ok) throw Error("Signal unavailable");
            return res.json();
          },
          readHpa: () => request(hpaPath),
          patchHpa: (body) => request(hpaPath, "PATCH", body),
          patchStatus: (status) =>
            request(base + "/" + policy.metadata.name + "/status", "PATCH", {
              status,
            }),
        });
      } catch {
        console.error(
          "Policy reconciliation failed; inspect policy Ready condition.",
        );
      }
    }
    lastPoll = Date.now();
  } catch {
    console.error("Kubernetes API poll failed.");
  }
}
const server = http.createServer((req, res) => {
  res.statusCode =
    req.url === "/healthz" || (lastPoll && Date.now() - lastPoll < 30000)
      ? 200
      : 503;
  res.end(res.statusCode === 200 ? "ok" : "waiting");
});
server.listen(8081, "0.0.0.0");
async function loop() {
  while (!stopped) {
    await poll();
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
loop();
process.on("SIGTERM", () => {
  stopped = true;
  server.close();
});
