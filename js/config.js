const CONFIG = {
  // Rates & Mechanics
  HEALTH_DECAY_PER_HOUR: 0.01, // 1% per hour
  HUNGER_DECAY_PER_HOUR: 0.04, // 4% per hour
  WELL_FED_HUNGER_THRESHOLD: 90, // % hunger to be considered well-fed
  WELL_FED_HEALTH_RATIO: 0.9,
  HEALTH_INCREASE_REQ_HOURS: 24, // Banked eligible care; pauses when hungry or hurt.
  CARE_HEALTH_REWARD: 10,
  RAID_INTERVAL_SEC: 90,
  MAX_ACTIVE_GAP_SEC: 5, // Longer browser suspensions follow the away rule.

  // Growth
  SIZE_INCREASE_PER_LEVEL: 0.01, // 1% per level up
  MAX_HEALTH_INCREASE_PER_LEVEL: 0.10, // 10% per level up

  // Base Pet Stats
  BASE_HP: 100,
  BASE_HUNGER: 100,

  // Deliberate tuning defaults: permanent ownership, one defense item at a time.
  EQUIPMENT: {
    leaf: { id: 'leaf', name: 'Leaf Shield', icon: '🍃', cost: 60, level: 1, defense: 1 },
    shell: { id: 'shell', name: 'Shell Shield', icon: '🐚', cost: 180, level: 3, defense: 2 },
    crystal: { id: 'crystal', name: 'Crystal Shield', icon: '🛡️', cost: 420, level: 5, defense: 4 }
  },

  // Food Aging
  FOOD_AGE_DECAY_HOURS: 48, // hours after which food quality degrades to min quality
  MIN_FOOD_QUALITY_RATIO: 0.5,

  // Default Items / Crops
  CROPS: {
    berry: {
      id: 'berry',
      name: 'Pixel Berry',
      icon: '🫐',
      growTimeSec: 30, // quick growth for playability
      xpYield: 15,
      qualityTier: 1,
      seedCost: 5,
      hungerRestore: 15,
      qualityRating: 15
    },
    root: {
      id: 'root',
      name: 'Square Carrot',
      icon: '🥕',
      growTimeSec: 120,
      xpYield: 40,
      qualityTier: 2,
      seedCost: 15,
      hungerRestore: 35,
      qualityRating: 40
    },
    crystal: {
      id: 'crystal',
      name: 'Mana Shard',
      icon: '💎',
      growTimeSec: 300,
      xpYield: 100,
      qualityTier: 3,
      seedCost: 50,
      hungerRestore: 70,
      qualityRating: 120
    }
  }
};

if (typeof module !== 'undefined') {
  module.exports = CONFIG;
}
