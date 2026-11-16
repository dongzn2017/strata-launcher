// Optional native overrides. "default" omits the environment/flag instead of guessing its value.
export const deepseekOptionSpecs = [
  {key: 'engramCacheMiB', env: 'DS4_ENGRAM_CACHE_MB', values: ['default', '0', '128', '256', '512', '1024', '2048']},
  {key: 'engramThreads', env: 'DS4_ENGRAM_THREADS', values: ['default', '2', '4', '6', '8', '12', '16', '32', '64']},
  {key: 'storeThreads', env: 'DS4_STORE_THREADS', values: ['default', '2', '4', '8', '12', '16']},
  {key: 'storeFloorGiB', env: 'DS4_STORE_FLOOR_GB', values: ['default', '8', '10', '12', '16']},
  {key: 'prefillChunk', flag: '--prefill-chunk', values: ['default', '256', '512', '1024', '2048', '4096', '8192']},
];

export function deepseekOptions(settings = {}) {
  return Object.fromEntries(deepseekOptionSpecs.map(({key, values}) => {
    const value = settings[key] === undefined ? 'default' : settings[key];
    if (!values.includes(value)) throw new Error(`DeepSeek ${key}: expected ${values.join(', ')}`);
    return [key, value];
  }));
}

export function deepseekEnvironment(settings) {
  const options = deepseekOptions(settings);
  return Object.fromEntries(deepseekOptionSpecs.filter(s => s.env && options[s.key] !== 'default')
    .map(s => [s.env, options[s.key]]));
}
