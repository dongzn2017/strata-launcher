import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {endpoint,snapshot,render} from './monitor-client.mjs';

const metrics=()=>({time:Date.now()/1000,engine:{model:'fixture',max_context:32768},live:{state:'idle',queued:0},
  hardware:{gpu_util:0,gpu_mem_used:10*2**30,gpu_mem_total:12*2**30},requests:[{decode_tok_s:35.4}]});
test('portable monitor uses private LAN or HTTPS and validates origin-only URLs',()=>{
  for(const host of ['127.0.0.1','10.1.2.3','172.16.0.2','192.168.20.30'])assert.equal(endpoint(`http://${host}:8081`),`http://${host}:8081`);
  for(const url of ['http://8.8.8.8','http://example.org','http://user:pass@localhost','http://localhost/v1','http://localhost/?x=1'])assert.throws(()=>endpoint(url));
});
test('monitor labels last versus live speed, unknowns, units, dimensions and terminal controls',()=>{
  const data=metrics();data.engine.model='fixture\x1b[2J\rX';
  const text=render(data,{width:72,height:15});
  assert.doesNotMatch(text,/\x1b|\r/);assert.match(text,/TG now  --/);assert.match(text,/TG 35.4/);assert.match(text,/VRAM 10.0 \/ 12.0/);
  assert.ok(text.split('\n').length<=15);assert.ok(text.split('\n').every(l=>l.length<72));
  assert.doesNotMatch(render(null,{error:'Disconnected'}),/35.4|fixture/);
  data.engine.drafting='dflash2';data.requests[0]={drafts_accepted:8,drafts_offered:10,hit_rate:0.7,pcie_share:0.3};
  assert.match(render(data),/dflash2.*Accepted 80.0% \[last\].*EC 70.0% \[last\]/);
  data.requests[0].drafts_offered=0;assert.match(render(data),/Accepted --/);
});
test('snapshot and real standalone command make bounded GET requests only; reject stale data/redirects',async()=>{
  let value=metrics(),code=200;const seen=[];
  const server=http.createServer((req,res)=>{seen.push([req.method,req.url]);res.writeHead(code,{'content-type':'application/json',location:'/health'}).end(JSON.stringify(value));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await snapshot(base)).engine.model,'fixture');
    const child=spawn(process.execPath,[fileURLToPath(new URL('./monitor-client.mjs',import.meta.url)),'--url',base,'--once'],{windowsHide:true});
    let output='';child.stdout.on('data',c=>output+=c);const timer=setTimeout(()=>child.kill(),5000);
    const exit=await new Promise(resolve=>child.once('close',resolve));clearTimeout(timer);assert.equal(exit,0);assert.match(output,/fixture/);
    value={...metrics(),time:0};await assert.rejects(snapshot(base),/stale/);code=302;await assert.rejects(snapshot(base),/302/);
    assert.ok(seen.every(([method,url])=>method==='GET' && url==='/metrics'));
  } finally{server.closeAllConnections();server.close();}
});
