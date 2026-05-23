/**
 * Theme registry. Each theme provides:
 *  - id, label (i18n key resolved at runtime by the UI layer)
 *  - isEquipmentVendor: enables the >=1 uncommon + 25% rare guarantee
 *  - itemTypes:  PF2E item.type values to consider
 *  - matches(item): predicate run on a compendium index entry
 *  - traitsRequiredAny: optional list of traits where the item must have at least one
 *  - traitsForbidden: optional list of traits that disqualify an item
 *  - nameKeywords: optional case-insensitive substrings (matches if any present)
 *
 * Index entries are objects from `pack.getIndex({fields: [...]})` so they have a partial
 * `system` tree. Predicates must tolerate missing fields.
 */

const FOOD_KEYWORDS = [
  "ration", "rations", "food", "meal", "drink", "ale", "beer", "wine",
  "bread", "cheese", "meat", "water", "tea", "coffee", "spirits",
  "rum", "mead", "feast", "provisions", "biscuit", "jerky"
];

export const THEMES = {
  food: {
    id: "food",
    labelKey: "INTRINSICS_RESTOCKER.Theme.food",
    isEquipmentVendor: false,
    itemTypes: ["consumable", "equipment"],
    nameKeywords: FOOD_KEYWORDS,
    matches(entry) {
      const type = entry.type;
      if (!this.itemTypes.includes(type)) return false;
      const name = (entry.name ?? "").toLowerCase();
      if (FOOD_KEYWORDS.some(k => name.includes(k))) return true;
      const traits = entry.system?.traits?.value ?? [];
      return traits.includes("food") || traits.includes("drink");
    }
  },

  weapons: {
    id: "weapons",
    labelKey: "INTRINSICS_RESTOCKER.Theme.weapons",
    isEquipmentVendor: true,
    itemTypes: ["weapon"],
    matches(entry) {
      return entry.type === "weapon";
    }
  },

  armor: {
    id: "armor",
    labelKey: "INTRINSICS_RESTOCKER.Theme.armor",
    isEquipmentVendor: true,
    itemTypes: ["armor", "shield", "equipment"],
    matches(entry) {
      if (entry.type === "armor" || entry.type === "shield") return true;
      if (entry.type === "equipment") {
        const traits = entry.system?.traits?.value ?? [];
        return traits.includes("shield");
      }
      return false;
    }
  },

  alchemical: {
    id: "alchemical",
    labelKey: "INTRINSICS_RESTOCKER.Theme.alchemical",
    isEquipmentVendor: false,
    itemTypes: ["consumable"],
    matches(entry) {
      if (entry.type !== "consumable") return false;
      const name = (entry.name ?? "").toLowerCase();
      // Exclude pure foodstuffs so the alchemical merchant doesn't sell ale.
      if (FOOD_KEYWORDS.some(k => name.includes(k))) return false;
      return true;
    }
  }
};

export function getTheme(id) {
  return THEMES[id] ?? null;
}

export function listThemes() {
  return Object.values(THEMES);
}
