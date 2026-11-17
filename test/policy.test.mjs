import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, reconcile } from "../controller/policy.mjs";
const now = Date.parse("2026-11-17T14:00:00Z");
const spec = {
  idleReplicas: 1,
  openReplicas: 3,
  maxReplicas: 5,
  prewarmSeconds: 60,
  cooldownSeconds: 20,
};
const signal = (open) => ({ open, observedAt: new Date(now).toISOString() });
test("availability changes baseline; prewarming and cooldown preserve capacity", () => {
  assert.equal(decide(spec, signal(false), {}, now).minReplicas, 1);
  assert.equal(decide(spec, signal(true), {}, now).minReplicas, 3);
  assert.equal(
    decide(
      { ...spec, opensAt: new Date(now + 30000).toISOString() },
      signal(false),
      {},
      now,
    ).windowState,
    "Prewarming",
  );
  assert.equal(
    decide(
      spec,
      signal(false),
      { lastOpenAt: new Date(now - 10000).toISOString() },
      now,
    ).windowState,
    "CoolingDown",
  );
  assert.equal(
    decide(
      spec,
      signal(false),
      { lastOpenAt: new Date(now - 21000).toISOString() },
      now,
    ).minReplicas,
    1,
  );
  assert.throws(() =>
    decide({ ...spec, maxReplicas: 2 }, signal(true), {}, now),
  );
});
test("stale or unavailable signals retain HPA bounds and report failure", async () => {
  let patches = 0;
  let status;
  await assert.rejects(
    reconcile(
      { spec, metadata: { generation: 1 } },
      {
        signal: async () => ({
          open: false,
          observedAt: new Date(now - 31000).toISOString(),
        }),
        readHpa: async () => ({ spec: { minReplicas: 3, maxReplicas: 5 } }),
        patchHpa: async () => patches++,
        patchStatus: async (value) => {
          status = value;
        },
      },
      now,
    ),
  );
  assert.equal(patches, 0);
  assert.equal(status.conditions[0].status, "False");
});
test("reconciliation changes HPA bounds and is idempotent for an idle policy", async () => {
  let hpa = { spec: { minReplicas: 3, maxReplicas: 5 } };
  let patches = 0;
  let statuses = 0;
  const policy = { spec, metadata: { generation: 2 } };
  const io = {
    signal: async () => signal(false),
    readHpa: async () => hpa,
    patchHpa: async (value) => {
      patches++;
      hpa = value;
    },
    patchStatus: async (value) => {
      statuses++;
      policy.status = value;
    },
  };
  await reconcile(policy, io, now);
  await reconcile(policy, io, now);
  assert.equal(patches, 1);
  assert.equal(statuses, 1);
  assert.deepEqual(hpa.spec, { minReplicas: 1, maxReplicas: 5 });
});
