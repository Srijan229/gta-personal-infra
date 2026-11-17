import { spawnSync } from "node:child_process";
export function guardContext() {
  const result = spawnSync("kubectl", ["config", "current-context"], {
    encoding: "utf8",
  });
  const context = result.stdout?.trim();
  if (result.status || !context)
    throw Error("Set the isolated rehearsal kubeconfig first.");
  if (context === "kind-gta-rehearsal") return context;
  if (context === "minikube" && process.env.GTA_LOCAL_MINIKUBE === "true")
    return context;
  if (
    process.env.GTA_CLOUD_APPROVED === "true" &&
    /^arn:aws:eks:us-east-1:\d{12}:cluster\/gta-portfolio-demo$/.test(context)
  )
    return context;
  throw Error("Context is outside the approved portfolio rehearsal.");
}
