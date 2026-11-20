import {configFile, loadConfig} from '../launcher.mjs';
import {configurationSnapshot, updateProfileFields} from '../scripts/parameters.mjs';
import {check, read, settingLimits} from '../scripts/strata-panel/core.mjs';
import {engineOptionSpecs, inheritedEngineOptions} from '../scripts/strata-panel/engine-options.mjs';
import {samplingDefaults} from '../scripts/strata-panel/sampling.mjs';

const schema = read(new URL('../conf/launcher.schema.json', import.meta.url)).$defs;
const specs = {
  settings: schema.settings.properties,
  sampling: schema.sampling.properties,
  draftOptions: schema.draftOptions.properties,
  learning: schema.learning.properties,
  engineOptions: Object.fromEntries(engineOptionSpecs.map(({key, values}) => [key, {enum: values}])),
};
const object = value => value && typeof value === 'object' && !Array.isArray(value);
export const httpError = (status, message) => Object.assign(new Error(message), {status});

function select(config, id) {
  const {profiles, deployment} = loadConfig(config);
  const profile = profiles.find(p => p.id === id);
  if (!profile) throw httpError(404, 'Unknown model profile');
  return {profile, deployment};
}

export function tuningOptions(id) {
  const {config,revision} = configurationSnapshot(configFile);
  const {profile,deployment} = select(config,id);
  const current = check(profile,deployment);
  const settingsSpec = {...specs.settings};
  for (const [key,[minimum,maximum,integer]] of Object.entries(settingLimits(profile.limits))) {
    settingsSpec[key] = {type: integer ? 'integer' : 'number', minimum, maximum};
  }
  const {enabled,reuse,scope,saveEveryMinutes} = current.routing.metadata;
  // Read inherited options from the original profile, not check()'s applied overrides.
  const inherited = inheritedEngineOptions(read(profile.profile));
  const sampling = {thinking: samplingDefaults({effort:'medium',thinking:1},current.profile.sampling),
    withoutThinking: samplingDefaults({effort:'off',thinking:0},current.profile.sampling)};
  return {profile: id, revision, vision: current.vision, specs: {...specs,settings: settingsSpec},
    engineOptions: engineOptionSpecs, inherited, samplingDefaults: sampling,
    values: {settings: current.settings, sampling: current.sampling, draftOptions: current.drafting,
      learning: {enabled,reuse,scope,saveEveryMinutes}, engineOptions: current.advanced}};
}

function validateChanges(changes) {
  if (!object(changes) || !Object.keys(changes).length) throw httpError(400, 'No parameter changes supplied');
  for (const [section, fields] of Object.entries(changes)) {
    if (!Object.hasOwn(specs,section) || !object(fields) || !Object.keys(fields).length) {
      throw httpError(400, 'Unsupported parameter section: '+section);
    }
    for (const [key,value] of Object.entries(fields)) {
      if (!Object.hasOwn(specs[section],key)) throw httpError(400, 'Unsupported parameter: '+section+'.'+key);
      const spec = specs[section][key];
      const types = [spec.type].flat();
      const allowed = spec.enum ? spec.enum.includes(value)
        : types.includes('boolean') ? typeof value === 'boolean'
        : value === null ? types.includes('null')
        : Number.isFinite(value) && (!types.includes('integer') || Number.isInteger(value)) &&
          (section === 'settings' || (value >= (spec.minimum ?? -Infinity) && value <= (spec.maximum ?? Infinity)));
      if (!allowed) throw httpError(422, 'Invalid value for '+section+'.'+key);
    }
  }
}

export function saveTuning(id, body) {
  if (!object(body) || typeof body.revision!=='string' || !/^[a-f0-9]{64}$/.test(body.revision) ||
      Object.keys(body).some(key=>!['revision','changes'].includes(key))) throw httpError(400,'A configuration revision and parameter changes are required');
  validateChanges(body.changes);
  try {
    return updateProfileFields(configFile,id,body.changes,(config,selected)=>{
      const {profile,deployment}=select(config,selected);
      try { check(profile,deployment); } catch(error) { throw httpError(422,error.message); }
    },{expectedRevision:body.revision});
  } catch (error) {
    if (error.code==='CONFIG_CONFLICT') throw httpError(409,'配置已被修改，请重新读取参数后再保存。');
    if (error.code==='EEXIST') throw httpError(409,'配置正在使用，请稍后重新读取；不要删除配置锁。');
    throw error;
  }
}
