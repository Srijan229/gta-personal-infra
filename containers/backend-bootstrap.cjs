// Portfolio packaging overlay: the pinned application source is kept intact.
// Replicas don't each schedule the same background work. A separate CronJob is provided.
const http = require("node:http");
const expiry = require("./src/lib/interviewExpiry");
expiry.startInterviewExpiry = () => undefined;
const sync = require("./src/lib/flowSync");
sync.startFlowSync = () => undefined;
for (const key of Object.keys(process.env)) {
  if (/^(FLOW_|OIDC_|BASIC_AUTH_|INITIAL_ADMIN|SESSION_SECRET)/.test(key))
    delete process.env[key];
}
const prisma = require("./src/db");
const signals = http.createServer(async (req, res) => {
  if (!["/readyz", "/scaling-signal"].includes(req.url)) {
    res.writeHead(404);
    res.end();
    return;
  }
  try {
    const [activePhases, openSections] = await Promise.all([
      prisma.applicationPhase.count({ where: { isActive: true } }),
      prisma.importedSection.count({
        where: {
          activeStatus: true,
          assignBy: null,
          applicationPerCourseId: null,
        },
      }),
    ]);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(
      JSON.stringify({
        open: activePhases > 0 && openSections > 0,
        activePhases,
        openSections,
        observedAt: new Date().toISOString(),
      }),
    );
  } catch {
    res.writeHead(503);
    res.end("Database unavailable");
  }
});
signals.listen(3002, "0.0.0.0");
process.on("SIGTERM", () => signals.close());
require("./src/server");
