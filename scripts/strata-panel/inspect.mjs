// Read-only discovery: find a Strata install and its model profiles, and describe the
// local environment. Nothing here starts, stops or modifies a service.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const SKIPPED = new Set(['.git', '.venv', 'node_modules', '__pycache__', '$recycle.bin', 'system volume information',
  'runtime', 'logs', 'appdata', 'windows', 'programdata']);
const QUANT = /(?:^|[-_.])((?:u?d-)?((?:iq|q|k|nf)\d[a-z0-9_]*(?:_xl|_xs|_s|_m|_l)?(?:[-_.]v\d+)?))(?=[-_.]|$)/i;

function skipped(name) {
  return SKIPPED.has(name.toLowerCase()) || name.startsWith('.');
}

export function* walk(dir, {maxDepth = 6, entries = 50_000} = {}) {
  let seen = 0;
  const stack = [[dir, 0]];
  while (stack.length) {
    const [current, depth] = stack.pop();
    let listing;
    try {
      listing = fs.readdirSync(current, {withFileTypes: true});
    } catch { continue; }
    for (const entry of listing) {
      if (seen++ >= entries) return;
      const file = path.join(current, entry.name);
      if (entry.isFile()) yield {file, name: entry.name, directory: current, depth};
      else if (entry.isDirectory() && depth < maxDepth && !skipped(entry.name)) stack.push([file, depth + 1]);
    }
  }
}

function args(profile) {
  return Array.isArray(profile?.args) ? profile.args : [];
}

function arg(profile, key) {
  const index = args(profile).indexOf(key);
  return index < 0 ? undefined : args(profile)[index + 1];
}

export function guessQuant(names) {
  for (const name of names) {
    const match = QUANT.exec(name);
    if (match) return match[2].toLowerCase().replace(/[.-]/g, '_');
  }
  return null;
}

// A Strata model profile is a JSON file with an args array that points at GGUF weights.
export function readModelProfile(file) {
  let profile;
  try {
    if (fs.statSync(file).size > 4 * 2 ** 20) return null;
    profile = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.args) || !arg(profile, '--native')) return null;
  const weights = arg(profile, '--native');
  return {profile: file, model: profile.model_name ?? null, vision: !!profile.vision,
    weights: path.basename(weights), context: arg(profile, '--max-context') ?? null,
    suggestedQuant: guessQuant([weights, profile.model_name ?? '', path.basename(file, '.json')]),
    sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex')};
}

function component(name) {
  return name.match(/^(\d+\.\d+\.\d+)(?=$|[-_])/)?.[1] ?? null;
}

export function detectInstalls(paths) {
  const control = new Map();
  const engines = new Map();
  const models = [];
  const unreadable = [];
  const roots = [];
  for (const given of paths) {
    let stat;
    try {
      stat = fs.statSync(given);
    } catch { unreadable.push(given); continue; }
    if (stat.isFile()) {
      const model = path.extname(given).toLowerCase() === '.json' ? readModelProfile(given) : null;
      if (model) models.push(model); else unreadable.push(given);
      continue;
    }
    roots.push(path.resolve(given));
  }
  for (const root of roots) {
    for (const {file, name, directory} of walk(root)) {
      const lower = name.toLowerCase();
      if (lower === 'strata.py') control.set(directory, {directory, version: component(path.basename(directory))});
      else if (lower === 'strata.exe' || lower === 'strata-vision.exe') {
        const found = engines.get(directory) || {directory, version: component(path.basename(directory)), engine: false, vision: false};
        found[lower === 'strata.exe' ? 'engine' : 'vision'] = true;
        engines.set(directory, found);
      } else if (lower.endsWith('.json') && !lower.includes('package')) {
        const model = readModelProfile(file);
        if (model) models.push(model);
      }
    }
  }
  return {control: [...control.values()], engines: [...engines.values()].filter(entry => entry.engine),
    models, unreadable};
}

export function configSkeleton(detection) {
  const matches = [];
  for (const control of detection.control) for (const engine of detection.engines) {
    if (!control.version || control.version !== engine.version) continue;
    matches.push({control, engine});
  }
  const preferred = matches[0];
  const profiles = detection.models.map((model, index) => ({
    id: (model.model ?? path.basename(model.profile, '.json')).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32) || `model-${index + 1}`,
    quant: model.suggestedQuant ?? null,
    profile: model.profile.replaceAll('\\', '/'),
    minimumFreeGiB: null,
    settings: {port: 8081 + index},
  }));
  const config = {version: 1,
    deployment: preferred ? {controlDirectory: preferred.control.directory.replaceAll('\\', '/'),
      engineDirectory: preferred.engine.directory.replaceAll('\\', '/'), engineVersion: preferred.control.version ?? null} : null,
    profiles};
  const fillIn = [];
  if (!preferred) fillIn.push('deployment');
  else if (!preferred.control.version) fillIn.push('deployment.engineVersion');
  for (const [index, profile] of profiles.entries()) {
    if (!profile.quant) fillIn.push(`profiles[${index}].quant`);
    fillIn.push(`profiles[${index}].minimumFreeGiB`);
  }
  return {config, fillIn, candidateInstalls: matches.length};
}

export function probePort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', error => resolve({port, free: false, reason: error.code ?? String(error)}));
    server.once('listening', () => server.close(() => resolve({port, free: true})));
    server.listen(port, '127.0.0.1');
  });
}

export function probePython(python) {
  const probe = 'import sys, psutil; sys.stdout.write(psutil.__version__)';
  const result = spawnSync(python, ['-B', '-c', probe], {encoding: 'utf8', windowsHide: true, timeout: 20_000});
  if (result.error) return {python, psutil: null, error: result.error.message};
  return {python, psutil: result.status === 0 ? result.stdout.trim() : null,
    ...(result.status === 0 ? {} : {error: (result.stderr || result.stdout || '').trim().slice(0, 200)})};
}

export function runningEngines(platform = process.platform) {
  if (platform !== 'win32') return {checked: false, reason: 'not windows'};
  const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {encoding: 'utf8', windowsHide: true, timeout: 20_000});
  if (result.error) return {checked: false, reason: result.error.message};
  const names = new Set();
  for (const line of (result.stdout || '').split('\n')) {
    const name = line.match(/^"([^"]+)"/)?.[1]?.toLowerCase();
    if (name?.startsWith('strata') && name.endsWith('.exe')) names.add(name);
  }
  return {checked: true, names: [...names]};
}

export function environment() {
  return {platform: process.platform, arch: process.arch, node: process.version,
    nodeMajor: Number(process.versions.node.split('.')[0]), totalMemoryGiB: Math.round(os.totalmem() / 2 ** 30),
    freeMemoryGiB: Math.round(os.freemem() / 2 ** 20 / 1024), home: os.homedir()};
}
