import { test } from "node:test";
import assert from "node:assert/strict";
import { render } from "../scripts/render-k8s.mjs";
test("private services, bounded HPA, and controller RBAC keep the rehearsal scoped", () => {
  const all = Object.values(render()).flat();
  assert.ok(
    all
      .filter((item) => item.kind === "Service")
      .every((item) => item.spec.type === "ClusterIP"),
  );
  assert.ok(!all.some((item) => ["Ingress", "Gateway"].includes(item.kind)));
  const hpa = all.find((item) => item.kind === "HorizontalPodAutoscaler");
  assert.equal(hpa.spec.maxReplicas, 5);
  const role = all.find((item) => item.kind === "Role");
  assert.ok(
    !role.rules.some(
      (rule) =>
        rule.resources.includes("deployments") ||
        rule.resources.includes("secrets"),
    ),
  );
  const controller = all.find(
    (item) => item.kind === "Deployment" && item.metadata.name === "controller",
  );
  assert.equal(controller.spec.replicas, 1);
  assert.equal(controller.spec.strategy.type, "Recreate");
  assert.equal(all.find((item) => item.kind === "CronJob").spec.suspend, true);
});
