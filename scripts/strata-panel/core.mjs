import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {learningOptions, modelIdentity, planLearning} from './learning.mjs';
import {samplingDefaults, samplingOptions, samplingFields} from './sampling.mjs';
import {engineOptions, engineOverrides} from './engine-options.mjs';
import {draftOptions, configureDraft, draftGates} from './draft-options.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const stateRoot = path.join(root, 'runtime/strata-launcher');
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  fs.renameSync(tmp, file);
}
export function arg(profile, key) {
  const i = profile.args.indexOf(key);
  return i < 0 ? undefined : profile.args[i + 1];
}
function put(profile, key, value) {
  const i = profile.args.indexOf(key);
  if (i >= 0) profile.args.splice(i, 2);
  if (value !== undefined) profile.args.push(key, String(value));
}
export function defaults(profile) {
  return {
    context: +arg(profile, '--max-context'), kv: arg(profile, '--kv') || 'int8',
    kvResident: +(arg(profile, '--kv-resident') || arg(profile, '--max-context')),
    expertGiB: +arg(profile, '--resident-budget-gib'), headroomGiB: +(profile.env?.STRATA_RESIDENT_HEADROOM_GIB || 8),
    vramMiB: +arg(profile, '--vram-reserve-mib'), workers: +(arg(profile, '--pool-workers') || 5),
    output: profile.max_tokens ?? 16384, thinking: profile.reasoning_budget_tokens ?? 4096,
    effort: profile.reasoning_effort === 'none' ? 'off' : profile.reasoning_effort || 'medium',
    spec: +(arg(profile, '--spec') || 0), specMinP: +(arg(profile, '--spec-min-p') || 0.5), drafting: profile.drafting || 'mtp',
    port: profile.port || 8080, visionThreads: profile.vision?.threads || 6, imageTokens: profile.vision?.max_tokens || 300,
  };
}
function numeric(s, key, low, high, integer = true) {
  const n = s[key];
  if (typeof n !== 'number' || !Number.isFinite(n) || n < low || n > high || (integer && !Number.isInteger(n))) {
    throw new Error(`${key}: expected ${integer ? 'integer' : 'number'} ${low}..${high}`);
  }
}
// Defaults for a large MoE deployment; a profile may widen or narrow any of them with `limits`.
export const settingBounds = {
  context: [32768, 262144, true], output: [1024, 32768, true], thinking: [0, 24576, true],
  kvResident: [4096, 262144, true], expertGiB: [8, 50, false], headroomGiB: [6, 24, false],
  vramMiB: [0, 4096, true], workers: [1, 12, true], spec: [0, 8, true], specMinP: [0, 1, false],
  port: [1024, 65535, true], visionThreads: [1, 12, true], imageTokens: [64, 1024, true],
};
export function settingLimits(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('limits: expected an object');
  const bounds = {...settingBounds};
  for (const [key, range] of Object.entries(value)) {
    if (!Object.hasOwn(settingBounds, key)) throw new Error(`limits.${key}: no such setting`);
    if (!Array.isArray(range) || range.length !== 2 || range.some(n => typeof n !== 'number' || !Number.isFinite(n))) {
      throw new Error(`limits.${key}: expected [minimum, maximum]`);
    }
    if (range[0] > range[1]) throw new Error(`limits.${key}: minimum exceeds maximum`);
    bounds[key] = [range[0], range[1], settingBounds[key][2]];
  }
  return bounds;
}
export function validate(s, limits = settingBounds) {
  for (const [key, [low, high, integer]] of Object.entries(limits)) numeric(s, key, low, high, integer);
  if (!['int8', 'k8v4'].includes(s.kv)) throw new Error('Unsupported KV precision');
  if (s.drafting !== undefined && !['mtp', 'dflash2'].includes(s.drafting)) throw new Error('Unsupported drafter');
  if (!['off', 'low', 'medium', 'high'].includes(s.effort)) throw new Error('Unsupported thinking effort');
  if (s.thinking >= s.output || s.output + 4096 >= s.context) throw new Error('Thinking must fit inside total output; leave input space in context');
  if (s.kvResident > s.context) throw new Error('GPU KV residency exceeds context');
  return s;
}
function slugify(value) {
  const slug = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || 'strata';
}

export function modelSlug(profile, request) {
  return request.slug || slugify(profile.model_name || path.basename(request.profile, path.extname(request.profile)));
}

export function check(request, deployment) {
  const profile = read(request.profile);
  if (!profile || typeof profile !== 'object' || !Array.isArray(profile.args) || profile.args.some(value => typeof value !== 'string')) {
    throw new Error(`Expected a Strata model profile with a string args array: ${request.profile}`);
  }
  const initial = defaults(profile);
  if (request.settings && Object.keys(request.settings).some(key => !Object.hasOwn(initial, key))) {
    throw new Error('Unknown launcher settings field');
  }
  const settings = validate({...initial, ...request.settings}, request.limits ? settingLimits(request.limits) : settingBounds);
  const drafting = draftOptions(request.draftOptions);
  const learning = learningOptions(request.learning);
  const advanced = engineOptions(request.engineOptions);
  const envOverrides = engineOverrides(advanced);
  const engineIdentity = Object.keys(envOverrides).length ? {engineOptions: advanced} : {};
  const source = deployment.controlDirectory;
  const python = path.join(source, 'python/python.exe');
  const engine = path.join(deployment.engineDirectory, 'strata.exe');
  const vision = !!profile.vision;
  for (const file of [python, engine, path.join(source, 'strata.py'), path.join(source, 'serve/winjob.py'),
    ...(vision ? [path.join(deployment.engineDirectory, 'strata-vision.exe')] : [])]) {
    if (!fs.statSync(file, {throwIfNoEntry: false})?.isFile()) throw new Error(`Missing runtime file: ${file}`);
  }
  const assets = {'--pack': arg(profile, '--pack'), '--native': arg(profile, '--native'),
    '--expert-profile': arg(profile, '--expert-profile'), tokenizer: profile.tokenizer};
  if (arg(profile, '--ple-gguf') !== undefined) assets['--ple-gguf'] = arg(profile, '--ple-gguf');
  if (settings.drafting === 'mtp' && settings.spec > 0) assets['--mtp'] = arg(profile, '--mtp');
  if (vision) assets.mmproj = profile.vision.mmproj;
  for (const [key, file] of Object.entries(assets)) {
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error(`${key}: expected an absolute asset path in ${request.profile}`);
    const stat = fs.statSync(file, {throwIfNoEntry: false});
    if (!(stat?.isFile() || key === '--pack' && stat?.isDirectory())) throw new Error(`Missing ${key} asset: ${file}`);
  }
  const sampling = samplingOptions(request.sampling, samplingDefaults(settings, profile.sampling));
  const routing = planLearning({baseFile: assets['--expert-profile'],
    identity: {...modelIdentity(profile, deployment.engineVersion), ...engineIdentity}, options: learning,
    storeRoot: path.join(stateRoot, 'learning')});
  if (learning.enabled && ['--adapt-every', '--adapt-swaps'].some(key => arg(profile, key) !== undefined && +arg(profile, key) <= 0)) {
    throw new Error('Routing learning requires adaptive expert caching; adaptation is disabled in this preset');
  }
  const quant = request.quant;
  const slug = modelSlug(profile, request);
  const fingerprint = digest({quant, slug, vision, settings, modelKey: routing.metadata.modelKey,
    ...(settings.drafting === 'dflash2' ? {draftOptions: drafting} : {}),
    ...(learning.enabled ? {learning} : {}), ...(sampling.mode === 'custom' ? {sampling} : {}), ...engineIdentity}).slice(0, 16);
  const clientModel = `${slug}-${quant}-${vision ? 'vision' : 'text'}-${fingerprint}`;
  const gates = draftGates(request.dflash2);
  const tuned = settings.drafting === 'dflash2' && drafting.pack === 'tuned';
  if (tuned && (!gates.pack || !gates.model)) throw new Error('draftOptions.pack "tuned" needs dflash2.pack and dflash2.model in the launcher profile');
  if (tuned && gates.quant && gates.quant !== quant) throw new Error(`dflash2.pack ${gates.pack} is verified for quant ${gates.quant}, not ${quant}`);
  if (tuned && gates.engineVersions && !gates.engineVersions.includes(deployment.engineVersion)) {
    throw new Error(`dflash2.pack ${gates.pack} is verified for engine ${gates.engineVersions.join(', ')}, not ${deployment.engineVersion}`);
  }
  const model = tuned ? gates.model : clientModel;
  if (settings.drafting === 'dflash2') {
    const drafter = path.join(path.dirname(path.dirname(arg(profile, '--pack'))), 'dflash2');
    let found;
    try {
      found = tuned ? [path.join(drafter, gates.pack)] :
        fs.readdirSync(drafter).filter(name => name.toLowerCase().endsWith('.pack')).map(name => path.join(drafter, name));
    } catch { found = []; }
    if (!found.length) throw new Error(`No DFlash2 drafter under ${drafter}; fetch the drafter for this model first`);
    for (const file of found) {
      if (!fs.statSync(file, {throwIfNoEntry: false})?.isFile()) throw new Error(`Missing DFlash2 drafter: ${file}`);
    }
  }
  return {profile, settings, drafting, advanced, envOverrides, routing, sampling, vision, fingerprint, clientModel, model,
    tuned, source, python, engine};
}

export function prepare(request, deployment) {
  const {profile, settings, drafting, advanced, envOverrides, routing, sampling, vision, fingerprint, clientModel, model,
    tuned, source, python, engine} = check(request, deployment);
  const id = randomUUID();
  const dir = path.join(stateRoot, 'runs', id);
  for (const [key, value] of Object.entries({
    '--max-context': settings.context, '--kv': settings.kv, '--kv-resident': settings.kvResident,
    '--resident-budget-gib': settings.expertGiB, '--vram-reserve-mib': settings.vramMiB,
    '--pool-workers': settings.workers, '--spec': settings.spec, '--spec-min-p': settings.specMinP,
    '--expert-profile': path.join(dir, 'expert-profile.bin'),
    '--expert-profile-save': routing.metadata.savePath ?? undefined,
    '--expert-profile-save-every': routing.metadata.enabled ? routing.metadata.saveEveryMinutes : undefined,
  })) put(profile, key, value);
  delete profile.expert_profile_save;
  delete profile.expert_profile_save_every;
  if (settings.spec === 0) put(profile, '--mtp', undefined);
  configureDraft(profile, settings, drafting);
  if (tuned) profile.aliases = [...new Set([...(profile.aliases || []), clientModel])];
  Object.assign(profile, {exe: engine, model_name: model, port: settings.port, host: '127.0.0.1', parallel: 1,
    open_browser: false, api_monitor: false, log: path.join(dir, 'engine.log'), max_tokens: settings.output,
    reasoning_budget_tokens: settings.thinking, reasoning_effort: settings.effort === 'off' ? 'none' : settings.effort});
  profile.env = {...profile.env, STRATA_RESIDENT_HEADROOM_GIB: String(settings.headroomGiB), ...envOverrides};
  if (sampling.mode === 'custom') {
    profile.sampling = {...profile.sampling, ...samplingFields(sampling)};
    delete profile.sampling.repeat_penalty;
    delete profile.sampling.repeat_last_n;
    if (sampling.seed === null) delete profile.sampling.seed;
  }
  if (vision) Object.assign(profile.vision, {exe: path.join(deployment.engineDirectory, 'strata-vision.exe'),
    threads: settings.visionThreads, max_tokens: settings.imageTokens});
  fs.mkdirSync(dir, {recursive: true});
  fs.writeFileSync(path.join(dir, 'expert-profile.bin'), routing.bytes, {flag: 'wx'});
  if (routing.metadata.enabled) fs.mkdirSync(path.dirname(routing.metadata.savePath), {recursive: true});
  const config = path.join(dir, 'model.json');
  const shared = {max_tokens: settings.output, reasoning_budget_tokens: settings.thinking, reasoning_effort: settings.effort === 'off' ? 'none' : settings.effort};
  write(config, profile); write(path.join(dir, 'model.shared-settings.json'), shared);
  const run = {version: 1, id, dir, config, source, python, engine, model, clientModel, draftOptions: drafting, fingerprint, profile: request.id,
    vision, settings, sampling, engineOptions: advanced, learning: routing.metadata, minimumFreeGiB: request.minimumFreeGiB, log: path.join(dir, 'console.log'),
    configHash: digest(fs.readFileSync(config, 'utf8')), sharedHash: digest(fs.readFileSync(path.join(dir, 'model.shared-settings.json'), 'utf8'))};
  write(path.join(dir, 'run.json'), run);
  return run;
}
