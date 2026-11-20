// Local control panel: one loopback HTTP server bridging the CLI, no dependencies.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {read, stateRoot} from '../scripts/strata-panel/core.mjs';
import {runCommand} from '../launcher.mjs';
import {httpError, saveTuning, tuningOptions} from './tuning.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const launcher = path.join(root, 'launcher.mjs');
const page = path.join(here, 'index.html');
const terminalStates = ['stopped', 'exited', 'error'];
const runId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const profileId = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function readJson(request) {
  if (request.headers['content-type']?.split(';',1)[0].trim().toLowerCase() !== 'application/json') {
    throw httpError(415, 'Expected application/json');
  }
  const limit = 16 * 1024;
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    throw httpError(413, 'Parameter request is too large');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({destroyOnReturn:false})) {
    size += chunk.length;
    if (size > limit) {
      request.resume();
      throw httpError(413, 'Parameter request is too large');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'Invalid parameter JSON'); }
}

function runCli(args) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [launcher, ...args], {cwd: root, windowsHide: true,
      env: {...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1'}});
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', d => { out += d; });
    child.stderr.setEncoding('utf8').on('data', d => { err += d; });
    child.on('error', error => resolve({ok: false, error: error.message}));
    child.on('close', code => {
      if (!out.trim()) { resolve({ok: false, error: err.trim() || `launcher exited with ${code}`}); return; }
      try { resolve(JSON.parse(out)); }
      catch { resolve({ok: false, error: 'launcher printed non-JSON output', raw: out.slice(0, 2000)}); }
    });
  });
}

function activeRuns() {
  const directory = path.join(stateRoot, 'runs');
  if (!fs.existsSync(directory)) return [];
  const active = [];
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isDirectory()) continue;
    const file = path.join(directory, entry.name, 'status.json');
    if (!fs.existsSync(file)) continue;
    try {
      const status = read(file);
      if (!terminalStates.includes(status.state)) active.push({id: entry.name, state: status.state, model: status.model});
    } catch { active.push({id: entry.name, state: 'unreadable'}); }
  }
  return active;
}

// The launcher start command prints its run JSON first, then inherits the engine's stdout.
function firstJson(buffer) {
  let depth = 0, start = -1, inString = false, escape = false;
  for (let i = 0; i < buffer.length; i++) {
    const c = buffer[i];
    if (start < 0) { if (c === '{') { start = i; depth = 1; } continue; }
    if (inString) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (!depth) { try { return JSON.parse(buffer.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

let starting = null;
function startRun(id) {
  if (starting) return Promise.resolve({ok: false, error: 'a start is already in progress'});
  if (activeRuns().length) return Promise.resolve({ok: false, error: 'Launcher-owned runs are still active; stop them first'});
  return new Promise(resolve => {
    const child = spawn(process.execPath, [launcher, 'start', id], {cwd: root, windowsHide: true,
      env: {...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1'}});
    starting = {id, child};
    let buffer = '', reported = false, err = '';
    const timer = setTimeout(() => finish({ok: false, error: 'Start did not return a run ID within 60 seconds; check before retrying'}), 60000);
    const finish = value => {
      if (reported) return;
      reported = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout.setEncoding('utf8').on('data', d => {
      if (reported) return;
      buffer += d;
      if (!reported && buffer.includes('{')) {
        const parsed = firstJson(buffer);
        if (parsed && runId.test(parsed.id)) finish(parsed);
      }
      if (buffer.length > 1 << 20) buffer = buffer.slice(-4096);
    });
    child.stderr.setEncoding('utf8').on('data', d => { err = (err + d).slice(-4096); });
    child.on('error', error => { starting = null; finish({ok: false, error: error.message}); });
    child.on('close', code => {
      starting = null;
      if (!reported) finish({ok: false, error: err.trim() || `start exited with ${code}`});
    });
  });
}

const routes = {
  'GET /api/doctor': async url => runCli(url.searchParams.get('profile') ? ['doctor', url.searchParams.get('profile')] : ['doctor']),
  'GET /api/list': () => runCli(['list']),
  'GET /api/check': async url => runCli(['check', url.searchParams.get('id')]),
  'GET /api/status': url => runCommand('status', url.searchParams.get('id')),
  'GET /api/runs': () => activeRuns(),
  'GET /api/tuning': url => tuningOptions(url.searchParams.get('id')),
  'POST /api/tuning': async (url,request) => saveTuning(url.searchParams.get('id'),await readJson(request)),
  'POST /api/start': url => startRun(url.searchParams.get('id')),
  'POST /api/stop': url => runCommand('stop', url.searchParams.get('id')),
};

const server = http.createServer(async (request, response) => {
  const host = `127.0.0.1:${request.socket.localPort}`;
  const origin = `http://${host}`;
  const send = (code, value, type = 'application/json') => {
    const body = typeof value === 'string' ? value : JSON.stringify(value);
    response.writeHead(code, {'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store'});
    response.end(body);
  };
  if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.method === 'POST' && request.headers['x-strata-panel'] !== '1')) {
    return send(403, {ok: false, error: 'Use the local panel address to access this service'});
  }
  let url;
  try {
    if (!request.url.startsWith('/') || request.url.startsWith('//')) throw new Error();
    url = new URL(request.url, origin);
    if (url.origin !== origin) throw new Error();
  } catch { return send(400, {ok: false, error: 'Invalid request URL'}); }
  if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try { return send(200, fs.readFileSync(page, 'utf8'), 'text/html'); }
    catch { return send(500, 'ui/index.html is missing', 'text/plain'); }
  }
  if (request.method === 'GET' && url.pathname === '/tuning.js') {
    try { return send(200, fs.readFileSync(path.join(here,'tuning.js'),'utf8'), 'text/javascript'); }
    catch { return send(500, 'Parameter editor script is missing', 'text/plain'); }
  }
  const handler = routes[`${request.method} ${url.pathname}`];
  if (!handler) return send(404, {ok: false, error: 'unknown endpoint'});
  const ids = {'/api/doctor': profileId, '/api/check': profileId, '/api/start': profileId, '/api/status': runId, '/api/stop': runId, '/api/tuning': profileId};
  const id = url.searchParams.get('id');
  if (ids[url.pathname] && (url.pathname !== '/api/doctor' || url.searchParams.has('profile')) &&
      !ids[url.pathname].test((url.pathname === '/api/doctor' ? url.searchParams.get('profile') : id) ?? '')) {
    return send(400, {ok: false, error: 'missing or invalid id'});
  }
  try { send(200, await handler(url,request)); }
  catch (error) { send(error.status ?? 500, {ok: false, error: String(error?.message ?? error)}); }
});

const port = Number(process.argv[2] ?? 8444);
if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('Usage: node ui/server.mjs [PORT]');
  process.exitCode = 2;
} else {
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? `Web panel port ${port} is already in use; choose another port.` : error.message);
    process.exitCode = 2;
  });
  server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({panel: `http://127.0.0.1:${port}/`, root})));
}

const shutdown = () => { try { starting?.child?.kill(); } catch {} server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
