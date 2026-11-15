import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createBridge,lanOptions,clientInfo} from './bridge.mjs';

const health={service:'strata',status:'ok',loaded:true,model:'test-model',max_context:32768,images:false};
const props={model_alias:'test-model',default_generation_settings:{n_ctx:32768,params:{n_predict:4096}},modalities:{vision:false},total_slots:1};
test('LAN configuration never implicitly binds the network, public IPs or wildcard clients',()=>{
  assert.equal(lanOptions(),null);
  assert.deepEqual(lanOptions({host:'127.0.0.1',port:8081,allowedClients:['127.0.0.1']}),{host:'127.0.0.1',port:8081,allowedClients:['127.0.0.1']});
  for(const change of [{host:'0.0.0.0'},{host:'8.8.8.8'},{allowedClients:['*']},{allowedClients:['192.168.1.0/24']},{allowedClients:[]},{port:80},{installFirewall:true}]) {
    assert.throws(()=>lanOptions({host:'192.168.1.10',port:8081,allowedClients:['192.168.1.20'],...change}));
  }
});
test('bridge discovery, allowlist, management denial, exact client hash and inference streaming',async()=>{
  let live=structuredClone(health),listed=health.model,posts=0;
  const upstream=http.createServer((req,res)=>{
    if(req.url==='/health')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(live));
    if(req.url==='/props')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(props));
    if(req.url==='/v1/models')return res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{id:listed}]}));
    if(req.method==='POST') {
      posts++;res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');
      const timer=setTimeout(()=>res.end('data: [DONE]\n\n'),200);res.on('close',()=>clearTimeout(timer));return;
    }
    res.end('{}');
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const options={allowed:['127.0.0.1'],upstreamPort:upstream.address().port,publicBase:'http://127.0.0.1:8081',expectedModel:health.model,defaultsReader:()=>null};
  const bridge=createBridge(options),denied=createBridge({...options,allowed:['192.168.1.20']});
  await Promise.all([bridge,denied].map(s=>new Promise(resolve=>s.listen(0,'127.0.0.1',resolve))));
  const base=`http://127.0.0.1:${bridge.address().port}`;
  try {
    const cap=await (await fetch(base+'/capabilities')).json();
    assert.equal(cap.model,health.model);assert.equal(cap.context_tokens,32768);assert.equal(cap.api_base_url,options.publicBase+'/v1');
    const bytes=Buffer.from(await(await fetch(base+'/monitor-client.mjs')).arrayBuffer());
    assert.deepEqual(bytes,fs.readFileSync(new URL('./monitor-client.mjs',import.meta.url)));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),clientInfo(options.publicBase).sha256);
    assert.equal((await fetch(`http://127.0.0.1:${denied.address().port}/monitor-client.mjs`)).status,403);
    for(const route of ['/unload','/load','/config','/api/requests','/api/logs','/slots/0?action=save']) assert.equal((await fetch(base+route,{method:'POST'})).status,404);
    assert.equal((await fetch(base+'/metrics',{headers:{origin:'http://untrusted.example'}})).status,403);
    assert.equal((await fetch(base+'/v1/chat/completions',{method:'POST',body:'form=bad'})).status,415);
    const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const reader=response.body.getReader();const first=new TextDecoder().decode((await reader.read()).value);
    assert.match(first,/first/);assert.doesNotMatch(first,/DONE/);await reader.cancel();assert.equal(posts,1);
    live.model='different';assert.equal((await fetch(base+'/capabilities')).status,503);
    assert.equal((await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,503);
    assert.equal(posts,1);
    live=structuredClone(health);listed='stale-model-list';
    assert.equal((await fetch(base+'/capabilities')).status,503);
  } finally {for(const s of [bridge,denied,upstream]){s.closeAllConnections();s.close();}}
});
