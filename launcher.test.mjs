import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
  const modules = 'scripts/strata-panel';
  fs.mkdirSync(path.join(root, modules), {recursive: true});
  for (const file of ['core.mjs', 'draft-options.mjs', 'engine-options.mjs', 'inspect.mjs', 'learning.mjs', 'sampling.mjs']) {
    fs.copyFileSync(path.join(source, modules, file), path.join(root, modules, file));
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

  fs.rmSync(path.join(f.root, 'install/components/engine/fixture/strata.exe'));
  fs.unlinkSync(f.shard);
  const broken = JSON.parse(f.call('doctor').stdout);
  assert.equal(broken.ok, false);
  assert.deepEqual(broken.problems.map(problem => problem.section), ['deployment', 'python', 'profiles']);
  assert.match(broken.problems[0].error, /strata\.exe/);
  assert.match(broken.problems[2].error, /strata\.exe/);
  assert.equal(broken.deployment.engine.endsWith('strata.exe'), true, 'a failed check must not erase the report');
  assert.equal(broken.profiles.length, 1);
  f.write('install/components/engine/fixture/strata.exe', '');
  const shardless = JSON.parse(f.call('doctor').stdout);
  assert.match(shardless.problems.at(-1).error, /weights-00002-of-00002\.gguf/);
  assert.deepEqual(shardless.problems.map(problem => problem.section), ['python', 'profiles']);

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
