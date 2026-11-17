import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { root, local } from "./core.mjs";
export const settings = JSON.parse(
  fs.readFileSync(path.join(root, "config/kubernetes.json"), "utf8"),
);
const ns = settings.namespace;
const labels = (app) => ({ app, "app.kubernetes.io/part-of": "gta-portfolio" });
const meta = (name, app = name) => ({
  name,
  namespace: ns,
  labels: labels(app),
});
const service = (name, ports) => ({
  apiVersion: "v1",
  kind: "Service",
  metadata: meta(name),
  spec: {
    type: "ClusterIP",
    selector: { app: name },
    ports: ports.map(([port, targetPort = port]) => ({
      name: "tcp-" + port,
      port,
      targetPort,
    })),
  },
});
const podSecurity = {
  runAsNonRoot: true,
  runAsUser: 1000,
  runAsGroup: 1000,
  seccompProfile: { type: "RuntimeDefault" },
};
const security = {
  allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] },
};
const envDb = [
  {
    name: "DATABASE_URL",
    valueFrom: { secretKeyRef: { name: "database", key: "url" } },
  },
];
function deployment(
  name,
  image,
  ports,
  { resources, extra = {}, containerExtra = {} } = {},
) {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: meta(name),
    spec: {
      replicas: 1,
      strategy:
        name === "controller" || name === "db-relay"
          ? { type: "Recreate" }
          : {
              type: "RollingUpdate",
              rollingUpdate: { maxSurge: 1, maxUnavailable: 0 },
            },
      selector: { matchLabels: { app: name } },
      template: {
        metadata: { labels: labels(name) },
        spec: {
          automountServiceAccountToken: false,
          securityContext: podSecurity,
          terminationGracePeriodSeconds: 20,
          containers: [
            {
              name,
              image,
              imagePullPolicy: "IfNotPresent",
              securityContext: security,
              ports: ports.map((containerPort) => ({ containerPort })),
              resources: resources || {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "300m", memory: "256Mi" },
              },
              ...containerExtra,
            },
          ],
          ...extra,
        },
      },
    },
  };
}
export function render({ imagePrefix = "gta-", imageTag = "demo" } = {}) {
  const image = (component) => `${imagePrefix}${component}:${imageTag}`;
  const bootstrap = [
    {
      apiVersion: "v1",
      kind: "Namespace",
      metadata: {
        name: ns,
        labels: { "app.kubernetes.io/part-of": "gta-portfolio" },
      },
    },
    service("db-relay", [[5432], [2222]]),
    service("backend", [[3001], [3002]]),
    service("frontend", [[8080]]),
    deployment("db-relay", image("relay"), [2222, 5432], {
      extra: {
        securityContext: {
          runAsUser: 0,
          seccompProfile: { type: "RuntimeDefault" },
        },
        volumes: [
          {
            name: "keys",
            secret: {
              secretName: "relay-keys",
              items: [
                { key: "host_key", path: "host_key", mode: 256 },
                { key: "authorized_keys", path: "authorized_keys", mode: 420 },
              ],
            },
          },
          { name: "run", emptyDir: {} },
        ],
      },
      containerExtra: {
        securityContext: {
          allowPrivilegeEscalation: false,
          capabilities: {
            drop: ["ALL"],
            add: ["SETUID", "SETGID", "SYS_CHROOT"],
          },
        },
        volumeMounts: [
          { name: "run", mountPath: "/run" },
          { name: "keys", mountPath: "/run/keys", readOnly: true },
        ],
        readinessProbe: { tcpSocket: { port: 2222 }, periodSeconds: 2 },
      },
    }),
  ];
  const migration = [
    {
      apiVersion: "batch/v1",
      kind: "Job",
      metadata: meta("migrate"),
      spec: {
        backoffLimit: 0,
        activeDeadlineSeconds: 180,
        template: {
          metadata: { labels: labels("migrate") },
          spec: {
            restartPolicy: "Never",
            automountServiceAccountToken: false,
            securityContext: podSecurity,
            containers: [
              {
                name: "migrate",
                image: image("backend"),
                securityContext: security,
                env: envDb,
                command: [
                  "node",
                  "node_modules/prisma/build/index.js",
                  "migrate",
                  "deploy",
                ],
                resources: {
                  requests: { cpu: "100m", memory: "128Mi" },
                  limits: { cpu: "500m", memory: "384Mi" },
                },
              },
            ],
          },
        },
      },
    },
  ];
  const app = [
    deployment("backend", image("backend"), [3001, 3002], {
      resources: {
        requests: { cpu: "100m", memory: "128Mi" },
        limits: { cpu: "500m", memory: "384Mi" },
      },
      containerExtra: {
        env: envDb,
        readinessProbe: {
          httpGet: { path: "/readyz", port: 3002 },
          periodSeconds: 3,
        },
        startupProbe: {
          httpGet: { path: "/health", port: 3001 },
          periodSeconds: 2,
          failureThreshold: 45,
        },
        livenessProbe: {
          httpGet: { path: "/health", port: 3001 },
          periodSeconds: 10,
          failureThreshold: 6,
        },
      },
    }),
    deployment("frontend", image("frontend"), [8080], {
      containerExtra: {
        readinessProbe: {
          httpGet: { path: "/healthz", port: 8080 },
          periodSeconds: 3,
        },
        livenessProbe: {
          httpGet: { path: "/healthz", port: 8080 },
          periodSeconds: 10,
        },
      },
    }),
    {
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      metadata: meta("backend"),
      spec: {
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name: "backend",
        },
        minReplicas: 1,
        maxReplicas: 5,
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: { type: "Utilization", averageUtilization: 60 },
            },
          },
        ],
        behavior: {
          scaleDown: { stabilizationWindowSeconds: 30 },
          scaleUp: {
            stabilizationWindowSeconds: 0,
            policies: [{ type: "Pods", value: 2, periodSeconds: 15 }],
          },
        },
      },
    },
    { apiVersion: "v1", kind: "ServiceAccount", metadata: meta("controller") },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "Role",
      metadata: meta("controller"),
      rules: [
        {
          apiGroups: ["portfolio.gta.dev"],
          resources: ["applicationscalingpolicies"],
          verbs: ["get", "list"],
        },
        {
          apiGroups: ["portfolio.gta.dev"],
          resources: ["applicationscalingpolicies/status"],
          verbs: ["patch"],
        },
        {
          apiGroups: ["autoscaling"],
          resources: ["horizontalpodautoscalers"],
          resourceNames: ["backend"],
          verbs: ["get", "patch"],
        },
      ],
    },
    {
      apiVersion: "rbac.authorization.k8s.io/v1",
      kind: "RoleBinding",
      metadata: meta("controller"),
      roleRef: {
        apiGroup: "rbac.authorization.k8s.io",
        kind: "Role",
        name: "controller",
      },
      subjects: [{ kind: "ServiceAccount", name: "controller", namespace: ns }],
    },
    deployment("controller", image("controller"), [8081], {
      extra: {
        automountServiceAccountToken: true,
        serviceAccountName: "controller",
      },
      containerExtra: {
        env: [
          {
            name: "POD_NAMESPACE",
            valueFrom: { fieldRef: { fieldPath: "metadata.namespace" } },
          },
        ],
        readinessProbe: {
          httpGet: { path: "/readyz", port: 8081 },
          periodSeconds: 3,
        },
        livenessProbe: {
          httpGet: { path: "/healthz", port: 8081 },
          periodSeconds: 10,
        },
      },
    }),
    {
      apiVersion: "portfolio.gta.dev/v1alpha1",
      kind: "ApplicationScalingPolicy",
      metadata: meta("application-window"),
      spec: {
        idleReplicas: 1,
        openReplicas: 3,
        maxReplicas: 5,
        prewarmSeconds: 60,
        cooldownSeconds: 20,
      },
    },
    {
      apiVersion: "batch/v1",
      kind: "CronJob",
      metadata: meta("interview-expiry"),
      spec: {
        suspend: true,
        schedule: "0 * * * *",
        concurrencyPolicy: "Forbid",
        jobTemplate: {
          spec: {
            backoffLimit: 1,
            template: {
              spec: {
                restartPolicy: "Never",
                automountServiceAccountToken: false,
                securityContext: podSecurity,
                containers: [
                  {
                    name: "expiry",
                    image: image("backend"),
                    env: envDb,
                    securityContext: security,
                    command: ["node", "expire.cjs"],
                    resources: {
                      requests: { cpu: "50m", memory: "128Mi" },
                      limits: { cpu: "300m", memory: "256Mi" },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  ];
  return { bootstrap, migration, app };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = path.join(local, "k8s");
  fs.mkdirSync(output, { recursive: true });
  const args = {
    imagePrefix: process.env.GTA_IMAGE_PREFIX || "gta-",
    imageTag: process.env.GTA_IMAGE_TAG || "demo",
  };
  for (const [name, items] of Object.entries(render(args)))
    fs.writeFileSync(
      path.join(output, name + ".json"),
      JSON.stringify({ apiVersion: "v1", kind: "List", items }, null, 2),
    );
  console.log("Rendered private Kubernetes resources under .local/k8s.");
}
