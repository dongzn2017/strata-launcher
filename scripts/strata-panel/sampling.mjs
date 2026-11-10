export const samplingSpecs = [
  ['temperature', 0, 2, 0.05, 2],
  ['top_p', 0.01, 1, 0.01, 2],
  ['top_k', 1, 64, 1, 0],
  ['min_p', 0, 1, 0.01, 2],
  ['repetition_penalty', 0.1, 2, 0.05, 2],
  ['presence_penalty', 0, 2, 0.05, 2],
  ['frequency_penalty', 0, 2, 0.05, 2],
  ['penalty_last_n', 1, 131072, 64, 0],
];

export function samplingDefaults(settings = {}, configured = {}) {
  const thinking = settings.effort !== 'off' && settings.thinking !== 0;
  const defaults = {temperature: thinking ? 1 : 0.7, top_p: thinking ? 0.95 : 0.8,
    top_k: 20, min_p: 0, repetition_penalty: 1, presence_penalty: thinking ? 0 : 1.5,
    frequency_penalty: 0, penalty_last_n: 64, seed: null};
  const source = {...configured};
  if (source.repetition_penalty === undefined) source.repetition_penalty = source.repeat_penalty;
  if (source.penalty_last_n === undefined) source.penalty_last_n = source.repeat_last_n;
  for (const key of Object.keys(defaults)) if (source[key] !== undefined && source[key] !== null) defaults[key] = source[key];
  return defaults;
}

export function samplingOptions(value, defaults = samplingDefaults()) {
  if (value === undefined) return {mode: 'model'};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sampling must be an object');
  const allowed = new Set(['mode', 'seed', ...samplingSpecs.map(s => s[0])]);
  if (Object.keys(value).some(key => !allowed.has(key))) throw new Error('Unknown sampling setting');
  if (!['model', 'custom'].includes(value.mode)) throw new Error('Choose model or custom sampling');
  if (value.mode === 'model') return {mode: 'model'};
  const options = {mode: 'custom', ...defaults, ...value};
  for (const [key, low, high, , decimals] of samplingSpecs) {
    const n = options[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < low || n > high || (!decimals && !Number.isInteger(n))) {
      throw new Error(`sampling.${key}: expected ${decimals ? 'number' : 'integer'} ${low}..${high}`);
    }
  }
  if (options.seed !== null && (!Number.isInteger(options.seed) || options.seed < 1 || options.seed > 2147483647)) {
    throw new Error('sampling.seed: expected null (random) or integer 1..2147483647');
  }
  return options;
}

export function samplingFields(value, {request = false} = {}) {
  const options = samplingOptions(value);
  if (options.mode === 'model') return {};
  const {mode, seed, ...fields} = options;
  // Strata accepts seed=0 on requests as unset; this also overrides a shared fixed seed.
  if (seed !== null || request) fields.seed = seed ?? 0;
  return fields;
}
