import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {learningOptions, modelIdentity, planLearning, routingProfile} from './learning.mjs';

const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'strata-panel-learning-test-'));
const baseFile = path.join(folder, 'base.bin'), storeRoot = path.join(folder, 'learning');
function profile(order = [0, 1, 2, 3]) {
  const bytes = Buffer.alloc(24 + order.length * 4 + 16);
  bytes.write('STRP');
  [1, 2, 2, order.length, order.length].forEach((n, i) => bytes.writeUInt32LE(n, 4 + 4 * i));
  order.forEach((n, i) => { bytes.writeUInt16LE(Math.floor(n / 2), 24 + 4 * i); bytes.writeUInt16LE(n % 2, 26 + 4 * i); });
  return bytes;
}
fs.writeFileSync(baseFile, profile());
const identity = {model: 'fixture-q3xl', vision: false, engineVersion: '0.1.50'};
const plan = options => planLearning({baseFile, storeRoot, identity, options});

test('Learning options whitelist booleans, scopes and bounded integer intervals', () => {
  assert.equal(learningOptions().enabled, false); // Legacy callers remain opt-in.
  for (const options of [{enabled: 'true'}, {reuse: 1}, {scope: '../other'}, {scope: '$(bad)'},
    {saveEveryMinutes: 0}, {saveEveryMinutes: 61}, {saveEveryMinutes: 1.5}]) assert.throws(() => learningOptions(options));
});
test('Learning begins from a validated base without modifying it; next run uses saved bytes', () => {
  const first = plan({enabled: true});
  assert.equal(first.metadata.selected, 'base');
  fs.mkdirSync(path.dirname(first.metadata.savePath), {recursive: true});
  fs.writeFileSync(first.metadata.savePath, profile([3, 2, 1, 0]));
  const second = plan({enabled: true});
  assert.equal(second.metadata.selected, 'learned');
  assert.deepEqual(second.bytes, profile([3, 2, 1, 0]));
  assert.notEqual(second.metadata.snapshotHash, second.metadata.baseHash);
  assert.deepEqual(fs.readFileSync(baseFile), profile());
  assert.equal(plan({enabled: false}).metadata.selected, 'base');
  assert.equal(plan({enabled: false}).metadata.savePath, null);
  assert.equal(plan({enabled: true, reuse: false}).metadata.selected, 'base');
  assert.deepEqual(fs.readFileSync(first.metadata.savePath), profile([3, 2, 1, 0]));
});
test('Different models, modality, engine version, base profile and workload cannot share learned routing', () => {
  const first = plan({enabled: true});
  const paths = [first.metadata.savePath, plan({enabled: true, scope: 'video'}).metadata.savePath,
    plan({enabled: true, scope: 'coding'}).metadata.savePath];
  for (const delta of [{model: 'fixture-iq3s'}, {vision: true}, {engineVersion: 'other'}]) {
    paths.push(planLearning({baseFile, storeRoot, identity: {...identity, ...delta}, options: {enabled: true}}).metadata.savePath);
  }
  const other = path.join(folder, 'other.bin'); fs.writeFileSync(other, profile([1, 0, 3, 2]));
  paths.push(planLearning({baseFile: other, storeRoot, identity, options: {enabled: true}}).metadata.savePath);
  assert.equal(new Set(paths).size, paths.length);
});
test('Malformed, truncated, wrong-shape and duplicate learned profiles fall back to the base', () => {
  const target = plan({enabled: true}).metadata.savePath;
  const wrongShape = profile(); wrongShape.writeUInt32LE(4, 8); wrongShape.writeUInt32LE(1, 12);
  for (const bytes of [Buffer.from('broken'), profile().subarray(0, 40), profile([0, 0, 2, 3]),
    profile([0, 1]), profile([0, 1, 2, 8]), wrongShape]) {
    fs.writeFileSync(target, bytes);
    const result = plan({enabled: true});
    assert.equal(result.metadata.selected, 'base'); assert.match(result.metadata.warning, /rejected/);
    assert.deepEqual(result.bytes, profile());
  }
  const original = fs.readFileSync(baseFile);
  fs.writeFileSync(baseFile, 'bad');
  try { assert.throws(() => routingProfile(baseFile)); } finally { fs.writeFileSync(baseFile, original); }
});
test('Model identity records all GGUF shards cheaply, and detects file or pack-index replacement', () => {
  const native = path.join(folder, 'model-00001-of-00002.gguf'), second = native.replace('00001-of', '00002-of');
  const pack = path.join(folder, 'pack'); fs.mkdirSync(pack);
  fs.writeFileSync(native, 'part1'); fs.writeFileSync(second, 'part2'); fs.writeFileSync(path.join(pack, 'index.txt'), 'index1');
  const cfg = {args: ['--native', native, '--pack', pack]};
  const before = modelIdentity(cfg, '0.1.50');
  assert.equal(before.files.length, 3);
  fs.writeFileSync(second, 'replacement longer');
  assert.notDeepEqual(modelIdentity(cfg, '0.1.50'), before);
  const next = modelIdentity(cfg, '0.1.50');
  fs.writeFileSync(path.join(pack, 'index.txt'), 'index2');
  assert.notDeepEqual(modelIdentity(cfg, '0.1.50'), next);
});
test.after(() => {
  assert.equal(path.dirname(folder), os.tmpdir());
  assert.ok(path.basename(folder).startsWith('strata-panel-learning-test-'));
  fs.rmSync(folder, {recursive: true});
});
