/**
 * Farming Manager Subsystem
 */
class FarmingManager {
  constructor(state) {
    this.state = state;
  }

  plantSeed(plotId, cropId) {
    if (!this.state.canPlay) return false;
    const plot = this.state.data.farmPlots.find(p => p.id === plotId);
    const cropConfig = CONFIG.CROPS[cropId];
    if (!plot || plot.state !== 'empty' || !cropConfig) return false;

    if (this.state.data.gold < cropConfig.seedCost) {
      return { success: false, reason: 'Not enough gold!' };
    }

    this.state.data.gold -= cropConfig.seedCost;
    plot.state = 'planted';
    plot.cropId = cropId;
    plot.plantedAt = this.state.data.lastTimestamp;
    plot.growthSec = 0;
    this.state.notify();
    return { success: true };
  }

  harvestPlot(plotId) {
    if (!this.state.canPlay) return false;
    const plot = this.state.data.farmPlots.find(p => p.id === plotId);
    if (!plot || plot.state !== 'ready' || !plot.cropId) return false;

    const cropId = plot.cropId;
    // Add to inventory
    if (!this.state.data.inventory[cropId]) {
      this.state.data.inventory[cropId] = { count: 0, ageHours: 0, batches: [] };
    }
    const item = this.state.data.inventory[cropId];
    item.count += 1;
    const latest = item.batches[item.batches.length - 1];
    if (latest && latest.ageHours === 0) latest.count += 1;
    else item.batches.push({ count: 1, ageHours: 0 });
    item.ageHours = item.batches[0].ageHours;

    // Reset plot
    plot.state = 'empty';
    plot.cropId = null;
    plot.plantedAt = null;
    plot.growthSec = 0;

    this.state.notify();
    return { success: true, cropId };
  }

  updatePlots() {
    // Time and crop completion are advanced together by Progression.advanceTo.
    return this.state.data.farmPlots.filter(plot => plot.state === 'ready');
  }
}

if (typeof window !== 'undefined') {
  window.FarmingManager = FarmingManager;
}
if (typeof module !== 'undefined') {
  module.exports = FarmingManager;
}
