import { MODULE_ID } from "./constants.js";
import { listThemes, getTheme } from "./themes.js";
import { restock, priceToGp } from "./restocker.js";
import { MerchantConfigApp } from "./config-app.js";
import { registerSheetHooks } from "./sheet.js";

Hooks.once("init", () => {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) return;

  // Public API for macros & other modules.
  mod.api = {
    restock,
    listThemes,
    getTheme,
    openConfig: actor => new MerchantConfigApp(actor).render(true),
    priceToGp
  };
});

Hooks.once("ready", () => {
  registerSheetHooks();
  console.log(`${MODULE_ID} | ready`);
});
