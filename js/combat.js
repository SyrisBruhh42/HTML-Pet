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

  triggerRaid() {
    const pet = this.state.data.pet;
    const d20 = DiceEngine.roll(1, 20);
    const statModifier = Math.floor(pet.level / 2);
    const baseDefense = 10;
    const totalDefense = d20.total + statModifier + baseDefense;

    // Threat level DC scaled with pet level
    const threatLevel = Math.floor(Math.random() * 5) + pet.level;
    const encounterDC = 10 + threatLevel;

    let resultMsg = '';
    let type = '';

    if (d20.total === 20) {
      // Natural 20
      const rewardGold = 25 * pet.level;
      this.state.data.gold += rewardGold;
      resultMsg = `🌟 CRITICAL VICTORY! Nat 20 roll! Defense check ${totalDefense} vs DC ${encounterDC}. Pet defended perfectly and gained ${rewardGold} gold!`;
      type = 'crit-win';
    } else if (totalDefense >= encounterDC) {
      // Standard Success
      const rewardGold = 10 * pet.level;
      this.state.data.gold += rewardGold;
      resultMsg = `⚔️ VICTORY! Defense check ${totalDefense} (Roll ${d20.total} + ${statModifier}) vs DC ${encounterDC}. Pet repelled the raid and earned ${rewardGold} gold!`;
      type = 'win';
    } else if (d20.total === 1) {
      // Critical Fail
      const damage = Math.min(pet.hp, Math.floor(pet.maxHp * 0.20));
      pet.hp -= damage;
      resultMsg = `💀 CRITICAL FAILURE! Nat 1 roll! Pet suffered ${damage} damage in ambush!`;
      type = 'crit-loss';
    } else {
      // Standard Loss
      const damage = Math.min(pet.hp, Math.floor(pet.maxHp * 0.08));
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

    this.state.notify();
    return { d20: d20.total, totalDefense, encounterDC, resultMsg, type };
  }
}

if (typeof window !== 'undefined') {
  window.DiceEngine = DiceEngine;
  window.EncounterEngine = EncounterEngine;
}
if (typeof module !== 'undefined') {
  module.exports = { DiceEngine, EncounterEngine };
}
