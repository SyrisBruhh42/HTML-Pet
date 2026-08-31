/**
 * Main Application Lifecycle, Loop, and Offline Time Catch-up
 */
class App {
  constructor() {
    this.state = window.gameState;
    this.state.load();

    this.canvas = document.getElementById('game-canvas');
    this.renderer = new Renderer(this.canvas, this.state);
    this.farmingMgr = new FarmingManager(this.state);
    this.combatEngine = new EncounterEngine(this.state);
    this.ui = new UIManager(this.state, this.farmingMgr, this.combatEngine, this.renderer);

    this.lastTick = Date.now();
    this.raidTimerSec = 0;
    this.RAID_INTERVAL_SEC = 90; // Automatic raid check every 90 seconds

    this.processOfflineTime();
    this.startLoop();
  }

  processOfflineTime() {
    const now = Date.now();
    const lastTimestamp = this.state.data.lastTimestamp || now;
    const elapsedSec = Math.max(0, (now - lastTimestamp) / 1000);
    const elapsedHours = elapsedSec / 3600;

    if (elapsedHours > 0.001) {
      const pet = this.state.data.pet;

      // 1. Hunger decay: 4% per hour
      const hungerLoss = elapsedHours * (CONFIG.HUNGER_DECAY_PER_HOUR * 100);
      pet.hunger = Math.max(0, pet.hunger - hungerLoss);

      // 2. Health decay: 1% per hour
      const hpLoss = elapsedHours * (CONFIG.HEALTH_DECAY_PER_HOUR * pet.maxHp);
      pet.hp = Math.max(1, pet.hp - hpLoss); // Keep at least 1 HP

      // 3. Track well-fed duration
      if (pet.hunger >= CONFIG.WELL_FED_HUNGER_THRESHOLD && pet.hp >= pet.maxHp) {
        pet.wellFedDurationSec += elapsedSec;
      } else {
        pet.wellFedDurationSec = 0;
      }

      // 4. Age food inventory
      Object.keys(this.state.data.inventory).forEach(cropId => {
        const item = this.state.data.inventory[cropId];
        if (item && item.count > 0) {
          item.ageHours = (item.ageHours || 0) + elapsedHours;
        }
      });

      // Automated offline raid checks if away for more than 15 mins
      if (elapsedHours >= 0.25) {
        const offlineRaidResult = this.combatEngine.triggerRaid();
        this.state.data.logs.unshift({
          timestamp: new Date().toLocaleTimeString(),
          text: `💤 Welcome back! While away (${elapsedHours.toFixed(1)} hrs), your pet faced an automated raid encounter!`,
          type: offlineRaidResult.type
        });
      }

      // Log offline decay summary if away for more than 5 minutes
      if (elapsedHours >= 0.08) {
        this.state.data.logs.unshift({
          timestamp: new Date().toLocaleTimeString(),
          text: `💤 Summary: Hunger reduced by ${hungerLoss.toFixed(1)}% and HP decreased by ${hpLoss.toFixed(1)}.`,
          type: 'win'
        });
      }
    }

    this.state.data.lastTimestamp = now;
    this.state.save();
    this.ui.renderHUD();
  }

  startLoop() {
    const loop = () => {
      const now = Date.now();
      const deltaSec = (now - this.lastTick) / 1000;
      this.lastTick = now;

      // Realtime decay & updates (every second)
      this.tickRealtime(deltaSec);

      // Update farm growth
      this.farmingMgr.updatePlots();

      // Render graphics canvas
      this.renderer.render();

      requestAnimationFrame(loop);
    };

    requestAnimationFrame(loop);
  }

  tickRealtime(deltaSec) {
    const pet = this.state.data.pet;
    const deltaHours = deltaSec / 3600;

    // Decay rates
    const hungerLoss = deltaHours * (CONFIG.HUNGER_DECAY_PER_HOUR * 100);
    pet.hunger = Math.max(0, pet.hunger - hungerLoss);

    const hpLoss = deltaHours * (CONFIG.HEALTH_DECAY_PER_HOUR * pet.maxHp);
    pet.hp = Math.max(1, pet.hp - hpLoss);

    // Track well-fed duration
    if (pet.hunger >= CONFIG.WELL_FED_HUNGER_THRESHOLD && pet.hp >= pet.maxHp) {
      pet.wellFedDurationSec += deltaSec;
    } else {
      pet.wellFedDurationSec = 0;
    }

    // Automatic Raid Event Timer
    this.raidTimerSec += deltaSec;
    if (this.raidTimerSec >= this.RAID_INTERVAL_SEC) {
      this.raidTimerSec = 0;
      this.combatEngine.triggerRaid();
    }

    // Save timestamp periodically
    this.state.data.lastTimestamp = Date.now();

    // Trigger state notification for UI updates every frame
    this.ui.renderHUD();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
});
