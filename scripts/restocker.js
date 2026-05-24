import { MODULE_ID, FLAGS } from "./constants.js";
import { getTheme } from "./themes.js";

const RARITY_MULTIPLIER = {
  common: 1,
  uncommon: 1.5,
  rare: 3,
  unique: 5
};

// Random-fill selection weights. Without this, a pool with many uncommons
// (e.g. PF2E's equipment lists) produces too many uncommon picks.
const RARITY_WEIGHT = {
  common: 1.0,
  uncommon: 0.3,
  rare: 0.1,
  unique: 0.05
};

const UNCOMMON_CHANCE = 0.5;
const RARE_CHANCE = 0.25;

// Cap on attempts when filling budget so a tiny candidate pool can't loop forever.
const MAX_PICKS = 200;

// Indexed compendium fields needed for filtering and price math.
const INDEX_FIELDS = [
  "name",
  "img",
  "type",
  "system.traits.value",
  "system.traits.rarity",
  "system.level.value",
  "system.price.value",
  "system.bulk.value",
  "system.quantity",
  "system.category"
];

// Rune upgrade chances for equipment vendors.
const RUNE_POTENCY_CHANCE = 0.20;
const RUNE_FUNDAMENTAL_CHANCE = 0.50; // striking (weapon) or resilient (armor), rolled only if potency landed
const RUNE_PROPERTY_CHANCE = 0.40;    // per property-rune slot (one slot per potency level)
const MATERIAL_CHANCE = 0.10;          // independent of runes

// Base PF2E rune costs (gp).
const RUNE_COSTS = {
  weapon: { potency: 35, striking: 65 },
  armor: { potency: 160, resilient: 340 }
};

// SF2E uses item grades (`system.grade`) in place of PF2E potency runes. Grade
// bundles the potency-equivalent and striking/resilient-equivalent into one
// quality tier. Costs derived from sf2e's weaponImprovements / armorImprovements
// tables (credits ÷ 10 = gp). Picked weights make low-tier grades dominant.
const SF2E_GRADES = {
  weapon: [
    { grade: "tactical", cost: 35, weight: 4 },
    { grade: "advanced", cost: 100, weight: 2 },
    { grade: "superior", cost: 1000, weight: 1 },
    { grade: "elite", cost: 2000, weight: 0.5 },
    { grade: "ultimate", cost: 10000, weight: 0.2 },
    { grade: "paragon", cost: 40000, weight: 0.05 }
  ],
  armor: [
    { grade: "tactical", cost: 160, weight: 4 },
    { grade: "advanced", cost: 500, weight: 2 },
    { grade: "superior", cost: 1400, weight: 1 },
    { grade: "elite", cost: 4500, weight: 0.5 },
    { grade: "ultimate", cost: 24000, weight: 0.2 },
    { grade: "paragon", cost: 70000, weight: 0.05 }
  ]
};

// Grade tiers in SF2E map roughly to PF2E potency levels (tactical=+1,
// superior=+2, ultimate=+3). Use the same material level cap rules but keyed
// off grade tier index for max property rune level.
const SF2E_GRADE_RUNE_CAP = {
  tactical: 8,
  advanced: 8,
  superior: 15,
  elite: 15,
  ultimate: 999,
  paragon: 999
};

function isSF2E() {
  return globalThis.game?.system?.id === "sf2e";
}

// Property-rune pools curated from the GM's Materials & Runes notes
// (~/Documents/.../Pathfinder - Lore Wiki/Rules/Materials and Runes/).
// Slugs/levels/prices verified against WEAPON_PROPERTY_RUNES and
// ARMOR_PROPERTY_RUNES in systems/pf2e/pf2e.mjs. Remaster name → slug:
// Vitalizing→disrupting, Animated→dancing, Quickstrike→speed,
// Spell Reservoir→spellStoring.
const PROPERTY_RUNES = {
  weapon: [
    { slug: "fanged", level: 2, cost: 30 },
    { slug: "kinWarding", level: 3, cost: 52 },
    { slug: "crushing", level: 3, cost: 50 },
    { slug: "authorized", level: 3, cost: 50 },
    { slug: "underwater", level: 3, cost: 50 },
    { slug: "returning", level: 3, cost: 55 },
    { slug: "merciful", level: 4, cost: 70 },
    { slug: "ghostTouch", level: 4, cost: 75 },
    { slug: "bane", level: 4, cost: 100 },
    { slug: "cunning", level: 5, cost: 140 },
    { slug: "hooked", level: 5, cost: 140 },
    { slug: "earthbinding", level: 5, cost: 125 },
    { slug: "pacifying", level: 5, cost: 150 },
    { slug: "disrupting", level: 5, cost: 150 },
    { slug: "fearsome", level: 5, cost: 160 },
    { slug: "demolishing", level: 6, cost: 225 },
    { slug: "hauling", level: 6, cost: 225 },
    { slug: "shifting", level: 6, cost: 225 },
    { slug: "energizing", level: 6, cost: 250 },
    { slug: "flickering", level: 6, cost: 250 },
    { slug: "called", level: 7, cost: 350 },
    { slug: "wounding", level: 7, cost: 340 },
    { slug: "deathdrinking", level: 7, cost: 360 },
    { slug: "flurrying", level: 7, cost: 360 },
    { slug: "rooting", level: 7, cost: 360 },
    { slug: "extending", level: 7, cost: 700 },
    { slug: "greaterFanged", level: 8, cost: 425 },
    { slug: "astral", level: 8, cost: 450 },
    { slug: "giantKilling", level: 8, cost: 450 },
    { slug: "bloodbane", level: 8, cost: 475 },
    { slug: "corrosive", level: 8, cost: 500 },
    { slug: "decaying", level: 8, cost: 500 },
    { slug: "flaming", level: 8, cost: 500 },
    { slug: "frost", level: 8, cost: 500 },
    { slug: "shock", level: 8, cost: 500 },
    { slug: "thundering", level: 8, cost: 500 },
    { slug: "nightmare", level: 9, cost: 250 },
    { slug: "greaterCrushing", level: 9, cost: 650 },
    { slug: "ashen", level: 9, cost: 700 },
    { slug: "coating", level: 9, cost: 700 },
    { slug: "grievous", level: 9, cost: 700 },
    { slug: "swarming", level: 9, cost: 700 },
    { slug: "anchoring", level: 10, cost: 900 },
    { slug: "impactful", level: 10, cost: 1000 },
    { slug: "serrating", level: 10, cost: 1000 },
    { slug: "hopeful", level: 11, cost: 1200 },
    { slug: "greaterHauling", level: 11, cost: 1300 },
    { slug: "greaterRooting", level: 11, cost: 1400 },
    { slug: "holy", level: 11, cost: 1400 },
    { slug: "unholy", level: 11, cost: 1400 },
    { slug: "brilliant", level: 12, cost: 2000 },
    { slug: "greaterFearsome", level: 12, cost: 2000 },
    { slug: "dancing", level: 13, cost: 2700 },
    { slug: "spellStoring", level: 13, cost: 2700 },
    { slug: "greaterBloodbane", level: 13, cost: 2800 },
    { slug: "keen", level: 13, cost: 3000 },
    { slug: "shockwave", level: 13, cost: 3000 },
    { slug: "greaterExtending", level: 13, cost: 3000 },
    { slug: "majorFanged", level: 15, cost: 6000 },
    { slug: "greaterAstral", level: 15, cost: 6000 },
    { slug: "greaterGiantKilling", level: 15, cost: 6000 },
    { slug: "majorRooting", level: 15, cost: 6500 },
    { slug: "greaterCorrosive", level: 15, cost: 6500 },
    { slug: "greaterDecaying", level: 15, cost: 6500 },
    { slug: "greaterFlaming", level: 15, cost: 6500 },
    { slug: "greaterFrost", level: 15, cost: 6500 },
    { slug: "greaterShock", level: 15, cost: 6500 },
    { slug: "greaterThundering", level: 15, cost: 6500 },
    { slug: "ancestralEchoing", level: 15, cost: 9500 },
    { slug: "greaterAshen", level: 16, cost: 9000 },
    { slug: "speed", level: 16, cost: 10000 },
    { slug: "greaterImpactful", level: 17, cost: 15000 },
    { slug: "vorpal", level: 17, cost: 15000 },
    { slug: "greaterAnchoring", level: 18, cost: 22000 },
    { slug: "greaterBrilliant", level: 18, cost: 24000 },
    { slug: "trueRooting", level: 19, cost: 40000 },
    { slug: "impossible", level: 20, cost: 70000 }
  ],
  armor: [
    { slug: "slick", level: 5, cost: 45 },
    { slug: "shadow", level: 5, cost: 55 },
    { slug: "stanching", level: 5, cost: 130 },
    { slug: "assisting", level: 5, cost: 125 },
    { slug: "raiment", level: 5, cost: 140 },
    { slug: "glamered", level: 5, cost: 140 },
    { slug: "ready", level: 6, cost: 200 },
    { slug: "swallowSpike", level: 6, cost: 200 },
    { slug: "aimAiding", level: 6, cost: 225 },
    { slug: "lesserDread", level: 6, cost: 225 },
    { slug: "quenching", level: 6, cost: 250 },
    { slug: "deathless", level: 7, cost: 330 },
    { slug: "sizeChanging", level: 7, cost: 350 },
    { slug: "acidResistant", level: 8, cost: 420 },
    { slug: "coldResistant", level: 8, cost: 420 },
    { slug: "electricityResistant", level: 8, cost: 420 },
    { slug: "fireResistant", level: 8, cost: 420 },
    { slug: "gliding", level: 8, cost: 450 },
    { slug: "greaterSlick", level: 8, cost: 450 },
    { slug: "invisibility", level: 8, cost: 500 },
    { slug: "sinisterKnight", level: 8, cost: 500 },
    { slug: "bitter", level: 9, cost: 135 },
    { slug: "advancing", level: 9, cost: 625 },
    { slug: "greaterShadow", level: 9, cost: 650 },
    { slug: "malleable", level: 9, cost: 650 },
    { slug: "portable", level: 9, cost: 660 },
    { slug: "greaterStanching", level: 9, cost: 600 },
    { slug: "greaterInvisibility", level: 10, cost: 1000 },
    { slug: "magnetizing", level: 10, cost: 900 },
    { slug: "greaterQuenching", level: 10, cost: 1000 },
    { slug: "implacable", level: 11, cost: 1200 },
    { slug: "greaterReady", level: 11, cost: 1200 },
    { slug: "moderateDread", level: 12, cost: 1800 },
    { slug: "immovable", level: 12, cost: 1800 },
    { slug: "greaterSwallowSpike", level: 12, cost: 1750 },
    { slug: "fortification", level: 12, cost: 2000 },
    { slug: "greaterAcidResistant", level: 12, cost: 1650 },
    { slug: "greaterColdResistant", level: 12, cost: 1650 },
    { slug: "greaterElectricityResistant", level: 12, cost: 1650 },
    { slug: "greaterFireResistant", level: 12, cost: 1650 },
    { slug: "rockBraced", level: 13, cost: 3000 },
    { slug: "energyAdaptive", level: 13, cost: 2600 },
    { slug: "majorStanching", level: 13, cost: 2500 },
    { slug: "winged", level: 13, cost: 2500 },
    { slug: "soaring", level: 14, cost: 3750 },
    { slug: "majorQuenching", level: 14, cost: 4500 },
    { slug: "antimagic", level: 15, cost: 6500 },
    { slug: "greaterAdvancing", level: 16, cost: 8000 },
    { slug: "misleading", level: 16, cost: 8000 },
    { slug: "majorSwallowSpike", level: 16, cost: 19250 },
    { slug: "majorSlick", level: 16, cost: 9000 },
    { slug: "ethereal", level: 17, cost: 13500 },
    { slug: "trueStanching", level: 17, cost: 12500 },
    { slug: "majorShadow", level: 17, cost: 14000 },
    { slug: "greaterDread", level: 18, cost: 21000 },
    { slug: "trueQuenching", level: 18, cost: 24000 },
    { slug: "greaterFortification", level: 19, cost: 24000 },
    { slug: "greaterWinged", level: 19, cost: 35000 }
  ]
};

// Precious materials curated from the GM's notes, verified against PF2E's
// WEAPON_MATERIAL_VALUATION_DATA / ARMOR_MATERIAL_VALUATION_DATA. Each entry
// has a maxRuneLevel cap matching the GM's note: low=8, standard=15, high=any.
// Rarity is informational — uncommon/rare materials still get rolled but
// budget filtering keeps them off low-tier merchants.
const MATERIAL_LEVEL_CAP = { low: 8, standard: 15, high: 999 };

const MATERIALS = {
  weapon: [
    { type: "cold-iron", grade: "low", cost: 40 },
    { type: "silver", grade: "low", cost: 40 },
    { type: "cold-iron", grade: "standard", cost: 880 },
    { type: "silver", grade: "standard", cost: 880 },
    { type: "adamantine", grade: "standard", cost: 1400 },
    { type: "dawnsilver", grade: "standard", cost: 1400 },
    { type: "duskwood", grade: "standard", cost: 1400 },
    { type: "inubrix", grade: "standard", cost: 1400 },
    { type: "siccatite", grade: "standard", cost: 1400 },
    { type: "sovereign-steel", grade: "standard", cost: 1600 },
    { type: "noqual", grade: "standard", cost: 1600 },
    { type: "djezet", grade: "standard", cost: 1800 },
    { type: "peachwood", grade: "standard", cost: 2000 },
    { type: "abysium", grade: "standard", cost: 2000 }
  ],
  armor: [
    { type: "cold-iron", grade: "low", cost: 140 },
    { type: "silver", grade: "low", cost: 140 },
    { type: "dreamweb", grade: "standard", cost: 150 },
    { type: "cold-iron", grade: "standard", cost: 1200 },
    { type: "silver", grade: "standard", cost: 1200 },
    { type: "inubrix", grade: "standard", cost: 1200 },
    { type: "grisantian-pelt", grade: "standard", cost: 1800 },
    { type: "adamantine", grade: "standard", cost: 1600 },
    { type: "dawnsilver", grade: "standard", cost: 1600 },
    { type: "duskwood", grade: "standard", cost: 1600 },
    { type: "dragonhide", grade: "standard", cost: 1600 },
    { type: "siccatite", grade: "standard", cost: 1600 },
    { type: "noqual", grade: "standard", cost: 1600 },
    { type: "djezet", grade: "standard", cost: 1800 },
    { type: "abysium", grade: "standard", cost: 2000 },
    { type: "sovereign-steel", grade: "standard", cost: 2400 }
  ]
};

// Rarity ordering — used by the maxRarity filter to allow "common only" or
// "common+uncommon" merchants regardless of theme.
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, unique: 3 };

/**
 * Format a gp amount in the active system's currency for display. PF2E shows
 * gp; SF2E shows credits (1 gp = 10 credits per PF2E's COIN_DENOMINATIONS).
 */
export function formatCurrency(gp) {
  if (!Number.isFinite(gp)) return "—";
  if (isSF2E()) {
    const credits = Math.round(gp * 10);
    return `${credits.toLocaleString()} credits`;
  }
  const rounded = Math.round(gp * 100) / 100;
  return `${rounded.toLocaleString()} gp`;
}

/**
 * Convert a PF2E price object {pp, gp, sp, cp} to a single gp number.
 * Missing denominations are treated as zero. Returns Infinity for unparseable
 * prices so they get filtered out of buyable candidate pools.
 */
export function priceToGp(price) {
  if (!price || typeof price !== "object") return Infinity;
  const pp = Number(price.pp ?? 0);
  const gp = Number(price.gp ?? 0);
  const sp = Number(price.sp ?? 0);
  const cp = Number(price.cp ?? 0);
  if (![pp, gp, sp, cp].every(Number.isFinite)) return Infinity;
  return pp * 10 + gp + sp / 10 + cp / 100;
}

function costInPoints(entry) {
  const rarity = entry.system?.traits?.rarity ?? "common";
  const mult = RARITY_MULTIPLIER[rarity] ?? 1;
  const gp = priceToGp(entry.system?.price?.value);
  return gp * mult;
}

function rarityOf(entry) {
  return entry.system?.traits?.rarity ?? "common";
}

/**
 * Discover candidate compendium entries for a theme by scanning every Item-type pack.
 * Skips packs that throw on getIndex (e.g. unavailable system packs in SF2E worlds).
 *
 * If `overrideCompendium` is set, scan only that pack and skip theme matching —
 * every item in the override pack is considered fair game. Used by themes like
 * "food" where the GM curates a bespoke list (e.g. survival-system rations).
 */
async function buildCandidatePool(theme, overrideCompendium, { maxLevel = null, maxRarity = null } = {}) {
  const candidates = [];
  let packs;
  if (overrideCompendium) {
    const pack = game.packs.get(overrideCompendium);
    if (!pack || pack.metadata.type !== "Item") {
      console.warn(`${MODULE_ID} | override compendium missing or not an Item pack`, overrideCompendium);
      return candidates;
    }
    packs = [pack];
  } else {
    packs = game.packs.filter(p => p.metadata.type === "Item");
  }

  const rarityCap = maxRarity ? RARITY_ORDER[maxRarity] ?? null : null;

  for (const pack of packs) {
    let index;
    try {
      index = await pack.getIndex({ fields: INDEX_FIELDS });
    } catch (err) {
      console.warn(`${MODULE_ID} | failed to index pack ${pack.collection}`, err);
      continue;
    }

    for (const entry of index) {
      if (!overrideCompendium) {
        if (!theme.itemTypes.includes(entry.type)) continue;
        if (!theme.matches(entry)) continue;
      }
      let candidate;
      if (theme.prepareCandidate) {
        const partial = theme.prepareCandidate(entry, { packCollection: pack.collection });
        if (!partial) continue;
        const rarity = partial.rarity ?? "common";
        const basePrice = Number(partial.basePriceGp ?? 0);
        const cost = basePrice * (RARITY_MULTIPLIER[rarity] ?? 1);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        candidate = { ...partial, rarity, cost };
      } else {
        const rarity = rarityOf(entry);
        const cost = costInPoints(entry);
        if (!Number.isFinite(cost) || cost <= 0) continue;
        candidate = {
          uuid: `Compendium.${pack.collection}.Item.${entry._id}`,
          name: entry.name,
          type: entry.type,
          rarity,
          level: Number(entry.system?.level?.value ?? 0),
          cost
        };
      }
      if (Number.isFinite(maxLevel) && Number(candidate.level ?? 0) > maxLevel) continue;
      if (rarityCap !== null && (RARITY_ORDER[candidate.rarity] ?? 0) > rarityCap) continue;
      candidates.push(candidate);
    }
  }

  return candidates;
}

/**
 * Roll for rune/grade + material upgrades on a weapon/armor pick. Returns the
 * pick unchanged if the type isn't applicable, all rolls miss, or no upgrade
 * fits the remaining budget. PF2E and SF2E derive the displayed price from
 * system.runes/system.grade and system.material; we track upgrade gp ourselves.
 *
 * Roll order: material (sets rune level cap per GM's notes) -> potency/grade
 * -> fundamental (striking/resilient, PF2E only — SF2E bundles this into grade)
 * -> property runes. Material grade caps: low=lvl 8, standard=lvl 15, high=any.
 * When no material is rolled the cap defaults to lvl 8 so merchants stay
 * tonally sensible.
 *
 * SF2E branch sets system.grade (e.g. "tactical") instead of system.runes.potency.
 */
function tryUpgradeWithRunes(pick, remainingBudget) {
  const slot = pick.type === "weapon" ? "weapon" : pick.type === "armor" ? "armor" : null;
  if (!slot) return pick;

  let budget = remainingBudget;
  let upgradeCost = 0;
  let runes = null;
  let material = null;
  let grade = null;
  let maxRuneLevel = MATERIAL_LEVEL_CAP.low; // default cap with no material rolled

  if (Math.random() < MATERIAL_CHANCE) {
    const affordable = MATERIALS[slot].filter(m => m.cost <= budget);
    if (affordable.length) {
      const chosen = pickRandom(affordable);
      material = { type: chosen.type, grade: chosen.grade };
      maxRuneLevel = MATERIAL_LEVEL_CAP[chosen.grade] ?? maxRuneLevel;
      upgradeCost += chosen.cost;
      budget -= chosen.cost;
    }
  }

  const sf2e = isSF2E();

  if (sf2e) {
    // SF2E: roll item grade in place of potency/fundamental runes.
    if (Math.random() < RUNE_POTENCY_CHANCE) {
      const affordable = SF2E_GRADES[slot].filter(g => g.cost <= budget);
      if (affordable.length) {
        const chosen = pickWeightedBy(affordable, g => g.weight);
        grade = chosen.grade;
        upgradeCost += chosen.cost;
        budget -= chosen.cost;
        const gradeCap = SF2E_GRADE_RUNE_CAP[grade] ?? maxRuneLevel;
        if (gradeCap > maxRuneLevel) maxRuneLevel = gradeCap;
      }
    }
  } else if (Math.random() < RUNE_POTENCY_CHANCE) {
    const costs = RUNE_COSTS[slot];
    if (costs.potency <= budget) {
      runes = { potency: 1, property: [] };
      upgradeCost += costs.potency;
      budget -= costs.potency;

      const fundamentalKey = slot === "weapon" ? "striking" : "resilient";
      if (Math.random() < RUNE_FUNDAMENTAL_CHANCE && costs[fundamentalKey] <= budget) {
        runes[fundamentalKey] = 1;
        upgradeCost += costs[fundamentalKey];
        budget -= costs[fundamentalKey];
      }
    }
  }

  // Property runes apply in both systems. Slot count = 1 at +1 potency / lower
  // grade; SF2E grade tiers don't expand slots in this implementation.
  const propertyEligible = sf2e ? !!grade : !!runes;
  if (propertyEligible) {
    const propertyPool = PROPERTY_RUNES[slot];
    const slots = sf2e ? 1 : runes.potency;
    const chosenProps = [];
    for (let i = 0; i < slots; i++) {
      if (Math.random() >= RUNE_PROPERTY_CHANCE) continue;
      const affordable = propertyPool.filter(r =>
        r.cost <= budget &&
        r.level <= maxRuneLevel &&
        !chosenProps.includes(r.slug)
      );
      if (!affordable.length) continue;
      const chosen = pickRandom(affordable);
      chosenProps.push(chosen.slug);
      upgradeCost += chosen.cost;
      budget -= chosen.cost;
    }
    if (chosenProps.length) {
      if (sf2e) runes = { property: chosenProps };
      else runes.property = chosenProps;
    } else if (!sf2e && runes.property.length === 0) {
      delete runes.property;
    }
  }

  if (!runes && !material && !grade) return pick;
  return { ...pick, cost: pick.cost + upgradeCost, runes, material, grade };
}

function pickWeightedBy(list, weightFn) {
  if (!list.length) return null;
  let total = 0;
  for (const c of list) total += weightFn(c);
  if (total <= 0) return pickRandom(list);
  let roll = Math.random() * total;
  for (const c of list) {
    roll -= weightFn(c);
    if (roll <= 0) return c;
  }
  return list[list.length - 1];
}

function pickRandom(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

function pickWeighted(list) {
  if (!list.length) return null;
  let total = 0;
  for (const c of list) total += RARITY_WEIGHT[c.rarity] ?? RARITY_WEIGHT.common;
  if (total <= 0) return pickRandom(list);
  let roll = Math.random() * total;
  for (const c of list) {
    roll -= RARITY_WEIGHT[c.rarity] ?? RARITY_WEIGHT.common;
    if (roll <= 0) return c;
  }
  return list[list.length - 1];
}

/**
 * Randomly select items until the budget can no longer fit the cheapest remaining
 * candidate, or we hit the MAX_PICKS safety cap. Selection is weighted by rarity
 * so common items dominate even when the pool contains many uncommons.
 */
function fillFromPool(pool, startingBudget, pickedUuids, { allowRunes = false, uniqueLimit = Infinity } = {}) {
  const picked = [];
  let budget = startingBudget;
  const uniqueUuids = new Set(pickedUuids);

  for (let i = 0; i < MAX_PICKS; i++) {
    let affordable = pool.filter(c => c.cost <= budget);
    if (!affordable.length) break;
    // Once we've hit the unique-item cap, only allow picks of items we've
    // already picked — excess rolls deepen stacks instead of adding variety.
    if (uniqueUuids.size >= uniqueLimit) {
      affordable = affordable.filter(c => uniqueUuids.has(c.uuid));
      if (!affordable.length) break;
    }
    const choice = pickWeighted(affordable);
    const upgraded = allowRunes ? tryUpgradeWithRunes(choice, budget - choice.cost) : choice;
    picked.push(upgraded);
    pickedUuids.add(upgraded.uuid);
    uniqueUuids.add(upgraded.uuid);
    budget -= upgraded.cost;
  }

  return { picked, remaining: budget };
}

/**
 * Build a restock plan for the given merchant without modifying the actor.
 * The plan contains a consolidated stack list (each entry has uuid + qty plus
 * any runes/material/grade upgrades) plus a summary. Used by both the live
 * restock path and the preview path.
 */
export async function planRestock(actor) {
  if (!actor || actor.type !== "loot") {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.notLoot") ?? "Actor must be a Loot actor.");
  }

  const themeId = actor.getFlag(MODULE_ID, FLAGS.theme);
  const budget = Number(actor.getFlag(MODULE_ID, FLAGS.budget) ?? 0);
  const overrideCompendium = actor.getFlag(MODULE_ID, FLAGS.compendium) || null;
  const maxLevelFlag = actor.getFlag(MODULE_ID, FLAGS.maxLevel);
  const maxLevel = Number.isFinite(Number(maxLevelFlag)) && Number(maxLevelFlag) > 0 ? Number(maxLevelFlag) : null;
  const maxRarity = actor.getFlag(MODULE_ID, FLAGS.maxRarity) || null;
  const theme = getTheme(themeId);

  if (!theme) {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.noTheme") ?? "No theme configured for this merchant.");
  }
  if (!(budget > 0)) {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.noBudget") ?? "Merchant budget must be greater than zero.");
  }

  const allCandidates = await buildCandidatePool(theme, overrideCompendium, { maxLevel, maxRarity });
  if (!allCandidates.length) {
    throw new Error(game.i18n?.format?.("INTRINSICS_RESTOCKER.Error.emptyPool", { theme: theme.id }) ?? `No items found for theme ${theme.id}.`);
  }

  const pickedUuids = new Set();
  const guaranteed = []; // entries forced in before random fill

  // Equipment-vendor guarantees: 50% chance of 1 uncommon, 25% chance of 1 rare.
  if (theme.isEquipmentVendor) {
    if (Math.random() < UNCOMMON_CHANCE) {
      const uncommonPool = allCandidates.filter(c => c.rarity === "uncommon" && c.cost <= budget);
      if (uncommonPool.length) {
        const pick = pickRandom(uncommonPool);
        const used = guaranteed.reduce((s, g) => s + g.cost, 0);
        guaranteed.push(tryUpgradeWithRunes(pick, budget - used - pick.cost));
      }
    }

    if (Math.random() < RARE_CHANCE) {
      const usedSoFar = guaranteed.reduce((sum, g) => sum + g.cost, 0);
      const remaining = budget - usedSoFar;
      const rarePool = allCandidates.filter(c => c.rarity === "rare" && c.cost <= remaining);
      if (rarePool.length) {
        const pick = pickRandom(rarePool);
        guaranteed.push(tryUpgradeWithRunes(pick, remaining - pick.cost));
      }
    }
  }

  const guaranteedCost = guaranteed.reduce((sum, g) => sum + g.cost, 0);
  guaranteed.forEach(g => pickedUuids.add(g.uuid));

  const fillBudget = budget - guaranteedCost;
  const uniqueLimit = theme.stockSpread?.uniqueLimit ?? Infinity;
  const { picked: filled } = fillFromPool(allCandidates, fillBudget, pickedUuids, {
    allowRunes: !!theme.isEquipmentVendor,
    uniqueLimit
  });

  const allPicks = [...guaranteed, ...filled];

  // Consolidate: plain picks stack by uuid; upgraded picks (runes/material/
  // grade) stay separate because each upgrade combination is a distinct item.
  const stackMap = new Map();
  const stacks = [];
  for (const pick of allPicks) {
    if (pick.runes || pick.material || pick.grade) {
      stacks.push({ ...pick, qty: 1 });
      continue;
    }
    const cur = stackMap.get(pick.uuid);
    if (cur) cur.qty += 1;
    else {
      const entry = { ...pick, qty: 1 };
      stackMap.set(pick.uuid, entry);
      stacks.push(entry);
    }
  }

  const spent = allPicks.reduce((sum, p) => sum + p.cost, 0);
  const summary = {
    theme: theme.id,
    budget,
    spent,
    remaining: budget - spent,
    itemCount: allPicks.length,
    uniqueItemCount: stacks.length,
    rarityBreakdown: allPicks.reduce((acc, p) => {
      acc[p.rarity] = (acc[p.rarity] ?? 0) + 1;
      return acc;
    }, {})
  };

  return { themeId: theme.id, stacks, summary };
}

/**
 * Resolve a plan's stacks into ready-to-create item document data. Themes can
 * override the default fromUuid path by providing createDoc(stack) — used by
 * the scrolls theme to conjure scroll consumables from spell entries.
 */
async function resolvePlanToDocs(plan, theme) {
  const docs = [];
  for (const stack of plan.stacks) {
    let data;
    if (theme?.createDoc) {
      data = await theme.createDoc(stack);
    } else {
      const source = await fromUuid(stack.uuid);
      if (!source) continue;
      data = source.toObject();
    }
    if (!data) continue;
    if (stack.qty > 1 && foundry.utils.hasProperty(data, "system.quantity")) {
      data.system.quantity = stack.qty;
    }
    if (stack.grade) data.system.grade = stack.grade;
    if (stack.runes) {
      if (!data.system.runes) data.system.runes = {};
      if (stack.runes.potency != null) data.system.runes.potency = stack.runes.potency;
      if (stack.runes.striking != null) data.system.runes.striking = stack.runes.striking;
      if (stack.runes.resilient != null) data.system.runes.resilient = stack.runes.resilient;
      if (stack.runes.property?.length) {
        data.system.runes.property = [...(data.system.runes.property ?? []), ...stack.runes.property];
      }
    }
    if (stack.material) {
      if (!data.system.material) data.system.material = {};
      data.system.material.type = stack.material.type;
      data.system.material.grade = stack.material.grade;
    }
    docs.push(data);
  }
  return docs;
}

/**
 * Apply a plan to the actor: snapshot the current inventory for undo, replace
 * with the planned items, and return the summary.
 */
async function commitPlan(actor, plan) {
  const theme = getTheme(plan.themeId);
  const docs = await resolvePlanToDocs(plan, theme);

  // Snapshot existing inventory so undoLastRestock can restore it. Stored as
  // raw item source data on a flag — overwritten on every restock.
  const snapshot = actor.items.map(i => i.toObject());
  await actor.setFlag(MODULE_ID, FLAGS.previousInventory, snapshot);

  const existingIds = actor.items.map(i => i.id);
  if (existingIds.length) {
    await actor.deleteEmbeddedDocuments("Item", existingIds);
  }
  if (docs.length) {
    await actor.createEmbeddedDocuments("Item", docs);
  }

  Hooks.callAll(`${MODULE_ID}.restocked`, actor, plan.summary);
  return plan.summary;
}

/**
 * Restock the given Loot actor according to its configured theme & budget flags.
 * Replaces the entire contained inventory. Returns the plan summary.
 */
export async function restock(actor) {
  const plan = await planRestock(actor);
  return commitPlan(actor, plan);
}

/**
 * Roll a restock plan and post it to chat without modifying the actor. Lets the
 * GM eyeball the result before committing — they can re-roll the preview or
 * click the regular Restock button to roll fresh and commit.
 */
export async function previewRestock(actor) {
  const plan = await planRestock(actor);
  await postPlanToChat(actor, plan);
  return plan;
}

/**
 * Restore the inventory snapshot taken on the last commitPlan. No-op (with
 * warning) if no snapshot is present.
 */
export async function undoLastRestock(actor) {
  if (!actor || actor.type !== "loot") {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.notLoot") ?? "Actor must be a Loot actor.");
  }
  const snapshot = actor.getFlag(MODULE_ID, FLAGS.previousInventory);
  if (!Array.isArray(snapshot)) {
    ui.notifications?.warn(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Notify.noUndo") ?? "No previous inventory to restore.");
    return false;
  }
  const existingIds = actor.items.map(i => i.id);
  if (existingIds.length) {
    await actor.deleteEmbeddedDocuments("Item", existingIds);
  }
  if (snapshot.length) {
    await actor.createEmbeddedDocuments("Item", snapshot);
  }
  await actor.unsetFlag(MODULE_ID, FLAGS.previousInventory);
  ui.notifications?.info(
    game.i18n?.format?.("INTRINSICS_RESTOCKER.Notify.undone", { name: actor.name })
    ?? `Restored previous inventory for ${actor.name}.`
  );
  return true;
}

export function hasUndoSnapshot(actor) {
  if (!actor) return false;
  return Array.isArray(actor.getFlag(MODULE_ID, FLAGS.previousInventory));
}

async function postPlanToChat(actor, plan) {
  const rows = plan.stacks.map(s => {
    const qty = s.qty > 1 ? `${s.qty}× ` : "";
    const lineCost = formatCurrency(s.cost * s.qty);
    const tags = [];
    if (s.grade) tags.push(s.grade);
    if (s.runes?.potency) tags.push(`+${s.runes.potency}`);
    if (s.runes?.striking) tags.push("striking");
    if (s.runes?.resilient) tags.push("resilient");
    if (s.runes?.property?.length) tags.push(...s.runes.property);
    if (s.material) tags.push(`${s.material.grade}-grade ${s.material.type}`);
    const tagStr = tags.length ? ` <em>(${tags.join(", ")})</em>` : "";
    return `<li>${qty}${foundry.utils.escapeHTML?.(s.name) ?? s.name}${tagStr} — ${lineCost}</li>`;
  }).join("");

  const breakdown = Object.entries(plan.summary.rarityBreakdown ?? {})
    .map(([r, n]) => `${n} ${r}`)
    .join(", ") || "—";

  const theme = getTheme(plan.themeId);
  const themeLabel = theme?.labelKey ? game.i18n.localize(theme.labelKey) : plan.themeId;

  const content = `
    <div class="intrinsics-restocker-preview">
      <h3>${foundry.utils.escapeHTML?.(actor.name) ?? actor.name} — Preview</h3>
      <p><strong>Theme:</strong> ${themeLabel} &nbsp;
         <strong>Budget:</strong> ${formatCurrency(plan.summary.budget)} &nbsp;
         <strong>Spent:</strong> ${formatCurrency(plan.summary.spent)}</p>
      <ul>${rows || "<li><em>No items rolled.</em></li>"}</ul>
      <p><small>${plan.summary.itemCount} items, ${plan.summary.uniqueItemCount} unique &middot; ${breakdown}</small></p>
      <p><small><em>This is a preview only — click Restock on the merchant sheet to commit (rolls a fresh plan).</em></small></p>
    </div>
  `;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: game.users.filter(u => u.isGM).map(u => u.id)
  });
}

/**
 * Restock every Loot actor in the world that has a configured theme + budget.
 * Skips non-merchant loot actors and any actor missing required flags. Errors
 * on individual actors are logged and surfaced as notifications but do not
 * abort the run.
 */
export async function restockAll() {
  const merchants = game.actors.filter(a => {
    if (a.type !== "loot") return false;
    if (a.system?.lootSheetType !== "Merchant") return false;
    if (!a.getFlag(MODULE_ID, FLAGS.theme)) return false;
    if (!(Number(a.getFlag(MODULE_ID, FLAGS.budget)) > 0)) return false;
    return true;
  });

  const results = [];
  for (const actor of merchants) {
    try {
      const summary = await restock(actor);
      results.push({ actor, summary });
    } catch (err) {
      console.error(`${MODULE_ID} | restockAll failed for ${actor.name}`, err);
      ui.notifications?.warn(`${actor.name}: ${err.message ?? err}`);
      results.push({ actor, error: err });
    }
  }

  const ok = results.filter(r => r.summary).length;
  const totalSpent = results.reduce((sum, r) => sum + (r.summary?.spent ?? 0), 0);
  ui.notifications?.info(`Restocked ${ok}/${merchants.length} merchants — total spent ${formatCurrency(totalSpent)}.`);
  return results;
}
