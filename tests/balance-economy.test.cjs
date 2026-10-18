const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
global.CONFIG = require('../js/config.js');
const GameState = require('../js/state.js');
const Progression = require('../js/progression.js');
const Upgrades = require('../js/upgrades.js');
const Farming = require('../js/farming.js');
const root = path.resolve(__dirname, '..');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
function state(data = GameState.fresh(0)) {
  return { data, canPlay: true, notify() {}, pause(kind) { this.canPlay = false; this.status = kind; return false; } };
}
function encounters() {
  // Isolate deterministic RNG, leaving native clocks, browser and storage untouched.
  let random = () => { throw Error('Set an explicit random source'); };
  const context = vm.createContext({ module: { exports: {} }, random: () => random() });
  vm.runInContext('Math.random = () => random()', context);
  for (const name of ['config', 'combat']) {
    context.module = { exports: {} };
    vm.runInContext(fs.readFileSync(path.join(root, 'js', name + '.js'), 'utf8'), context);
  }
  return { Engine: context.module.exports.EncounterEngine, useRandom(fn) { random = fn; } };
}

test('every raid outcome preserves early difficulty and bounded later equipment value', () => {
  const { Engine, useRandom } = encounters();
  let outcomes = 0;
  for (let level = 1; level <= 100; level++) for (const [id, bonus] of [[null, 0], ['leaf', 1], ['shell', 2], ['crystal', 4]]) {
    let wins = 0, oldWins = 0;
    for (let face = 1; face <= 20; face++) for (let extra = 0; extra < 5; extra++) {
      const s = state(); s.data.pet.level = level;
      if (id) s.data.equipmentLoadout = { schemaVersion: 1, owned: [id], equipped: id };
      const draws = [(face - .5) / 20, (extra + .5) / 5]; useRandom(() => draws.shift());
      const result = new Engine(s).triggerRaid({ persist: false });
      const success = face === 20 || (face !== 1 && face + bonus >= Math.min(Math.ceil(level / 2), 4) + extra);
      const type = face === 20 ? 'crit-win' : face === 1 ? 'crit-loss' : success ? 'win' : 'loss';
      assert.equal(result.type, type, `level${level}/${id}/${face}/${extra}`);
      assert.equal(s.data.gold, 50 + (face === 20 ? 25 * level : success ? 10 * level : 0));
      assert.equal(draws.length, 0); outcomes++; if (success) wins++;
      if (face === 20 || (face !== 1 && face + bonus >= Math.ceil(level / 2) + extra)) oldWins++;
    }
    if (level <= 8) assert.equal(wins, oldWins);
    if (level >= 7) assert.equal(wins, { 0: 75, 1: 80, 2: 85, 4: 92 }[bonus]);
  }
  assert.equal(outcomes, 40000);
});

test('healing scales at fixed cost and clamps to preserved maximum health', () => {
  for (const maximum of [1, 100, 121, 1000, 7764, Number.MAX_SAFE_INTEGER]) {
    const s = state(); Object.assign(s.data.pet, { hp: 0, maxHp: maximum }); s.data.gold = 120;
    const shop = new Upgrades(s); const quantity = Math.max(30, Math.ceil(maximum * .30));
    assert.equal(shop.buyHealKit().success, true); assert.equal(s.data.pet.hp, Math.min(maximum, quantity));
    assert.equal(s.data.gold, 90); assert.equal(s.data.pet.maxHp, maximum);
    s.data.pet.hp = maximum - Math.min(1, maximum);
    assert.equal(shop.buyHealKit().success, true); assert.equal(s.data.pet.hp, maximum);
    const before = JSON.stringify(s.data); assert.equal(shop.buyHealKit().success, false); assert.equal(JSON.stringify(s.data), before);
  }
});

test('healing refuses missing funds or paused writer before changing progress', () => {
  for (const [gold, canPlay] of [[29, true], [1000, false]]) {
    const s = state(); s.data.pet.maxHp = 1000; s.data.pet.hp = 1; s.data.gold = gold; s.canPlay = canPlay;
    const before = JSON.stringify(s.data); assert.equal(new Upgrades(s).buyHealKit().success, false); assert.equal(JSON.stringify(s.data), before);
  }
});

test('care adds permanent HP without increasing the next food requirement', () => {
  const pets = [state(), state()];
  for (const s of pets) s.data.pet.cumulativeFoodQuality = 85;
  pets[1].data.pet.wellFedDurationSec = 86400;
  for (const s of pets) assert.equal(new Progression(s).feed('berry'), true);
  assert.equal(pets[0].data.pet.maxHp, 110); assert.equal(pets[1].data.pet.maxHp, 121);
  for (const s of pets) { assert.equal(s.data.pet.level, 2); assert.equal(s.data.pet.requiredQualityForNextLevel, 110); }
  assert.equal(pets[1].data.pet.wellFedDurationSec, 0);
});

test('existing custom and historical thresholds stay authoritative through future growth', () => {
  for (const [maximum, threshold] of [[100, 100], [121, 121], [120, 110], [1000, 123.5], [1, 1]]) {
    const original = GameState.fresh(0); Object.assign(original.pet, { hp: maximum, maxHp: maximum, requiredQualityForNextLevel: threshold, cumulativeFoodQuality: threshold });
    original.pet.historical = { keep: true }; original.historical = 'keep';
    const raw = JSON.stringify(original); const decoded = GameState.decode(raw, 0).data;
    assert.deepEqual(decoded, original); // No new balance migration or threshold rebasing.
    const s = state(decoded); const p = new Progression(s); assert.equal(JSON.stringify(s.data), raw);
    // A one-quality food isolates a single transition even at the smallest supported threshold.
    const config = { ...CONFIG, CROPS: { ...CONFIG.CROPS, berry: { ...CONFIG.CROPS.berry, qualityRating: 1 } } };
    assert.equal(new Progression(s, config).feed('berry'), true);
    assert.equal(s.data.pet.requiredQualityForNextLevel, Math.max(threshold + 1, Math.floor(threshold * 1.10)));
    assert.equal(s.data.pet.cumulativeFoodQuality, 1); assert.equal(s.data.pet.historical.keep, true); assert.equal(s.data.historical, 'keep');
    assert.doesNotThrow(() => GameState.decode(JSON.stringify(s.data), 0));
  }
});

test('multiple levels spend the same quality sequence with and without care', () => {
  const pets = [state(), state()];
  for (const s of pets) s.data.pet.cumulativeFoodQuality = 316;
  pets[1].data.pet.wellFedDurationSec = 86400;
  for (const s of pets) new Progression(s).feed('berry');
  // 331 quality pays100+110+121, independent of the care-grown health sequence.
  for (const s of pets) { assert.equal(s.data.pet.level, 4); assert.equal(s.data.pet.cumulativeFoodQuality, 0); assert.equal(s.data.pet.requiredQualityForNextLevel, 133); }
  assert.ok(pets[1].data.pet.maxHp > pets[0].data.pet.maxHp);
});

test('fractional and minimum saved requirements grow without rounding away legacy progress', () => {
  for (const [requirement, level, remainder, next, maximum] of [[1.5, 5, 3, 5.5, 146], [1, 6, 0, 6, 160]]) {
    const s = state(); s.data.pet.requiredQualityForNextLevel = requirement;
    assert.equal(new Progression(s).feed('berry'), true);
    assert.equal(s.data.pet.level, level); assert.equal(s.data.pet.cumulativeFoodQuality, remainder);
    assert.equal(s.data.pet.requiredQualityForNextLevel, next); assert.equal(s.data.pet.maxHp, maximum);
    const reloaded = GameState.decode(JSON.stringify(s.data), 0).data; assert.deepEqual(reloaded, s.data);
  }
  const s = state(); s.data.pet.requiredQualityForNextLevel = 100.5; s.data.pet.cumulativeFoodQuality = 85.5;
  const reloaded = state(GameState.decode(JSON.stringify(s.data), 0).data);
  assert.equal(reloaded.data.pet.requiredQualityForNextLevel, 100.5);
  new Progression(reloaded).feed('berry'); assert.equal(reloaded.data.pet.requiredQualityForNextLevel, 110);
  assert.equal(reloaded.data.pet.cumulativeFoodQuality, 0);
});

test('care without a level never reprices the saved requirement', () => {
  const s = state(); s.data.pet.wellFedDurationSec = 86400;
  new Progression(s).feed('berry');
  assert.equal(s.data.pet.level, 1); assert.equal(s.data.pet.maxHp, 110);
  assert.equal(s.data.pet.requiredQualityForNextLevel, 100); assert.equal(s.data.pet.cumulativeFoodQuality, 15);
});

test('next food requirement accepts its exact numeric boundary and refuses the next input', () => {
  for (const threshold of [8188362958855446, 8188362958855447]) {
    const s = state(); s.data.pet.requiredQualityForNextLevel = threshold; s.data.pet.cumulativeFoodQuality = threshold - 15;
    const before = JSON.stringify(s.data); const result = new Progression(s).feed('berry');
    if (threshold === 8188362958855446) {
      assert.equal(result, true); assert.equal(s.data.pet.requiredQualityForNextLevel, Number.MAX_SAFE_INTEGER);
      assert.doesNotThrow(() => GameState.decode(JSON.stringify(s.data), 0));
    } else { assert.equal(result, false); assert.equal(JSON.stringify(s.data), before); }
  }
});

test('a later planned level failure keeps all food, care, logs and earlier levels unspent', () => {
  for (const limit of ['level', 'health']) {
    const s = state(); s.data.pet.cumulativeFoodQuality = 500; s.data.pet.wellFedDurationSec = 86400;
    if (limit === 'level') s.data.pet.level = Number.MAX_SAFE_INTEGER - 1;
    else s.data.pet.maxHp = s.data.pet.hp = 7e15;
    const before = JSON.stringify(s.data); assert.equal(new Progression(s).feed('berry'), false);
    assert.equal(s.status, 'progress-limit'); assert.equal(JSON.stringify(s.data), before);
  }
});

test('next requirement overflow refuses the complete feeding transaction', () => {
  const s = state(); const threshold = Number.MAX_SAFE_INTEGER - 32;
  s.data.pet.requiredQualityForNextLevel = threshold; s.data.pet.cumulativeFoodQuality = threshold - 15;
  s.data.pet.wellFedDurationSec = 86400; const before = JSON.stringify(s.data);
  assert.equal(new Progression(s).feed('berry'), false); assert.equal(s.status, 'progress-limit');
  assert.equal(JSON.stringify(s.data), before);
});

test('a full-day absence keeps a viable care window without raids or clock replay', () => {
  const s = state(); const p = new Progression(s); let raids = 0;
  p.advanceTo(86400000, false, () => raids++);
  near(s.data.pet.hunger, 76); near(s.data.pet.hp, 76); near(s.data.pet.wellFedDurationSec, 36000);
  assert.equal(raids, 0); assert.equal(s.data.timing.raidElapsedSec, 0);
  const before = JSON.stringify(s.data); assert.equal(p.advanceTo(0, true).clockBackwards, true); assert.equal(JSON.stringify(s.data), before);
});

test('partitioned away care and positive or historical zero health floors remain consistent', () => {
  for (const hours of [24, 72, 720]) {
    const a = state(), b = state(); const pa = new Progression(a), pb = new Progression(b);
    pa.advanceTo(hours * 3600000, false);
    for (let h = 1; h <= hours; h++) pb.advanceTo(h * 3600000, false);
    for (const field of ['hp', 'hunger', 'wellFedDurationSec']) near(a.data.pet[field], b.data.pet[field]);
    near(a.data.inventory.berry.batches[0].ageHours, hours); near(b.data.inventory.berry.batches[0].ageHours, hours);
    assert.ok(a.data.pet.hp >= 1); assert.ok(a.data.pet.hunger >= 0);
  }
  const zero = state(); zero.data.pet.hp = 0; new Progression(zero).advanceTo(720 * 3600000, false); assert.equal(zero.data.pet.hp, 0);
});

test('scheduled raids retain their 90-second visible cadence and saved partial phase', () => {
  const s = state(); s.data.timing.raidElapsedSec = 89; const p = new Progression(s); let raids = 0;
  p.advanceTo(1000, true, () => raids++); assert.equal(raids, 1); assert.equal(s.data.timing.raidElapsedSec, 0);
  for (let sec = 6; sec <= 86; sec += 5) p.advanceTo(sec * 1000, true, () => raids++);
  p.advanceTo(91000, true, () => raids++); assert.equal(raids, 2);
  const before = s.data.timing.raidElapsedSec; p.advanceTo(3600000, true, () => raids++);
  assert.equal(raids, 2); assert.equal(s.data.timing.raidElapsedSec, before);
});

test('ordinary event log has no reward-bearing manual test action or binding', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/ui.js'), 'utf8');
  assert.doesNotMatch(html, /trigger-raid-btn|Trigger Raid Check/);
  assert.doesNotMatch(ui, /trigger-raid-btn|combatEngine\.triggerRaid\(/);
  assert.match(html, /id="combat-log"/);
});

function randomSeed(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function dailySession(seed, days) {
  const s = state(), d = s.data, p = new Progression(s), farm = new Farming(s), shop = new Upgrades(s);
  const { Engine, useRandom } = encounters(); useRandom(randomSeed(seed)); const engine = new Engine(s); let credits = 0;
  function feed(id) { const before = d.pet.wellFedDurationSec; p.feed(id); if (before > d.pet.wellFedDurationSec) credits++; }
  function act() {
    for (const plot of d.farmPlots) if (plot.state === 'ready') farm.harvestPlot(plot.id);
    if (d.pet.hunger <= 90) for (const id of ['berry', 'root', 'crystal']) while (d.pet.hunger < 100 && d.inventory[id]?.count) feed(id);
    for (const id of ['root', 'crystal', 'berry']) while ((d.inventory[id]?.count || 0) > (id === 'berry' ? 2 : 0)) feed(id);
    while (d.pet.hp < .9 * d.pet.maxHp && d.gold >= 40) assert.equal(shop.buyHealKit().success, true);
    const item = ['crystal', 'shell', 'leaf'].find(id => d.pet.level >= CONFIG.EQUIPMENT[id].level && !d.equipmentLoadout.owned.includes(id) && d.gold >= CONFIG.EQUIPMENT[id].cost + 20 && CONFIG.EQUIPMENT[id].defense > (CONFIG.EQUIPMENT[d.equipmentLoadout.equipped]?.defense || 0));
    if (item) { assert.equal(shop.buyEquipment(item).success, true); assert.equal(shop.equip(item).success, true); }
    for (const plot of d.farmPlots) if (plot.state === 'empty' && d.gold >= 5) assert.equal(farm.plantSeed(plot.id, 'berry').success, true);
  }
  let firstSessionLevel, day7Credits;
  for (let day = 0; day < days; day++) {
    const start = day * 86400000; p.advanceTo(start, false); act();
    for (let sec = 5; sec <= 600; sec += 5) {
      p.advanceTo(start + sec * 1000, true, () => engine.triggerRaid({ persist: false }));
      if (sec % 30 === 0) act();
    }
    if (day === 0) firstSessionLevel = d.pet.level; if (day === 6) day7Credits = credits;
    assert.equal(s.canPlay, true); assert.doesNotThrow(() => GameState.decode(JSON.stringify(d), d.lastTimestamp));
  }
  return { d, firstSessionLevel, day7Credits };
}

test('seeded daily care and progression remain sustainable without manual raids', () => {
  // Example behavior:10min/day, actions every30sec, berries, two-food reserve,
  // heal below90% with10gold retained, buy affordable gear, no plot purchases.
  // This is a deterministic regression envelope, not proof of human enjoyment.
  let sustainable = 0, credited = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { d, firstSessionLevel, day7Credits } = dailySession(seed, 30);
    assert.ok(firstSessionLevel >= 3);
    if (d.pet.hp >= .9 * d.pet.maxHp && (d.inventory.berry?.count || 0) >= 2 && d.gold >= 40) sustainable++;
    if (day7Credits >= 1) credited++;
  }
  assert.ok(sustainable >= 95, `${sustainable}/100 sustainable`);
  assert.ok(credited >= 90, `${credited}/100 earned care by day7`);
});
