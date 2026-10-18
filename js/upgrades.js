/** Persistent purchases. Refused purchases never spend gold or earned progress. */
class Upgrades {
  constructor(state, config = CONFIG) { this.state = state; this.config = config; }

  static loadout(data) {
    return data.equipmentLoadout || { schemaVersion: 1, owned: [], equipped: null };
  }

  static defenseBonus(data, config = CONFIG) {
    const gear = Upgrades.loadout(data);
    return gear.owned.includes(gear.equipped) ? config.EQUIPMENT[gear.equipped]?.defense || 0 : 0;
  }

  commit(message) { this.state.notify(); return { success: true, message }; }
  refuse(message) { return { success: false, message }; }

  buyPlot() {
    if (!this.state.canPlay) return this.refuse('Saving is paused. Resolve the save notice before purchasing.');
    const data = this.state.data;
    if (data.gold < 100) return this.refuse('A new plot costs 100 gold.');
    const id = data.farmPlots.reduce((max, plot) => Math.max(max, plot.id), -1) + 1;
    if (!Number.isSafeInteger(id)) return this.refuse('No further plot IDs are supported. Your gold was kept.');
    data.gold -= 100;
    data.farmPlots.push({ id, state: 'empty', cropId: null, plantedAt: null, growthSec: 0 });
    return this.commit(`Purchased farm plot ${id + 1}. Find it in Farming and in your garden.`);
  }

  buyHealKit() {
    if (!this.state.canPlay) return this.refuse('Saving is paused. Resolve the save notice before purchasing.');
    const data = this.state.data, pet = data.pet;
    if (pet.hp >= pet.maxHp) return this.refuse('Your pet is already healthy. Your gold was kept.');
    if (data.gold < 30) return this.refuse('A healing kit costs 30 gold.');
    const next = Math.min(pet.maxHp, pet.hp + 30);
    if (!Number.isFinite(next) || next <= pet.hp) return this.refuse('Healing cannot be recorded safely. Your gold was kept.');
    const healed = next - pet.hp;
    data.gold -= 30; pet.hp = next;
    return this.commit(`Restored ${Math.round(healed * 10) / 10} health.`);
  }

  buyEquipment(id) {
    if (!this.state.canPlay) return this.refuse('Saving is paused. Resolve the save notice before purchasing.');
    const item = Object.hasOwn(this.config.EQUIPMENT, id) && this.config.EQUIPMENT[id];
    if (!item) return this.refuse('This equipment is not available.');
    const data = this.state.data, old = Upgrades.loadout(data);
    if (old.owned.includes(id)) return this.refuse('You already own this equipment. Your gold was kept.');
    if (data.pet.level < item.level) return this.refuse(`${item.name} unlocks at level ${item.level}.`);
    if (data.gold < item.cost) return this.refuse(`${item.name} costs ${item.cost} gold.`);
    data.equipmentLoadout = { ...old, owned: [...old.owned, id] };
    data.gold -= item.cost;
    return this.commit(`Purchased ${item.name}. Equip it to use its defense bonus.`);
  }

  equip(id) {
    if (!this.state.canPlay) return this.refuse('Saving is paused. Resolve the save notice before changing equipment.');
    const data = this.state.data, old = Upgrades.loadout(data);
    if (id !== null && (!Object.hasOwn(this.config.EQUIPMENT, id) || !old.owned.includes(id)))
      return this.refuse('Purchase this equipment before equipping it.');
    data.equipmentLoadout = { ...old, owned: [...old.owned], equipped: id };
    return this.commit(id === null ? 'Equipment removed; it remains yours.' : `${this.config.EQUIPMENT[id].name} equipped.`);
  }
}

if (typeof window !== 'undefined') window.Upgrades = Upgrades;
if (typeof module !== 'undefined') module.exports = Upgrades;
