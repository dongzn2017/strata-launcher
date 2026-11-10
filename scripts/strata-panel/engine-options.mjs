export const engineOptionSpecs = [
  {key: 'routePrior', env: 'STRATA_ROUTE_PRIOR', values: ['default', 'off', 'on']},
  {key: 'kva', env: 'STRATA_KVA', values: ['default', 'off', 'on']},
  {key: 'vramFree', env: 'STRATA_VRAM_FREE', values: ['default', 'device']},
];

export function engineOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Engine options must be an object');
  if (Object.keys(value).some(key => !engineOptionSpecs.some(s => s.key === key))) throw new Error('Unknown engine option');
  return Object.fromEntries(engineOptionSpecs.map(({key, values}) => {
    const selected = value[key] === undefined ? 'default' : value[key];
    if (!values.includes(selected)) throw new Error(`engineOptions.${key}: expected ${values.join(', ')}`);
    return [key, selected];
  }));
}

export function engineOverrides(value) {
  const options = engineOptions(value);
  const env = {};
  if (options.routePrior !== 'default') env.STRATA_ROUTE_PRIOR = options.routePrior === 'off' ? '0' : '1.5';
  if (options.kva !== 'default') env.STRATA_KVA = options.kva === 'off' ? '0' : '1';
  if (options.vramFree === 'device') env.STRATA_VRAM_FREE = 'device';
  return env;
}
