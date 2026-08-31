/**
 * UI Overlay & Modal Handlers
 */
class UIManager {
  constructor(state, farmingMgr, combatEngine, renderer) {
    this.state = state;
    this.farmingMgr = farmingMgr;
    this.combatEngine = combatEngine;
    this.renderer = renderer;

    this.pendingFeedCropId = null;

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    this.hpText = document.getElementById('hp-text');
    this.hpBar = document.getElementById('hp-bar');
    this.hungerText = document.getElementById('hunger-text');
    this.hungerBar = document.getElementById('hunger-bar');
    this.levelVal = document.getElementById('level-val');
    this.xpText = document.getElementById('xp-text');
    this.xpBar = document.getElementById('xp-bar');
    this.goldVal = document.getElementById('gold-val');

    this.modalOverlay = document.getElementById('modal-overlay');
    this.inventoryGrid = document.getElementById('inventory-grid');
    this.plotsContainer = document.getElementById('plots-container');
    this.combatLog = document.getElementById('combat-log');

    this.toggleConfirm = document.getElementById('toggle-confirm');
    this.confirmDialog = document.getElementById('confirm-feed-dialog');
    this.confirmMsg = document.getElementById('confirm-dialog-msg');
  }

  bindEvents() {
    // Navigation Modal Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetId = e.currentTarget.getAttribute('data-target');
        this.openModal(targetId);
      });
    });

    // Close Modal Buttons
    document.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => this.closeModals());
    });

    // Click outside modal
    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) {
        this.closeModals();
      }
    });

    // Toggle confirm checkbox
    this.toggleConfirm.addEventListener('change', (e) => {
      this.state.data.settings.confirmFeed = e.target.checked;
      this.state.save();
    });

    // Confirm Feed Buttons
    document.getElementById('confirm-yes-btn').addEventListener('click', () => {
      if (this.pendingFeedCropId) {
        this.executeFeed(this.pendingFeedCropId);
        this.pendingFeedCropId = null;
      }
      this.confirmDialog.classList.add('hidden');
    });

    document.getElementById('confirm-no-btn').addEventListener('click', () => {
      this.pendingFeedCropId = null;
      this.confirmDialog.classList.add('hidden');
    });

    // Trigger Raid Test Button
    document.getElementById('trigger-raid-btn').addEventListener('click', () => {
      this.combatEngine.triggerRaid();
      this.renderLog();
    });

    // Buy Plot Button
    const buyPlotBtn = document.getElementById('buy-plot-btn');
    if (buyPlotBtn) {
      buyPlotBtn.addEventListener('click', () => {
        if (this.state.data.gold >= 100) {
          this.state.data.gold -= 100;
          const newId = this.state.data.farmPlots.length;
          this.state.data.farmPlots.push({ id: newId, state: 'empty', cropId: null, plantedAt: null });
          this.state.notify();
          alert(`🎉 Success! Purchased Farm Plot #${newId + 1}`);
        } else {
          alert('Not enough gold! Need 100g');
        }
      });
    }

    // Buy Heal Kit Button
    const buyHealBtn = document.getElementById('buy-heal-btn');
    if (buyHealBtn) {
      buyHealBtn.addEventListener('click', () => {
        const pet = this.state.data.pet;
        if (this.state.data.gold >= 30) {
          this.state.data.gold -= 30;
          pet.hp = Math.min(pet.maxHp, pet.hp + 30);
          this.state.notify();
          alert('💖 Emergency Heal Kit used! Restored 30 HP.');
        } else {
          alert('Not enough gold! Need 30g');
        }
      });
    }

    // Listen to state changes
    this.state.onChange(() => this.renderHUD());
  }

  openModal(modalId) {
    this.modalOverlay.classList.remove('hidden');
    document.querySelectorAll('.folder-modal').forEach(m => m.classList.add('hidden'));

    const targetModal = document.getElementById(modalId);
    if (targetModal) {
      targetModal.classList.remove('hidden');
    }

    if (modalId === 'feed-modal') this.renderInventory();
    if (modalId === 'farm-modal') this.renderFarmPlots();
    if (modalId === 'log-modal') this.renderLog();
  }

  closeModals() {
    this.modalOverlay.classList.add('hidden');
    document.querySelectorAll('.folder-modal').forEach(m => m.classList.add('hidden'));
    this.confirmDialog.classList.add('hidden');
  }

  renderHUD() {
    const pet = this.state.data.pet;

    // HP
    this.hpText.textContent = `${Math.floor(pet.hp)} / ${Math.floor(pet.maxHp)}`;
    const hpPct = Math.max(0, Math.min(100, (pet.hp / pet.maxHp) * 100));
    this.hpBar.style.width = `${hpPct}%`;

    // Hunger
    this.hungerText.textContent = `${Math.floor(pet.hunger)}%`;
    this.hungerBar.style.width = `${Math.max(0, Math.min(100, pet.hunger))}%`;

    // Level & XP (Food Quality)
    this.levelVal.textContent = pet.level;
    this.xpText.textContent = `${Math.floor(pet.cumulativeFoodQuality)} / ${pet.requiredQualityForNextLevel} Quality`;
    const xpPct = Math.min(100, (pet.cumulativeFoodQuality / pet.requiredQualityForNextLevel) * 100);
    this.xpBar.style.width = `${xpPct}%`;

    // Gold
    this.goldVal.textContent = this.state.data.gold;

    // Toggle confirm checkbox sync
    this.toggleConfirm.checked = !!this.state.data.settings.confirmFeed;
  }

  renderInventory() {
    this.inventoryGrid.innerHTML = '';
    const inventory = this.state.data.inventory;

    Object.keys(CONFIG.CROPS).forEach(cropId => {
      const config = CONFIG.CROPS[cropId];
      const item = inventory[cropId] || { count: 0, ageHours: 0 };

      const card = document.createElement('div');
      card.className = 'item-card';
      if (item.count <= 0) card.style.opacity = '0.5';

      // Food quality degradation calculation
      const qualityFactor = Math.max(
        CONFIG.MIN_FOOD_QUALITY_RATIO,
        1 - (item.ageHours / CONFIG.FOOD_AGE_DECAY_HOURS)
      );
      const currentQuality = Math.floor(config.qualityRating * qualityFactor);

      card.innerHTML = `
        <div class="item-icon">${config.icon}</div>
        <div class="item-name">${config.name}</div>
        <div class="item-qty">Qty: ${item.count}</div>
        <div class="item-quality">Quality: ${currentQuality}</div>
      `;

      card.addEventListener('click', () => {
        if (item.count > 0) {
          this.handleFeedClick(cropId, config, currentQuality);
        }
      });

      this.inventoryGrid.appendChild(card);
    });
  }

  handleFeedClick(cropId, config, currentQuality) {
    if (this.state.data.settings.confirmFeed) {
      this.pendingFeedCropId = cropId;
      this.confirmMsg.textContent = `Feed 1 ${config.name} (Quality: ${currentQuality}) to your slime?`;
      this.confirmDialog.classList.remove('hidden');
    } else {
      this.executeFeed(cropId);
    }
  }

  executeFeed(cropId) {
    const config = CONFIG.CROPS[cropId];
    const inventory = this.state.data.inventory;
    const pet = this.state.data.pet;

    if (!config || !inventory[cropId] || inventory[cropId].count <= 0) return;

    // Deduct food item
    inventory[cropId].count -= 1;

    // Quality calculation
    const ageHours = inventory[cropId].ageHours || 0;
    const qualityFactor = Math.max(
      CONFIG.MIN_FOOD_QUALITY_RATIO,
      1 - (ageHours / CONFIG.FOOD_AGE_DECAY_HOURS)
    );
    const effectiveQuality = config.qualityRating * qualityFactor;

    // 1. Hunger restoration
    const hungerGain = config.hungerRestore;
    const wasFullHunger = pet.hunger >= CONFIG.WELL_FED_HUNGER_THRESHOLD;
    pet.hunger = Math.min(pet.maxHunger, pet.hunger + hungerGain);

    // 2. Health restore condition:
    // "Feeding only increases health if pet is at full health and food for at least 24hrs"
    const wasFullHealth = pet.hp >= pet.maxHp;
    if (wasFullHealth && wasFullHunger && pet.wellFedDurationSec >= CONFIG.HEALTH_INCREASE_REQ_HOURS * 3600) {
      pet.hp = Math.min(pet.maxHp, pet.hp + 10);
    }

    // 3. XP / Level Growth:
    // If hunger is saturated >= 90%, excess food converts into Level XP
    pet.cumulativeFoodQuality += effectiveQuality;

    // Check Level Up
    if (pet.cumulativeFoodQuality >= pet.requiredQualityForNextLevel) {
      pet.level += 1;
      pet.cumulativeFoodQuality -= pet.requiredQualityForNextLevel;

      // Stat Increases
      pet.scale += CONFIG.SIZE_INCREASE_PER_LEVEL;
      pet.maxHp = Math.floor(pet.maxHp * (1 + CONFIG.MAX_HEALTH_INCREASE_PER_LEVEL));
      pet.hp = pet.maxHp; // Refill HP on level up
      pet.requiredQualityForNextLevel = Math.floor(pet.maxHp); // XP req equals total health points

      // Log level up
      this.state.data.logs.unshift({
        timestamp: new Date().toLocaleTimeString(),
        text: `🎉 LEVEL UP! Slime reached Level ${pet.level}! Size increased and Max HP grew to ${pet.maxHp}!`,
        type: 'crit-win'
      });
    }

    // Aura Effect & Bounce
    this.renderer.triggerFeedAura();

    this.state.notify();
    this.renderInventory();
  }

  renderFarmPlots() {
    this.plotsContainer.innerHTML = '';
    const plots = this.state.data.farmPlots;

    plots.forEach(plot => {
      const card = document.createElement('div');
      card.className = 'plot-card';

      let statusMsg = 'Empty Plot';
      let actionBtn = '';

      if (plot.state === 'empty') {
        statusMsg = 'Empty';
        // Options to plant seed
        actionBtn = `
          <select class="seed-select" data-plot="${plot.id}">
            <option value="">Select Seed</option>
            <option value="berry">Berry (5g - 30s)</option>
            <option value="root">Carrot (15g - 2m)</option>
            <option value="crystal">Mana (50g - 5m)</option>
          </select>
          <button class="pixel-btn success plant-btn" data-plot="${plot.id}">Plant</button>
        `;
      } else if (plot.state === 'planted') {
        const crop = CONFIG.CROPS[plot.cropId];
        const elapsed = (Date.now() - plot.plantedAt) / 1000;
        const remaining = Math.max(0, Math.ceil(crop.growTimeSec - elapsed));
        statusMsg = `Growing ${crop.icon} ${crop.name}<br>(${remaining}s left)`;
        actionBtn = `<button class="pixel-btn" disabled>Growing...</button>`;
      } else if (plot.state === 'ready') {
        const crop = CONFIG.CROPS[plot.cropId];
        statusMsg = `Ready to Harvest! ${crop.icon} ${crop.name}`;
        actionBtn = `<button class="pixel-btn success harvest-btn" data-plot="${plot.id}">Harvest ${crop.icon}</button>`;
      }

      card.innerHTML = `
        <div style="font-weight: bold;">Plot #${plot.id + 1}</div>
        <div class="plot-status">${statusMsg}</div>
        <div>${actionBtn}</div>
      `;

      this.plotsContainer.appendChild(card);
    });

    // Event listeners for plant/harvest
    this.plotsContainer.querySelectorAll('.plant-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const plotId = parseInt(e.target.getAttribute('data-plot'));
        const select = this.plotsContainer.querySelector(`select[data-plot="${plotId}"]`);
        const cropId = select.value;
        if (cropId) {
          const res = this.farmingMgr.plantSeed(plotId, cropId);
          if (res && !res.success) {
            alert(res.reason || 'Could not plant seed');
          } else {
            this.renderFarmPlots();
          }
        }
      });
    });

    this.plotsContainer.querySelectorAll('.harvest-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const plotId = parseInt(e.target.getAttribute('data-plot'));
        this.farmingMgr.harvestPlot(plotId);
        this.renderFarmPlots();
      });
    });
  }

  renderLog() {
    this.combatLog.innerHTML = '';
    const logs = this.state.data.logs;

    if (logs.length === 0) {
      this.combatLog.innerHTML = '<div class="log-entry">No encounters recorded yet.</div>';
      return;
    }

    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.type || ''}`;
      entry.innerHTML = `<strong>[${log.timestamp}]</strong> ${log.text}`;
      this.combatLog.appendChild(entry);
    });
  }
}

window.UIManager = UIManager;
