import { MODULE_ID, FLAGS } from "./constants.js";
import { getTheme } from "./themes.js";

const RARITY_MULTIPLIER = {
  common: 1,
  uncommon: 1.5,
  rare: 3,
  unique: 5
};

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
  "system.quantity"
];

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
 */
async function buildCandidatePool(theme) {
  const candidates = [];
  const itemPacks = game.packs.filter(p => p.metadata.type === "Item");

  for (const pack of itemPacks) {
    let index;
    try {
      index = await pack.getIndex({ fields: INDEX_FIELDS });
    } catch (err) {
      console.warn(`${MODULE_ID} | failed to index pack ${pack.collection}`, err);
      continue;
    }

    for (const entry of index) {
      if (!theme.itemTypes.includes(entry.type)) continue;
      if (!theme.matches(entry)) continue;
      const cost = costInPoints(entry);
      if (!Number.isFinite(cost) || cost <= 0) continue;
      candidates.push({
        uuid: `Compendium.${pack.collection}.Item.${entry._id}`,
        name: entry.name,
        type: entry.type,
        rarity: rarityOf(entry),
        cost
      });
    }
  }

  return candidates;
}

function pickRandom(list) {
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Randomly select items until the budget can no longer fit the cheapest remaining
 * candidate, or we hit the MAX_PICKS safety cap.
 */
function fillFromPool(pool, startingBudget, pickedUuids) {
  const picked = [];
  let budget = startingBudget;

  for (let i = 0; i < MAX_PICKS; i++) {
    const affordable = pool.filter(c => c.cost <= budget);
    if (!affordable.length) break;
    const choice = pickRandom(affordable);
    picked.push(choice);
    pickedUuids.add(choice.uuid);
    budget -= choice.cost;
  }

  return { picked, remaining: budget };
}

/**
 * Restock the given Loot actor according to its configured theme & budget flags.
 * Replaces the entire contained inventory.
 *
 * Returns a small summary object the caller can surface in chat/UI.
 */
export async function restock(actor) {
  if (!actor || actor.type !== "loot") {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.notLoot") ?? "Actor must be a Loot actor.");
  }

  const themeId = actor.getFlag(MODULE_ID, FLAGS.theme);
  const budget = Number(actor.getFlag(MODULE_ID, FLAGS.budget) ?? 0);
  const theme = getTheme(themeId);

  if (!theme) {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.noTheme") ?? "No theme configured for this merchant.");
  }
  if (!(budget > 0)) {
    throw new Error(game.i18n?.localize?.("INTRINSICS_RESTOCKER.Error.noBudget") ?? "Merchant budget must be greater than zero.");
  }

  const allCandidates = await buildCandidatePool(theme);
  if (!allCandidates.length) {
    throw new Error(game.i18n?.format?.("INTRINSICS_RESTOCKER.Error.emptyPool", { theme: theme.id }) ?? `No items found for theme ${theme.id}.`);
  }

  const pickedUuids = new Set();
  const guaranteed = []; // entries forced in before random fill

  // Equipment-vendor guarantees: 1 uncommon, 25% chance of 1 rare.
  if (theme.isEquipmentVendor) {
    const uncommonPool = allCandidates.filter(c => c.rarity === "uncommon" && c.cost <= budget);
    if (uncommonPool.length) {
      guaranteed.push(pickRandom(uncommonPool));
    }

    if (Math.random() < RARE_CHANCE) {
      const usedSoFar = guaranteed.reduce((sum, g) => sum + g.cost, 0);
      const remaining = budget - usedSoFar;
      const rarePool = allCandidates.filter(c => c.rarity === "rare" && c.cost <= remaining);
      if (rarePool.length) {
        guaranteed.push(pickRandom(rarePool));
      }
    }
  }

  const guaranteedCost = guaranteed.reduce((sum, g) => sum + g.cost, 0);
  guaranteed.forEach(g => pickedUuids.add(g.uuid));

  // Random fill from the full pool (common items dominate but uncommons/rares can still appear).
  const fillBudget = budget - guaranteedCost;
  const { picked: filled } = fillFromPool(allCandidates, fillBudget, pickedUuids);

  const allPicks = [...guaranteed, ...filled];

  // Resolve each pick into a full item document, dedupe by source uuid so
  // duplicate rolls become a single stack with quantity > 1 where it makes sense.
  const stackMap = new Map();
  for (const pick of allPicks) {
    const cur = stackMap.get(pick.uuid);
    if (cur) cur.qty += 1;
    else stackMap.set(pick.uuid, { uuid: pick.uuid, qty: 1 });
  }

  const docs = [];
  for (const { uuid, qty } of stackMap.values()) {
    const source = await fromUuid(uuid);
    if (!source) continue;
    const data = source.toObject();
    if (qty > 1 && foundry.utils.hasProperty(data, "system.quantity")) {
      data.system.quantity = qty;
    }
    docs.push(data);
  }

  // Replace existing inventory.
  const existingIds = actor.items.map(i => i.id);
  if (existingIds.length) {
    await actor.deleteEmbeddedDocuments("Item", existingIds);
  }
  if (docs.length) {
    await actor.createEmbeddedDocuments("Item", docs);
  }

  const spent = allPicks.reduce((sum, p) => sum + p.cost, 0);
  const summary = {
    theme: theme.id,
    budget,
    spent,
    remaining: budget - spent,
    itemCount: allPicks.length,
    uniqueItemCount: docs.length,
    rarityBreakdown: allPicks.reduce((acc, p) => {
      acc[p.rarity] = (acc[p.rarity] ?? 0) + 1;
      return acc;
    }, {})
  };

  Hooks.callAll(`${MODULE_ID}.restocked`, actor, summary);
  return summary;
}
