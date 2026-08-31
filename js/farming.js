/**
 * Farming Manager Subsystem
 */
class FarmingManager {
  constructor(state) {
    this.state = state;
  }

  plantSeed(plotId, cropId) {
    const plot = this.state.data.farmPlots.find(p => p.id === plotId);
    const cropConfig = CONFIG.CROPS[cropId];
    if (!plot || plot.state !== 'empty' || !cropConfig) return false;

    if (this.state.data.gold < cropConfig.seedCost) {
      return { success: false, reason: 'Not enough gold!' };
    }

    this.state.data.gold -= cropConfig.seedCost;
    plot.state = 'planted';
    plot.cropId = cropId;
    plot.plantedAt = Date.now();
    this.state.notify();
    return { success: true };
  }

  harvestPlot(plotId) {
    const plot = this.state.data.farmPlots.find(p => p.id === plotId);
    if (!plot || plot.state !== 'ready' || !plot.cropId) return false;

    const cropId = plot.cropId;
    // Add to inventory
    if (!this.state.data.inventory[cropId]) {
      this.state.data.inventory[cropId] = { count: 0, ageHours: 0 };
    }
    this.state.data.inventory[cropId].count += 1;

    // Reset plot
    plot.state = 'empty';
    plot.cropId = null;
    plot.plantedAt = null;

    this.state.notify();
    return { success: true, cropId };
  }

  updatePlots() {
    const now = Date.now();
    let updated = false;

    this.state.data.farmPlots.forEach(plot => {
      if (plot.state === 'planted' && plot.cropId) {
        const cropConfig = CONFIG.CROPS[plot.cropId];
        const elapsedSec = (now - plot.plantedAt) / 1000;
        if (elapsedSec >= cropConfig.growTimeSec) {
          plot.state = 'ready';
          updated = true;
        }
      }
    });

    if (updated) {
      this.state.notify();
    }
  }
}

if (typeof window !== 'undefined') {
  window.FarmingManager = FarmingManager;
}
if (typeof module !== 'undefined') {
  module.exports = FarmingManager;
}
