import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import telemetry from '../containers/telemetry.cjs';
test('HTTP and database spans correlate without retaining payloads or query arguments',async()=>{
  let middleware;
  telemetry.instrumentPrisma({$use(fn){middleware=fn;}});
  const server=http.createServer((req,res)=>telemetry.track(req,res,'backend',async()=>{
    await middleware({model:'Profile',action:'findMany',args:{email:'private@example.test'}},async()=>[]);
    res.end('ok');
  }));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const traceId='11111111-1111-1111-1111-111111111111';
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/profile/private-id?token=secret`,{headers:{'X-GTA-Trace':traceId}});
    await response.text();assert.equal(response.headers.get('x-gta-trace'),traceId);
    const spans=telemetry.snapshot().spans.filter(s=>s.traceId===traceId);
    assert.equal(spans.length,2);
    const backend=spans.find(s=>s.component==='backend'),database=spans.find(s=>s.component==='database');
    assert.equal(database.parentId,backend.spanId);assert.equal(database.operation,'Profile.findMany');
    assert.equal(backend.operation,'GET /api/*');
    assert.ok(!JSON.stringify(spans).includes('private'));assert.ok(!JSON.stringify(spans).includes('secret'));
    assert.ok(database.durationMs>=0);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
