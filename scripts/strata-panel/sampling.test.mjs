import assert from 'node:assert/strict';
import {test} from 'node:test';
import {samplingDefaults, samplingOptions, samplingFields, samplingSpecs} from './sampling.mjs';
const custom = samplingOptions({mode: 'custom', temperature: 0.7});

test('Automatic sampling preserves the model defaults; thinking and temperature are independent', () => {
  assert.deepEqual(samplingOptions(), {mode: 'model'});
  assert.deepEqual(samplingFields({mode: 'model'}), {});
  assert.equal(samplingDefaults().temperature, 1);
  assert.equal(samplingDefaults({thinking: 0}).temperature, 0.7);
  assert.equal(samplingDefaults({effort: 'off'}).presence_penalty, 1.5);
  assert.equal(samplingOptions({mode: 'custom', temperature: 0}).temperature, 0);
  assert.equal(custom.temperature, 0.7);
  assert.equal(custom.min_p, 0);
  assert.equal(custom.repetition_penalty, 1);
});

test('All numeric limits, optional seeds and unsupported sampling keys are validated', () => {
  for (const [key, low, high] of samplingSpecs) for (const value of [low, high]) {
    assert.equal(samplingOptions({...custom, [key]: value})[key], value);
  }
  for (const seed of [null, 1, 2147483647]) assert.equal(samplingOptions({...custom, seed}).seed, seed);
  for (const value of [null, [], false, 'custom', {}, {mode: 'other'}, {mode: 'model', eval: 'bad'}]) {
    assert.throws(() => samplingOptions(value));
  }
  for (const delta of [{temperature: -0.1}, {temperature: 2.01}, {temperature: '0.7'}, {temperature: NaN},
    {top_p: 0}, {top_p: 1.01}, {top_k: 20.5}, {top_k: 65}, {min_p: -0.01}, {min_p: Infinity},
    {repetition_penalty: 0}, {presence_penalty: -1}, {frequency_penalty: true}, {penalty_last_n: 0},
    {penalty_last_n: 64.5}, {seed: 0}, {seed: -1}, {seed: 1.5}, {seed: 2147483648}, {seed: '42'}]) {
    assert.throws(() => samplingOptions({...custom, ...delta}));
  }
});
