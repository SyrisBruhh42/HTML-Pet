/**
 * State Management & LocalStorage Persistence Architecture
 */
class GameState {
  constructor() {
    this.key = 'pixel_pet_save_v1';
    this.defaultState = {
      pet: {
        name: 'Gloop',
        level: 1,
        hp: 100,
        maxHp: 100,
        hunger: 100, // 0 to 100
        maxHunger: 100,
        cumulativeFoodQuality: 0,
        requiredQualityForNextLevel: 100,
        wellFedDurationSec: 0,
        scale: 1.0,
      },
      gold: 50,
      inventory: {
        berry: { count: 3, ageHours: 0 },
        root: { count: 1, ageHours: 0 }
      },
      farmPlots: [
        { id: 0, state: 'empty', cropId: null, plantedAt: null },
        { id: 1, state: 'empty', cropId: null, plantedAt: null },
        { id: 2, state: 'empty', cropId: null, plantedAt: null },
        { id: 3, state: 'empty', cropId: null, plantedAt: null }
      ],
      settings: {
        confirmFeed: false
      },
      logs: [],
      lastTimestamp: Date.now()
    };

    this.data = JSON.parse(JSON.stringify(this.defaultState));
    this.listeners = [];
  }

  load() {
    try {
      const saved = localStorage.getItem(this.key);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Deep merge with default state to handle schema updates
        this.data = { ...this.defaultState, ...parsed };
        this.data.pet = { ...this.defaultState.pet, ...(parsed.pet || {}) };
        this.data.inventory = { ...this.defaultState.inventory, ...(parsed.inventory || {}) };
        this.data.settings = { ...this.defaultState.settings, ...(parsed.settings || {}) };
      }
    } catch (e) {
      console.warn('Could not load saved state, using default state', e);
      this.data = JSON.parse(JSON.stringify(this.defaultState));
    }
  }

  save() {
    try {
      this.data.lastTimestamp = Date.now();
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }

  onChange(callback) {
    this.listeners.push(callback);
  }

  notify() {
    this.listeners.forEach(cb => cb(this.data));
    this.save();
  }
}

if (typeof window !== 'undefined') {
  window.gameState = new GameState();
}
if (typeof module !== 'undefined') {
  module.exports = GameState;
}
