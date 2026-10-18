/** Explicit recovery review. Only the confirm button can replace saved progress. */
class RecoveryDialog {
  constructor({ state, document, decode = GameState.decode, report = () => {} }) {
    this.state = state;
    this.document = document;
    this.decode = decode;
    this.report = report;
    this.dialog = document.getElementById('recovery-dialog');
    this.title = document.getElementById('recovery-title');
    this.summary = document.getElementById('recovery-summary');
    this.error = document.getElementById('recovery-error');
    this.rawText = document.getElementById('recovery-raw');
    this.rawDetails = document.getElementById('recovery-raw-details');
    this.cancelButton = document.getElementById('recovery-cancel');
    this.confirmButton = document.getElementById('recovery-confirm');
    this.pending = null;
    this.cancelButton.addEventListener('click', () => this.finish(false));
    this.confirmButton.addEventListener('click', () => this.confirm());
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.finish(false); });
    this.dialog.addEventListener('close', () => this.closed());
  }

  isOpen() { return this.pending !== null; }

  review(raw, { kind = 'restore', opener = this.document.activeElement } = {}) {
    if (this.pending) {
      this.showError('Finish or cancel this review before choosing another backup.');
      return Promise.resolve(false);
    }
    let data;
    try {
      if (typeof raw !== 'string' || new TextEncoder().encode(raw).length > 5 * 1024 * 1024)
        throw new Error('Choose backup text of no more than 5 MB.');
      data = this.decode(raw, this.state.now()).data;
      if (typeof this.dialog.showModal !== 'function')
        throw new Error('This browser cannot display the recovery review. Keep your backup and use a browser with HTML dialog support.');
    } catch (error) {
      this.report(`Cannot restore: ${error.message}`, true);
      return Promise.resolve(false);
    }
    this.title.textContent = kind === 'new' ? 'Start a new pet?' : 'Restore this pet?';
    this.confirmButton.textContent = kind === 'new' ? 'Preserve progress and start new pet' : 'Preserve progress and restore';
    this.summary.textContent = `${data.pet.name} · Level ${data.pet.level} · ${data.gold} gold · ${data.farmPlots.length} garden plots`;
    this.rawText.value = raw;
    this.rawDetails.open = false;
    this.error.hidden = true;
    this.error.textContent = '';
    this.confirmButton.disabled = false;
    return new Promise(resolve => {
      this.pending = { raw, kind, opener, resolve, result: false, busy: false };
      try {
        this.dialog.showModal();
        // The first focused action is always non-destructive. Native dialog
        // keeps background controls inert and contains keyboard navigation.
        this.cancelButton.focus();
      } catch (error) {
        this.closed();
        this.report(`Recovery review could not open: ${error.message}. Keep your backup.`, true);
      }
    });
  }

  showError(message) {
    this.error.textContent = message;
    this.error.hidden = false;
    this.rawDetails.open = true;
    this.error.focus();
  }

  confirm() {
    const pending = this.pending;
    if (!pending || pending.busy) return;
    pending.busy = true;
    this.confirmButton.disabled = true;
    let replaced = false;
    try {
      // GameState revalidates the exact retained payload, writer lease,
      // current stored bytes and verified recovery copies at confirmation.
      replaced = this.state.replace(pending.raw);
      if (!replaced) this.showError(this.state.status.message);
    } catch (error) {
      this.showError(`Restoration was not completed: ${error.message}. Your backup text remains below.`);
    }
    if (replaced) { this.finish(true); return; }
    pending.busy = false;
    this.confirmButton.disabled = false;
  }

  finish(result) {
    if (!this.pending) return;
    this.pending.result = result;
    this.dialog.close();
  }

  closed() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.rawText.value = '';
    this.error.hidden = true;
    this.confirmButton.disabled = false;
    const action = pending.kind === 'new' ? 'New pet' : 'Backup restoration';
    this.report(pending.result ? `${action} completed. Previous progress is available in recovery copies.` : `${action} canceled.`, false);
    if (pending.opener?.isConnected !== false && !pending.opener?.disabled && typeof pending.opener?.focus === 'function')
      pending.opener.focus();
    else this.document.getElementById('recovery-status').focus();
    pending.resolve(pending.result);
  }
}

if (typeof window !== 'undefined') window.RecoveryDialog = RecoveryDialog;
if (typeof module !== 'undefined') module.exports = RecoveryDialog;
