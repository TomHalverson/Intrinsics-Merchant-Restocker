import { MODULE_ID } from "./constants.js";
import { MerchantConfigApp } from "./config-app.js";
import { restock, previewRestock, undoLastRestock, hasUndoSnapshot, formatCurrency } from "./restocker.js";

/**
 * Returns true if this actor is a PF2E/SF2E Loot actor with the Merchant subtype.
 * Loot actors with lootSheetType === "Loot" are treated as plain treasure piles and
 * are skipped — only merchants get the buttons.
 */
function isMerchant(actor) {
  if (!actor || actor.type !== "loot") return false;
  return actor.system?.lootSheetType === "Merchant";
}

/**
 * Build a button element to inject into the loot sheet header / body. ApplicationV1
 * gives us jQuery; ApplicationV2 gives us a raw HTMLElement. This helper handles both.
 */
function makeButton({ icon, label, title, onClick }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("intrinsics-restocker-btn");
  btn.title = title ?? label;
  btn.innerHTML = `<i class="fas ${icon}"></i> <span>${label}</span>`;
  btn.addEventListener("click", ev => {
    ev.preventDefault();
    ev.stopPropagation();
    onClick(ev);
  });
  return btn;
}

async function handleRestock(actor) {
  try {
    const summary = await restock(actor);
    const breakdown = Object.entries(summary.rarityBreakdown ?? {})
      .map(([r, n]) => `${n} ${r}`)
      .join(", ");
    ui.notifications?.info(
      game.i18n.format("INTRINSICS_RESTOCKER.Notify.restocked", {
        name: actor.name,
        count: summary.itemCount,
        breakdown: breakdown || "—",
        spent: formatCurrency(summary.spent)
      })
    );
  } catch (err) {
    console.error(`${MODULE_ID} | restock failed`, err);
    ui.notifications?.error(err.message ?? String(err));
  }
}

async function handlePreview(actor) {
  try {
    await previewRestock(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | preview failed`, err);
    ui.notifications?.error(err.message ?? String(err));
  }
}

async function handleUndo(actor) {
  try {
    await undoLastRestock(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | undo failed`, err);
    ui.notifications?.error(err.message ?? String(err));
  }
}

function injectButtons(app, root) {
  if (!isMerchant(app.actor)) return;
  if (!game.user?.isGM) return;

  // Avoid double-injection on re-render.
  if (root.querySelector(".intrinsics-restocker-toolbar")) return;

  const toolbar = document.createElement("div");
  toolbar.classList.add("intrinsics-restocker-toolbar");

  toolbar.appendChild(makeButton({
    icon: "fa-shop",
    label: game.i18n.localize("INTRINSICS_RESTOCKER.Sheet.configure"),
    onClick: () => new MerchantConfigApp(app.actor).render(true)
  }));

  toolbar.appendChild(makeButton({
    icon: "fa-eye",
    label: game.i18n.localize("INTRINSICS_RESTOCKER.Sheet.preview"),
    onClick: () => handlePreview(app.actor)
  }));

  toolbar.appendChild(makeButton({
    icon: "fa-dice-d20",
    label: game.i18n.localize("INTRINSICS_RESTOCKER.Sheet.restock"),
    onClick: () => handleRestock(app.actor)
  }));

  if (hasUndoSnapshot(app.actor)) {
    toolbar.appendChild(makeButton({
      icon: "fa-rotate-left",
      label: game.i18n.localize("INTRINSICS_RESTOCKER.Sheet.undo"),
      onClick: () => handleUndo(app.actor)
    }));
  }

  // Mount near the top of the sheet body so it's visible without scrolling.
  const mountTarget =
    root.querySelector(".sheet-body") ??
    root.querySelector(".window-content") ??
    root;
  mountTarget.prepend(toolbar);
}

export function registerSheetHooks() {
  // ApplicationV2-compatible: renderActorSheet still fires for PF2E v6+.
  Hooks.on("renderActorSheet", (app, html) => {
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root) return;
    injectButtons(app, root);
  });

  // Context menu entry on the Actor sidebar directory.
  Hooks.on("getActorDirectoryEntryContext", (_html, entries) => {
    entries.push({
      name: "INTRINSICS_RESTOCKER.Sheet.restock",
      icon: '<i class="fas fa-dice-d20"></i>',
      condition: li => {
        if (!game.user?.isGM) return false;
        const actor = game.actors.get(li.dataset.entryId ?? li.dataset.documentId);
        return isMerchant(actor);
      },
      callback: li => {
        const actor = game.actors.get(li.dataset.entryId ?? li.dataset.documentId);
        if (actor) handleRestock(actor);
      }
    });

    entries.push({
      name: "INTRINSICS_RESTOCKER.Sheet.configure",
      icon: '<i class="fas fa-shop"></i>',
      condition: li => {
        if (!game.user?.isGM) return false;
        const actor = game.actors.get(li.dataset.entryId ?? li.dataset.documentId);
        return isMerchant(actor);
      },
      callback: li => {
        const actor = game.actors.get(li.dataset.entryId ?? li.dataset.documentId);
        if (actor) new MerchantConfigApp(actor).render(true);
      }
    });
  });
}
