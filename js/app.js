/** Lifecycle: one elapsed-time path, with raids only during visible, unsuspended play. */
class App {
  constructor() {
    this.state = window.gameState;
    this.writerLease = false;
    this.state.writerCheck = () => this.writerLease;
    this.renderer = new Renderer(document.getElementById('game-canvas'), this.state);
    this.progression = new Progression(this.state);
    this.farmingMgr = new FarmingManager(this.state);
    this.combatEngine = new EncounterEngine(this.state);
    this.ui = new UIManager(this.state, this.farmingMgr, this.combatEngine, this.renderer, this.progression);
    this.ui.beforeAction = () => this.advance(!document.hidden);
    this.openSession();
    this.lastSaveFrame = 0;
    this.lastUpdateFrame = 0;
    document.addEventListener('visibilitychange', () => {
      this.advance(false);
      if (this.state.canPlay) this.state.notify();
    });
    window.addEventListener('pagehide', () => {
      this.advance(false);
      if (this.state.canPlay) this.state.save();
      this.writerLease = false;
      this.state.canPlay = false;
      this.releaseWriter?.();
      this.releaseWriter = null;
    });
    window.addEventListener('pageshow', event => { if (event.persisted) this.openSession(); });
    window.addEventListener('storage', event => {
      if (event.key === this.state.key || event.key === null) {
        this.state.pause('conflict', 'Pet paused: browser storage changed in another tab. Download this tab’s progress before reloading.');
      }
    });
    this.startLoop();
  }

  openSession() {
    this.state.canPlay = false;
    if (!navigator.locks?.request) {
      this.state.load();
      this.state.pause('writer-blocked', 'This browser cannot protect saved pets between tabs. Your pet is read-only. Download it or reopen this game in a browser supporting Web Locks on localhost or HTTPS.');
      return;
    }
    navigator.locks.request(`${this.state.key}:writer`, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) {
        this.state.load();
        this.state.pause('writer-blocked', 'Another game tab owns this pet’s save session. Close it and reload here. You can still download the stored pet.');
        return;
      }
      this.writerLease = true;
      if (this.state.load()) this.processOfflineTime();
      await new Promise(resolve => { this.releaseWriter = resolve; });
    }).catch(() => {
      this.writerLease = false;
      this.state.pause('writer-blocked', 'The browser could not establish an exclusive save session. Reload after closing other game tabs. Your stored pet has not been replaced.');
    });
  }

  advance(active) {
    const result = this.progression.advanceTo(Date.now(), active,
      () => this.combatEngine.triggerRaid({ persist: false }));
    this.ui.renderClockStatus(result.clockBackwards);
    this.ui.renderHUD();
    this.ui.refreshOpenFarm();
    return result;
  }

  processOfflineTime() {
    if (!this.state.canPlay) { this.ui.renderHUD(); return; }
    const result = this.advance(false);
    if (result.seconds >= 300) {
      this.progression.log(`Welcome back! ${ (result.seconds / 3600).toFixed(1) } hours away: food aged and crops grew. Raids waited for you; earned care and levels were kept.`);
    }
    this.state.notify();
  }

  startLoop() {
    const loop = frame => {
      if (frame - this.lastUpdateFrame >= 250) {
        this.lastUpdateFrame = frame;
        this.advance(!document.hidden);
      }
      if (this.state.canPlay && frame - this.lastSaveFrame >= 5000) {
        this.lastSaveFrame = frame;
        this.state.save();
      }
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
if (typeof module !== 'undefined') module.exports = App;
