/**
 * Theme registry. Each theme provides:
 *  - id, label (i18n key resolved at runtime by the UI layer)
 *  - isEquipmentVendor: enables the uncommon/rare guarantees + rune rolls
 *  - itemTypes:  item.type values to consider
 *  - matches(item): predicate run on a compendium index entry
 *  - systems: list of system ids this theme applies to (defaults to both)
 *
 * Optional hooks for themes whose candidates don't map 1:1 onto compendium
 * Item documents (e.g. scrolls, which are conjured from spells at restock time):
 *  - prepareCandidate(entry, ctx): return a partial candidate {name, rarity,
 *    basePriceGp, level, kind, ...} instead of the default item-derived shape.
 *    basePriceGp is multiplied by RARITY_MULTIPLIER in the caller.
 *  - createDoc(stack): async; return ready-to-create item document data
 *    instead of the default fromUuid(stack.uuid).toObject().
 *
 * Index entries are objects from `pack.getIndex({fields: [...]})` so they have a partial
 * `system` tree. Predicates must tolerate missing fields.
 */

const FOOD_KEYWORDS = [
  "ration", "rations", "food", "meal", "drink", "ale", "beer", "wine",
  "bread", "cheese", "meat", "water", "tea", "coffee", "spirits",
  "rum", "mead", "feast", "provisions", "biscuit", "jerky",
  // SF2E flavor
  "nutrient", "mre", "field ration", "ration pack"
];

// Traits that mark an item as Starfinder tech/biotech/magitech/nanite gear.
const SF2E_TECH_TRAITS = ["tech", "biotech", "magitech", "nanite", "cybernetic"];

// PF2E standard scroll base prices in gp, indexed by spell rank.
const SCROLL_COSTS = {
  1: 4, 2: 12, 3: 30, 4: 70, 5: 150,
  6: 300, 7: 600, 8: 1200, 9: 2400, 10: 16000
};

// Scroll item level = 2 * spell rank - 1 (PF2E rules).
const scrollItemLevel = rank => 2 * rank - 1;

const MAGIC_TRADITIONS = ["arcane", "divine", "occult", "primal"];

export const THEMES = {
  food: {
    id: "food",
    labelKey: "INTRINSICS_RESTOCKER.Theme.food",
    isEquipmentVendor: false,
    systems: ["pf2e", "sf2e"],
    itemTypes: ["consumable", "equipment"],
    // Food vendors stock a small variety in bulk — caps unique items so the
    // random fill turns excess picks into deeper stacks of existing items.
    stockSpread: { uniqueLimit: 6 },
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
    systems: ["pf2e", "sf2e"],
    itemTypes: ["weapon"],
    matches(entry) {
      return entry.type === "weapon";
    }
  },

  armor: {
    id: "armor",
    labelKey: "INTRINSICS_RESTOCKER.Theme.armor",
    isEquipmentVendor: true,
    systems: ["pf2e", "sf2e"],
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
    systems: ["pf2e", "sf2e"],
    itemTypes: ["consumable"],
    matches(entry) {
      if (entry.type !== "consumable") return false;
      const traits = entry.system?.traits?.value ?? [];
      return traits.includes("alchemical");
    }
  },

  magical: {
    id: "magical",
    labelKey: "INTRINSICS_RESTOCKER.Theme.magical",
    isEquipmentVendor: false,
    systems: ["pf2e", "sf2e"],
    itemTypes: ["weapon", "armor", "shield", "equipment", "consumable"],
    matches(entry) {
      if (!this.itemTypes.includes(entry.type)) return false;
      const traits = entry.system?.traits?.value ?? [];
      if (!traits.includes("magical")) return false;
      // Pre-built scroll items in the compendium are handled by the dedicated
      // scrolls theme (which conjures fresh scrolls from spells), so skip them
      // here to avoid duplication.
      if (entry.type === "consumable" && entry.system?.category === "scroll") return false;
      return true;
    }
  },

  // Scrolls vendor: rolls spell entries from compendiums and conjures fresh
  // scroll consumables at restock time. Uses the PF2E scroll templates from
  // CONFIG.PF2E.spellcastingItems.scroll.compendiumUuids per rank.
  scrolls: {
    id: "scrolls",
    labelKey: "INTRINSICS_RESTOCKER.Theme.scrolls",
    isEquipmentVendor: false,
    systems: ["pf2e"],
    itemTypes: ["spell"],
    matches(entry) {
      if (entry.type !== "spell") return false;
      const rank = Number(entry.system?.level?.value ?? 0);
      if (!(rank >= 1 && rank <= 10)) return false;
      const traits = entry.system?.traits?.value ?? [];
      if (traits.includes("cantrip") || traits.includes("focus")) return false;
      const category = entry.system?.category?.value ?? entry.system?.category;
      if (category === "ritual" || category === "focus") return false;
      return true;
    },
    prepareCandidate(entry, { packCollection }) {
      const rank = Number(entry.system?.level?.value ?? 0);
      const basePriceGp = SCROLL_COSTS[rank];
      if (!Number.isFinite(basePriceGp)) return null;
      const spellUuid = `Compendium.${packCollection}.Item.${entry._id}`;
      return {
        // Use spellUuid as the dedup key so duplicate spell rolls stack as
        // multiple copies of the same scroll.
        uuid: spellUuid,
        spellUuid,
        spellRank: rank,
        name: `Scroll of ${entry.name} (Rank ${rank})`,
        type: "consumable",
        rarity: entry.system?.traits?.rarity ?? "common",
        level: scrollItemLevel(rank),
        basePriceGp,
        kind: "scroll"
      };
    },
    async createDoc(stack) {
      return createScrollDoc(stack.spellUuid, stack.spellRank);
    }
  },

  // SF2E-only: tech/biotech/magitech/nanite gear across consumables, equipment,
  // weapons, armor and ammo. Useful for gearheads, cyber-clinics, gun shops.
  tech: {
    id: "tech",
    labelKey: "INTRINSICS_RESTOCKER.Theme.tech",
    isEquipmentVendor: true,
    systems: ["sf2e"],
    itemTypes: ["consumable", "equipment", "weapon", "armor", "ammo"],
    matches(entry) {
      if (!this.itemTypes.includes(entry.type)) return false;
      const traits = entry.system?.traits?.value ?? [];
      return SF2E_TECH_TRAITS.some(t => traits.includes(t));
    }
  },

  // SF2E-only: ammunition for ranged weapons. Pure ammo merchant.
  ammo: {
    id: "ammo",
    labelKey: "INTRINSICS_RESTOCKER.Theme.ammo",
    isEquipmentVendor: false,
    systems: ["sf2e"],
    itemTypes: ["ammo", "consumable"],
    stockSpread: { uniqueLimit: 4 },
    matches(entry) {
      if (entry.type === "ammo") return true;
      if (entry.type === "consumable" && entry.system?.category === "ammo") return true;
      return false;
    }
  }
};

function activeSystemId() {
  return globalThis.game?.system?.id ?? null;
}

export function getTheme(id) {
  return THEMES[id] ?? null;
}

export function listThemes() {
  const sysId = activeSystemId();
  return Object.values(THEMES).filter(t => !sysId || !t.systems || t.systems.includes(sysId));
}

/**
 * Build a scroll item document from a spell, mirroring PF2E's internal
 * createConsumableFromSpell (which isn't exposed on the system API). Pulls
 * the rank-specific scroll template from CONFIG.PF2E.spellcastingItems and
 * merges in the spell's source, traits and rarity.
 */
async function createScrollDoc(spellUuid, rank) {
  const scrollTable = CONFIG?.PF2E?.spellcastingItems?.scroll?.compendiumUuids;
  const templateUuid = scrollTable?.[rank];
  if (!templateUuid) {
    console.warn(`intrinsics-merchant-restocker | no scroll template for rank ${rank}`);
    return null;
  }
  const [spell, template] = await Promise.all([fromUuid(spellUuid), fromUuid(templateUuid)]);
  if (!spell || !template) {
    console.warn(`intrinsics-merchant-restocker | failed to load spell or scroll template`, { spellUuid, templateUuid });
    return null;
  }

  const source = template.toObject();
  source._id = null;

  // Merge spell traits into the scroll. Drop the generic "magical" trait when
  // a specific tradition is already present, matching PF2E's behavior.
  const spellTraits = spell.system?.traits?.value ?? [];
  const merged = new Set([...(source.system.traits.value ?? []), ...spellTraits]);
  if ([...merged].some(t => MAGIC_TRADITIONS.includes(t))) merged.delete("magical");
  source.system.traits.value = [...merged].sort();
  source.system.traits.rarity = spell.system?.traits?.rarity ?? source.system.traits.rarity ?? "common";

  source.name = `Scroll of ${spell.name} (Rank ${rank})`;

  // Embed the spell on the scroll so it can be cast. Use a fresh _id per
  // PF2E's convention so multiple scrolls of the same spell don't collide.
  const spellSource = spell.toObject();
  source.system.spell = foundry.utils.mergeObject(spellSource, {
    _id: foundry.utils.randomID(),
    system: { location: { value: null, heightenedLevel: rank } }
  }, { inplace: false });

  // Prepend a link to the source spell above the scroll template's description.
  const spellRef = `@UUID[${spell.uuid}]{${spell.name}}`;
  const existingDesc = source.system.description?.value ?? "";
  source.system.description = { ...(source.system.description ?? {}), value: `<p>${spellRef}</p><hr>${existingDesc}` };

  return source;
}
