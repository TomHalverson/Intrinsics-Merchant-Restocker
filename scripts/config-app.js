import { MODULE_ID, FLAGS, DEFAULTS } from "./constants.js";
import { listThemes } from "./themes.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MerchantConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor(actor, options = {}) {
    super({ ...options, id: `intrinsics-merchant-restocker-config-${actor.id}` });
    this.actor = actor;
  }

  static DEFAULT_OPTIONS = {
    classes: ["intrinsics-merchant-restocker", "config"],
    tag: "form",
    window: {
      title: "INTRINSICS_RESTOCKER.Config.title",
      icon: "fas fa-shop",
      contentClasses: ["standard-form"]
    },
    position: { width: 420, height: "auto" },
    form: {
      handler: MerchantConfigApp._onSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/config.hbs` },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  get title() {
    const base = game.i18n.localize("INTRINSICS_RESTOCKER.Config.title");
    return `${base}: ${this.actor.name}`;
  }

  async _prepareContext() {
    const currentTheme = this.actor.getFlag(MODULE_ID, FLAGS.theme) ?? "";
    const currentBudget = this.actor.getFlag(MODULE_ID, FLAGS.budget) ?? DEFAULTS.budget;

    const themes = listThemes().map(t => ({
      id: t.id,
      label: game.i18n.localize(t.labelKey),
      isEquipmentVendor: t.isEquipmentVendor,
      selected: t.id === currentTheme
    }));

    return {
      actor: this.actor,
      themes,
      currentTheme,
      currentBudget,
      buttons: [{ type: "submit", icon: "fas fa-save", label: "INTRINSICS_RESTOCKER.Config.save" }]
    };
  }

  static async _onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const theme = (data.theme ?? "").trim();
    const budget = Number(data.budget);

    if (!theme) {
      ui.notifications?.warn(game.i18n.localize("INTRINSICS_RESTOCKER.Error.noTheme"));
      return;
    }
    if (!(budget > 0)) {
      ui.notifications?.warn(game.i18n.localize("INTRINSICS_RESTOCKER.Error.noBudget"));
      return;
    }

    await this.actor.update({
      [`flags.${MODULE_ID}.${FLAGS.theme}`]: theme,
      [`flags.${MODULE_ID}.${FLAGS.budget}`]: budget
    });

    ui.notifications?.info(game.i18n.format("INTRINSICS_RESTOCKER.Notify.configured", { name: this.actor.name }));
  }
}
