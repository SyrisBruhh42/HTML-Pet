const test = require('node:test');
const assert = require('node:assert/strict');
const GameState = require('../js/state.js');
const Progression = require('../js/progression.js');
global.CONFIG = require('../js/config.js');
const FarmingManager = require('../js/farming.js');
const { EncounterEngine, DiceEngine } = require('../js/combat.js');
const App = require('../js/app.js');
const UIManager = require('../js/ui.js');
const EPOCH = 1792300000000;
const KEY = 'pixel_pet_save_v1';
class MemoryStorage {
  constructor(raw = null) { this.map = new Map(raw === null ? [] : [[KEY, raw]]); this.failRead = false; this.failWrite = false; }
  getItem(key) { if (this.failRead) throw new Error('Storage denied'); return this.map.get(key) ?? null; }
  setItem(key, raw) { if (this.failWrite) throw new Error('Quota exceeded'); this.map.set(key, String(raw)); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}
function fresh(raw = null) {
  const storage = new MemoryStorage(raw);
  const state = new GameState({ storage, writerCheck: () => true, now: () => EPOCH });
  state.load();
  return { state, storage, progression: new Progression(state, CONFIG), farm: new FarmingManager(state) };
}
function legacy() {
  const data = GameState.fresh(EPOCH);
  delete data.schemaVersion; delete data.timing;
  for (const item of Object.values(data.inventory)) delete item.batches;
  for (const plot of data.farmPlots) delete plot.growthSec;
  data.pet.level = 9; data.pet.maxHp = 211; data.pet.hp = 173;
  data.pet.cumulativeFoodQuality = 76; data.pet.wellFedDurationSec = 12345;
  data.pet.requiredQualityForNextLevel = 211;
  data.gold = 793; data.inventory.berry = { count: 17, ageHours: 11 };
  data.farmPlots[0] = { id: 0, state: 'planted', cropId: 'root', plantedAt: EPOCH - 45000 };
  data.equipment = { keepsake: 'preserve future extension data' };
  return data;
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);

test('legacy migration preserves progress, extensions and byte-exact original before first write', () => {
  const raw = JSON.stringify(legacy(), null, 3);
  const { state, storage } = fresh(raw);
  assert.equal(state.data.pet.level, 9); assert.equal(state.data.gold, 793);
  assert.deepEqual(state.data.inventory.berry.batches, [{ count: 17, ageHours: 11 }]);
  assert.equal(state.data.farmPlots[0].growthSec, 45);
  assert.equal(state.data.pet.wellFedDurationSec, 12345);
  assert.equal(state.data.equipment.keepsake, 'preserve future extension data');
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(state.save(), true);
  assert.equal(storage.getItem(state.recoveryKey), raw);
  assert.equal(JSON.parse(storage.getItem(KEY)).schemaVersion, 2);
  const restarted = new GameState({ storage, writerCheck: () => true, now: () => EPOCH });
  assert.equal(restarted.load(), true);
  assert.deepEqual(restarted.data, state.data);
});

test('migration cannot overwrite legacy save when recovery storage fails', () => {
  const raw = JSON.stringify(legacy());
  const { state, storage } = fresh(raw);
  storage.failWrite = true;
  assert.equal(state.save(), false); assert.equal(storage.getItem(KEY), raw);
  assert.equal(state.canPlay, false); assert.equal(state.status.kind, 'save-error');
  storage.failWrite = false;
  assert.equal(state.retry(), true); assert.equal(storage.getItem(state.recoveryKey), raw);
});

test('malformed, future and structurally broken saves stay byte-exact and paused through startup', () => {
  const mutations = [d => { d.farmPlots = null; }, d => { d.pet.hp = 'bad'; }, d => { d.pet.maxHp = 0; },
    d => { d.schemaVersion = 99; }, d => { d.inventory.berry.count = -2; },
    d => { d.farmPlots[1].id = 0; }, d => { d.inventory.berry.batches[0].count = 2; },
    d => { d.lastTimestamp = Infinity; }, d => { d.timing.raidElapsedSec = 90; }];
  const invalid = ['{broken', 'null', '[]', '{}'];
  for (const mutate of mutations) { const d = GameState.fresh(EPOCH); mutate(d); invalid.push(JSON.stringify(d)); }
  for (const raw of invalid) {
    const { state, storage, progression } = fresh(raw);
    let advances = 0;
    const app = { state, ui: { renderHUD() {} }, advance() { advances++; }, progression };
    App.prototype.processOfflineTime.call(app);
    state.save(); state.notify(); progression.advanceTo(EPOCH + 3600000); progression.feed('berry');
    assert.equal(advances, 0); assert.equal(state.canPlay, false);
    assert.equal(storage.getItem(KEY), raw); assert.equal(state.originalRaw, raw);
    assert.equal(state.exportCurrent(), null); assert.match(state.status.message, /not been replaced/);
  }
});

test('read errors never turn into a new game or write attempt', () => {
  const storage = new MemoryStorage('keep me'); storage.failRead = true;
  const state = new GameState({ storage, writerCheck: () => true, now: () => EPOCH });
  assert.equal(state.load(), false); assert.equal(state.save(), false);
  assert.equal(storage.map.get(KEY), 'keep me'); assert.equal(state.loaded, false);
});

test('write failure retains in-memory progress for export and recovers on retry', () => {
  const { state, storage } = fresh(); state.save();
  const previous = storage.getItem(KEY); state.data.gold = 82; storage.failWrite = true;
  assert.equal(state.save(), false); assert.equal(storage.getItem(KEY), previous);
  assert.equal(JSON.parse(state.exportCurrent()).gold, 82);
  storage.failWrite = false; assert.equal(state.retry(), true);
  assert.equal(JSON.parse(storage.getItem(KEY)).gold, 82);
});

test('invalid in-memory state and another tab cannot overwrite last stored progress', () => {
  const { state, storage } = fresh(); state.save(); const old = storage.getItem(KEY);
  state.data.pet.hp = NaN; assert.equal(state.save(), false); assert.equal(storage.getItem(KEY), old);
  state.data.pet.hp = 100;
  const another = GameState.fresh(EPOCH); another.gold = 500;
  storage.setItem(KEY, JSON.stringify(another));
  assert.equal(state.save(), false); assert.equal(state.status.kind, 'conflict');
  assert.equal(JSON.parse(storage.getItem(KEY)).gold, 500);
  assert.equal(state.replace(JSON.stringify(GameState.fresh(EPOCH))), false);
});

test('explicit import preserves original bytes; invalid imports and quota failures leave stored game intact', () => {
  const { state, storage } = fresh(); state.save(); const old = storage.getItem(KEY);
  assert.equal(state.replace('{bad'), false); assert.equal(storage.getItem(KEY), old);
  const imported = GameState.fresh(EPOCH); imported.pet.name = 'Sprout'; imported.gold = 131;
  storage.failWrite = true; assert.equal(state.replace(JSON.stringify(imported)), false);
  assert.equal(storage.getItem(KEY), old); storage.failWrite = false;
  assert.equal(state.replace(JSON.stringify(imported)), true);
  assert.equal(storage.getItem(state.recoveryKey), old); assert.equal(state.data.gold, 131);
});

test('invalid-save new-pet action needs a verified copy, and copies never collide', () => {
  const { state, storage } = fresh('{bad');
  assert.equal(state.replace(JSON.stringify(GameState.fresh(EPOCH))), true);
  assert.equal(storage.getItem(state.recoveryKey), '{bad'); const key = state.recoveryKey;
  assert.equal(state.replace(JSON.stringify(GameState.fresh(EPOCH))), true);
  assert.notEqual(state.recoveryKey, key); assert.equal(storage.getItem(key), '{bad');
});

test('fresh games do not share mutable arrays or pet objects', () => {
  const a = fresh().state, b = fresh().state;
  a.data.inventory.berry.batches[0].count = 2;
  a.data.farmPlots[0].state = 'ready'; a.data.pet.level = 55;
  assert.equal(b.data.inventory.berry.batches[0].count, 3);
  assert.equal(b.data.farmPlots[0].state, 'empty'); assert.equal(b.data.pet.level, 1);
});

test('care credits exactly the eligible part of an interval and pauses rather than resets', () => {
  const { state, progression } = fresh();
  progression.advanceTo(EPOCH + 5 * 3600000);
  near(state.data.pet.wellFedDurationSec, 2.5 * 3600);
  near(state.data.pet.hunger, 80); near(state.data.pet.hp, 95);
  progression.advanceTo(EPOCH + 6 * 3600000);
  near(state.data.pet.wellFedDurationSec, 2.5 * 3600);
});

test('a reachable repeated care sequence earns one permanent benefit, consumes credit and survives restart', () => {
  const { state, progression, farm, storage } = fresh();
  // Repeated two-hour visits: crop -> harvest -> feed. Restore health with earned levels or the existing kit.
  let now = EPOCH;
  state.data.gold = 1000;
  for (let visit = 0; visit < 12; visit++) {
    assert.equal(farm.plantSeed(0, 'berry').success, true);
    now += 2 * 3600000; progression.advanceTo(now);
    assert.equal(farm.harvestPlot(0).success, true);
    if (state.data.pet.hp < state.data.pet.maxHp * .92) {
      state.data.gold -= 30;
      state.data.pet.hp = Math.min(state.data.pet.maxHp, state.data.pet.hp + 30);
    }
    progression.feed('berry');
  }
  assert.ok(state.data.pet.logs === undefined);
  assert.ok(state.data.logs.some(log => log.text.startsWith('Care reward:')));
  near(state.data.pet.wellFedDurationSec, 0);
  const max = state.data.pet.maxHp; const quality = state.data.pet.cumulativeFoodQuality;
  state.save();
  const restart = new GameState({ storage, writerCheck: () => true, now: () => now }); restart.load();
  assert.equal(restart.data.pet.maxHp, max); near(restart.data.pet.cumulativeFoodQuality, quality);
  assert.equal(restart.data.pet.wellFedDurationSec, 0);
});

test('banked care claims only one interval per feed, adds actual maximum HP, and never duplicates', () => {
  const { state, progression } = fresh();
  state.data.pet.wellFedDurationSec = 48 * 3600 + 123;
  state.data.pet.hp = 80; state.data.pet.hunger = 40;
  progression.feed('berry'); assert.equal(state.data.pet.maxHp, 110); assert.equal(state.data.pet.hp, 90);
  assert.equal(state.data.pet.wellFedDurationSec, 24 * 3600 + 123);
  progression.feed('berry'); assert.equal(state.data.pet.maxHp, 120);
  progression.feed('berry'); assert.equal(state.data.pet.maxHp, 120);
  assert.equal(state.data.pet.wellFedDurationSec, 123);
});

test('all earned levels are applied on one feed with leftover quality preserved', () => {
  const { state, progression } = fresh();
  state.data.pet.cumulativeFoodQuality = 500;
  progression.feed('berry');
  assert.equal(state.data.pet.level, 5);
  near(state.data.pet.cumulativeFoodQuality, 51);
  assert.equal(state.data.pet.maxHp, 146);
  assert.ok(state.data.pet.cumulativeFoodQuality < state.data.pet.requiredQualityForNextLevel);
});

test('live and offline stats agree without raids; food ages in both; harvest keeps fresh and old batches', () => {
  const a = fresh(), b = fresh();
  a.farm.plantSeed(0, 'berry'); b.farm.plantSeed(0, 'berry');
  for (let s = 1; s <= 60; s++) a.progression.advanceTo(EPOCH + s * 1000, true);
  b.progression.advanceTo(EPOCH + 60000, false);
  near(a.state.data.pet.hp, b.state.data.pet.hp);
  near(a.state.data.pet.wellFedDurationSec, b.state.data.pet.wellFedDurationSec);
  near(a.state.data.inventory.berry.ageHours, 1 / 60);
  a.farm.harvestPlot(0);
  assert.equal(a.state.data.inventory.berry.batches.length, 2);
  assert.equal(a.state.data.inventory.berry.batches[1].ageHours, 0);
  for (let i = 0; i < 3; i++) a.progression.feed('berry');
  assert.equal(a.progression.foodQuality('berry'), 15);
});

test('backward clocks do not reverse decay, grow crops or replay elapsed time', () => {
  const { state, progression, farm } = fresh(); farm.plantSeed(0, 'berry');
  const before = JSON.stringify(state.data);
  assert.equal(progression.advanceTo(EPOCH - 3600000, true).clockBackwards, true);
  assert.equal(JSON.stringify(state.data), before);
  progression.advanceTo(EPOCH + 10000);
  const once = JSON.stringify(state.data);
  progression.advanceTo(EPOCH - 10); progression.advanceTo(EPOCH + 10000);
  assert.equal(JSON.stringify(state.data), once);
  assert.equal(state.data.farmPlots[0].growthSec, 10);
});

test('away time matures crops and ages food but never queues raids or removes earned levels/care', () => {
  const { state, progression, farm } = fresh(); farm.plantSeed(0, 'crystal');
  state.data.pet.level = 7; state.data.pet.wellFedDurationSec = 100;
  state.data.timing.raidElapsedSec = 89;
  let raids = 0;
  progression.advanceTo(EPOCH + 365 * 24 * 3600000, true, () => raids++);
  assert.equal(raids, 0); assert.equal(state.data.timing.raidElapsedSec, 89);
  assert.equal(state.data.farmPlots[0].state, 'ready');
  assert.equal(state.data.pet.hp, 1); assert.equal(state.data.pet.hunger, 0);
  assert.equal(state.data.pet.level, 7); assert.ok(state.data.pet.wellFedDurationSec >= 100);
  progression.advanceTo(state.data.lastTimestamp + 2000, true, () => raids++);
  assert.equal(raids, 1); assert.equal(state.data.timing.raidElapsedSec, 1);
});

test('raid phase and fractional elapsed remainder survive saving and restart', () => {
  const { state, progression, storage } = fresh(); state.data.timing.raidElapsedSec = 89.5;
  let raids = 0; progression.advanceTo(EPOCH + 2250, true, () => raids++);
  assert.equal(raids, 1); assert.equal(state.data.timing.raidElapsedSec, 1.75); state.save();
  const restarted = new GameState({ storage, writerCheck: () => true, now: () => EPOCH + 2250 }); restarted.load();
  assert.equal(restarted.data.timing.raidElapsedSec, 1.75);
});

test('raids preserve positive life and invalid-save pause blocks farming and combat mutations', () => {
  const { state, farm } = fresh(); const engine = new EncounterEngine(state);
  const roll = DiceEngine.roll;
  const random = Math.random;
  try {
    Math.random = () => 0; // A natural 1 must fail even against the easiest threat.
    DiceEngine.roll = () => ({ total: 1, rolls: [1] }); state.data.pet.hp = 3;
    engine.triggerRaid(); assert.equal(state.data.pet.hp, 1);
    engine.triggerRaid(); assert.equal(state.data.pet.hp, 1);
    state.canPlay = false; const before = JSON.stringify(state.data);
    assert.equal(farm.plantSeed(0, 'berry'), false); assert.equal(engine.triggerRaid(), null);
    assert.equal(JSON.stringify(state.data), before);
  } finally { DiceEngine.roll = roll; Math.random = random; }
});

test('saved log payloads are rendered as text, not markup', () => {
  const created = [];
  global.document = {
    createElement(tag) { const e = { tag, children: [], append(...items) { this.children.push(...items); } }; created.push(e); return e; },
    createTextNode(text) { return { text }; }
  };
  try {
    const payload = '<img src=x onerror=alert(1)>';
    const target = { innerHTML: '', entries: [], appendChild(e) { this.entries.push(e); } };
    UIManager.prototype.renderLog.call({ state: { data: { logs: [{ timestamp: payload, text: payload, type: 'win' }] } }, combatLog: target });
    assert.equal(created[0].innerHTML, undefined);
    assert.equal(created[1].textContent, `[${payload}] `);
    assert.equal(target.entries[0].children[1].text, payload);
  } finally { delete global.document; }
});

test('very small imported maximum health still grows strictly and a billion quality resolves promptly', () => {
  const { state, progression } = fresh();
  state.data.pet.maxHp = state.data.pet.hp = 1;
  state.data.pet.requiredQualityForNextLevel = 1;
  state.data.pet.cumulativeFoodQuality = 1e9;
  assert.doesNotThrow(() => GameState.decode(JSON.stringify(state.data), EPOCH));
  const start = performance.now();
  assert.equal(progression.feed('berry'), true);
  assert.ok(performance.now() - start < 250);
  assert.ok(state.data.pet.level < 512);
  assert.ok(state.data.pet.maxHp > 1);
  assert.ok(state.data.pet.cumulativeFoodQuality < state.data.pet.requiredQualityForNextLevel);
  assert.doesNotThrow(() => GameState.decode(state.exportCurrent(), EPOCH));
});

test('numeric-limit care and quality do not consume food or corrupt exportable progress', () => {
  for (const kind of ['care', 'quality']) {
    const { state, progression } = fresh();
    if (kind === 'care') {
      state.data.pet.maxHp = Number.MAX_SAFE_INTEGER;
      state.data.pet.wellFedDurationSec = 24 * 3600;
    } else state.data.pet.cumulativeFoodQuality = Number.MAX_SAFE_INTEGER;
    const before = state.exportCurrent();
    assert.equal(progression.feed('berry'), false);
    assert.equal(state.exportCurrent(), before);
    assert.equal(state.status.kind, 'progress-limit');
    assert.doesNotThrow(() => GameState.decode(state.exportCurrent(), EPOCH));
  }
});

test('a missing or lost exclusive writer lease permits reading/export but blocks every storage mutation', () => {
  const raw = JSON.stringify(GameState.fresh(EPOCH));
  const storage = new MemoryStorage(raw); let ownsLease = false;
  const state = new GameState({ storage, now: () => EPOCH, writerCheck: () => ownsLease });
  state.load(); assert.equal(state.canPlay, false); assert.equal(state.loaded, true);
  assert.equal(state.save(), false); assert.equal(state.replace(raw), false);
  assert.equal(storage.getItem(KEY), raw); assert.equal(storage.length, 1);
  ownsLease = true; state.load(); state.data.gold = 77; assert.equal(state.save(), true);
  ownsLease = false; state.data.gold = 88; assert.equal(state.save(), false);
  assert.equal(JSON.parse(storage.getItem(KEY)).gold, 77);
  assert.equal(JSON.parse(state.exportCurrent()).gold, 88);
});

test('the default storage API is read-only without an explicit writer lease', () => {
  const storage = new MemoryStorage(JSON.stringify(GameState.fresh(EPOCH)));
  const state = new GameState({ storage, now: () => EPOCH });
  state.load();
  assert.equal(state.canPlay, false);
  assert.equal(state.save(), false);
  assert.equal(storage.length, 1);
  assert.equal(JSON.parse(state.exportCurrent()).gold, 50);
});

test('full food capacity never spends a harvest or makes the current save unimportable', () => {
  const { state, farm } = fresh();
  state.data.inventory.berry = { count: Number.MAX_SAFE_INTEGER, ageHours: 0, batches: [{ count: Number.MAX_SAFE_INTEGER, ageHours: 0 }] };
  state.data.farmPlots[0] = { id: 0, state: 'ready', cropId: 'berry', plantedAt: EPOCH, growthSec: 30 };
  const before = state.exportCurrent();
  assert.equal(farm.harvestPlot(0).success, false);
  assert.equal(state.exportCurrent(), before);
  assert.doesNotThrow(() => GameState.decode(state.exportCurrent(), EPOCH));
});

test('level, size and health limits abort the whole feeding before spending progress', () => {
  for (const field of ['level', 'scale', 'maxHp']) {
    const { state, progression } = fresh();
    state.data.pet[field] = Number.MAX_SAFE_INTEGER;
    state.data.pet.cumulativeFoodQuality = 100;
    const before = state.exportCurrent();
    assert.equal(progression.feed('berry'), false);
    assert.equal(state.exportCurrent(), before);
    assert.doesNotThrow(() => GameState.decode(state.exportCurrent(), EPOCH));
  }
});

test('currency and time counters refuse overflow without lossy clamps', () => {
  const { state, progression } = fresh();
  state.data.gold = Number.MAX_SAFE_INTEGER;
  const originalRoll = DiceEngine.roll;
  try {
    DiceEngine.roll = () => ({total:20,rolls:[20]});
    const before = state.exportCurrent();
    assert.equal(new EncounterEngine(state).triggerRaid(), null);
    assert.equal(state.exportCurrent(), before);
  } finally { DiceEngine.roll = originalRoll; }
  for (const field of ['care', 'age']) {
    state.canPlay = true;
    state.data.pet.wellFedDurationSec = field === 'care' ? Number.MAX_SAFE_INTEGER : 0;
    state.data.inventory.berry.batches[0].ageHours = field === 'age' ? Number.MAX_SAFE_INTEGER : 0;
    state.data.inventory.berry.ageHours = state.data.inventory.berry.batches[0].ageHours;
    const before = state.exportCurrent();
    assert.equal(progression.advanceTo(EPOCH + 3600000).seconds, 0);
    assert.equal(state.exportCurrent(), before);
    assert.doesNotThrow(() => GameState.decode(state.exportCurrent(), EPOCH));
  }
});

test('a late writer grant after pagehide cannot load or save, and the restored page can acquire', async () => {
  const requests = [];
  global.navigator = { locks: { request(name, options, callback) {
    let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;});
    requests.push({ callback, resolve, reject }); return promise;
  } } };
  const { state, storage } = fresh();
  const app = { state, sessionGeneration: 0, writerLease: false, processOfflineTime() { state.save(); } };
  state.writerCheck = () => app.writerLease;
  try {
    App.prototype.openSession.call(app);
    // pagehide invalidates the generation before the asynchronous lock grant arrives.
    app.sessionGeneration += 1; app.writerLease = false; state.canPlay = false;
    await requests[0].callback({ name: 'late grant' }); requests[0].resolve();
    assert.equal(state.canPlay, false); assert.equal(app.writerLease, false);
    assert.equal(storage.getItem(KEY), null);
    App.prototype.openSession.call(app);
    const held = requests[1].callback({ name: 'restored grant' });
    assert.equal(app.writerLease, true); assert.equal(state.canPlay, true);
    assert.equal(JSON.parse(storage.getItem(KEY)).gold, 50);
    app.sessionGeneration += 1; app.writerLease = false; state.canPlay = false;
    app.releaseWriter(); await held; requests[1].resolve();
    assert.equal(app.writerLease, false);
  } finally { delete global.navigator; }
});
