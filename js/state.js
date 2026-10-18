/** Versioned saves. A failed load never authorizes replacing the stored game. */
class GameState {
  constructor(options = {}) {
    this.key = 'pixel_pet_save_v1'; // Keep the existing key so old pets are found.
    this.now = options.now || (() => Date.now());
    this.storage = options.storage;
    this.writerCheck = options.writerCheck || (() => false);
    this.listeners = [];
    this.statusListeners = [];
    this.data = GameState.fresh(this.now());
    this.canPlay = false;
    this.loaded = false;
    this.lastSavedRaw = null;
    this.originalRaw = null;
    this.pendingBackup = null;
    this.status = { kind: 'loading', message: 'Loading your pet…' };
  }

  static fresh(now) {
    return {
      schemaVersion: 2,
      pet: { name: 'Gloop', level: 1, hp: 100, maxHp: 100, hunger: 100,
        maxHunger: 100, cumulativeFoodQuality: 0, requiredQualityForNextLevel: 100,
        wellFedDurationSec: 0, scale: 1 },
      gold: 50,
      equipmentLoadout: { schemaVersion: 1, owned: [], equipped: null },
      inventory: {
        berry: { count: 3, ageHours: 0, batches: [{ count: 3, ageHours: 0 }] },
        root: { count: 1, ageHours: 0, batches: [{ count: 1, ageHours: 0 }] }
      },
      farmPlots: Array.from({ length: 4 }, (_, id) =>
        ({ id, state: 'empty', cropId: null, plantedAt: null, growthSec: 0 })),
      settings: { confirmFeed: false }, logs: [], timing: { raidElapsedSec: 0 },
      lastTimestamp: now
    };
  }

  static decode(raw, now) {
    const source = JSON.parse(raw);
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
    const check = (condition, field) => { if (!condition) throw new Error(`Invalid ${field}`); };
    const number = (value, field, min = 0, integer = false) => {
      check(Number.isFinite(value) && value >= min && value <= Number.MAX_SAFE_INTEGER &&
        (!integer || Number.isSafeInteger(value)), field);
    };
    check(record(source), 'save object');
    check(source.schemaVersion === undefined || source.schemaVersion === 1 || source.schemaVersion === 2,
      'save version (this game may need a newer version)');
    for (const field of ['pet', 'gold', 'inventory', 'farmPlots', 'settings', 'logs', 'lastTimestamp'])
      check(Object.hasOwn(source, field), `missing ${field}`);
    const legacy = source.schemaVersion !== 2;
    const defaults = GameState.fresh(now);
    const data = legacy ? { ...defaults, ...source } : { ...source };
    for (const field of ['pet', 'inventory', 'settings', 'timing']) {
      if (legacy && source[field] === undefined) data[field] = defaults[field];
      check(record(data[field]), field);
    }
    if (legacy) {
      data.settings = { ...defaults.settings, ...data.settings };
      data.timing = { ...defaults.timing, ...data.timing };
    }
    const pet = data.pet;
    check(typeof pet.name === 'string', 'pet name');
    number(pet.level, 'level', 1, true);
    for (const field of ['maxHp', 'maxHunger', 'requiredQualityForNextLevel']) number(pet[field], field, 1);
    number(pet.scale, 'scale', Number.EPSILON);
    for (const field of ['hp', 'hunger', 'cumulativeFoodQuality', 'wellFedDurationSec']) number(pet[field], field);
    check(pet.hp <= pet.maxHp && pet.hunger <= pet.maxHunger, 'pet stat bounds');
    number(data.gold, 'gold', 0, true);
    // Optional on existing version-2 saves. Preserve unrelated historical fields.
    if (Object.hasOwn(data, 'equipmentLoadout')) {
      const gear = data.equipmentLoadout;
      check(record(gear) && gear.schemaVersion === 1, 'equipment version');
      check(Array.isArray(gear.owned) && gear.owned.every(id => ['leaf', 'shell', 'crystal'].includes(id)) &&
        new Set(gear.owned).size === gear.owned.length, 'owned equipment');
      check(gear.equipped === null || gear.owned.includes(gear.equipped), 'equipped item ownership');
    }
    number(data.lastTimestamp, 'timestamp');
    number(data.timing.raidElapsedSec, 'raid timer');
    check(data.timing.raidElapsedSec < 90, 'raid timer range');
    check(typeof data.settings.confirmFeed === 'boolean', 'feed confirmation setting');
    const cropIds = ['berry', 'root', 'crystal'];
    for (const [cropId, item] of Object.entries(data.inventory)) {
      check(cropIds.includes(cropId) && record(item), 'inventory crop');
      number(item.count, 'food count', 0, true);
      number(item.ageHours, 'food age');
      if (legacy) item.batches = item.count ? [{ count: item.count, ageHours: item.ageHours }] : [];
      check(Array.isArray(item.batches), 'food batches');
      let count = 0;
      for (const batch of item.batches) {
        check(record(batch), 'food batch');
        number(batch.count, 'batch count', 1, true);
        number(batch.ageHours, 'batch age');
        count += batch.count;
      }
      check(Number.isSafeInteger(count) && count === item.count, 'food batch total');
      item.ageHours = item.batches[0]?.ageHours || 0;
    }
    check(Array.isArray(data.farmPlots), 'farm plots');
    const ids = new Set();
    for (const plot of data.farmPlots) {
      check(record(plot), 'farm plot');
      number(plot.id, 'plot id', 0, true);
      check(!ids.has(plot.id), 'duplicate plot id'); ids.add(plot.id);
      check(['empty', 'planted', 'ready'].includes(plot.state), 'plot state');
      if (plot.state === 'empty') {
        check(plot.cropId === null && plot.plantedAt === null, 'empty plot');
      } else {
        check(cropIds.includes(plot.cropId), 'planted crop');
        number(plot.plantedAt, 'planting timestamp');
      }
      if (legacy) plot.growthSec = plot.state === 'empty' ? 0 : Math.max(0, (data.lastTimestamp - plot.plantedAt) / 1000);
      number(plot.growthSec, 'crop growth');
    }
    check(Array.isArray(data.logs), 'event log');
    for (const log of data.logs) {
      check(record(log) && typeof log.timestamp === 'string' && typeof log.text === 'string' &&
        (log.type === undefined || (typeof log.type === 'string' && ['win', 'loss', 'crit-win', 'crit-loss', ''].includes(log.type))), 'log entry');
    }
    data.schemaVersion = 2;
    return { data, migrated: legacy };
  }

  getStorage() { return this.storage === undefined ? window.localStorage : this.storage; }
  setStatus(kind, message) {
    this.status = { kind, message };
    this.statusListeners.forEach(callback => callback(this.status));
  }
  pause(kind, message) { this.canPlay = false; this.setStatus(kind, message); return false; }

  load() {
    this.canPlay = false;
    try {
      const raw = this.getStorage().getItem(this.key);
      this.lastSavedRaw = raw;
      this.originalRaw = raw;
      const decoded = raw === null ? { data: GameState.fresh(this.now()), migrated: false } : GameState.decode(raw, this.now());
      this.data = decoded.data;
      this.pendingBackup = decoded.migrated ? raw : null;
      this.loaded = true;
      this.canPlay = this.writerCheck();
      if (!this.canPlay) return this.pause('writer-blocked', 'Pet is read-only: an exclusive save session is not available. Close other game tabs and reload in a browser supporting Web Locks on localhost or HTTPS.');
      this.setStatus('ready', decoded.migrated ? 'Older save loaded. Its original will be preserved before upgrading.' : 'Pet loaded. Saving in this browser.');
      return true;
    } catch (error) {
      this.loaded = false;
      return this.pause('recovery', `Pet paused: ${error.message}. Your stored save has not been replaced. Download the original, import a backup, or retry.`);
    }
  }

  preserve(raw) {
    if (raw === null) return;
    const storage = this.getStorage();
    let index = 0;
    let key;
    do { key = `${this.key}:recovery:${this.now()}:${index++}`; } while (storage.getItem(key) !== null);
    storage.setItem(key, raw);
    if (storage.getItem(key) !== raw) throw new Error('Recovery copy could not be verified');
    this.recoveryKey = key;
  }

  save() {
    if (!this.loaded) return false;
    if (!this.writerCheck()) return this.pause('writer-blocked', 'Pet is read-only: this tab does not own the save session. Download progress and close other game tabs before reloading.');
    try {
      const storage = this.getStorage();
      if (storage.getItem(this.key) !== this.lastSavedRaw) {
        return this.pause('conflict', 'Pet paused: the stored game changed in another tab. Download your current pet before reloading the page.');
      }
      const raw = JSON.stringify(this.data);
      GameState.decode(raw, this.now());
      if (this.pendingBackup !== null) { this.preserve(this.pendingBackup); this.pendingBackup = null; }
      storage.setItem(this.key, raw);
      if (storage.getItem(this.key) !== raw) throw new Error('Saved data could not be verified');
      this.lastSavedRaw = raw;
      this.canPlay = true;
      this.setStatus('saved', 'Saved in this browser. Download a backup before moving or clearing browser data.');
      return true;
    } catch (error) {
      return this.pause('save-error', `Pet paused: saving failed (${error.message}). Current progress is still in this tab. Download it, then retry saving.`);
    }
  }

  retry() { return this.loaded ? this.save() : this.load(); }

  replace(raw) {
    if (!this.writerCheck()) return this.pause('writer-blocked', 'Cannot replace a saved pet without an exclusive save session. Download your backup and reload after closing other tabs.');
    try {
      const decoded = GameState.decode(raw, this.now());
      const storage = this.getStorage();
      const existing = storage.getItem(this.key);
      if (existing !== this.lastSavedRaw) return this.pause('conflict', 'Stored game changed. Reload before replacing it; download this tab first.');
      this.preserve(existing);
      const encoded = JSON.stringify(decoded.data);
      storage.setItem(this.key, encoded);
      if (storage.getItem(this.key) !== encoded) throw new Error('Replacement could not be verified');
      this.data = decoded.data;
      this.lastSavedRaw = encoded;
      this.originalRaw = existing;
      this.pendingBackup = null;
      this.loaded = this.canPlay = true;
      this.setStatus('saved', 'Pet restored. The previous stored save has a recovery copy in this browser.');
      this.listeners.forEach(callback => callback(this.data));
      return true;
    } catch (error) {
      return this.pause('import-error', `Import was not completed: ${error.message}. Keep your backup; current progress remains available for download. Retry before continuing.`);
    }
  }

  exportCurrent() { return this.loaded ? JSON.stringify(this.data, null, 2) : null; }
  onChange(callback) { this.listeners.push(callback); }
  onStatus(callback) { this.statusListeners.push(callback); }
  notify() {
    this.save();
    this.listeners.forEach(callback => callback(this.data));
  }
}

if (typeof window !== 'undefined') window.gameState = new GameState({ writerCheck: () => false });
if (typeof module !== 'undefined') module.exports = GameState;
