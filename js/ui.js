/**
 * UI Overlay & Modal Handlers
 */
class UIManager {
  constructor(state, farmingMgr, combatEngine, renderer, progression) {
    this.state = state;
    this.farmingMgr = farmingMgr;
    this.combatEngine = combatEngine;
    this.renderer = renderer;
    this.progression = progression;
    this.upgrades = new Upgrades(state);
    this.beforeAction = () => {};

    this.pendingFeedCropId = null;

    this.initDOM();
    this.bindEvents();
    this.recoveryRequest = 0;
    this.recoveryDialog = new RecoveryDialog({ state, document, report: (message, error) => this.reportRecovery(message, error) });
    this.bindRecovery();
  }

  initDOM() {
    this.hpText = document.getElementById('hp-text');
    this.careText = document.getElementById('care-text');
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
      // Advancing elapsed time refreshes the HUD, including this checkbox.
      const requested = e.target.checked;
      if (!this.allowAction()) { this.renderHUD(); return; }
      this.state.data.settings.confirmFeed = requested;
      this.state.save();
      this.renderHUD();
    });

    // Confirm Feed Buttons
    document.getElementById('confirm-yes-btn').addEventListener('click', () => {
      if (!this.confirmDialog.open || !this.pendingFeedCropId) return;
      const cropId = this.pendingFeedCropId;
      if (this.pendingFeedData !== this.state.data) {
        this.finishFeedReview(cropId);
        document.getElementById('feeding-status').textContent = 'Your pet changed during this review. No food was spent; choose food again for the current pet.';
        return;
      }
      this.pendingFeedCropId = null; // A second activation cannot feed twice.
      this.executeFeed(cropId);
      this.finishFeedReview(cropId);
    });

    document.getElementById('confirm-no-btn').addEventListener('click', () => {
      this.finishFeedReview();
    });
    this.confirmDialog.addEventListener('cancel', event => {
      event.preventDefault();
      this.finishFeedReview();
    });

    // Trigger Raid Test Button
    document.getElementById('trigger-raid-btn').addEventListener('click', () => {
      if (!this.allowAction()) return;
      this.combatEngine.triggerRaid();
      this.renderLog();
    });

    const shopAction = action => {
      const previousFocus = document.activeElement;
      if (!this.allowAction()) return;
      const result = action();
      document.getElementById('shop-status').textContent = result.message;
      this.renderUpgrades();
      if (previousFocus?.disabled) document.getElementById('shop-status').focus();
    };
    document.getElementById('buy-plot-btn').addEventListener('click', () => shopAction(() => this.upgrades.buyPlot()));
    document.getElementById('buy-heal-btn').addEventListener('click', () => shopAction(() => this.upgrades.buyHealKit()));

    // Listen to state changes
    this.state.onChange(() => {
      this.renderHUD();
      if (!document.getElementById('feed-modal').classList.contains('hidden')) this.renderInventory();
      if (!document.getElementById('farm-modal').classList.contains('hidden')) this.renderFarmPlots();
      if (!document.getElementById('log-modal').classList.contains('hidden')) this.renderLog();
      if (!document.getElementById('upgrades-modal').classList.contains('hidden')) this.renderUpgrades();
    });
    document.addEventListener('keydown', event => {
      if (this.recoveryDialog?.isOpen() || this.confirmDialog.open) return;
      if (this.modalOverlay.classList.contains('hidden')) return;
      if (event.key === 'Escape') this.closeModals();
      if (event.key !== 'Tab') return;
      const focusable = [...this.modalOverlay.querySelectorAll('button, select, input')]
        .filter(el => !el.disabled && el.offsetParent !== null);
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    });
  }

  openModal(modalId) {
    this.lastFocus = document.activeElement;
    this.modalOverlay.classList.remove('hidden');
    document.querySelectorAll('.folder-modal').forEach(m => m.classList.add('hidden'));

    const targetModal = document.getElementById(modalId);
    if (targetModal) {
      targetModal.classList.remove('hidden');
      targetModal.querySelector('button')?.focus();
    }

    if (modalId === 'feed-modal') this.renderInventory();
    if (modalId === 'farm-modal') this.renderFarmPlots();
    if (modalId === 'log-modal') this.renderLog();
    if (modalId === 'upgrades-modal') this.renderUpgrades();
  }

  closeModals() {
    this.finishFeedReview();
    this.modalOverlay.classList.add('hidden');
    document.querySelectorAll('.folder-modal').forEach(m => m.classList.add('hidden'));
    this.lastFocus?.focus();
  }

  renderHUD() {
    const pet = this.state.data.pet;

    const careHours = pet.wellFedDurationSec / 3600;
    const ready = Math.floor(careHours / CONFIG.HEALTH_INCREASE_REQ_HOURS);
    this.careText.textContent = ready > 0
      ? `Care reward ready (${ready}): feed for +${CONFIG.CARE_HEALTH_REWARD} maximum HP`
      : `Care: ${careHours.toFixed(1)} / ${CONFIG.HEALTH_INCREASE_REQ_HOURS} hours · keep food and health at 90%+`;

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

    const gear = Upgrades.loadout(this.state.data);
    document.getElementById('game-canvas').setAttribute('aria-label',
      `${pet.name}, level ${pet.level}, ${Math.floor(pet.hp)} of ${Math.floor(pet.maxHp)} health. ${this.state.data.farmPlots.length} garden plots. ${gear.equipped ? CONFIG.EQUIPMENT[gear.equipped].name + ' equipped.' : 'No equipment equipped.'}`);

    // Toggle confirm checkbox sync
    this.toggleConfirm.checked = !!this.state.data.settings.confirmFeed;
  }

  renderUpgrades() {
    const data = this.state.data, gear = Upgrades.loadout(data);
    document.getElementById('equipment-status').textContent = gear.equipped
      ? `${CONFIG.EQUIPMENT[gear.equipped].name} equipped: +${Upgrades.defenseBonus(data)} defense.`
      : 'No equipment equipped. Purchased items remain yours when removed.';
    document.getElementById('buy-plot-btn').disabled = !this.state.canPlay || data.gold < 100;
    document.getElementById('buy-heal-btn').disabled = !this.state.canPlay || data.gold < 30 || data.pet.hp >= data.pet.maxHp;
    const grid = document.getElementById('equipment-grid');
    const focused = document.activeElement?.dataset.equipmentId;
    grid.replaceChildren();
    for (const item of Object.values(CONFIG.EQUIPMENT)) {
      const card = document.createElement('div'); card.className = 'upgrade-card';
      const title = document.createElement('h3'); title.textContent = `${item.icon} ${item.name}`;
      const detail = document.createElement('p');
      detail.textContent = `+${item.defense} defense · level ${item.level} · ${item.cost} gold · one-time purchase`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'pixel-btn';
      button.dataset.gameAction = ''; button.dataset.equipmentId = item.id;
      const owned = gear.owned.includes(item.id), equipped = gear.equipped === item.id;
      button.textContent = equipped ? 'Remove' : owned ? 'Equip' : data.pet.level < item.level ? `Unlocks at level ${item.level}` : 'Purchase';
      button.setAttribute('aria-label', `${button.textContent} ${item.name}`);
      button.disabled = !this.state.canPlay || (!owned && (data.gold < item.cost || data.pet.level < item.level));
      button.addEventListener('click', () => {
        if (!this.allowAction()) return;
        const result = owned ? this.upgrades.equip(equipped ? null : item.id) : this.upgrades.buyEquipment(item.id);
        document.getElementById('shop-status').textContent = result.message;
        this.renderUpgrades();
        grid.querySelector(`[data-equipment-id="${item.id}"]`)?.focus();
      });
      card.append(title, detail, button); grid.appendChild(card);
    }
    if (focused) {
      const replacement = grid.querySelector(`[data-equipment-id="${focused}"]`);
      if (replacement?.disabled) {
        const status = document.getElementById('shop-status');
        status.textContent = this.state.canPlay ? 'This equipment is currently unavailable.' : this.state.status.message;
        status.focus();
      } else replacement?.focus();
    }
  }

  renderInventory() {
    const focusedCrop = document.activeElement?.dataset.cropId;
    this.inventoryGrid.innerHTML = '';
    const inventory = this.state.data.inventory;

    Object.keys(CONFIG.CROPS).forEach(cropId => {
      const config = CONFIG.CROPS[cropId];
      const item = inventory[cropId] || { count: 0, ageHours: 0 };

      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'item-card';
      card.dataset.cropId = cropId;
      card.disabled = !this.state.canPlay || item.count <= 0;
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
    if (focusedCrop) this.focusFood(focusedCrop);
  }

  handleFeedClick(cropId, config, currentQuality) {
    if (this.confirmDialog.open || this.pendingFeedCropId) return;
    if (this.state.data.settings.confirmFeed) {
      if (!this.allowAction()) return;
      const status = document.getElementById('feeding-status');
      if (typeof this.confirmDialog.showModal !== 'function') {
        status.textContent = 'Feeding confirmation needs HTML dialog support. Your food was kept.';
        status.focus();
        return;
      }
      this.pendingFeedCropId = cropId;
      this.pendingFeedData = this.state.data;
      currentQuality = Math.floor(this.progression.foodQuality(cropId));
      this.confirmMsg.textContent = `Feed 1 ${config.name} to your slime? Quality now: ${currentQuality}. Food continues to age until fed.`;
      try {
        this.confirmDialog.showModal();
        document.getElementById('confirm-no-btn').focus();
        status.textContent = '';
      } catch {
        this.pendingFeedCropId = null;
        this.pendingFeedData = null;
        status.textContent = 'The feeding dialog could not open. Your food was kept. Close other dialogs and try again.';
        status.focus();
      }
    } else {
      this.executeFeed(cropId);
    }
  }

  finishFeedReview(cropId = this.pendingFeedCropId) {
    this.pendingFeedCropId = null;
    this.pendingFeedData = null;
    if (this.confirmDialog?.open) this.confirmDialog.close();
    if (!cropId) return;
    this.focusFood(cropId);
  }

  focusFood(cropId) {
    const food = this.inventoryGrid.querySelector(`[data-crop-id="${cropId}"]`);
    const target = food && !food.disabled ? food : document.getElementById('feed-modal').querySelector('.close-btn');
    target?.focus();
  }

  executeFeed(cropId) {
    if (!this.allowAction() || !this.progression.feed(cropId)) return;
    this.renderer.triggerFeedAura();
    this.state.notify();
    this.renderInventory();
  }

  renderFarmPlots() {
    this.plotsContainer.innerHTML = '';
    const plots = this.state.data.farmPlots;
    this.farmSignature = plots.map(plot => `${plot.id}:${plot.state}`).join('|');

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
        const elapsed = plot.growthSec;
        const remaining = Math.max(0, Math.ceil(crop.growTimeSec - elapsed));
        statusMsg = `Growing ${crop.icon} ${crop.name}<br><span class="plot-countdown" data-plot="${plot.id}">(${remaining}s left)</span>`;
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
        if (!this.allowAction()) return;
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
        if (!this.allowAction()) return;
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
      const time = document.createElement('strong');
      time.textContent = `[${log.timestamp}] `;
      entry.append(time, document.createTextNode(log.text));
      this.combatLog.appendChild(entry);
    });
  }

  allowAction() { this.beforeAction(); return this.state.canPlay; }

  refreshOpenFarm() {
    if (document.getElementById('farm-modal').classList.contains('hidden')) return;
    const plots = this.state.data.farmPlots;
    const signature = plots.map(plot => `${plot.id}:${plot.state}`).join('|');
    if (signature !== this.farmSignature) { this.renderFarmPlots(); return; }
    this.plotsContainer.querySelectorAll('.plot-countdown').forEach(label => {
      const plot = plots.find(item => item.id === Number(label.dataset.plot));
      label.textContent = `(${Math.max(0, Math.ceil(CONFIG.CROPS[plot.cropId].growTimeSec - plot.growthSec))}s left)`;
    });
  }

  renderClockStatus(backwards) {
    const notice = document.getElementById('clock-status');
    notice.hidden = !backwards;
    notice.textContent = backwards ? 'Your clock moved backwards. Time progress is paused until it catches up; earned progress is kept.' : '';
  }

  download(raw, name) {
    if (raw === null) return;
    const preview = document.getElementById('backup-preview');
    const text = document.getElementById('backup-text');
    preview.hidden = false;
    text.value = raw;
    text.focus(); text.select();
    try {
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      document.getElementById('save-status').textContent = 'Download could not start. Your exact backup text is selected below; copy it into a file and keep it safe.';
    }
  }

  reportRecovery(message, error = false) {
    const feedback = document.getElementById('recovery-status');
    feedback.setAttribute('role', error ? 'alert' : 'status');
    feedback.textContent = message;
    feedback.hidden = false;
    document.getElementById('save-tools').open = true;
    if (error) feedback.focus();
  }

  restoreBackup(raw, options) {
    // A delayed file read may finish after a feeding review has opened.
    // Recovery supersedes that review; its approval must never target a new pet.
    this.finishFeedReview();
    return this.recoveryDialog.review(raw, options);
  }

  bindRecovery() {
    const panel = document.getElementById('save-tools');
    const recoverySelect = document.getElementById('recovery-select');
    const update = () => {
      document.getElementById('save-status').textContent = this.state.status.message;
      document.getElementById('save-panel').classList.toggle('save-problem', !this.state.canPlay);
      if (!this.state.canPlay && this.state.status.kind !== 'loading') panel.open = true;
      this.renderHUD();
      document.getElementById('export-save-btn').disabled = !this.state.loaded;
      document.getElementById('export-original-btn').disabled = this.state.originalRaw === null;
      document.querySelectorAll('[data-game-action]').forEach(el => { el.disabled = !this.state.canPlay; });
      // Autosave emits status without an onChange event. Restore the shop's
      // gold, health and unlock constraints after the general session guard.
      if (!document.getElementById('upgrades-modal').classList.contains('hidden')) this.renderUpgrades();
      try {
        const storage = this.state.getStorage();
        const keys = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key?.startsWith(`${this.state.key}:recovery:`)) keys.push(key);
        }
        const signature = keys.sort().join('|');
        if (signature !== this.recoverySignature) {
          this.recoverySignature = signature;
          recoverySelect.replaceChildren();
          keys.reverse().forEach((key, index) => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = `Recovery ${index + 1}: ${new Date(Number(key.split(':')[2])).toLocaleString()}`;
            recoverySelect.appendChild(option);
          });
        }
        document.getElementById('export-recovery-btn').disabled = !keys.length;
      } catch { document.getElementById('export-recovery-btn').disabled = true; }
    };
    this.state.onStatus(update);
    document.getElementById('export-save-btn').addEventListener('click', () =>
      this.download(this.state.exportCurrent(), 'pixel-pet-backup.json'));
    document.getElementById('export-original-btn').addEventListener('click', () =>
      this.download(this.state.originalRaw, 'pixel-pet-original.json'));
    document.getElementById('export-recovery-btn').addEventListener('click', () => {
      try { this.download(this.state.getStorage().getItem(recoverySelect.value), 'pixel-pet-recovery.json'); }
      catch { this.reportRecovery('Recovery storage is unavailable. The original save has not been removed.', true); }
    });
    document.getElementById('retry-save-btn').addEventListener('click', () => {
      this.state.retry(); this.renderHUD();
    });
    document.getElementById('import-text-btn').addEventListener('click', async () => {
      if (this.recoveryDialog.isOpen()) return;
      ++this.recoveryRequest;
      const input = document.getElementById('import-text');
      const raw = input.value;
      if (await this.restoreBackup(raw) && input.value === raw) input.value = '';
    });
    document.getElementById('import-save').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file || this.recoveryDialog.isOpen()) return;
      const request = ++this.recoveryRequest;
      const opener = event.target;
      try {
        if (file.size > 5 * 1024 * 1024) throw new Error('This file exceeds the 5 MB import limit.');
        const raw = await file.text();
        if (request !== this.recoveryRequest) return;
        // Keep file text available after cancel, validation or storage failure.
        const input = document.getElementById('import-text');
        input.value = raw;
        if (await this.restoreBackup(raw, { opener }) && input.value === raw) input.value = '';
      } catch (error) {
        if (request === this.recoveryRequest) this.reportRecovery(`Cannot import: ${error.message}. Keep your backup.`, true);
      } finally {
        if (request === this.recoveryRequest) event.target.value = '';
      }
    });
    document.getElementById('new-pet-btn').addEventListener('click', () => {
      if (this.recoveryDialog.isOpen()) return;
      ++this.recoveryRequest;
      this.restoreBackup(JSON.stringify(GameState.fresh(Date.now())), { kind: 'new' });
    });
    update();
  }

}

if (typeof window !== 'undefined') window.UIManager = UIManager;
if (typeof module !== 'undefined') module.exports = UIManager;
