import {extraEngineOptionSpecs} from './engine-extra-options.mjs';

export const engineOptionSpecs = [
  {key: 'routePrior', env: 'STRATA_ROUTE_PRIOR', values: ['default', 'off', 'on'], group: '路由与质量', label: '偏向显存中已有专家', risk: '改变路由/质量',
    hint: 'off 写入 0；on 写入 1.5，偏向 GPU 已缓存专家以提速，长 Agent 会话可能重复和能力下降。继承不等于关闭；它和 tail skip 完全独立。'},
  {key: 'kva', env: 'STRATA_KVA', values: ['default', 'off', 'on'], group: '路由与质量', label: 'KVA 长上下文近似加速', risk: '近似计算',
    hint: 'on 写入 1；off 写入 0。通过近似部分注意力工作加快长提示，可能漏掉或混淆长文细节。不是 KV 精度 k8v4。'},
  {key: 'vramFree', env: 'STRATA_VRAM_FREE', values: ['default', 'device'], group: '提示 / KV', label: '显存空闲量探测来源', risk: '资源/性能',
    hint: 'device 尝试按设备/NVML 空闲量进行预算；具体回退和最终可分配量以启动日志为准。不会绕过 WDDM，也不保证所有空闲显存都能分配。'},
  ...extraEngineOptionSpecs,
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
  for (const spec of extraEngineOptionSpecs) {
    if (spec.env && options[spec.key] !== 'default') env[spec.env] = options[spec.key];
  }
  return env;
}

export function explicitEngineOptions(value) {
  return Object.fromEntries(Object.entries(engineOptions(value)).filter(([, v]) => v !== 'default'));
}

export function engineOptionIdentity(value) {
  const selected = explicitEngineOptions(value);
  if (!Object.keys(selected).length) return {};
  // Preserve old three-field fingerprints; only explicit new fields enter the identity.
  return {engineOptions: {routePrior: 'default', kva: 'default', vramFree: 'default', ...selected}};
}

export function applyEngineOptions(profile, value, learningEnabled = false) {
  const options = engineOptions(value);
  if (learningEnabled && ['adaptEvery', 'adaptSwaps'].some(key => options[key] === '0')) {
    throw new Error('Routing learning requires nonzero adaptEvery and adaptSwaps');
  }
  if (options.adaptOverlap === '1' && (options.adaptAsync === '1' ||
      (options.adaptAsync === 'default' && (profile.env?.STRATA_ADAPT_ASYNC === '1' ||
        [...(profile.args || []), ...(profile.user_args || [])].some((arg, i, args) => arg === '--adapt-async' && args[i + 1] === '1'))))) {
    throw new Error('adaptOverlap cannot be combined with adaptAsync=1');
  }
  if (options.adaptOverlap === '1' && (['STRATA_ADAPT_LAG','STRATA_ADAPT_NOWAIT','STRATA_DMA_BATCH']
    .some(key => profile.env?.[key] !== undefined && profile.env[key] !== '0') ||
    [...(profile.args || []), ...(profile.user_args || [])].includes('--pipeline-windows'))) {
    throw new Error('adaptOverlap conflicts with pipeline/lag/nowait/DMA overrides');
  }
  for (const spec of engineOptionSpecs.filter(s => s.flag && options[s.key] !== 'default')) {
    for (const field of ['args', 'user_args']) {
      const prior = profile[field] || [], next = [];
      for (let i = 0; i < prior.length; i++) {
        if (prior[i] === spec.flag) { if (!spec.booleanFlag) i++; }
        else next.push(prior[i]);
      }
      profile[field] = next;
    }
    if (spec.booleanFlag) {
      if (options[spec.key] === 'on') profile.user_args.push(spec.flag);
    } else profile.user_args.push(spec.flag, options[spec.key]);
  }
  profile.env = {...profile.env, ...engineOverrides(options)};
}

export function inheritedEngineOptions(profile, environment = process.env) {
  return Object.fromEntries(engineOptionSpecs.map(spec => {
    if (spec.env) {
      const fromProfile = profile.env?.[spec.env];
      return [spec.key, fromProfile !== undefined ? `profile: ${fromProfile}` :
        environment[spec.env] !== undefined ? `process env: ${environment[spec.env]}` : 'engine auto / startup log'];
    }
    for (const [name, args] of [['user_args', profile.user_args || []], ['args', profile.args || []]]) {
      const index = args.lastIndexOf(spec.flag);
      if (index >= 0) return [spec.key, `${name}: ${spec.booleanFlag ? 'on' : args[index + 1]}`];
    }
    return [spec.key, 'engine auto / startup log'];
  }));
}
