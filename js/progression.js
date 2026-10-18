/** Shared elapsed-time and feeding rules, independent of rendering or storage. */
class Progression {
  constructor(state, config = CONFIG) { this.state = state; this.config = config; }

  canAdvance(seconds) {
    const data = this.state.data, pet = data.pet, c = this.config;
    const eligible = Math.max(0, Math.min(seconds,
      (pet.hunger - c.WELL_FED_HUNGER_THRESHOLD * pet.maxHunger / 100) / (c.HUNGER_DECAY_PER_HOUR * pet.maxHunger / 3600),
      (pet.hp - c.WELL_FED_HEALTH_RATIO * pet.maxHp) / (c.HEALTH_DECAY_PER_HOUR * pet.maxHp / 3600)));
    if (pet.wellFedDurationSec + eligible > Number.MAX_SAFE_INTEGER ||
        Object.values(data.inventory).some(item => item.batches.some(batch => batch.ageHours + seconds / 3600 > Number.MAX_SAFE_INTEGER))) {
      this.state.pause('progress-limit', 'Pet paused at the supported time-record limit. Existing care, food and crop progress were kept. Download your pet before continuing with a newer game version.');
      return false;
    }
    return true;
  }

  advanceStats(seconds) {
    if (!(seconds > 0) || !Number.isFinite(seconds)) return;
    if (!this.canAdvance(seconds)) return;
    const data = this.state.data;
    const pet = data.pet;
    const c = this.config;
    const hungerRate = c.HUNGER_DECAY_PER_HOUR * pet.maxHunger / 3600;
    const healthRate = c.HEALTH_DECAY_PER_HOUR * pet.maxHp / 3600;
    const eligible = Math.max(0, Math.min(seconds,
      (pet.hunger - c.WELL_FED_HUNGER_THRESHOLD * pet.maxHunger / 100) / hungerRate,
      (pet.hp - c.WELL_FED_HEALTH_RATIO * pet.maxHp) / healthRate));
    pet.wellFedDurationSec += eligible;
    pet.hunger = Math.max(0, pet.hunger - hungerRate * seconds);
    pet.hp = Math.max(Math.min(1, pet.hp), pet.hp - healthRate * seconds);
    for (const item of Object.values(data.inventory)) {
      for (const batch of item.batches) batch.ageHours += seconds / 3600;
      item.ageHours = item.batches[0]?.ageHours || 0;
    }
    for (const plot of data.farmPlots) {
      if (plot.state !== 'planted') continue;
      plot.growthSec = Math.min(c.CROPS[plot.cropId].growTimeSec, plot.growthSec + seconds);
      if (plot.growthSec >= c.CROPS[plot.cropId].growTimeSec) plot.state = 'ready';
    }
  }

  advanceTo(now, active = false, raid = () => {}) {
    if (!this.state.canPlay || !Number.isFinite(now)) return { seconds: 0, clockBackwards: false };
    const data = this.state.data;
    if (now < data.lastTimestamp) return { seconds: 0, clockBackwards: true };
    let remaining = (now - data.lastTimestamp) / 1000;
    const seconds = remaining;
    if (!this.canAdvance(seconds)) return { seconds: 0, clockBackwards: false };
    active = active && seconds <= this.config.MAX_ACTIVE_GAP_SEC;
    while (active && remaining > 0) {
      const step = Math.min(remaining, this.config.RAID_INTERVAL_SEC - data.timing.raidElapsedSec);
      this.advanceStats(step);
      data.timing.raidElapsedSec += step;
      remaining -= step;
      if (data.timing.raidElapsedSec >= this.config.RAID_INTERVAL_SEC - 1e-9) {
        data.timing.raidElapsedSec = 0;
        raid();
      }
    }
    if (!active) this.advanceStats(remaining);
    data.lastTimestamp = now;
    return { seconds, clockBackwards: false };
  }

  foodQuality(cropId) {
    const item = this.state.data.inventory[cropId];
    const age = item?.batches[0]?.ageHours || 0;
    return this.config.CROPS[cropId].qualityRating * Math.max(this.config.MIN_FOOD_QUALITY_RATIO,
      1 - age / this.config.FOOD_AGE_DECAY_HOURS);
  }

  feed(cropId) {
    if (!this.state.canPlay) return false;
    const data = this.state.data;
    const item = data.inventory[cropId];
    const crop = this.config.CROPS[cropId];
    if (!crop || !item?.count) return false;
    const pet = data.pet;
    // Plan the entire feeding before spending an item or changing earned progress.
    const next = { ...pet };
    const messages = [];
    const bounded = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
    const refuse = () => {
      this.state.pause('progress-limit', 'Pet paused at the supported numeric limit. No food or earned care was spent. Download your current pet before continuing with a newer game version.');
      return false;
    };
    const careSeconds = this.config.HEALTH_INCREASE_REQ_HOURS * 3600;
    next.hunger = Math.min(next.maxHunger, next.hunger + crop.hungerRestore);
    next.cumulativeFoodQuality += this.foodQuality(cropId);
    if (!bounded(next.cumulativeFoodQuality)) return refuse();
    if (next.wellFedDurationSec >= careSeconds) {
      next.maxHp += this.config.CARE_HEALTH_REWARD;
      if (!bounded(next.maxHp) || next.maxHp <= pet.maxHp) return refuse();
      next.wellFedDurationSec -= careSeconds;
      next.hp = Math.min(next.maxHp, next.hp + this.config.CARE_HEALTH_REWARD);
      messages.push(`Care reward: maximum health grew by ${this.config.CARE_HEALTH_REWARD}. Thank you for caring for your pet!`);
    }
    while (next.cumulativeFoodQuality >= next.requiredQualityForNextLevel) {
      const nextHp = Math.max(next.maxHp + 1, Math.floor(next.maxHp * (1 + this.config.MAX_HEALTH_INCREASE_PER_LEVEL)));
      const nextScale = next.scale + this.config.SIZE_INCREASE_PER_LEVEL;
      if (!Number.isSafeInteger(nextHp) || !Number.isSafeInteger(next.level + 1) ||
          !bounded(nextScale) || nextScale <= next.scale) return refuse();
      next.cumulativeFoodQuality -= next.requiredQualityForNextLevel;
      next.level += 1;
      next.scale = nextScale;
      next.maxHp = nextHp;
      next.hp = nextHp;
      next.requiredQualityForNextLevel = nextHp;
      messages.push(`LEVEL UP! Your slime reached level ${next.level}; maximum health is ${next.maxHp}.`);
    }
    Object.assign(pet, next);
    item.batches[0].count -= 1;
    if (!item.batches[0].count) item.batches.shift();
    item.count -= 1;
    item.ageHours = item.batches[0]?.ageHours || 0;
    for (const message of messages) this.log(message);
    return true;
  }

  log(text) {
    this.state.data.logs.unshift({ timestamp: new Date(this.state.data.lastTimestamp).toLocaleTimeString(), text, type: 'crit-win' });
    this.state.data.logs = this.state.data.logs.slice(0, 30);
  }
}

if (typeof window !== 'undefined') window.Progression = Progression;
if (typeof module !== 'undefined') module.exports = Progression;
