import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {draftGates, draftOptions} from './draft-options.mjs';

export const draftingModes = ['auto', 'mtp', 'dflash2', 'off'];
const mtpFiles = ['dense.txt', 'dense.bin', 'experts.bin'];
const stockPacks = ['qwen3.8-flash-next-dflash2.q4_0.pack',
  'qwen3.8-flash-next-dflash2.q4_0-selq4.pack', 'qwen3.8-flash-next-dflash2.q8.pack'];

const stat = file => fs.statSync(file, {throwIfNoEntry: false});
const file = name => stat(name)?.isFile() === true;
const directory = name => stat(name)?.isDirectory() === true;
const nonempty = name => { const value = stat(name); return value?.isFile() && value.size > 0; };
const versionId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function flag(args, name) {
  const index = args.lastIndexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function effectiveArgs(profile) {
  if (!Array.isArray(profile?.args) || profile.args.some(value => typeof value !== 'string') ||
      (profile.user_args != null && (!Array.isArray(profile.user_args) || profile.user_args.some(value => typeof value !== 'string')))) {
    throw new Error('Expected a Strata model profile with string args and optional user_args arrays');
  }
  return [...profile.args, ...(profile.user_args ?? [])];
}

function runtimeFolder(folder) {
  const missing = mtpFiles.filter(name => !nonempty(path.join(folder, name)));
  return {missing, ready: missing.length === 0};
}

function findMtp(profile, args, dataDirectory) {
  const configured = flag(args, '--mtp');
  if (/^\d+$/.test(configured ?? '')) {
    return {type: 'embedded', explicit: true, depth: Number(configured), path: null, ready: true, missing: []};
  }
  const explicit = configured !== undefined;
  const model = flag(args, '--native');
  const flash = /qwen3\.8-flash-next/i.test(profile.model_name ?? '') ||
    /qwen3\.8-flash-next/i.test(path.basename(model ?? ''));
  const candidate = dataDirectory && flash ? path.join(dataDirectory, 'mtp', 'rt') : null;
  const chosen = explicit ? (path.isAbsolute(configured) ? configured : null) : candidate;
  if (!chosen) return {type: 'unresolved', explicit, path: null, ready: false, missing: []};
  if (file(chosen)) return {type: 'file', explicit, path: chosen, ready: true, missing: []};
  return {type: 'directory', explicit, path: chosen, ...runtimeFolder(chosen)};
}

export function draftAssets(profile, tunedPack) {
  const args = effectiveArgs(profile);
  const pack = flag(args, '--pack');
  const weights = flag(args, '--native');
  const dataDirectory = pack && path.isAbsolute(pack) ? path.dirname(path.dirname(pack)) : null;
  const drafterDir = dataDirectory ? path.join(dataDirectory, 'dflash2') : null;
  const provided = flag(args, '--draft-model');
  const stock = drafterDir ? stockPacks.map(name => path.join(drafterDir, name)).filter(nonempty) : [];
  if (provided && path.isAbsolute(provided) && nonempty(provided)) stock.push(provided);
  const tuned = drafterDir && typeof tunedPack === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(tunedPack)
    ? path.join(drafterDir, tunedPack) : null;
  return {
    dataDirectory,
    weights: weights ?? null,
    weightsPresent: !!(weights && path.isAbsolute(weights) && file(weights)),
    pack: pack ?? null,
    tokenizer: profile.tokenizer ?? null,
    nativePack: !!(pack && path.isAbsolute(pack) && directory(pack) && file(path.join(pack, 'native_experts.txt'))),
    mtp: findMtp(profile, args, pack && path.basename(path.dirname(pack)).toLowerCase() === 'packs' ? dataDirectory : null),
    dflash2: {directory: drafterDir, stock: [...new Set(stock)], tuned, tunedReady: !!(tuned && nonempty(tuned))}
  };
}

function controlEnv(extra = {}) {
  const env = {...process.env, PYTHONUTF8: '1', PYTHONNOUSERSITE: '1', ...extra};
  for (const key of ['PYTHONPATH', 'PYTHONHOME', 'STRATA_MTP_REVISION', 'STRATA_ALLOW_UNPINNED', 'STRATA_SOURCE']) delete env[key];
  return env;
}

async function control(deployment, command, {json = true, env = {}} = {}) {
  const cwd = deployment.controlDirectory;
  const python = path.join(cwd, 'python', 'python.exe');
  if (!file(python)) throw new Error(`Missing Strata Control Python: ${python}`);
  const engines = path.dirname(deployment.engineDirectory);
  const components = path.basename(engines).toLowerCase() === 'engine' ? {STRATA_COMPONENTS_DIR: path.dirname(engines)} : {};
  const child = spawn(python, ['-B', '-u', ...command], {
    cwd, env: controlEnv({...components, ...env}), windowsHide: true,
    stdio: ['ignore', json ? 'pipe' : process.stderr, json ? 'pipe' : process.stderr],
    ...(json ? {signal: AbortSignal.timeout(90_000)} : {})
  });
  let output = '', errors = '';
  if (json) {
    child.stdout.setEncoding('utf8').on('data', chunk => {
      output += chunk;
      if (output.length > 4 * 1024 * 1024) child.kill();
    });
    child.stderr.setEncoding('utf8').on('data', chunk => { errors = (errors + chunk).slice(-6000); });
  }
  const [status] = await once(child, 'close');
  let result;
  if (json) {
    try { result = JSON.parse(output); } catch {}
  }
  if (status !== 0 || result?.ok === false) {
    throw new Error(result?.error?.message || errors.trim() || `Strata Control failed (exit ${status})`);
  }
  if (json && (!result || typeof result !== 'object')) throw new Error('Expected a JSON report from this version of Strata Control');
  return result;
}

const cli = (deployment, args, options) => control(deployment, [path.join(deployment.controlDirectory, 'strata.py'), ...args], options);

function selectedDrafter(request, profile, override) {
  const mode = override ?? request.settings?.drafting ?? profile.drafting ?? (profile.mtp === false ? 'off' : 'mtp');
  if (!['mtp', 'dflash2'].includes(mode)) throw new Error('Choose mtp or dflash2 explicitly for an auto/off profile');
  return mode;
}

function checkTuned(request, deployment, gates) {
  if (!gates.pack || !gates.model || (gates.quant && gates.quant !== request.quant) ||
      (gates.engineVersions && !gates.engineVersions.includes(deployment.engineVersion))) {
    throw new Error('Selected tuned DFlash2 needs matching pack, model, quant and engine declarations');
  }
}

export async function planDrafter(request, deployment, profile, override) {
  const mode = selectedDrafter(request, profile, override);
  const gates = draftGates(request.dflash2);
  const local = draftAssets(profile, gates.pack);
  if (mode === 'mtp') {
    return {mode, ...local, estimatedDownloadGB: local.mtp.ready ? 0 : local.mtp.path ? 5.2 : null,
      source: 'Qwen original checkpoint via Strata tools'};
  }
  if (!local.dataDirectory) throw new Error('DFlash2 needs an absolute --pack path in the Strata profile');
  const tuned = draftOptions(request.draftOptions).pack === 'tuned';
  if (tuned) checkTuned(request, deployment, gates);
  const upstream = await cli(deployment, ['drafting', 'plan', '--config', request.profile, '--data-dir',
    local.dataDirectory, '--mode', mode, '--output', 'json']);
  return {mode, ...local, upstream, tuned};
}

async function fetchMtp(profile, deployment, plan) {
  if (plan.mtp.ready) return {mode: 'mtp', ...plan.mtp, downloaded: false};
  if (!plan.dataDirectory || !directory(plan.dataDirectory) || !plan.mtp.path) {
    throw new Error('MTP download needs a local Flash-Next pack and a resolved MTP runtime directory');
  }
  const canonical = path.join(plan.dataDirectory, 'mtp', 'rt');
  if (path.relative(canonical, plan.mtp.path) !== '') throw new Error(`MTP download targets the model's standard path: ${canonical}`);
  if (stat(canonical)) throw new Error(`Incomplete MTP directory is already present: ${canonical}. Move it aside or repair it before downloading.`);
  const source = deployment.controlDirectory;
  const tools = ['mtp_fetch.py','mtp_pack.py','mtp_rt.py'].map(name => path.join(source, 'tools', name));
  const vocab = path.join(source, 'data', 'draft_vocab.bin');
  if (![...tools, vocab].every(file)) throw new Error('This Strata Control does not ship the official MTP fetch/pack tools and vocabulary');
  const native = flag(effectiveArgs(profile), '--native');
  if (!native || !path.isAbsolute(native) || !file(native)) throw new Error('MTP download requires the existing model GGUF to identify its architecture');
  const fit = await control(deployment, ['-c',
    'import json,sys; sys.path.insert(0,sys.argv[1]); from strata_control import drafting; f=drafting.gguf_facts(sys.argv[2]); print(json.dumps({"facts":f,"fit":drafting.file_fit(["--native",sys.argv[2]])}))',
    source, native]);
  if (fit.fit !== 'fits' || fit.facts?.vocab !== 248320) throw new Error('Strata could not verify this GGUF as the Flash-Next shape for the shared MTP head');

  const parent = path.dirname(canonical);
  const stage = path.join(parent, '.launcher-mtp-download');
  const lock = path.join(parent, '.launcher-mtp.lock');
  fs.mkdirSync(parent, {recursive: true});
  const lockFd = fs.openSync(lock, 'wx');
  try {
    if (stat(canonical)) throw new Error(`The MTP destination appeared during preparation: ${canonical}`);
    if ([stage, parent].some(folder => fs.existsSync(folder) && fs.lstatSync(folder).isSymbolicLink())) {
      throw new Error('MTP download staging and destination must be local directories');
    }
    const rt = path.join(stage, 'rt');
    if (fs.existsSync(rt) && fs.lstatSync(rt).isSymbolicLink()) throw new Error('MTP runtime staging must be a local directory');
    const gguf = path.join(stage, 'mtp-q2_0.gguf');
    await control(deployment, [tools[0], 'fetch', '--out', stage], {json: false});
    await control(deployment, [tools[0], 'verify', '--out', stage], {json: false});
    await control(deployment, [tools[1], '--src', stage, '--experts', 'q2_0', '--out', gguf], {json: false});
    await control(deployment, [tools[2], '--gguf', gguf, '--out', rt], {json: false});
    fs.copyFileSync(vocab, path.join(rt, 'draft_vocab.bin'));
    if (!runtimeFolder(rt).ready) throw new Error('Strata did not produce a complete MTP runtime directory');
    if (stat(canonical)) throw new Error(`The MTP destination appeared during the download: ${canonical}`);
    fs.renameSync(rt, canonical);
    return {mode: 'mtp', type: 'directory', path: canonical, ready: true, downloaded: true};
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}

export async function fetchDrafter(request, deployment, profile, override) {
  const plan = await planDrafter(request, deployment, profile, override);
  if (plan.mode === 'mtp') return fetchMtp(profile, deployment, plan);
  if (!plan.upstream.serves || (!plan.upstream.needed && !plan.upstream.ready)) {
    throw new Error(plan.upstream.support_line || plan.upstream.note || 'Strata did not find a compatible DFlash2 pack for this profile');
  }
  if (plan.tuned !== !!plan.upstream.tuned || (plan.tuned && plan.upstream.file !== request.dflash2.pack)) {
    throw new Error(`Strata selected ${plan.upstream.file}; it differs from the requested DFlash2 variant. Review the drafter plan.`);
  }
  await cli(deployment, ['drafting', 'fetch', '--config', request.profile, '--data-dir',
    plan.dataDirectory, '--mode', 'dflash2', '--if-needed', '--output', 'human'], {json: false});
  const current = draftAssets(profile, request.dflash2?.pack).dflash2;
  if (plan.tuned ? !current.tunedReady : !current.stock.length) throw new Error('Strata did not produce the selected DFlash2 pack');
  return {mode: 'dflash2', path: plan.tuned ? current.tuned : current.stock[0], ready: true};
}

export function modelPlan(deployment, family, model, destination) {
  if (![family, model].every(value => versionId.test(value ?? ''))) throw new Error('Expected a Strata model family and size');
  if (destination !== undefined && !path.isAbsolute(destination)) throw new Error('Model destination must be absolute');
  return cli(deployment, ['launch', '--family', family, '--model', model, '--plan', '--output', 'json',
    ...(destination ? ['--data-dir', destination] : [])]);
}

export async function fetchModel(deployment, family, model, destination, installHome) {
  if (!path.isAbsolute(destination)) throw new Error('model-fetch requires an absolute destination for model assets');
  if (![family, model].every(value => versionId.test(value ?? ''))) throw new Error('Expected a Strata model family and size');
  const installer = path.join(deployment.controlDirectory, 'setup.py');
  if (!file(installer) || !file(path.join(deployment.controlDirectory, 'VERSION'))) {
    throw new Error('model-fetch needs a packaged Strata Control with setup.py and VERSION');
  }
  const plan = await modelPlan(deployment, family, model, destination);
  const targetKey = createHash('sha256').update(path.resolve(destination)).digest('hex').slice(0, 12);
  const isolatedHome = path.join(installHome, `${family.toLowerCase()}-${model.toLowerCase()}-${targetKey}`);
  fs.mkdirSync(isolatedHome, {recursive: true});
  const lock = path.join(isolatedHome, 'install.lock');
  const lockFd = fs.openSync(lock, 'wx');
  try {
    await control(deployment, [installer, '--setup', '--family', family, '--model', model,
      '--data-dir', destination, '--yes', '--no-start', '--output', 'jsonl'], {
      json: false, env: {STRATA_CONTROL_INSTALL: '1', STRATA_INSTALL_DIR: isolatedHome}
    });
    const profiles = fs.readdirSync(isolatedHome).filter(name => /^strata-.*\.json$/i.test(name))
      .map(name => path.join(isolatedHome, name)).filter(name => {
        const profile = JSON.parse(fs.readFileSync(name, 'utf8').replace(/^\uFEFF/, ''));
        const native = Array.isArray(profile.args) ? flag(profile.args, '--native') : undefined;
        return native && path.isAbsolute(native) && file(native);
      });
    if (!profiles.length) throw new Error(`Strata did not write a usable model profile under ${isolatedHome}`);
    return {family, model, plan, destination, profiles, started: false};
  } finally {
    fs.closeSync(lockFd);
    fs.unlinkSync(lock);
  }
}
