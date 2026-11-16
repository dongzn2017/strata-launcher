import fs from 'node:fs';
export const resourceApps = JSON.parse(fs.readFileSync(new URL('./resource-apps.json', import.meta.url), 'utf8'));
export function resourceOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid resource optimization options');
  const defaults = {beforeModelStart: false, reduceVisuals: false, restoreOnClose: true, forceApps: false, apps: []};
  if (Object.keys(value).some(k => !(k in defaults))) throw new Error('Unknown resource optimization option');
  const result = {...defaults, ...value};
  for (const key of ['beforeModelStart', 'reduceVisuals', 'restoreOnClose', 'forceApps']) {
    if (typeof result[key] !== 'boolean') throw new Error(`resourceOptimization.${key}: expected boolean`);
  }
  if (!Array.isArray(result.apps) || result.apps.some(id => !resourceApps.some(app => app.id === id))) throw new Error('Unknown resource optimization application');
  return {...result, apps: [...new Set(result.apps)]};
}
