const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const os = require('node:os');
const context = new AsyncLocalStorage();
const spans = [];
const startedAt = new Date().toISOString();
let requests = 0, errors = 0, totalMs = 0, inflight = 0;
const histogram = Array(9).fill(0);
const bounds = [5, 10, 25, 50, 100, 250, 500, 1000, Infinity];
function record(span) { spans.push(span); if (spans.length > 600) spans.shift(); }
function track(req, res, component, next) {
  if (req.url === '/health' || req.url === '/healthz') return next();
  const supplied = req.headers['x-gta-trace'];
  const traceId = typeof supplied === 'string' && /^[a-f0-9-]{36}$/.test(supplied) ? supplied : randomUUID();
  const spanId = randomUUID(), start = Date.now(), monotonic = performance.now();
  const parent = req.headers['x-gta-parent'];
  const parentId = typeof parent === 'string' && /^[a-f0-9-]{36}$/.test(parent) ? parent : null;
  const route = req.url?.split('?')[0] === '/api/applications' ? '/api/applications' : req.url?.startsWith('/api/') ? '/api/*' : '/page';
  res.setHeader('X-GTA-Trace', traceId);
  inflight++;
  let done = false;
  const finish = () => {
    if (done) return; done = true;
    const durationMs = performance.now() - monotonic;
    const failed = !res.writableFinished || res.statusCode >= 500;
    inflight--; requests++; if (failed) errors++;
    totalMs += durationMs;
    histogram[bounds.findIndex(b => durationMs <= b)]++;
    record({traceId, spanId, parentId, component, pod: os.hostname(), start, durationMs, status: res.writableFinished ? res.statusCode : 499, operation: `${req.method} ${route}`});
  };
  res.once('finish', finish); res.once('close', finish);
  return context.run({traceId, spanId}, next);
}
function snapshot() { return {pod: os.hostname(), startedAt, requests, errors, totalMs, inflight, histogram, bounds: bounds.map(b => Number.isFinite(b) ? b : null), spans}; }
function instrumentPrisma(prisma) {
  prisma.$use(async (params, next) => {
    const parent = context.getStore();
    if (!parent) return next(params);
    const start = Date.now(), monotonic = performance.now(); let status = 200;
    try { return await next(params); } catch (error) { status = 500; throw error; }
    finally { record({traceId: parent.traceId, spanId: randomUUID(), parentId: parent.spanId, component:'database', pod:os.hostname(), start, durationMs: performance.now()-monotonic, status, operation:`${params.model || 'database'}.${params.action}`}); }
  });
}
module.exports = {track, snapshot, context, instrumentPrisma};
