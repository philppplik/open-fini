// Customization hooks for extensions and future studios (pure bookkeeping, no DOM):
//   registerSetting(section, def)         adds a control to Settings
//   registerToolboxEntry(studio, entry)   adds a command button to a studio's toolbox
// Both return a function that removes the contribution again. Keybindings need no hook of their own: register a command
// with `shortcut` (or declare `contributes.keybindings` in an extension manifest) and it shows up in the shortcut editor.

const TYPES = ["switch", "segmented", "number", "text", "select", "color"];
const KEY_RE = /^[A-Za-z][A-Za-z0-9_.:-]{2,63}$/;

/** Validates a setting definition; returns an error string or "". */
export function checkSettingDef(section, def) {
  if (typeof section !== "string" || !/^[a-z][a-z0-9-]{0,30}$/.test(section)) return "section must be a lowercase id such as “appearance” or “my-extension”.";
  if (!def || typeof def !== "object") return "def must be an object.";
  if (!KEY_RE.test(def.key || "")) return "def.key must be a namespaced id such as “myext.compact” (3-64 characters).";
  if (!TYPES.includes(def.type)) return `def.type must be one of ${TYPES.join(", ")}.`;
  if (typeof def.label !== "string" || !def.label) return "def.label is required.";
  if (def.default === undefined) return "def.default is required.";
  if ((def.type === "segmented" || def.type === "select") && !(Array.isArray(def.options) && def.options.length)) return "def.options is required for segmented and select settings.";
  return "";
}

export function createRegistry(onChange = () => {}) {
  const settings = new Map(); // section → def[]
  const toolbox = new Map(); // studio → entry[]
  return {
    registerSetting(section, def) {
      const err = checkSettingDef(section, def);
      if (err) throw new Error(`registerSetting: ${err}`);
      const list = settings.get(section) || settings.set(section, []).get(section);
      if (list.some((d) => d.key === def.key)) throw new Error(`registerSetting: “${def.key}” is already registered.`);
      const copy = { ...def };
      list.push(copy);
      onChange("setting", copy);
      return () => {
        const i = list.indexOf(copy);
        if (i >= 0) list.splice(i, 1);
        onChange("setting", copy);
      };
    },
    registerToolboxEntry(studio, entry) {
      if (!entry || !/^[A-Za-z][\w.:-]{1,80}$/.test(entry.id || "") || !entry.command || !entry.label) throw new Error("registerToolboxEntry: entry needs id, label and command.");
      const list = toolbox.get(studio) || toolbox.set(studio, []).get(studio);
      if (list.some((e) => e.id === entry.id)) throw new Error(`registerToolboxEntry: “${entry.id}” is already registered.`);
      const copy = { icon: "plus-square", ...entry };
      list.push(copy);
      onChange("toolbox", copy);
      return () => {
        const i = list.indexOf(copy);
        if (i >= 0) list.splice(i, 1);
        onChange("toolbox", copy);
      };
    },
    settingsFor: (section) => (settings.get(section) || []).slice(),
    settingSections: () => [...settings.keys()].filter((s) => settings.get(s).length),
    allSettings: () => [...settings.values()].flat(),
    toolboxEntries: (studio) => (toolbox.get(studio) || []).slice(),
  };
}
