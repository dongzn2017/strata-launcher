import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resourceOptions, resourceApps} from './resource-options.mjs';

test('resource defaults are opt-in and application identifiers are a closed allowlist', () => {
  assert.deepEqual(resourceOptions(), {beforeModelStart: false, reduceVisuals: false, restoreOnClose: true, forceApps: false, apps: []});
  assert.deepEqual(resourceOptions({apps: ['chrome', 'chrome']}).apps, ['chrome']);
  assert.equal(resourceOptions({forceApps:true}).forceApps,true);
  for (const value of [{apps: ['node']}, {apps: ['Codex']}, {apps: 'chrome'}, {force: true}, {forceApps:'true'}, {reduceVisuals: 'true'}]) assert.throws(() => resourceOptions(value));
  assert.ok(resourceApps.every(a => !['node', 'python', 'ffmpeg', 'explorer', 'dwm', 'Codex', 'powershell'].includes(a.process)));
});
test('GPU scan and desktop shell controls are read-only or confirmed, with mocked OS effects', {skip: process.platform !== 'win32'}, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./ResourceGpuDesktop.test.ps1', import.meta.url))], {encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(result.status,0,result.stderr+result.stdout);
  assert.match(result.stdout,/RESOURCE_GPU_DESKTOP_TEST_OK/);
});
test('native optimization backs up, conditionally restores, and validates all targets before effects', {skip: process.platform !== 'win32'}, () => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', fileURLToPath(new URL('./ResourceOptimization.test.ps1', import.meta.url))], {encoding: 'utf8', windowsHide: true, timeout: 15000});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESOURCE_NATIVE_TEST_OK/);
});
