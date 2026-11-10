import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export const learningScopes = ['general', 'video', 'coding'];

export function learningOptions(value = {}) {
  const options = {enabled: false, reuse: true, scope: 'general', saveEveryMinutes: 5, ...value};
  if (typeof options.enabled !== 'boolean' || typeof options.reuse !== 'boolean' ||
      !learningScopes.includes(options.scope) || !Number.isInteger(options.saveEveryMinutes) ||
      options.saveEveryMinutes < 1 || options.saveEveryMinutes > 60) {
    throw new Error('Invalid routing learning options');
  }
  return options;
}

export function routingProfile(file) {
  if (fs.statSync(file).size > 2 ** 20) throw new Error('Routing profile exceeds size limit');
  const bytes = fs.readFileSync(file);
  if (bytes.length < 24 || bytes.toString('ascii', 0, 4) !== 'STRP' || bytes.readUInt32LE(4) !== 1) {
    throw new Error('Invalid STRP routing header');
  }
  const layers = bytes.readUInt32LE(8), experts = bytes.readUInt32LE(12);
  const slots = bytes.readUInt32LE(16), count = bytes.readUInt32LE(20), total = layers * experts;
  if (!layers || layers > 256 || !experts || experts > 2048 || !count || count > total ||
      slots > total || bytes.length !== 24 + 4 * count + 4 * total) {
    throw new Error('Invalid STRP routing dimensions/length');
  }
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const layer = bytes.readUInt16LE(24 + i * 4), expert = bytes.readUInt16LE(26 + i * 4);
    const key = layer * experts + expert;
    if (layer >= layers || expert >= experts || seen.has(key)) throw new Error('Invalid/duplicate routing pair');
    seen.add(key);
  }
  // Shipped profiles store frequencies here; learned profiles store ranks. The engine uses only the pairs.
  return {bytes, layers, experts, count, sha256: hash(bytes)};
}

export function modelIdentity(profile, engineVersion) {
  const get = key => { const i = profile.args.indexOf(key); return i < 0 ? undefined : profile.args[i + 1]; };
  const files = [get('--native'), get('--ple-gguf')].filter(Boolean);
  const split = get('--native')?.match(/^(.*)-00001-of-(\d{5})\.gguf$/i);
  if (split && +split[2] <= 64) for (let i = 2; i <= +split[2]; i++) {
    files.push(`${split[1]}-${String(i).padStart(5, '0')}-of-${split[2]}.gguf`);
  }
  const pack = get('--pack');
  if (pack && fs.statSync(pack).isDirectory()) files.push(path.join(pack, 'index.txt'));
  else if (pack) files.push(pack);
  return {engineVersion, vision: !!profile.vision, files: files.map(file => {
    const s = fs.statSync(file);
    return {path: path.resolve(file), bytes: s.size, modifiedMs: s.mtimeMs,
      ...(path.basename(file) === 'index.txt' ? {sha256: hash(fs.readFileSync(file))} : {})};
  })};
}

export function planLearning({baseFile, identity, options, storeRoot}) {
  options = learningOptions(options);
  const base = routingProfile(baseFile);
  const modelKey = hash(JSON.stringify({...identity, baseHash: base.sha256})).slice(0, 32);
  const savePath = path.join(storeRoot, modelKey, options.scope, 'expert-profile.bin');
  let chosen = base, selected = 'base', warning = null;
  if (options.enabled && options.reuse && fs.existsSync(savePath)) {
    try {
      const learned = routingProfile(savePath);
      if (learned.layers !== base.layers || learned.experts !== base.experts ||
          learned.count !== learned.layers * learned.experts) throw new Error('Learned routing shape differs');
      chosen = learned; selected = 'learned';
    } catch (error) { warning = `Learned routing rejected; using base: ${error.message}`; }
  }
  return {bytes: chosen.bytes, metadata: {...options, modelKey, selected, warning, identity,
    baseFile: path.resolve(baseFile), baseHash: base.sha256, snapshotHash: chosen.sha256,
    savePath: options.enabled ? savePath : null}};
}
