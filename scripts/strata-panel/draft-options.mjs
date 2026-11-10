export const draftGateSpecs = {
  // A tuned drafter is model specific: the profile declares the pack, the advertised model
  // alias, and, when known, the quant and engine versions that pack was verified against.
  tunedKeys: ['pack', 'model', 'quant', 'engineVersions'],
};

function name(value, key) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`dflash2.${key}: expected a file name or model alias of up to 128 characters`);
  }
  return value;
}

export function draftGates(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('dflash2: expected an object');
  if (Object.keys(value).some(key => !draftGateSpecs.tunedKeys.includes(key))) throw new Error('Unknown dflash2 option');
  const gates = {pack: undefined, model: undefined, quant: undefined, engineVersions: undefined, ...value};
  if (gates.pack !== undefined) name(gates.pack, 'pack');
  if (gates.model !== undefined) name(gates.model, 'model');
  if (gates.quant !== undefined && (typeof gates.quant !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(gates.quant))) {
    throw new Error('dflash2.quant: expected a lowercase quant id');
  }
  if (gates.engineVersions !== undefined && (!Array.isArray(gates.engineVersions) || !gates.engineVersions.length ||
      gates.engineVersions.some(version => !/^\d+\.\d+\.\d+$/.test(version)))) {
    throw new Error('dflash2.engineVersions: expected a non-empty array of engine versions');
  }
  return gates;
}

export function draftOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid DFlash2 options');
  const defaults = {mode: 'auto', pack: 'stock', window: 6, confidence: 0.8};
  if (Object.keys(value).some(k => !(k in defaults))) throw new Error('Unknown DFlash2 option');
  const result = {...defaults, ...value};
  if (!['auto','manual'].includes(result.mode) || !['stock','tuned'].includes(result.pack) ||
      !Number.isInteger(result.window) || result.window < 2 || result.window > 6 ||
      typeof result.confidence !== 'number' || !Number.isFinite(result.confidence) || result.confidence < 0.05 || result.confidence > 1) throw new Error('Invalid DFlash2 mode/pack/window/confidence');
  return result;
}
export function configureDraft(profile, settings, value) {
  const options = draftOptions(value);
  // Only the dedicated controls own these overrides; preserve all unrelated user arguments.
  const previous = profile.user_args || [];
  const controlled = new Set(['--spec','--draft-conf', ...(settings.drafting === 'dflash2' ? ['--spec-min-p','--mtp-max-t'] : [])]);
  const user = [];
  for (let i = 0; i < previous.length; i++) {
    if (controlled.has(previous[i])) { i++; continue; }
    user.push(previous[i]);
  }
  // Despite its name, this shared limit also prevents DFlash2's suffix path from expanding spec by two.
  if (settings.drafting === 'dflash2' && options.mode === 'manual') user.push('--spec', String(options.window), '--mtp-max-t', String(options.window), '--draft-conf', String(options.confidence));
  if (settings.drafting === 'mtp') user.push('--spec', String(settings.spec), '--spec-min-p', String(settings.specMinP));
  profile.user_args = user;
  profile.drafting = settings.drafting;
  return options;
}
