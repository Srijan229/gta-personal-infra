// Business availability raises the HPA floor; only the HPA writes Deployment replicas.
export function decide(spec, signal, status = {}, now = Date.now()) {
  const idle = spec.idleReplicas;
  const open = spec.openReplicas;
  const max = spec.maxReplicas;
  if (
    ![idle, open, max].every(Number.isInteger) ||
    idle < 1 ||
    open < idle ||
    max < open ||
    max > 5
  ) {
    throw Error("Invalid replica bounds");
  }
  const opening = spec.opensAt ? Date.parse(spec.opensAt) : null;
  if (spec.opensAt && !Number.isFinite(opening))
    throw Error("Invalid opening time");
  const prewarm =
    Number.isFinite(opening) &&
    now >= opening - spec.prewarmSeconds * 1000 &&
    now < opening;
  if (
    !signal ||
    typeof signal.open !== "boolean" ||
    !Number.isFinite(Date.parse(signal.observedAt)) ||
    Math.abs(now - Date.parse(signal.observedAt)) > 30000
  )
    throw Error("Availability signal is missing or stale");
  const lastOpenAt = signal.open
    ? new Date(now).toISOString()
    : status.lastOpenAt;
  const cooling =
    !signal.open &&
    lastOpenAt &&
    now - Date.parse(lastOpenAt) < spec.cooldownSeconds * 1000;
  const state = prewarm
    ? "Prewarming"
    : signal.open
      ? "Open"
      : cooling
        ? "CoolingDown"
        : "Idle";
  return {
    minReplicas: prewarm || signal.open || cooling ? open : idle,
    maxReplicas: max,
    windowState: state,
    ...(lastOpenAt ? { lastOpenAt } : {}),
  };
}

export async function reconcile(
  policy,
  { signal, readHpa, patchHpa, patchStatus },
  now = Date.now(),
) {
  try {
    const desired = decide(policy.spec, await signal(), policy.status, now);
    const hpa = await readHpa();
    if (
      hpa.spec.minReplicas !== desired.minReplicas ||
      hpa.spec.maxReplicas !== desired.maxReplicas
    ) {
      await patchHpa({
        spec: {
          minReplicas: desired.minReplicas,
          maxReplicas: desired.maxReplicas,
        },
      });
    }
    const status = {
      ...desired,
      observedGeneration: policy.metadata.generation,
      conditions: [
        {
          type: "Ready",
          status: "True",
          reason: desired.windowState,
          message: "Availability policy reconciled with HPA bounds.",
          lastTransitionTime: new Date(now).toISOString(),
        },
      ],
    };
    const before = policy.status || {};
    if (
      before.windowState !== status.windowState ||
      before.minReplicas !== status.minReplicas ||
      before.maxReplicas !== status.maxReplicas ||
      before.observedGeneration !== status.observedGeneration ||
      before.conditions?.[0]?.status !== "True" ||
      (desired.lastOpenAt && now - Date.parse(before.lastOpenAt || 0) > 10000)
    )
      await patchStatus(status);
    return desired;
  } catch (error) {
    // Never lower capacity when the database/tunnel or signal is unavailable.
    await patchStatus({
      ...policy.status,
      observedGeneration: policy.metadata.generation,
      conditions: [
        {
          type: "Ready",
          status: "False",
          reason: "SignalOrReconcileFailed",
          message: "Reconciliation failed; existing HPA bounds were retained.",
          lastTransitionTime: new Date(now).toISOString(),
        },
      ],
    });
    throw error;
  }
}
