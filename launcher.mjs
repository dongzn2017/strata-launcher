import {spawn} from 'node:child_process';
import {once} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import {check, prepare, read, root, stateRoot, write} from './scripts/strata-panel/core.mjs';
import {configSkeleton, detectInstalls, environment, probePort, probePython, runningEngines} from './scripts/strata-panel/inspect.mjs';

const configFile = path.join(root, 'conf/launcher.json');
const usage = 'Usage:\n' +
  '  node launcher.mjs doctor [PROFILE]        report the environment as one JSON object\n' +
  '  node launcher.mjs detect PATH...          find a Strata install and model profiles, print a candidate config\n' +
  '  node launcher.mjs list                    list configured profiles\n' +
  '  node launcher.mjs check PROFILE           offline check of one profile\n' +
  '  node launcher.mjs prepare PROFILE         write a run directory without starting anything\n' +
  '  node launcher.mjs start PROFILE           start in the foreground and print the RUN_ID\n' +
  '  node launcher.mjs status RUN_ID | stop RUN_ID';
const runId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const terminalStates = ['stopped', 'exited', 'error'];

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function configPath(value, key) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key}: expected a file or directory path`);
  return path.resolve(path.dirname(configFile), value);
}

function loadConfig() {
  let config;
  try {
    config = read(configFile);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Copy conf/launcher.example.json to conf/launcher.json and configure your installation.');
    throw error;
  }
  if (config?.version !== 1 || !object(config.deployment) || !Array.isArray(config.profiles) || !config.profiles.length) {
    throw new Error('Expected version 1, deployment and at least one profile in conf/launcher.json');
  }
  const {controlDirectory, engineDirectory, engineVersion} = config.deployment;
  if (typeof engineVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(engineVersion)) {
    throw new Error('deployment.engineVersion: expected the installed engine version, for example 0.1.59');
  }
  const deployment = {controlDirectory: configPath(controlDirectory, 'deployment.controlDirectory'),
    engineDirectory: configPath(engineDirectory, 'deployment.engineDirectory'), engineVersion};
  const ids = new Set();
  const profiles = config.profiles.map(profile => {
    if (!object(profile) || typeof profile.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.id)) {
      throw new Error('Each profile needs a lowercase id of up to 64 letters, digits, hyphens or underscores');
    }
    if (ids.has(profile.id)) throw new Error(`Duplicate profile id: ${profile.id}`);
    ids.add(profile.id);
    if (!/^[a-z0-9][a-z0-9._-]{0,31}$/.test(profile.quant ?? '')) {
      throw new Error(`${profile.id}: quant: expected a lowercase id such as q4_k_xl or iq4_xs_v31`);
    }
    if (profile.slug !== undefined && (typeof profile.slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(profile.slug))) {
      throw new Error(`${profile.id}.slug: expected lowercase letters, digits or hyphens, up to 48 characters`);
    }
    if (!Number.isFinite(profile.minimumFreeGiB) || profile.minimumFreeGiB <= 0) {
      throw new Error(`${profile.id}: minimumFreeGiB must be a positive number`);
    }
    for (const key of ['settings', 'sampling', 'engineOptions', 'draftOptions', 'learning', 'dflash2', 'limits']) {
      if (profile[key] !== undefined && !object(profile[key])) throw new Error(`${profile.id}.${key}: expected an object`);
    }
    return {...profile, profile: configPath(profile.profile, `${profile.id}.profile`)};
  });
  return {deployment, profiles};
}

function runCommand(command, id) {
  if (!runId.test(id)) throw new Error('Expected the RUN_ID printed by start or prepare');
  const directory = path.join(stateRoot, 'runs', id);
  const run = read(path.join(directory, 'run.json'));
  if (run.id !== id) throw new Error('Run identity mismatch');
  const file = path.join(directory, 'status.json');
  const status = fs.existsSync(file) ? read(file) : null;
  if (status && status.runId !== id) throw new Error('Status identity mismatch');
  if (command === 'status') return {id, directory, model: run.model, port: run.settings.port, status};
  if (terminalStates.includes(status?.state)) return {id, state: status.state};
  const ownerFile = path.join(directory, 'owner.json');
  if (!fs.existsSync(ownerFile)) throw new Error('The runner has not recorded ownership for this run');
  const owner = read(ownerFile);
  if (owner.runId !== id || typeof owner.token !== 'string' || !/^[0-9a-f]{32}$/.test(owner.token)) {
    throw new Error('Runner ownership record is invalid');
  }
  write(path.join(directory, 'stop.json'), {runId: id, token: owner.token});
  return {id, state: 'stop-requested'};
}

function activeRuns() {
  const runs = path.join(stateRoot, 'runs');
  const directory = fs.existsSync(runs) ? fs.readdirSync(runs, {withFileTypes: true}).filter(entry => entry.isDirectory()) : [];
  const active = [];
  for (const entry of directory) {
    const file = path.join(runs, entry.name, 'status.json');
    if (!fs.existsSync(file)) continue;
    try {
      const status = read(file);
      if (!terminalStates.includes(status.state)) active.push({id: entry.name, state: status.state, model: status.model});
    } catch { active.push({id: entry.name, state: 'unreadable'}); }
  }
  return active;
}

async function doctor(id) {
  const problems = [];
  const report = {ok: true, problems, environment: environment(), config: {file: configFile, exists: fs.existsSync(configFile)}};
  const fail = (section, message) => { report.ok = false; problems.push({section, error: message}); };
  if (report.environment.nodeMajor < 22) fail('environment', `Node.js 22 or newer is required; found ${report.environment.node}`);
  if (process.platform !== 'win32') report.windows = {required: 'start', satisfied: false};
  const {deployment, profiles} = loadConfig();
  const runtime = {python: path.join(deployment.controlDirectory, 'python/python.exe'),
    engine: path.join(deployment.engineDirectory, 'strata.exe')};
  report.deployment = {...deployment, ...runtime};
  for (const file of Object.values(runtime)) {
    if (!fs.statSync(file, {throwIfNoEntry: false})?.isFile()) fail('deployment', `Missing runtime file: ${file}`);
  }
  if (fs.statSync(runtime.python, {throwIfNoEntry: false})?.isFile()) report.python = probePython(runtime.python);
  else report.python = {python: runtime.python, psutil: null, error: 'interpreter missing'};
  if (!report.python.psutil) fail('python', `${runtime.python} cannot import psutil (${report.python.error ?? 'unknown'})`);
  report.engines = runningEngines();
  if (report.engines.names?.length) fail('engines', `A Strata engine is already running: ${report.engines.names.join(', ')}`);
  report.runs = activeRuns();
  if (report.runs.length) fail('runs', `Launcher-owned runs are still active: ${report.runs.map(run => run.id).join(', ')}`);
  const selected = id ? [profiles.find(profile => profile.id === id)] : profiles;
  if (!selected[0]) throw new Error(`Unknown profile: ${id}`);
  report.profiles = [];
  for (const profile of selected) {
    const entry = {id: profile.id, quant: profile.quant, ok: true};
    report.profiles.push(entry);
    try {
      const result = check(profile, deployment);
      entry.model = result.model;
      entry.port = result.settings.port;
      const port = await probePort(result.settings.port);
      entry.portAvailable = port.free;
      if (!port.free) fail('profiles', `${profile.id}: port ${result.settings.port} is busy (${port.error ?? 'in use'})`);
    } catch (error) {
      entry.ok = false;
      entry.error = error.message;
      fail('profiles', `${profile.id}: ${error.message}`);
    }
  }
  return report;
}

function detect(paths) {
  const detection = detectInstalls(paths);
  const skeleton = configSkeleton(detection);
  return {...skeleton, found: {control: detection.control.length, engines: detection.engines.length,
    models: detection.models.length}, unreadable: detection.unreadable,
    models_detail: detection.models, writeHint: `Copy config to ${configFile}, replace every null, then run doctor.`};
}

async function main([command, id, ...extra]) {
  if (command === undefined || command === '--help') {
    console.log(usage);
    return;
  }
  if (command === 'detect') {
    if (!id) throw new Error('detect needs at least one folder to search');
    return detect([id, ...extra]);
  }
  if (command === 'doctor') {
    if (extra.length) throw new Error(usage);
    const report = await doctor(id);
    if (!report.ok) process.exitCode = 3;
    return report;
  }
  if (!['list', 'check', 'prepare', 'start', 'status', 'stop'].includes(command) || extra.length ||
      (command === 'list' ? id !== undefined : !id)) throw new Error(usage);
  if (command === 'status' || command === 'stop') return runCommand(command, id);

  const {deployment, profiles} = loadConfig();
  if (command === 'list') return profiles.map(({id, quant, profile}) => ({id, quant, profile}));
  const request = profiles.find(profile => profile.id === id);
  if (!request) throw new Error(`Unknown profile: ${id}`);
  if (command === 'check') {
    const {model, vision, settings} = check(request, deployment);
    return {id, model, vision, engineVersion: deployment.engineVersion, minimumFreeGiB: request.minimumFreeGiB, settings};
  }
  if (command === 'start' && process.platform !== 'win32') throw new Error('Starting Strata requires Windows');
  const run = prepare(request, deployment);
  const result = {id: run.id, directory: run.dir, model: run.model, api: `http://127.0.0.1:${run.settings.port}/v1`, log: run.log};
  if (command === 'prepare') return result;

  const env = {...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1'};
  delete env.PYTHONHOME;
  delete env.PYTHONPATH;
  const child = spawn(run.python, ['-u', path.join(root, 'scripts/strata-panel/runner.py'), '--run',
    path.join(run.dir, 'run.json'), '--parent', String(process.pid)], {cwd: root, env, stdio: 'inherit', windowsHide: true});
  console.log(JSON.stringify(result, null, 2));
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
}

try {
  const result = await main(process.argv.slice(2));
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
