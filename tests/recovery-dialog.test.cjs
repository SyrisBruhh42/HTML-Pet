const test = require('node:test');
const assert = require('node:assert/strict');
const GameState = require('../js/state.js');
const RecoveryDialog = require('../js/recovery-dialog.js');
const UIManager = require('../js/ui.js');
const epoch = 1792300000000;
class Storage {
  constructor(raw) { this.map = new Map(raw == null ? [] : [['pixel_pet_save_v1', raw]]); this.writes = []; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) {
    if (this.failRecovery && key.includes(':recovery:')) throw new Error('Synthetic recovery quota');
    this.writes.push([key, String(value)]); this.map.set(key, String(value));
  }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
}
function dom() {
  const elements = new Map();
  const doc = { activeElement: null, querySelectorAll: () => [] };
  function element(id) {
    return { id, listeners: {}, disabled: false, isConnected: true, hidden: false, value: '', open: false,
      textContent: '', attributes: {}, children: [], classList: { toggle() {}, contains: () => true },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      dispatch(type, event = {}) { return Promise.all((this.listeners[type] || []).map(fn => fn({ target: this, ...event }))); },
      focus() { doc.activeElement = this; }, setAttribute(key, value) { this.attributes[key] = value; },
      appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; },
      showModal() { this.open = true; }, close() { this.open = false; this.dispatch('close'); }
    };
  }
  doc.getElementById = id => { if (!elements.has(id)) elements.set(id, element(id)); return elements.get(id); };
  doc.createElement = () => element('synthetic');
  doc.activeElement = doc.getElementById('import-text-btn');
  return doc;
}
function fixture(raw) {
  const original = GameState.fresh(epoch); original.pet.name = 'Original'; original.gold = 80;
  const storage = new Storage(raw === undefined ? JSON.stringify(original, null, 2) : raw);
  let writer = true;
  const state = new GameState({ storage, now: () => epoch, writerCheck: () => writer }); state.load();
  const doc = dom(), reports = [];
  const dialog = new RecoveryDialog({ state, document: doc, decode: GameState.decode, report: (...message) => reports.push(message) });
  const candidate = GameState.fresh(epoch); candidate.pet.name = 'Restored'; candidate.gold = 431;
  candidate.futureExtension = { keep: ['all', 'fields'] };
  return { state, storage, doc, dialog, reports, candidate: JSON.stringify(candidate, null, 3), setWriter(value) { writer = value; } };
}

test('review is non-mutating, cancellation has initial focus, and Cancel/Escape return focus', async () => {
  for (const cancel of ['button', 'escape']) {
    const f = fixture(), before = [...f.storage.map], opener = f.doc.activeElement;
    const result = f.dialog.review(f.candidate);
    assert.equal(f.dialog.isOpen(), true); assert.equal(f.doc.activeElement.id, 'recovery-cancel');
    assert.deepEqual([...f.storage.map], before);
    if (cancel === 'button') await f.doc.getElementById('recovery-cancel').dispatch('click');
    else { let prevented = false; await f.doc.getElementById('recovery-dialog').dispatch('cancel', { preventDefault() { prevented = true; } }); assert.equal(prevented, true); }
    assert.equal(await result, false); assert.equal(f.doc.activeElement, opener);
    assert.deepEqual([...f.storage.map], before); assert.equal(f.dialog.isOpen(), false);
  }
});

test('only explicit confirmation restores the exact reviewed payload and preserves extension fields', async () => {
  const f = fixture(); const before = f.storage.getItem(f.state.key), raw = f.candidate;
  const result = f.dialog.review(raw);
  f.doc.getElementById('recovery-raw').value = 'edited preview cannot replace original payload';
  assert.equal(f.state.data.gold, 80);
  await f.doc.getElementById('recovery-confirm').dispatch('click');
  assert.equal(await result, true); assert.equal(f.state.data.gold, 431);
  assert.deepEqual(f.state.data.futureExtension, { keep: ['all', 'fields'] });
  assert.ok([...f.storage.map].some(([key, value]) => key.includes(':recovery:') && value === before));
  const writes = f.storage.writes.length; f.dialog.confirm(); assert.equal(f.storage.writes.length, writes);
});

test('malformed, future and oversized backups fail visibly before opening or replacing', async () => {
  const f = fixture(); const before = [...f.storage.map];
  for (const raw of ['{bad', JSON.stringify({ ...GameState.fresh(epoch), schemaVersion: 99 }), 'é'.repeat(3 * 1024 * 1024), null]) {
    assert.equal(await f.dialog.review(raw), false); assert.equal(f.dialog.isOpen(), false);
    assert.equal(f.doc.getElementById('recovery-dialog').open, false);
    assert.equal(f.reports.at(-1)[1], true); assert.deepEqual([...f.storage.map], before);
  }
});

test('summary renders untrusted names as text and unsupported dialog never falls back to native confirmation', async () => {
  const f = fixture(), value = JSON.parse(f.candidate); value.pet.name = '<img src=x onerror=alert(1)>';
  const result = f.dialog.review(JSON.stringify(value));
  assert.match(f.doc.getElementById('recovery-summary').textContent, /<img src=x/);
  assert.equal(Object.hasOwn(f.doc.getElementById('recovery-summary'), 'innerHTML'), false);
  f.dialog.finish(false); await result;
  f.doc.getElementById('recovery-dialog').showModal = undefined;
  assert.equal(await f.dialog.review(f.candidate), false); assert.match(f.reports.at(-1)[0], /HTML dialog support/);
});

test('failed recovery storage retains dialog text and current progress until an explicit successful retry', async () => {
  const f = fixture(); const stored = f.storage.getItem(f.state.key); f.state.data.gold = 299;
  const result = f.dialog.review(f.candidate); f.storage.failRecovery = true;
  f.dialog.confirm(); assert.equal(f.dialog.isOpen(), true); assert.equal(f.state.data.gold, 299);
  assert.equal(f.storage.getItem(f.state.key), stored); assert.equal(f.doc.getElementById('recovery-raw').value, f.candidate);
  assert.equal(f.doc.activeElement.id, 'recovery-error'); assert.equal(f.doc.getElementById('recovery-raw-details').open, true);
  f.storage.failRecovery = false; f.dialog.confirm(); assert.equal(await result, true);
  const copies = [...f.storage.map].filter(([key]) => key.includes(':recovery:')).map(([, raw]) => raw);
  assert.ok(copies.includes(stored)); assert.ok(copies.some(raw => JSON.parse(raw).gold === 299));
});

test('writer withdrawal and changed stored bytes between review and confirmation remain held', async () => {
  for (const cause of ['writer', 'conflict']) {
    const f = fixture(); const result = f.dialog.review(f.candidate);
    if (cause === 'writer') f.setWriter(false); else f.storage.map.set(f.state.key, 'different stored bytes');
    const before = [...f.storage.map]; f.dialog.confirm();
    assert.equal(f.dialog.isOpen(), true); assert.equal(f.state.data.gold, 80);
    assert.deepEqual([...f.storage.map], before); assert.equal(f.doc.activeElement.id, 'recovery-error');
    f.dialog.finish(false); assert.equal(await result, false);
  }
});

test('new pet and invalid-current-save recovery both require confirmation and preserve original raw bytes', async () => {
  const f = fixture('{INVALID ORIGINAL BYTES}'); const result = f.dialog.review(JSON.stringify(GameState.fresh(epoch)), { kind: 'new' });
  assert.equal(f.storage.getItem(f.state.key), '{INVALID ORIGINAL BYTES}');
  assert.match(f.doc.getElementById('recovery-title').textContent, /Start a new pet/);
  f.dialog.confirm(); assert.equal(await result, true); assert.equal(f.state.loaded, true);
  assert.equal(f.storage.getItem(f.state.recoveryKey), '{INVALID ORIGINAL BYTES}');
});

test('overlapping reviews cannot replace the pending payload and focus has a valid fallback', async () => {
  const f = fixture(); const opener = f.doc.activeElement; const first = f.dialog.review(f.candidate);
  const different = JSON.stringify(GameState.fresh(epoch)); assert.equal(await f.dialog.review(different), false);
  assert.equal(f.doc.getElementById('recovery-raw').value, f.candidate);
  opener.isConnected = false; f.dialog.confirm(); assert.equal(await first, true);
  assert.equal(f.state.data.gold, 431); assert.equal(f.doc.activeElement.id, 'recovery-status');
});

function bindUI(f) {
  const ui = Object.create(UIManager.prototype);
  Object.assign(ui, { state: f.state, recoveryDialog: f.dialog, recoveryRequest: 0, renderHUD() {} });
  ui.bindRecovery(); return ui;
}

test('paste input is cleared only after success and retained after cancel or validation failure', async () => {
  const f = fixture(), previous = global.document; global.document = f.doc;
  try {
    bindUI(f); const input = f.doc.getElementById('import-text'); input.value = f.candidate;
    const canceled = f.doc.getElementById('import-text-btn').dispatch('click'); f.dialog.finish(false); await canceled;
    assert.equal(input.value, f.candidate);
    input.value = '{bad'; await f.doc.getElementById('import-text-btn').dispatch('click'); assert.equal(input.value, '{bad');
    input.value = f.candidate; const restored = f.doc.getElementById('import-text-btn').dispatch('click');
    f.dialog.confirm(); await restored; assert.equal(input.value, ''); assert.equal(f.state.data.gold, 431);
  } finally { if (previous === undefined) delete global.document; else global.document = previous; }
});

test('a delayed old file read cannot displace a newer explicit text review', async () => {
  const f = fixture(), previous = global.document; global.document = f.doc;
  try {
    bindUI(f); const file = f.doc.getElementById('import-save'); let finishRead;
    file.files = [{ size: 20, text: () => new Promise(resolve => { finishRead = resolve; }) }];
    const pending = file.dispatch('change');
    f.doc.getElementById('import-text').value = f.candidate;
    const text = f.doc.getElementById('import-text-btn').dispatch('click');
    finishRead(JSON.stringify(GameState.fresh(epoch))); await pending;
    assert.equal(f.doc.getElementById('recovery-raw').value, f.candidate);
    f.dialog.confirm(); await text; assert.equal(f.state.data.gold, 431);
  } finally { if (previous === undefined) delete global.document; else global.document = previous; }
});

test('file backup text survives canceled recovery and visible file read errors', async () => {
  const f = fixture(), previous = global.document; global.document = f.doc;
  try {
    bindUI(f); const file = f.doc.getElementById('import-save'); file.files = [{ size: 100, text: async () => f.candidate }];
    const pending = file.dispatch('change'); await Promise.resolve();
    f.dialog.finish(false); await pending;
    assert.equal(f.doc.getElementById('import-text').value, f.candidate);
    file.files = [{ size: 100, text: async () => { throw new Error('Synthetic read failure'); } }];
    await file.dispatch('change'); assert.match(f.doc.getElementById('recovery-status').textContent, /Synthetic read failure/);
    assert.equal(f.doc.getElementById('import-text').value, f.candidate);
  } finally { if (previous === undefined) delete global.document; else global.document = previous; }
});
