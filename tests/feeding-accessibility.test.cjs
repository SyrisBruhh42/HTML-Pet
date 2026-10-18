const test = require('node:test');
const assert = require('node:assert/strict');
global.CONFIG = require('../js/config.js');
global.Upgrades = require('../js/upgrades.js');
const GameState = require('../js/state.js');
const Progression = require('../js/progression.js');
const UIManager = require('../js/ui.js');

function fixture() {
  const elements = new Map(), items = new Map();
  const doc = { activeElement: null, listeners: {}, querySelectorAll: () => [],
    addEventListener(type, fn) { this.listeners[type] = fn; } };
  const make = id => ({ id, checked: false, disabled: false, open: false, isConnected: true,
    textContent: '', dataset: {}, style: {}, children: [], listeners: {},
    classList: { values: new Set(['hidden']), add(v) { this.values.add(v); },
      remove(v) { this.values.delete(v); }, contains(v) { return this.values.has(v); } },
    set innerHTML(v) { this.children.forEach(e => { e.isConnected = false; }); this.children = []; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    dispatch(type, event = {}) { return this.listeners[type]?.({ target: this, ...event }); },
    setAttribute() {}, appendChild(el) { this.children.push(el); },
    querySelectorAll() { return this.children; },
    querySelector(selector) {
      const match = selector.match(/data-crop-id="([^"]+)"/);
      return match ? this.children.find(e => e.dataset.cropId === match[1]) : doc.getElementById('close-feed');
    },
    focus() { doc.activeElement = this; },
    showModal() { this.open = true; }, close() { this.open = false; }
  });
  doc.getElementById = id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); };
  doc.createElement = () => make('food-card');
  const storage = { getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) };
  let writer = true;
  const state = new GameState({ storage, now: () => 1792350000000, writerCheck: () => writer }); state.load();
  const ui = Object.create(UIManager.prototype);
  Object.assign(ui, { state, progression: new Progression(state), renderer: { triggerFeedAura() {} },
    recoveryDialog: { isOpen: () => false }, pendingFeedCropId: null });
  const old = global.document; global.document = doc;
  ui.initDOM(); ui.beforeAction = () => ui.renderHUD(); ui.bindEvents(); ui.renderInventory();
  return { ui, state, doc, storage, setWriter(v) { writer = v; }, cleanup() { global.document = old; } };
}

test('confirmation preference survives the action-time HUD refresh and reload in both directions', () => {
  const f = fixture();
  try {
    for (const checked of [true, false, true]) {
      f.ui.toggleConfirm.checked = checked;
      f.ui.toggleConfirm.dispatch('change');
      assert.equal(f.state.data.settings.confirmFeed, checked);
      assert.equal(f.ui.toggleConfirm.checked, checked);
      const again = new GameState({ storage: f.storage, now: () => 1792350000000, writerCheck: () => true });
      assert.equal(again.load(), true); assert.equal(again.data.settings.confirmFeed, checked);
    }
    f.state.canPlay = false; f.ui.toggleConfirm.checked = false; f.ui.toggleConfirm.dispatch('change');
    assert.equal(f.state.data.settings.confirmFeed, true); assert.equal(f.ui.toggleConfirm.checked, true);
  } finally { f.cleanup(); }
});

test('Cancel and Escape consume no food and keep inventory open with meaningful focus', () => {
  for (const action of ['button', 'escape']) {
    const f = fixture();
    try {
      f.state.data.settings.confirmFeed = true;
      f.ui.openModal('feed-modal');
      const before = JSON.stringify(f.state.data);
      f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
      assert.equal(f.ui.confirmDialog.open, true);
      assert.equal(f.doc.activeElement.id, 'confirm-no-btn');
      if (action === 'button') f.doc.getElementById('confirm-no-btn').dispatch('click');
      else { let canceled = false; f.ui.confirmDialog.dispatch('cancel', { preventDefault() { canceled = true; } }); assert.equal(canceled, true); }
      assert.equal(f.ui.confirmDialog.open, false); assert.equal(f.ui.pendingFeedCropId, null);
      assert.equal(f.ui.modalOverlay.classList.contains('hidden'), false);
      assert.equal(f.doc.activeElement.dataset.cropId, 'berry');
      assert.equal(JSON.stringify(f.state.data), before);
    } finally { f.cleanup(); }
  }
});

test('explicit confirmation consumes exactly one item and focuses the rebuilt inventory control', () => {
  const f = fixture();
  try {
    f.state.data.settings.confirmFeed = true;
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
    f.doc.getElementById('confirm-yes-btn').dispatch('click');
    f.doc.getElementById('confirm-yes-btn').dispatch('click');
    assert.equal(f.state.data.inventory.berry.count, 2);
    assert.equal(f.state.data.pet.cumulativeFoodQuality, 15);
    assert.equal(f.ui.confirmDialog.open, false);
    assert.equal(f.doc.activeElement.dataset.cropId, 'berry'); assert.equal(f.doc.activeElement.isConnected, true);
  } finally { f.cleanup(); }
});

test('ordinary keyboard feeding retains a usable control after inventory refresh', () => {
  const f = fixture();
  try {
    f.ui.openModal('feed-modal');
    f.ui.inventoryGrid.querySelector('[data-crop-id="berry"]').focus();
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
    assert.equal(f.state.data.inventory.berry.count, 2);
    assert.equal(f.doc.activeElement.isConnected, true);
    assert.equal(f.doc.activeElement.dataset.cropId, 'berry');
  } finally { f.cleanup(); }
});

test('last item returns focus to inventory close and a paused review cannot consume food', () => {
  const f = fixture();
  try {
    f.state.data.settings.confirmFeed = true;
    f.ui.handleFeedClick('root', CONFIG.CROPS.root, 40); f.doc.getElementById('confirm-yes-btn').dispatch('click');
    assert.equal(f.state.data.inventory.root.count, 0); assert.equal(f.doc.activeElement.id, 'close-feed');
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15); f.state.canPlay = false;
    f.doc.getElementById('confirm-yes-btn').dispatch('click'); assert.equal(f.state.data.inventory.berry.count, 3);
  } finally { f.cleanup(); }
});

test('unavailable native dialog and a second review never silently feed or replace the pending item', () => {
  const f = fixture();
  try {
    f.state.data.settings.confirmFeed = true;
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
    f.ui.handleFeedClick('root', CONFIG.CROPS.root, 40);
    assert.equal(f.ui.pendingFeedCropId, 'berry');
    f.doc.getElementById('confirm-no-btn').dispatch('click');
    f.ui.confirmDialog.showModal = undefined;
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
    assert.equal(f.state.data.inventory.berry.count, 3); assert.equal(f.ui.pendingFeedCropId, null);
    assert.match(f.doc.getElementById('feeding-status').textContent, /dialog/i);
  } finally { f.cleanup(); }
});

test('review quality is calculated after elapsed time rather than from an old inventory card', () => {
  const f = fixture();
  try {
    f.state.data.settings.confirmFeed = true;
    f.ui.beforeAction = () => { f.state.data.inventory.berry.batches[0].ageHours = 24; f.ui.renderHUD(); };
    f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
    assert.match(f.ui.confirmMsg.textContent, /Quality now: 7\./);
  } finally { f.cleanup(); }
});

test('a pending feeding cannot spend food after the pet is restored or reloaded', () => {
  for (const transition of ['replace', 'load']) {
    const f = fixture();
    try {
      f.state.data.settings.confirmFeed = true; f.state.save();
      f.ui.handleFeedClick('berry', CONFIG.CROPS.berry, 15);
      if (transition === 'replace') assert.equal(f.state.replace(JSON.stringify(GameState.fresh(1792350000000))), true);
      else assert.equal(f.state.load(), true);
      const before = JSON.stringify(f.state.data);
      f.doc.getElementById('confirm-yes-btn').dispatch('click');
      assert.equal(JSON.stringify(f.state.data), before); assert.equal(f.ui.confirmDialog.open, false);
      assert.match(f.doc.getElementById('feeding-status').textContent, /changed/);
    } finally { f.cleanup(); }
  }
});
