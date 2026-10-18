const test = require('node:test');
const assert = require('node:assert/strict');
global.CONFIG = require('../js/config.js');
const GameState = require('../js/state.js');
const Upgrades = require('../js/upgrades.js');
const Progression = require('../js/progression.js');
const FarmingManager = require('../js/farming.js');
const { EncounterEngine, DiceEngine } = require('../js/combat.js');
const Renderer = require('../js/renderer.js');
const epoch = 1792350000000;
class Storage {
  constructor() { this.items = new Map(); }
  getItem(k) { return this.items.get(k) ?? null; }
  setItem(k, v) { if (this.fail) throw new Error('quota'); this.items.set(k, String(v)); }
  get length() { return this.items.size; }
  key(i) { return [...this.items.keys()][i]; }
}
function fixture(raw) {
  const storage = new Storage();
  if (raw) storage.setItem('pixel_pet_save_v1', raw);
  const state = new GameState({ storage, now: () => epoch, writerCheck: () => true });
  state.load();
  return { state, storage, shop: new Upgrades(state) };
}
function nextLoad(storage) {
  const state = new GameState({ storage, now: () => epoch, writerCheck: () => true });
  state.load(); return state;
}

test('old version-2 save has no invented ownership and preserves unrelated equipment fields', () => {
  const data = GameState.fresh(epoch); delete data.equipmentLoadout;
  data.equipment = { historical: 'retain exactly' }; data.gold = 350;
  const { state, shop, storage } = fixture(JSON.stringify(data));
  assert.equal(state.canPlay, true); assert.equal(Upgrades.defenseBonus(state.data), 0);
  assert.equal(shop.buyEquipment('leaf').success, true);
  assert.equal(state.data.gold, 290); assert.equal(state.data.equipmentLoadout.equipped, null);
  assert.deepEqual(nextLoad(storage).data.equipment, data.equipment);
});

test('purchase, equip, restart and removal retain paid ownership and all care progress', () => {
  const { state, shop, storage } = fixture(); state.data.gold = 500; state.data.pet.level = 5;
  state.data.pet.wellFedDurationSec = 86400;
  assert.equal(shop.buyEquipment('crystal').success, true);
  assert.equal(shop.equip('crystal').success, true);
  const loaded = nextLoad(storage);
  assert.equal(loaded.data.gold, 80); assert.equal(Upgrades.defenseBonus(loaded.data), 4);
  assert.equal(loaded.data.pet.wellFedDurationSec, 86400);
  const again = new Upgrades(loaded);
  assert.equal(again.equip(null).success, true);
  assert.equal(Upgrades.defenseBonus(loaded.data), 0);
  assert.deepEqual(nextLoad(storage).data.equipmentLoadout.owned, ['crystal']);
});

test('duplicate, insufficient, locked, unknown and unowned equipment actions preserve full state', () => {
  const { state, shop } = fixture();
  for (const action of [() => shop.buyEquipment('leaf'), () => shop.buyEquipment('shell'),
    () => shop.buyEquipment('__proto__'), () => shop.equip('crystal')]) {
    const before = JSON.stringify(state.data); assert.equal(action().success, false); assert.equal(JSON.stringify(state.data), before);
  }
  state.data.gold = 500; assert.equal(shop.buyEquipment('leaf').success, true);
  const before = JSON.stringify(state.data); assert.equal(shop.buyEquipment('leaf').success, false);
  assert.equal(JSON.stringify(state.data), before);
});

test('all equipment unlocks charge exactly once and only one bonus applies', () => {
  const { state, shop } = fixture(); state.data.gold = 1000; state.data.pet.level = 5;
  for (const item of Object.values(CONFIG.EQUIPMENT)) {
    assert.equal(shop.buyEquipment(item.id).success, true); assert.equal(shop.equip(item.id).success, true);
    assert.equal(Upgrades.defenseBonus(state.data), item.defense);
  }
  assert.equal(state.data.gold, 340);
});

test('paused save session refuses every upgrade without spending or switching equipment', () => {
  const { state, shop } = fixture(); state.data.gold = 900; state.data.pet.hp = 1;
  state.data.equipmentLoadout.owned = ['leaf']; state.canPlay = false;
  const before = JSON.stringify(state.data);
  for (const action of [() => shop.buyPlot(), () => shop.buyHealKit(), () => shop.buyEquipment('leaf'), () => shop.equip('leaf')])
    assert.equal(action().success, false);
  assert.equal(JSON.stringify(state.data), before);
});

test('quota failure keeps purchased progress downloadable and blocks another purchase', () => {
  const { state, shop, storage } = fixture(); state.data.gold = 300; state.save(); const prior = storage.getItem(state.key);
  storage.fail = true; assert.equal(shop.buyEquipment('leaf').success, true);
  assert.equal(state.canPlay, false); assert.equal(storage.getItem(state.key), prior);
  const saved = JSON.parse(state.exportCurrent()); assert.equal(saved.gold, 240); assert.deepEqual(saved.equipmentLoadout.owned, ['leaf']);
  assert.equal(shop.buyPlot().success, false); storage.fail = false; assert.equal(state.retry(), true);
  assert.deepEqual(nextLoad(storage).data.equipmentLoadout.owned, ['leaf']);
});

test('invalid equipment fails visibly without overwriting original save bytes', () => {
  const bad = [null, [], { schemaVersion: 2, owned: [], equipped: null },
    { schemaVersion: 1, owned: ['leaf', 'leaf'], equipped: null },
    { schemaVersion: 1, owned: ['unknown'], equipped: null },
    { schemaVersion: 1, owned: [], equipped: 'leaf' },
    { schemaVersion: 1, owned: [], equipped: 0 }];
  for (const gear of bad) {
    const data = GameState.fresh(epoch); data.equipmentLoadout = gear; const raw = JSON.stringify(data);
    const { state, storage } = fixture(raw); assert.equal(state.canPlay, false); assert.equal(state.loaded, false);
    assert.equal(storage.getItem(state.key), raw); assert.equal(state.save(), false);
  }
});

test('healing kit refuses full health and caps restoration without changing maximum health', () => {
  const { state, shop, storage } = fixture(); state.data.gold = 100;
  assert.equal(shop.buyHealKit().success, false); assert.equal(state.data.gold, 100);
  state.data.pet.hp = 90; assert.equal(shop.buyHealKit().success, true);
  const pet = nextLoad(storage).data.pet; assert.equal(pet.hp, 100); assert.equal(pet.maxHp, 100); assert.equal(state.data.gold, 70);
  state.data.pet.hp = 0; assert.equal(shop.buyHealKit().success, true); assert.equal(state.data.pet.hp, 30);
});

test('plot purchase uses unused maximum ID, persists and supports planting and harvest', () => {
  const { state, shop, storage } = fixture(); state.data.gold = 200; state.data.farmPlots[1].id = 80;
  assert.equal(shop.buyPlot().success, true); assert.equal(state.data.farmPlots.at(-1).id, 81);
  const loaded = nextLoad(storage); assert.equal(loaded.data.gold, 100); assert.equal(loaded.data.farmPlots.length, 5);
  const farm = new FarmingManager(loaded); assert.equal(farm.plantSeed(81, 'berry').success, true);
  new Progression(loaded).advanceTo(epoch + 31000, false);
  assert.equal(farm.harvestPlot(81).success, true); assert.equal(loaded.data.inventory.berry.count, 4);
});

test('plot ID exhaustion and low gold leave the complete state unchanged', () => {
  const { state, shop } = fixture(); let before = JSON.stringify(state.data);
  assert.equal(shop.buyPlot().success, false); assert.equal(JSON.stringify(state.data), before);
  state.data.gold = 500; state.data.farmPlots[0].id = Number.MAX_SAFE_INTEGER; before = JSON.stringify(state.data);
  assert.equal(shop.buyPlot().success, false); assert.equal(JSON.stringify(state.data), before);
});

test('equipment changes ordinary raid outcome, with critical rolls and life floor preserved', () => {
  const roll = DiceEngine.roll, random = Math.random;
  try {
    Math.random = () => 0.99;
    const { state, shop } = fixture(); state.data.gold = 500; state.data.pet.level = 5;
    shop.buyEquipment('crystal');
    DiceEngine.roll = () => ({ total: 3, rolls: [3] });
    let result = new EncounterEngine(state).triggerRaid(); assert.equal(result.type, 'loss');
    shop.equip('crystal'); result = new EncounterEngine(state).triggerRaid();
    assert.equal(result.type, 'win'); assert.equal(result.equipmentDefense, 4);
    DiceEngine.roll = () => ({ total: 1, rolls: [1] }); state.data.pet.hp = 1;
    assert.equal(new EncounterEngine(state).triggerRaid().type, 'crit-loss'); assert.equal(state.data.pet.hp, 1);
    DiceEngine.roll = () => ({ total: 20, rolls: [20] });
    assert.equal(new EncounterEngine(state).triggerRaid().type, 'crit-win');
  } finally { DiceEngine.roll = roll; Math.random = random; }
});

test('equipped pet retains existing offline care, crop, gold and defense rules', () => {
  const { state, shop, storage } = fixture(); state.data.gold = 500; shop.buyEquipment('leaf'); shop.equip('leaf');
  new Progression(state).advanceTo(epoch + 7 * 86400000, false); state.save(); const loaded = nextLoad(storage);
  assert.equal(loaded.data.gold, 440); assert.equal(Upgrades.defenseBonus(loaded.data), 1);
  assert.equal(loaded.data.pet.hunger, 0); assert.ok(loaded.data.pet.hp >= 1); assert.equal(loaded.data.timing.raidElapsedSec, 0);
});

test('all purchased plots have unique nonoverlapping positions and an enclosing garden', () => {
  for (const count of [0, 1, 4, 5, 20, 100, 1000]) {
    const renderer = Object.create(Renderer.prototype); const layout = renderer.gardenLayout(count);
    assert.equal(layout.positions.length, count); assert.equal(new Set(layout.positions.map(p => `${p.x},${p.y}`)).size, count);
    assert.equal(renderer.gardenLayout(count), layout);
    for (const p of layout.positions) assert.ok(Math.max(Math.abs(p.x),Math.abs(p.y),Math.abs(p.x+80),Math.abs(p.y+80)) < layout.worldSize/2);
    for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) {
      const a = layout.positions[i], b = layout.positions[j]; assert.ok(Math.abs(a.x-b.x) >= 80 || Math.abs(a.y-b.y) >= 80);
    }
  }
});

test('world draws soil for every owned plot including the fifth and later', () => {
  const renderer = Object.create(Renderer.prototype); renderer.state = { data: GameState.fresh(epoch) };
  renderer.state.data.farmPlots = Array.from({ length: 28 }, (_, id) => ({ id, state: 'empty' }));
  let soil = 0;
  const ctx = { fillRect(x,y,w,h) { if (w===80 && h===80) soil++; }, strokeRect() {}, fillText() {} };
  renderer.drawEnvironment(ctx); assert.equal(soil, 28);
});
