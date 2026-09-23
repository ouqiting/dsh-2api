/**
 * Browser half of the EPSE regeneration guard — a settings card on the
 * 插件配置 page. Plain-JS bundle (no build step): it registers through the
 * client module loader and draws its own card, mirroring the stock Terminal /
 * Agent loop / Web search cards so the layout and controls look identical.
 *
 * Registered into the Plugins page's `plugins.item` slot keyed by the guard's
 * settings namespace; the page only dispatches a card while the Host serves
 * that namespace, which index.js provides by exporting the `Config` schema the
 * settings service derives the form from. The two inputs write straight to the
 * durable settings document.
 */

window.__ModuleLoader__.load({
  id: "@ds2api/dsh-epse-regeneration-guard",
  factory: (require) => {
    const React = require("react");
    const { createElement: h, useState } = React;
    const { IconChevronDownOutline14 } = require("@deepseek-ai/dsh-client-ui-primitives");

    const NS = "epse-regeneration-guard";
    const LOCALE_NS = "epse-regeneration-guard";

    const cardCss = `
.epg_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;list-style:none;transition:border-color .16s,background .16s}
.epg_card:hover{border-color:var(--dsw-alias-label-dimmed)}
.epg_cardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.epg_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.epg_header:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.epg_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.epg_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.epg_description{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.epg_chevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}
.epg_chevronOpen{transform:rotate(180deg)}
.epg_body{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.epg_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}
.epg_pending{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.epg_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.epg_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.epg_discard,.epg_save{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.epg_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.epg_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.epg_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.epg_discard:disabled,.epg_save:disabled{opacity:.4;cursor:default}
.epg_discard:focus-visible,.epg_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
`;
    const fieldCss = `
.epg_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.epg_field+.epg_field{border-top:1px solid var(--dsw-alias-border-l2)}
.epg_head{align-items:center;gap:8px;display:flex}
.epg_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.epg_badges{align-items:center;gap:8px;display:inline-flex}
.epg_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.epg_badgeMuted{white-space:nowrap;color:var(--dsw-alias-label-tertiary);border-radius:999px;padding:1px 8px;font-size:11px;line-height:17px}
.epg_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
.epg_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.epg_reset:disabled{cursor:default}
.epg_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5}
.epg_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.epg_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.epg_inputInvalid{border-color:var(--dsw-alias-label-error)}
.epg_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.epg_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
`;
    const TAG = "@ds2api/dsh-epse-regeneration-guard/card.module.css";
    if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]") === null) {
      const tag = document.createElement("style");
      tag.dataset.plugin = "@ds2api/dsh-epse-regeneration-guard";
      tag.dataset.pluginCss = TAG;
      tag.textContent = cardCss + fieldCss;
      document.head.appendChild(tag);
    }

    const c = {
      card: "epg_card", cardOpen: "epg_cardOpen", header: "epg_header",
      headText: "epg_headText", name: "epg_name", description: "epg_description",
      chevron: "epg_chevron", chevronOpen: "epg_chevronOpen", body: "epg_body",
      readOnly: "epg_readOnly", pending: "epg_pending", footer: "epg_footer",
      failed: "epg_failed", discard: "epg_discard", save: "epg_save",
      field: "epg_field", head: "epg_head", label: "epg_label",
      badges: "epg_badges", badge: "epg_badge", badgeMuted: "epg_badgeMuted",
      reset: "epg_reset", input: "epg_input", inputInvalid: "epg_inputInvalid",
      invalid: "epg_invalid", hint: "epg_hint",
    };

    const en = {
      title: "EPSE leakage guard",
      description: "DS2api Companion Plugin Settings.",
      maxRegenerations: "Regenerations per step",
      maxRegenerationsHint: "How many times one step may be forced to regenerate after a framed reply (min 1).",
      targetProviders: "Target providers / models",
      targetProvidersHint: "Comma-separated provider or model names. Leave blank to apply to every agent.",
      customTriggerWords: "Custom trigger words",
      customTriggerWordsHint: "Semicolon-separated phrases. If any appears in the reply, the step regenerates.",
      unsaved: "Unsaved",
      readOnly: "This deployment stores settings read-only.",
      expand: "Show settings",
      collapse: "Hide settings",
      save: "Save",
      saving: "Saving…",
      discard: "Discard",
      saveFailed: "The deployment did not accept these values; they were left for you to correct.",
      overridden: "Overridden",
      reset: "Reset to default",
      invalidNumber: "Enter a whole number, or leave blank to use the default.",
    };
    const zh = {
      title: "EPSE 泄露守护",
      description: "DS2api 辅助插件设置。",
      maxRegenerations: "每步重生成次数",
      maxRegenerationsHint: "模型把工具调用框架写进文本时，同一 step 最多强制重生成多少次（最小 1）。",
      targetProviders: "限定的 provider / model",
      targetProvidersHint: "逗号分隔的 provider 或 model 名。留空表示对所有 agent 生效。",
      customTriggerWords: "自定义触发词",
      customTriggerWordsHint: "分号分隔的短语。回复中出现任意一个即触发重生成。",
      unsaved: "未保存",
      readOnly: "本部署的设置为只读。",
      expand: "展开设置",
      collapse: "收起设置",
      save: "保存",
      saving: "保存中…",
      discard: "放弃修改",
      saveFailed: "本部署没有接受这些值，已保留供你修改。",
      overridden: "已覆盖",
      reset: "恢复默认",
      invalidNumber: "请填整数；留空表示使用默认值。",
    };

    const cls = (...parts) => parts.filter(Boolean).join(" ");
    const formatMax = (value) => (value == null ? "" : String(value));
    const formatProviders = (value) => (Array.isArray(value) ? value.join(", ") : "");
    const formatTriggerWords = (value) => (typeof value === "string" ? value : "");
    const parseMax = (text) => {
      if (text.trim() === "") return { kind: "clear" };
      const n = Number(text);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return undefined;
      return { kind: "set", value: n };
    };
    const parseProviders = (text) => {
      const parts = text.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
      return { kind: "set", value: parts };
    };
    const parseTriggerWords = (text) => {
      if (text.trim() === "") return { kind: "clear" };
      return { kind: "set", value: text };
    };

    class CardController {
      constructor(scope) {
        this.scope = scope;
        this.staged = {};
        this.saving = false;
        this.failed = false;
        this.listeners = new Set();
        this.parsers = {
          maxRegenerationsPerTurn: parseMax,
          targetProviders: parseProviders,
          customTriggerWords: parseTriggerWords,
        };
        this.state = this.compute();
        this.unsubscribe = scope.subscribe(() => {
          this.state = this.compute();
          this.publish();
        });
      }
      compute() {
        const snap = this.scope.getSnapshot();
        const available = snap.status === "ready";
        const writable = snap.writable === true;
        const user = snap.user && typeof snap.user === "object" ? snap.user : {};
        const value = snap.value && typeof snap.value === "object" ? snap.value : {};
        const staged = this.staged;
        const maxText = Object.hasOwn(staged, "maxRegenerationsPerTurn") ? staged.maxRegenerationsPerTurn : formatMax(value.maxRegenerationsPerTurn);
        const maxOverridden = Object.hasOwn(staged, "maxRegenerationsPerTurn") || Object.hasOwn(user, "maxRegenerationsPerTurn");
        const maxInvalid = Object.hasOwn(staged, "maxRegenerationsPerTurn") ? parseMax(staged.maxRegenerationsPerTurn) === undefined : false;
        const provText = Object.hasOwn(staged, "targetProviders") ? staged.targetProviders : formatProviders(value.targetProviders);
        const provOverridden = Object.hasOwn(staged, "targetProviders") || Object.hasOwn(user, "targetProviders");
        const provInvalid = false;
        const triggerText = Object.hasOwn(staged, "customTriggerWords") ? staged.customTriggerWords : formatTriggerWords(value.customTriggerWords);
        const triggerOverridden = Object.hasOwn(staged, "customTriggerWords") || Object.hasOwn(user, "customTriggerWords");
        const triggerInvalid = false;
        const dirty = Object.keys(staged).length > 0;
        return {
          available,
          writable,
          dirty,
          invalid: maxInvalid || provInvalid || triggerInvalid,
          saving: this.saving,
          failed: this.failed,
          maxRegenerationsPerTurn: { text: maxText, overridden: maxOverridden, invalid: maxInvalid },
          targetProviders: { text: provText, overridden: provOverridden, invalid: provInvalid },
          customTriggerWords: { text: triggerText, overridden: triggerOverridden, invalid: triggerInvalid },
        };
      }
      getSnapshot() { return this.state; }
      subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
      publish() { for (const listener of this.listeners) listener(); }
      dispose() { this.unsubscribe(); this.listeners.clear(); }
      edit(field, text) { this.staged[field] = text; this.state = this.compute(); this.publish(); }
      resetField(field) { this.staged[field] = ""; this.state = this.compute(); this.publish(); }
      discard() { this.staged = {}; this.state = this.compute(); this.publish(); }
      async save() {
        if (this.saving) return;
        this.saving = true;
        this.failed = false;
        this.state = this.compute();
        this.publish();
        try {
          for (const field of Object.keys(this.staged)) {
            const result = this.parsers[field](this.staged[field]);
            if (result === undefined) continue;
            if (result.kind === "set") await this.scope.set(field, result.value);
            else if (result.kind === "clear") await this.scope.unset(field);
          }
          this.staged = {};
          this.saving = false;
          this.failed = false;
          this.state = this.compute();
          this.publish();
        } catch (error) {
          this.saving = false;
          this.failed = true;
          this.state = this.compute();
          this.publish();
        }
      }
      inject() {
        return {
          hooks: { epseCard: this },
          edit: (field, text) => this.edit(field, text),
          resetField: (field) => this.resetField(field),
          save: () => this.save(),
          discard: () => this.discard(),
        };
      }
    }

    function ValueField(props) {
      return h("div", { className: c.field }, [
        h("div", { className: c.head }, [
          h("label", { className: c.label, htmlFor: props.id }, props.label),
          props.overridden ? h("span", { className: c.badges }, [
            h("span", { className: c.badge }, props.overriddenLabel),
            h("button", { type: "button", className: c.reset, disabled: props.disabled, onClick: props.onReset }, props.resetLabel),
          ]) : null,
        ]),
        h("input", {
          id: props.id,
          className: props.invalid ? c.inputInvalid : c.input,
          type: "text",
          ...(props.numeric === true ? { inputMode: "numeric" } : {}),
          ...(props.invalid ? { "aria-invalid": true } : {}),
          value: props.text,
          placeholder: props.placeholder ?? "",
          disabled: props.disabled,
          onChange: (event) => props.onEdit(event.target.value),
        }),
        h("p", { className: props.invalid ? c.invalid : c.hint }, props.invalid ? props.invalidLabel : props.hint),
      ]);
    }

    function EpseGuardCard(props) {
      const [open, setOpen] = useState(false);
      const state = props.useEpseCard((snapshot) => snapshot);
      if (!state.available) return null;
      const title = props.t("title");
      const blocked = !state.dirty || state.invalid || state.saving;
      return h("li", { className: cls(c.card, open && c.cardOpen) }, [
        h("button", {
          type: "button",
          className: c.header,
          "aria-expanded": open,
          "aria-label": `${props.t(open ? "collapse" : "expand")}: ${title}`,
          onClick: () => setOpen(!open),
        }, [
          h("span", { className: c.headText }, [
            h("span", { className: c.name }, title),
            h("span", { className: c.description }, props.t("description")),
          ]),
          state.dirty ? h("span", { className: c.pending }, props.t("unsaved")) : null,
          h(IconChevronDownOutline14, { className: cls(c.chevron, open && c.chevronOpen) }),
        ]),
        open ? h("div", { className: c.body }, [
          !state.writable ? h("p", { className: c.readOnly, role: "status" }, props.t("readOnly")) : null,
          h(ValueField, {
            id: "plugin-config-epse-triggers",
            label: props.t("customTriggerWords"),
            hint: props.t("customTriggerWordsHint"),
            overriddenLabel: props.t("overridden"),
            resetLabel: props.t("reset"),
            invalidLabel: "",
            numeric: false,
            disabled: !state.writable,
            ...state.customTriggerWords,
            onEdit: (text) => props.edit("customTriggerWords", text),
            onReset: () => props.resetField("customTriggerWords"),
          }),
          h(ValueField, {
            id: "plugin-config-epse-max",
            label: props.t("maxRegenerations"),
            hint: props.t("maxRegenerationsHint"),
            overriddenLabel: props.t("overridden"),
            resetLabel: props.t("reset"),
            invalidLabel: props.t("invalidNumber"),
            numeric: true,
            disabled: !state.writable,
            ...state.maxRegenerationsPerTurn,
            onEdit: (text) => props.edit("maxRegenerationsPerTurn", text),
            onReset: () => props.resetField("maxRegenerationsPerTurn"),
          }),
          h(ValueField, {
            id: "plugin-config-epse-targets",
            label: props.t("targetProviders"),
            hint: props.t("targetProvidersHint"),
            overriddenLabel: props.t("overridden"),
            resetLabel: props.t("reset"),
            invalidLabel: "",
            numeric: false,
            disabled: !state.writable,
            ...state.targetProviders,
            onEdit: (text) => props.edit("targetProviders", text),
            onReset: () => props.resetField("targetProviders"),
          }),
          h("div", { className: c.footer }, [
            state.failed ? h("p", { className: c.failed, role: "status" }, props.t("saveFailed")) : null,
            h("button", { type: "button", className: c.discard, disabled: !state.dirty || state.saving, onClick: props.discard }, props.t("discard")),
            h("button", { type: "button", className: c.save, disabled: blocked, onClick: props.save }, props.t(state.saving ? "saving" : "save")),
          ]),
        ]) : null,
      ]);
    }

    const inject = ["slots", "locale", "configForms"];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), "epse-regeneration-guard: locale");
      const scope = ctx.configForms.get(NS);
      const controller = new CardController(scope);
      ctx.effect(() => () => controller.dispose(), "epse-regeneration-guard: card controller");
      // Register into the Plugins page only while the Host serves this
      // namespace, so a deployment without the guard shows no trace of the card.
      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject("plugins.item", () => ctx.slots.register({
        name: "plugins.item",
        id: NS,
        order: 50,
        label: () => ctx.locale.bind(LOCALE_NS)("title"),
        locale: LOCALE_NS,
        inject: () => controller.inject(),
      }, EpseGuardCard))), "epse-regeneration-guard: settings card");
    }

    return { apply, inject };
  },
});
