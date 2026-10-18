/**
 * Dice Utility and D&D Encounter Engine
 */
class DiceEngine {
  static roll(count = 1, sides = 20) {
    let total = 0;
    const rolls = [];
    for (let i = 0; i < count; i++) {
      const r = Math.floor(Math.random() * sides) + 1;
      rolls.push(r);
      total += r;
    }
    return { total, rolls };
  }
}

class EncounterEngine {
  constructor(state) {
    this.state = state;
  }

  triggerRaid({ persist = true } = {}) {
    if (!this.state.canPlay) return null;
    const pet = this.state.data.pet;
    const d20 = DiceEngine.roll(1, 20);
    const statModifier = Math.floor(pet.level / 2);
    const baseDefense = 10;
    const gear = this.state.data.equipmentLoadout;
    const equipmentDefense = gear?.owned.includes(gear.equipped) ? CONFIG.EQUIPMENT[gear.equipped]?.defense || 0 : 0;
    const totalDefense = d20.total + statModifier + baseDefense + equipmentDefense;

    // Keep the early challenge, then grow with defense so earned levels stay viable.
    const threatLevel = Math.floor(Math.random() * 5) + statModifier + Math.min(Math.ceil(pet.level / 2), 4);
    const encounterDC = 10 + threatLevel;

    let resultMsg = '';
    let type = '';

    if (d20.total === 20) {
      // Natural 20
      const rewardGold = 25 * pet.level;
      if (!Number.isSafeInteger(this.state.data.gold + rewardGold) || !Number.isSafeInteger(rewardGold)) {
        this.state.pause('progress-limit', 'Pet paused at the supported gold limit. Download your current pet; its progress has been preserved.');
        return null;
      }
      this.state.data.gold += rewardGold;
      resultMsg = `🌟 CRITICAL VICTORY! Nat 20 roll! Defense check ${totalDefense} vs DC ${encounterDC}. Pet defended perfectly and gained ${rewardGold} gold!`;
      type = 'crit-win';
    } else if (d20.total !== 1 && totalDefense >= encounterDC) {
      // Standard Success
      const rewardGold = 10 * pet.level;
      if (!Number.isSafeInteger(this.state.data.gold + rewardGold) || !Number.isSafeInteger(rewardGold)) {
        this.state.pause('progress-limit', 'Pet paused at the supported gold limit. Download your current pet; its progress has been preserved.');
        return null;
      }
      this.state.data.gold += rewardGold;
      resultMsg = `⚔️ VICTORY! Defense check ${totalDefense} (roll ${d20.total} + level ${statModifier} + base ${baseDefense} + equipment ${equipmentDefense}) vs DC ${encounterDC}. Pet repelled the raid and earned ${rewardGold} gold!`;
      type = 'win';
    } else if (d20.total === 1) {
      // Critical Fail
      const damage = Math.min(Math.max(0, pet.hp - 1), Math.floor(pet.maxHp * 0.20));
      pet.hp -= damage;
      resultMsg = `💀 CRITICAL FAILURE! Nat 1 roll! Pet suffered ${damage} damage in ambush!`;
      type = 'crit-loss';
    } else {
      // Standard Loss
      const damage = Math.min(Math.max(0, pet.hp - 1), Math.floor(pet.maxHp * 0.08));
      pet.hp -= damage;
      resultMsg = `💔 DEFEAT! Defense check ${totalDefense} vs DC ${encounterDC}. Raid broke through and pet took ${damage} damage!`;
      type = 'loss';
    }

    // Add entry to combat log
    this.state.data.logs.unshift({
      timestamp: new Date().toLocaleTimeString(),
      text: resultMsg,
      type: type
    });

    if (this.state.data.logs.length > 30) {
      this.state.data.logs.pop();
    }

    if (persist) this.state.notify();
    return { d20: d20.total, totalDefense, equipmentDefense, encounterDC, resultMsg, type };
  }
}

if (typeof window !== 'undefined') {
  window.DiceEngine = DiceEngine;
  window.EncounterEngine = EncounterEngine;
}
if (typeof module !== 'undefined') {
  module.exports = { DiceEngine, EncounterEngine };
}
