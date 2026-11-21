import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const source = path.dirname(fileURLToPath(import.meta.url));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Strata 空格 ' "));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  fs.copyFileSync(path.join(source, 'launcher.mjs'), path.join(root, 'launcher.mjs'));
  fs.copyFileSync(path.join(source, 'package.json'), path.join(root, 'package.json'));
  const modules = 'scripts/strata-panel';
  fs.mkdirSync(path.join(root, modules), {recursive: true});
  for (const file of ['core.mjs', 'draft-assets.mjs', 'draft-options.mjs', 'engine-options.mjs', 'engine-extra-options.mjs', 'engine-reference.json', 'inspect.mjs', 'learning.mjs', 'sampling.mjs']) {
    fs.copyFileSync(path.join(source, modules, file), path.join(root, modules, file));
  }
  fs.copyFileSync(path.join(source,'scripts/parameters.mjs'),path.join(root,'scripts/parameters.mjs'));
  const lanModules='scripts/strata-lan';
  fs.mkdirSync(path.join(root,lanModules),{recursive:true});
  for(const file of ['bridge.mjs','capabilities.mjs','lifecycle.mjs','monitor-client.mjs']) {
    fs.copyFileSync(path.join(source,lanModules,file),path.join(root,lanModules,file));
    assert.ok(fs.statSync(path.join(root,lanModules,file)).isFile());
  }

  const write = (name, data = '') => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
    return file;
  };
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const call = (...args) => spawnSync(process.execPath, [path.join(root, 'launcher.mjs'), ...args], {cwd: os.tmpdir(), encoding: 'utf8'});
  const command = (...args) => {
    const result = call(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const deployment = {controlDirectory: '../install/components/control/fixture',
    engineDirectory: '../install/components/engine/fixture', engineVersion: '0.1.59'};
  for (const file of ['strata.py', 'python/python.exe', 'serve/winjob.py']) write(`install/components/control/fixture/${file}`);
  for (const file of ['strata.exe', 'strata-vision.exe']) write(`install/components/engine/fixture/${file}`);

  const route = Buffer.alloc(32);
  route.write('STRP');
  for (const offset of [4, 8, 12, 16, 20]) route.writeUInt32LE(1, offset);
  const model = {args: ['--native', write('assets/weights-00001-of-00002.gguf'), '--pack', write('assets/pack/index.txt').replace(/[/\\]index\.txt$/, ''),
    '--expert-profile', write('assets/route.bin', route), '--max-context', '32768', '--resident-budget-gib', '8', '--vram-reserve-mib', '0'],
  tokenizer: write('assets/tokenizer.json'), reasoning_effort: 'none', reasoning_budget_tokens: 0};
  const shard = write('assets/weights-00002-of-00002.gguf');
  const profile = {id: 'fixture-text', quant: 'q3_k_xl', profile: '../assets/profile.json', minimumFreeGiB: 12.5,
    settings: {port: 8180}, sampling: {mode: 'custom', temperature: 0.2}, engineOptions: {kva: 'on'}};
  const config = {version: 1, deployment, profiles: [profile]};
  const profileFile = write('assets/profile.json', model);
  const configFile = write('conf/launcher.json', config);
  return {root, write, read, call, command, profile, config, model, configFile, profileFile, shard};
}

test('launcher reads local config independently of cwd and check never creates a run', t => {
  const f = fixture(t);
  assert.deepEqual(f.command('list'), [{id: f.profile.id, quant: f.profile.quant, profile: f.profileFile}]);
  const result = f.command('check', f.profile.id);
  assert.equal(result.settings.port, 8180);
  assert.equal(result.settings.effort, 'off');
  assert.equal(result.minimumFreeGiB, 12.5);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime')), false);
  fs.unlinkSync(f.shard);
  assert.match(f.call('check', f.profile.id).stderr, /weights-00002-of-00002\.gguf/);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime')), false);
});

test('native IQ profiles preserve a Windows MTP runtime directory and require a two-token window', t => {
  const f = fixture(t);
  const pack = f.model.args[f.model.args.indexOf('--pack') + 1];
  fs.writeFileSync(path.join(pack, 'native_experts.txt'), 'native layout');
  const runtime = path.dirname(f.write('mtp/rt/dense.txt', 'index'));
  f.write('mtp/rt/dense.bin', 'dense');
  const experts = f.write('mtp/rt/experts.bin', 'experts');
  f.model.args.push('--prefill', 'auto', '--spec', '4', '--mtp', runtime);
  f.write('assets/profile.json', f.model);
  const lookup = f.command('assets', f.profile.id);
  assert.equal(lookup.nativePack, true);
  assert.deepEqual(lookup.mtp, {type:'directory', explicit:true, path:runtime, ready:true, missing:[]});
  assert.equal(f.command('drafter-plan', f.profile.id).estimatedDownloadGB, 0);
  assert.equal(f.command('drafter-fetch', f.profile.id).downloaded, false);
  assert.equal(f.command('check', f.profile.id).settings.spec, 4);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime')), false);
  const {directory} = f.command('prepare', f.profile.id);
  const prepared = f.read(path.join(directory, 'model.json'));
  assert.equal(prepared.args[prepared.args.indexOf('--mtp') + 1], runtime);
  assert.equal(prepared.args[prepared.args.indexOf('--spec') + 1], '4');
  fs.unlinkSync(experts);
  assert.match(f.call('check', f.profile.id).stderr, /missing experts\.bin/);
  assert.equal(f.command('assets', f.profile.id).mtp.ready, false);
  f.profile.settings.spec = 0;
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('check', f.profile.id).stderr, /Native IQ pack requires spec >= 2/);
});

test('asset lookup finds a local Flash-Next head and distinguishes it from an embedded MTP depth', t => {
  const f = fixture(t);
  f.model.model_name = 'qwen3.8-flash-next-iq3_xxs';
  const pack = path.dirname(f.write('data/packs/iq3_xxs/native_experts.txt', 'native layout'));
  f.write('data/packs/iq3_xxs/index.txt', 'index');
  f.model.args[f.model.args.indexOf('--pack') + 1] = pack;
  f.model.args.push('--spec', '2');
  f.model.drafting = 'auto';
  const rt = path.dirname(f.write('data/mtp/rt/dense.txt', 'index'));
  f.write('data/mtp/rt/dense.bin', 'dense');
  f.write('data/mtp/rt/experts.bin', 'experts');
  f.write('data/dflash2/unrelated.pack', 'not the official drafter');
  const stock = f.write('data/dflash2/qwen3.8-flash-next-dflash2.q4_0.pack', 'stock drafter');
  f.write('assets/profile.json', f.model);
  const lookup = f.command('assets', f.profile.id);
  assert.equal(lookup.mtp.path, rt);
  assert.deepEqual(lookup.dflash2.stock, [stock]);
  assert.equal(f.command('check', f.profile.id).settings.drafting, 'auto');
  const {directory} = f.command('prepare', f.profile.id);
  const saved = f.read(path.join(directory, 'model.json'));
  assert.equal(saved.args[saved.args.indexOf('--mtp') + 1], rt);
  f.model.args.push('--mtp', '2');
  f.write('assets/profile.json', f.model);
  assert.deepEqual(f.command('assets', f.profile.id).mtp,
    {type:'embedded', explicit:true, depth:2, path:null, ready:true, missing:[]});
});

test('web tuning validates and saves a whole patch without touching source profiles or runs', {timeout: 15000}, async t => {
  const f = fixture(t);
  for (const file of ['index.html','server.mjs','tuning.mjs','tuning.js']) {
    f.write('ui/'+file,fs.readFileSync(path.join(source,'ui',file)));
  }
  f.write('conf/launcher.schema.json',fs.readFileSync(path.join(source,'conf/launcher.schema.json')));
  f.profile.limits = {expertGiB:[8,54]};
  f.config.profiles.push({...f.profile,id:'other',settings:{port:8181}});
  f.write('conf/launcher.json',f.config);
  const original = fs.readFileSync(f.configFile);
  const originalProfile = fs.readFileSync(f.profileFile);
  const reserve = net.createServer().listen(0,'127.0.0.1');
  await once(reserve,'listening');
  const {port} = reserve.address();
  await new Promise(resolve=>reserve.close(resolve));
  const child = spawn(process.execPath,[path.join(f.root,'ui/server.mjs'),String(port)],{windowsHide:true});
  const exited = once(child,'close');
  try {
    await Promise.race([once(child.stdout,'data'),exited.then(()=>{throw new Error('Fixture web server exited');})]);
    const origin = 'http://127.0.0.1:'+port;
    const endpoint = origin+'/api/tuning?id='+f.profile.id;
    const request = (url,opts) => fetch(url,{...opts,signal:AbortSignal.timeout(3000)});
    const options = async () => {
      const response = await request(endpoint);
      assert.equal(response.status,200);
      return response.json();
    };
    const post = (payload,extra = {}) => request(endpoint,{method:'POST',body:JSON.stringify(payload),
      headers:{'Content-Type':'application/json','X-Strata-Panel':'1',Origin:origin,...extra}});
    assert.match((await request(origin+'/tuning.js')).headers.get('content-type'),/^text\/javascript/);
    const assets = await request(origin+'/api/assets?id='+f.profile.id);
    assert.equal(assets.status,200);
    assert.equal((await assets.json()).weightsPresent,true);
    const before = await options();
    assert.equal(before.specs.settings.expertGiB.maximum,54);
    assert.equal(before.values.settings.context,32768);
    assert.ok(before.engineOptions.some(spec=>spec.key==='tailSkip'));
    assert.equal((await post({revision:before.revision,changes:{settings:{port:8188}}},{Origin:'http://example.test'})).status,403);
    assert.equal((await post({revision:before.revision,changes:{settings:{port:8188}}},{'Content-Type':'text/plain'})).status,415);
    assert.equal((await post({revision:before.revision,changes:{settings:{port:8188}},extra:'x'.repeat(16384)})).status,413);
    assert.equal((await post({revision:before.revision,changes:{deployment:{engineVersion:'0.0.0'}}})).status,400);
    assert.equal((await post({revision:before.revision,changes:{settings:{port:8188,kvResident:65536}}})).status,422);
    assert.equal((await post({revision:before.revision,changes:{sampling:{mode:'model',temperature:99}}})).status,422);
    assert.deepEqual(fs.readFileSync(f.configFile),original);
    assert.equal(fs.existsSync(path.join(f.root,'logs')),false);
    const response = await post({revision:before.revision,changes:{
      settings:{context:65536,kvResident:49152},sampling:{temperature:0.65},
      engineOptions:{vramFree:'device'},draftOptions:{confidence:0.7},learning:{enabled:true}}});
    assert.equal(response.status,200,await response.clone().text());
    const result = await response.json();
    assert.equal(result.restartRequired,true);
    assert.deepEqual(fs.readFileSync(result.backup),original);
    assert.deepEqual(f.read(f.configFile).profiles[1],f.config.profiles[1]);
    const after = await options();
    assert.notEqual(after.revision,before.revision);
    assert.equal(after.values.settings.kvResident,49152);
    assert.equal(after.values.sampling.temperature,0.65);
    assert.equal(after.values.engineOptions.kva,'on');
    assert.equal(after.values.engineOptions.vramFree,'device');
    assert.equal(after.values.draftOptions.confidence,0.7);
    assert.equal(after.values.learning.enabled,true);
    const snapshot = fs.readFileSync(f.configFile);
    assert.equal((await post({revision:before.revision,changes:{settings:{port:8189}}})).status,409);
    fs.writeFileSync(f.configFile+'.lock','existing lock');
    assert.equal((await post({revision:after.revision,changes:{settings:{port:8189}}})).status,409);
    assert.equal(fs.readFileSync(f.configFile+'.lock','utf8'),'existing lock');
    assert.deepEqual(fs.readFileSync(f.configFile),snapshot);
    assert.deepEqual(fs.readFileSync(f.profileFile),originalProfile);
    assert.equal(fs.existsSync(path.join(f.root,'runtime')),false);
  } finally { child.kill(); await exited; }
});

test('prepare writes an independent run with exact paths, settings, and hashes', t => {
  const f = fixture(t);
  const before = fs.readFileSync(f.profileFile);
  const a = f.command('prepare', f.profile.id);
  const b = f.command('prepare', f.profile.id);
  assert.notEqual(a.id, b.id);
  assert.equal(a.model, b.model);
  assert.equal(a.api, 'http://127.0.0.1:8180/v1');
  const run = f.read(path.join(a.directory, 'run.json'));
  assert.equal(run.minimumFreeGiB, 12.5);
  assert.equal(run.python, path.join(f.root, 'install/components/control/fixture/python/python.exe'));
  const model = f.read(run.config);
  assert.equal(model.host, '127.0.0.1');
  assert.equal(model.port, 8180);
  assert.equal(model.parallel, 1);
  assert.equal(model.sampling.temperature, 0.2);
  assert.equal(model.env.STRATA_KVA, '1');
  assert.equal(model.args[model.args.indexOf('--expert-profile') + 1], path.join(a.directory, 'expert-profile.bin'));
  assert.equal(createHash('sha256').update(fs.readFileSync(run.config)).digest('hex'), run.configHash);
  assert.deepEqual(fs.readFileSync(f.profileFile), before);
});

test('invalid settings, duplicate IDs and a missing vision executable fail before run creation', t => {
  const f = fixture(t);
  f.profile.settings.port = 80;
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('prepare', f.profile.id).stderr, /port: expected integer/);
  f.profile.settings.port = 8180;
  f.config.profiles.push({...f.profile});
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('list').stderr, /Duplicate profile id/);
  f.config.profiles.pop();
  f.write('conf/launcher.json', f.config);
  f.model.vision = {mmproj: f.write('assets/vision.gguf')};
  f.write('assets/profile.json', f.model);
  fs.unlinkSync(path.join(f.root, 'install/components/engine/fixture/strata-vision.exe'));
  assert.match(f.call('prepare', f.profile.id).stderr, /Missing runtime file: .*strata-vision\.exe/);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime')), false);
});

test('stop accepts only a matching run ownership record and status reads the local snapshot', t => {
  const f = fixture(t);
  const {id, directory} = f.command('prepare', f.profile.id);
  assert.equal(f.command('status', id).status, null);
  assert.match(f.call('stop', id).stderr, /has not recorded ownership/);
  assert.match(f.call('stop', '../elsewhere').stderr, /RUN_ID/);
  const runPath = `runtime/strata-launcher/runs/${id}`;
  const owner = {runId: 'another-run', token: 'a'.repeat(32)};
  f.write(`${runPath}/owner.json`, owner);
  assert.match(f.call('stop', id).stderr, /ownership record is invalid/);
  assert.equal(fs.existsSync(path.join(directory, 'stop.json')), false);
  owner.runId = id;
  f.write(`${runPath}/owner.json`, owner);
  assert.equal(f.command('stop', id).state, 'stop-requested');
  assert.deepEqual(f.read(path.join(directory, 'stop.json')), owner);
  f.write(`${runPath}/status.json`, {runId: id, state: 'stopped'});
  assert.equal(f.command('status', id).status.state, 'stopped');
  assert.equal(f.command('stop', id).state, 'stopped');
});

test('a profile names itself, any quant is accepted, and declared limits replace the defaults', t => {
  const f = fixture(t);
  f.profile.quant = 'q9_zz';
  f.write('conf/launcher.json', f.config);
  const named = f.command('check', f.profile.id);
  assert.match(named.model, /^profile-q9_zz-text-[0-9a-f]{16}$/);
  assert.doesNotMatch(JSON.stringify(named), /qwen/i);

  f.profile.settings = {port: 8180, context: 16384, output: 8192, kvResident: 16384};
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('check', f.profile.id).stderr, /context: expected integer 32768\.\.262144/);
  f.profile.limits = {context: [8192, 262144], output: [512, 32768]};
  f.write('conf/launcher.json', f.config);
  assert.equal(f.command('check', f.profile.id).settings.context, 16384);
  f.profile.limits = {context: [262144, 8192]};
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('check', f.profile.id).stderr, /limits\.context: minimum exceeds maximum/);
  f.profile.limits = {nonsense: [1, 2]};
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('check', f.profile.id).stderr, /limits\.nonsense: no such setting/);
  f.profile.limits = undefined;
  f.profile.quant = 'Not A Quant';
  f.write('conf/launcher.json', f.config);
  assert.match(f.call('list').stderr, /quant: expected a lowercase id/);
});

test('doctor reports the environment and refuses to claim readiness over a broken runtime', t => {
  const f = fixture(t);
  const result = f.call('doctor');
  assert.equal(result.status, 3, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.environment.node, process.version);
  assert.equal(report.config.exists, true);
  assert.equal(report.config.file.replaceAll('\\', '/'), f.configFile.replaceAll('\\', '/'));
  assert.match(report.python.error, /./);
  assert.equal(report.profiles[0].id, f.profile.id);
  assert.equal(typeof report.profiles[0].portAvailable, 'boolean');
  assert.equal(report.problems.find(problem => problem.section === 'python').error.includes('psutil'), true);
  assert.equal(fs.existsSync(path.join(f.root, 'runtime')), false, 'doctor must not create a run');

  // Real engine detection is host state, independent of the deliberately broken fixture.
  const fixtureProblems = snapshot => {
    const engineProblems = snapshot.problems.filter(problem => problem.section === 'engines');
    assert.equal(engineProblems.length, snapshot.engines.names?.length ? 1 : 0);
    return snapshot.problems.filter(problem => problem.section !== 'engines');
  };
  fs.rmSync(path.join(f.root, 'install/components/engine/fixture/strata.exe'));
  fs.unlinkSync(f.shard);
  const broken = JSON.parse(f.call('doctor').stdout);
  assert.equal(broken.ok, false);
  const problems = fixtureProblems(broken);
  assert.deepEqual(problems.map(problem => problem.section), ['deployment', 'python', 'profiles']);
  assert.match(problems[0].error, /strata\.exe/);
  assert.match(problems[2].error, /strata\.exe/);
  assert.equal(broken.deployment.engine.endsWith('strata.exe'), true, 'a failed check must not erase the report');
  assert.equal(broken.profiles.length, 1);
  f.write('install/components/engine/fixture/strata.exe', '');
  const shardless = JSON.parse(f.call('doctor').stdout);
  assert.match(shardless.problems.at(-1).error, /weights-00002-of-00002\.gguf/);
  assert.deepEqual(fixtureProblems(shardless).map(problem => problem.section), ['python', 'profiles']);

  assert.match(f.call('doctor', 'nope').stderr, /Unknown profile: nope/);
});

test('detect turns a found install into a config skeleton without touching conf', t => {
  const f = fixture(t);
  const found = f.command('detect', path.join(f.root, 'install'), path.join(f.root, 'assets'), path.join(f.root, 'nope'));
  assert.deepEqual(found.unreadable, [path.join(f.root, 'nope')]);
  assert.deepEqual(found.found, {control: 1, engines: 1, models: 1});
  assert.equal(found.candidateInstalls, 0, 'fixture directories carry no version, so nothing may be claimed');
  assert.equal(found.config.deployment, null);
  assert.ok(found.fillIn.includes('deployment'));
  assert.deepEqual(found.config.profiles.map(profile => profile.profile), [f.profileFile.replaceAll('\\', '/')]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.configFile, 'utf8')), f.config);
  assert.match(f.call('detect').stderr, /needs at least one folder/);
});

test('1.1 parameter catalogue and validated edits preserve source model files; invalid edits never persist',t=>{
  const f=fixture(t),sourceBefore=fs.readFileSync(f.profileFile);
  const options=f.command('options');assert.equal(options.version,'1.2.0');assert.ok(options.engineOptions.length>40);
  assert.ok(options.reference.entries.length>150);assert.equal(f.command('--version').version,'1.3.1');
  const saved=f.command('set',f.profile.id,'engineOptions.tailSkip','0');
  assert.equal(saved.value,'0');assert.equal(saved.restartRequired,true);assert.ok(fs.existsSync(saved.backup));
  assert.equal(f.read(f.configFile).profiles[0].engineOptions.tailSkip,'0');
  const prepared=f.command('prepare',f.profile.id);const run=f.read(path.join(prepared.directory,'run.json'));
  assert.equal(f.read(run.config).env.STRATA_ROUTE_TAIL_SKIP,'0');
  const before=fs.readFileSync(f.configFile);
  for(const [key,value] of [['settings.context','1'],['settings.unknown','1'],['engineOptions.tailSkip','99'],['learning.unknown','1'],['profile.path','bad']]) {
    assert.notEqual(f.call('set',f.profile.id,key,value).status,0);assert.deepEqual(fs.readFileSync(f.configFile),before);
  }
  assert.deepEqual(fs.readFileSync(f.profileFile),sourceBefore);assert.equal(fs.existsSync(f.configFile+'.lock'),false);
});

test('all curated settings reach a manifest; incompatible engines and learning modes fail offline',t=>{
  const f=fixture(t);const catalogue=f.command('options');
  for(const spec of catalogue.engineOptions) {
    f.profile.engineOptions={[spec.key]:spec.values[1]};f.write('conf/launcher.json',f.config);
    const result=f.command('prepare',f.profile.id);const run=f.read(path.join(result.directory,'run.json')),model=f.read(run.config);
    if(spec.env)assert.equal(typeof model.env[spec.env],'string');
    else if(spec.booleanFlag)assert.equal(model.user_args.includes(spec.flag),spec.values[1]==='on');
    else assert.equal(model.user_args[model.user_args.indexOf(spec.flag)+1],spec.values[1]);
  }
  f.config.deployment.engineVersion='0.1.58';f.profile.engineOptions={tailSkip:'0'};f.write('conf/launcher.json',f.config);
  assert.match(f.call('prepare',f.profile.id).stderr,/curated for engine/);
  f.config.deployment.engineVersion='0.1.59';f.profile.learning={enabled:true};f.profile.engineOptions={adaptEvery:'0'};f.write('conf/launcher.json',f.config);
  assert.match(f.call('prepare',f.profile.id).stderr,/learning/);
  f.profile.engineOptions={};f.model.user_args=['--adapt-every','0'];f.write('assets/profile.json',f.model);f.write('conf/launcher.json',f.config);
  assert.match(f.call('prepare',f.profile.id).stderr,/adaptation is disabled/);
});

test('LAN is opt-in and planning never starts a model or writes runtime state',t=>{
  const f=fixture(t);
  assert.match(f.call('lan-plan',f.profile.id).stderr,/LAN is disabled/);
  f.config.lan={host:'127.0.0.1',port:8881,allowedClients:['127.0.0.1']};f.write('conf/launcher.json',f.config);
  const plan=f.command('lan-plan',f.profile.id);assert.equal(plan.started,false);assert.equal(plan.upstream,'http://127.0.0.1:8180');
  assert.equal(plan.terminal.readOnly,true);assert.equal(fs.existsSync(path.join(f.root,'runtime')),false);
  f.config.lan.host='0.0.0.0';f.write('conf/launcher.json',f.config);assert.notEqual(f.call('lan-plan',f.profile.id).status,0);
});

test('LAN foreground lifecycle stops only its own bridge via token IPC and preserves upstream',{timeout:20000},async t=>{
  const f=fixture(t);let model;
  const upstream=http.createServer((req,res)=>{
    const values={
      '/health':{service:'strata',status:'ok',loaded:true,model,max_context:32768,images:false},
      '/props':{model_alias:model,default_generation_settings:{n_ctx:32768,params:{n_predict:4096}},modalities:{vision:false}},
      '/v1/models':{data:[{id:model}]},
    };
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(values[req.url] || {}));
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  t.after(()=>{upstream.closeAllConnections();upstream.close();});
  const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  f.profile.settings.port=upstream.address().port;f.config.lan={host:'127.0.0.1',port,allowedClients:['127.0.0.1']};f.write('conf/launcher.json',f.config);
  model=f.command('check',f.profile.id).model;
  const child=spawn(process.execPath,[path.join(f.root,'launcher.mjs'),'lan',f.profile.id],{cwd:os.tmpdir(),windowsHide:true});
  let output='',stderr='';child.stderr.on('data',c=>stderr+=c);
  const exited=new Promise(resolve=>child.once('close',resolve));
  const timeout=setTimeout(()=>child.kill(),10000);
  try {
    const running=await new Promise((resolve,reject)=>{
      child.stdout.on('data',c=>{output+=c;if(output.includes('\n')){try{resolve(JSON.parse(output.split('\n')[0]));}catch(error){reject(error);}}});
      child.once('close',()=>reject(new Error(stderr || 'Bridge exited before ready')));
    });
    assert.equal(running.state,'listening');assert.equal(f.command('lan-status',running.id).state,'listening');
    assert.equal((await(await fetch(`http://127.0.0.1:${port}/capabilities`)).json()).model,model);
    const ownerPath=path.join(running.directory,'owner.json'),owner=f.read(ownerPath);
    f.write(path.relative(f.root,ownerPath),{...owner,token:'wrong'});assert.match(f.call('lan-stop',running.id).stderr,/ownership/);
    f.write(path.relative(f.root,ownerPath),owner);assert.equal(f.command('lan-stop',running.id).state,'stop-requested');
    assert.equal(await exited,0,stderr);assert.equal(f.command('lan-status',running.id).state,'stopped');
    assert.equal((await(await fetch(`http://127.0.0.1:${upstream.address().port}/health`)).json()).loaded,true);
    assert.deepEqual(fs.readFileSync(f.profileFile),Buffer.from(JSON.stringify(f.model)));
  } finally {clearTimeout(timeout);if(child.exitCode===null)child.kill();await exited;upstream.closeAllConnections();await new Promise(resolve=>upstream.close(resolve));}
});
