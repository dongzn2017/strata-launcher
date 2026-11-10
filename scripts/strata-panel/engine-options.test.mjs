import assert from 'node:assert/strict';
import {test} from 'node:test';
import {engineOptionSpecs, engineOptions, engineOverrides} from './engine-options.mjs';
const custom = {routePrior: 'off', kva: 'on', vramFree: 'device'};

test('Missing advanced settings preserve inheritance; only three whitelisted variables can be overridden', () => {
  assert.deepEqual(engineOptions(), {routePrior: 'default', kva: 'default', vramFree: 'default'});
  assert.deepEqual(engineOverrides(), {});
  assert.deepEqual(engineOverrides(custom), {STRATA_ROUTE_PRIOR: '0', STRATA_KVA: '1', STRATA_VRAM_FREE: 'device'});
  assert.deepEqual(engineOverrides({routePrior: 'on', kva: 'off'}), {STRATA_ROUTE_PRIOR: '1.5', STRATA_KVA: '0'});
});

test('Every supported choice combination is accepted; arbitrary env keys and commands are rejected', () => {
  for (const routePrior of engineOptionSpecs[0].values) for (const kva of engineOptionSpecs[1].values) {
    for (const vramFree of engineOptionSpecs[2].values) {
      const value = {routePrior, kva, vramFree};
      assert.deepEqual(engineOptions(value), value);
      assert.ok(Object.values(engineOverrides(value)).every(s => typeof s === 'string'));
    }
  }
  for (const value of [null, false, [], 'device', {STRATA_KVA: '1'}, {PATH: 'bad'},
    {routePrior: '2'}, {routePrior: 0}, {routePrior: 'off;bad'}, {kva: 1}, {kva: null},
    {kva: '$(bad)'}, {vramFree: 'cuda'}, {vramFree: true}]) assert.throws(() => engineOptions(value));
});
