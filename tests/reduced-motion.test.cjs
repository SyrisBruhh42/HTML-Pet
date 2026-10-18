const test = require('node:test');
const assert = require('node:assert/strict');
const Renderer = require('../js/renderer.js');
const GameState = require('../js/state.js');

function fixture(reduced) {
  const old = global.window, calls = [];
  const media = { matches: reduced, addEventListener(type, fn) { this.change = fn; } };
  global.window = { innerWidth: 800, innerHeight: 600, addEventListener() {}, matchMedia: () => media };
  const ctx = new Proxy({}, { get(obj, key) { return (...args) => calls.push([key, ...args]); }, set() { return true; } });
  const state = { data: GameState.fresh(1792350000000) };
  const renderer = new Renderer({ getContext: () => ctx }, state);
  return { renderer, state, media, calls, cleanup() { global.window = old; } };
}

test('reduced motion at startup prevents feed bounce and particles without changing pet progress', () => {
  const f = fixture(true);
  try {
    const before = JSON.stringify(f.state.data); f.renderer.triggerFeedAura(); f.renderer.updateAnimation();
    assert.equal(f.renderer.bounceOffset, 0); assert.equal(f.renderer.bounceVelocity, 0);
    assert.equal(f.renderer.auraParticles.length, 0); assert.equal(JSON.stringify(f.state.data), before);
  } finally { f.cleanup(); }
});

test('changing the preference clears motion already in flight and normal motion can resume', () => {
  const f = fixture(false);
  try {
    f.renderer.triggerFeedAura(); f.renderer.updateAnimation(); assert.notEqual(f.renderer.bounceOffset, 0);
    f.media.matches = true; f.media.change({ matches: true }); f.renderer.updateAnimation();
    assert.equal(f.renderer.bounceOffset, 0); assert.equal(f.renderer.bounceVelocity, 0); assert.equal(f.renderer.auraParticles.length, 0);
    f.media.matches = false; f.media.change({ matches: false }); f.renderer.triggerFeedAura();
    assert.equal(f.renderer.auraParticles.length, 30); assert.equal(f.renderer.bounceVelocity, -10);
  } finally { f.cleanup(); }
});

test('reduced-motion slime geometry stays fixed across elapsed time', () => {
  const f = fixture(true), now = Date.now;
  try {
    Date.now = () => 0; f.renderer.drawSlimePet(f.renderer.ctx, f.state.data.pet); const before = [...f.calls];
    f.calls.length = 0; Date.now = () => 1234567; f.renderer.drawSlimePet(f.renderer.ctx, f.state.data.pet);
    assert.deepEqual(f.calls, before);
  } finally { Date.now = now; f.cleanup(); }
});
