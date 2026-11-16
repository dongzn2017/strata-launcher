import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import {fileURLToPath} from 'node:url';
const source=fileURLToPath(new URL('../..',import.meta.url));
function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"Strata GUI 中文 ' "));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  function copy(dir,target){fs.mkdirSync(target,{recursive:true});for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name==='__pycache__')continue;const a=path.join(dir,e.name),b=path.join(target,e.name);if(e.isDirectory())copy(a,b);else fs.copyFileSync(a,b);}}
  copy(path.join(source,'scripts'),path.join(root,'scripts'));
  for(const file of ['launcher.mjs','package.json'])fs.copyFileSync(path.join(source,file),path.join(root,file));
  const write=(name,data='')=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof data==='object'&&!Buffer.isBuffer(data)?JSON.stringify(data):data);return file;};
  for(const file of ['strata.py','python/python.exe','serve/winjob.py'])write('control/'+file);
  for(const file of ['strata.exe','strata-vision.exe'])write('engine/'+file);
  const route=Buffer.alloc(32);route.write('STRP');for(const offset of [4,8,12,16,20])route.writeUInt32LE(1,offset);
  const tokenizer=path.join(root,'assets/tokenizer');fs.mkdirSync(tokenizer,{recursive:true});
  const model={args:['--pack',path.dirname(write('assets/pack/index.txt')),'--native',write('assets/model.gguf'),'--expert-profile',write('assets/route.bin',route),'--max-context','32768','--resident-budget-gib','8','--vram-reserve-mib','512'],tokenizer,reasoning_effort:'none',reasoning_budget_tokens:0};
  const profile=write('assets/model.json',model);
  const config={version:1,deployment:{controlDirectory:'../control',engineDirectory:'../engine',engineVersion:'0.1.60'},profiles:[{id:'fixture',quant:'iq3_s',profile,minimumFreeGiB:12,settings:{port:18180},engineOptions:{prefillChunk:'auto:8192'}}]};
  const configFile=write('conf/launcher.json',config);
  const call=(command,request)=>{
    const args=[path.join(root,'scripts/windows-panel/cli.mjs'),command];if(request)args.push(write('request.json',request));
    return spawnSync(process.execPath,args,{cwd:os.tmpdir(),encoding:'utf8',timeout:10000});
  };
  return {root,write,call,configFile,config};
}
test('portable catalogue accepts tokenizer directories without local machine paths or side effects',t=>{
  const f=fixture(t),r=f.call('catalogue');assert.equal(r.status,0,r.stderr);
  const c=JSON.parse(r.stdout);assert.equal(c.piAvailable,false);assert.equal(c.profiles[0].available,true);assert.equal(c.preferences.profile,'fixture');
  assert.equal(c.engineReference.engineVersion,'0.1.60');assert.equal(c.engineOptionSpecs.length,42);
  assert.equal(fs.existsSync(path.join(f.root,'runtime')),false);
});
test('GUI save uses the CLI config as source of truth, backs up and rejects invalid requests atomically',t=>{
  const f=fixture(t),c=JSON.parse(f.call('catalogue').stdout);
  const request={profile:'fixture',...c.preferences.profiles.fixture,cwd:f.root,resourceOptimization:{forceApps:false},plugins:[],fields:[]};
  request.settings.context=65536;
  let r=f.call('save',request);assert.equal(r.status,0,r.stderr);assert.ok(fs.existsSync(JSON.parse(r.stdout).backup));
  assert.equal(JSON.parse(fs.readFileSync(f.configFile)).profiles[0].settings.context,65536);
  const before=fs.readFileSync(f.configFile);request.engineOptions={pcieFrac:'wrong'};
  r=f.call('save',request);assert.notEqual(r.status,0);assert.deepEqual(fs.readFileSync(f.configFile),before);
  assert.equal(fs.existsSync(f.configFile+'.lock'),false);
  const prepared=f.call('prepare',{profile:'fixture'});assert.equal(prepared.status,0,prepared.stderr);
  const run=JSON.parse(prepared.stdout);assert.equal(run.settings.context,65536);assert.equal(run.settings.port,18180);
});
test('Pi is optional and explicit configuration does not install packages or accept missing entries',t=>{
  const f=fixture(t);f.write('conf/pi.json',{entry:'C:/missing/pi.js',extensions:[]});
  const result=f.call('catalogue');assert.notEqual(result.status,0);assert.match(result.stderr,/existing absolute Pi entry/);
  assert.equal(fs.existsSync(path.join(f.root,'node_modules')),false);
});
test('Pi manifest binds advertised capabilities and exact run alias, without starting Pi',async t=>{
  const f=fixture(t);let run,wrong=false;
  const server=http.createServer((req,res)=>{
    const h={service:'strata',status:'ok',loaded:true,api_key:false,model:run.model,max_context:wrong?run.settings.context+1:run.settings.context,images:false};
    const body=req.url==='/health'?h:req.url==='/props'?{model_alias:run.model,total_slots:1,default_generation_settings:{n_ctx:run.settings.context},modalities:{vision:false}}:{data:[{id:run.clientModel}]};
    res.setHeader('content-type','application/json');res.end(JSON.stringify(body));
  });
  t.after(()=>{server.closeAllConnections();server.close();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  f.config.profiles[0].settings.port=server.address().port;f.write('conf/launcher.json',f.config);
  f.write('conf/pi.json',{entry:f.write('pi/entry.js'),extensions:[],skills:[]});
  const prepared=f.call('prepare',{profile:'fixture'});assert.equal(prepared.status,0,prepared.stderr);run=JSON.parse(prepared.stdout);
  const request=f.write('pi-request.json',{profile:'fixture',cwd:f.root,session:'new',plugins:[],fields:['speed']});
  const invoke=()=>promisify(execFile)(process.execPath,[path.join(f.root,'scripts/windows-panel/cli.mjs'),'pi',request],{encoding:'utf8',timeout:8000});
  const result=await invoke(),manifest=JSON.parse(fs.readFileSync(JSON.parse(result.stdout).file));
  assert.equal(manifest.expected.apiModel,run.clientModel);assert.equal(manifest.expected.context,run.settings.context);
  assert.equal(fs.existsSync(path.join(f.root,'runtime/strata-launcher/pi-active.lock')),false);
  wrong=true;await assert.rejects(invoke(),/capabilities|context|configuration/);
});
