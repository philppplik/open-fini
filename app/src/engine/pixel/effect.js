// Small helpers to declare EffectModules (see docs/engine-contracts.md section 1.2).

/**
 * @typedef {{ key: string, label: string, type: string, min?: number, max?: number, step?: number, options?: {value:string,label:string}[], unit?: string, group?: string, hint?: string, default: any }} Control
 * @typedef {{ id: string, label: string, category: string, defaults: object, controls: Control[], apply: (img: any, params: object, ctx: {scale: number}) => any }} EffectModule
 */

/**
 * Shallow-merges parameter overrides onto defaults (undefined values are ignored).
 * @param {object} defaults
 * @param {object} [params]
 * @returns {object}
 */
export function mergeParams(defaults, params) {
  const o = Object.assign({}, defaults);
  if (params) for (const k of Object.keys(params)) if (params[k] !== undefined) o[k] = params[k];
  return o;
}

/**
 * Normalizes a render context: guarantees a positive finite `scale`.
 * @param {{scale?: number}} [ctx]
 * @returns {{scale: number}}
 */
export function normalizeCtx(ctx) {
  return ctx && ctx.scale > 0 && isFinite(ctx.scale) ? ctx : { scale: 1 };
}

/**
 * Declares an EffectModule. `defaults` are derived from the controls plus `hidden` params that have
 * no UI control. `run(img, params, ctx)` receives fully merged params and a normalized ctx.
 * @param {string} id
 * @param {string} label
 * @param {string} category
 * @param {Control[]} controls
 * @param {object} hidden extra default params without a control
 * @param {(img: any, params: any, ctx: {scale: number}) => any} run
 * @returns {EffectModule}
 */
export function defineEffect(id, label, category, controls, hidden, run) {
  const defaults = Object.assign({}, hidden);
  for (const c of controls) defaults[c.key] = c.default;
  return {
    id,
    label,
    category,
    defaults,
    controls,
    apply(img, params, ctx) {
      const out = run(img, mergeParams(defaults, params), normalizeCtx(ctx));
      return out || img;
    },
  };
}

/** @returns {Control} a 'range' control */
export const rangeControl = (key, label, min, max, def, extra = {}) => Object.assign({ key, label, type: "range", min, max, step: 1, default: def }, extra);
/** @returns {Control} an 'int' control */
export const intControl = (key, label, min, max, def, extra = {}) => Object.assign({ key, label, type: "int", min, max, step: 1, default: def }, extra);
/** @returns {Control} a 'bool' control */
export const boolControl = (key, label, def, extra = {}) => Object.assign({ key, label, type: "bool", default: def }, extra);
/** @returns {Control} a 'color' control */
export const colorControl = (key, label, def, extra = {}) => Object.assign({ key, label, type: "color", default: def }, extra);
/** @returns {Control} an 'angle' control (degrees) */
export const angleControl = (key, label, def, extra = {}) => Object.assign({ key, label, type: "angle", min: -180, max: 180, step: 1, unit: "°", default: def }, extra);
/** @returns {Control} a 'point' control (0..1 relative to the image) */
export const pointControl = (key, label, def, extra = {}) => Object.assign({ key, label, type: "point", default: def }, extra);
/** @returns {Control} a 'select' control; options are [value, label] pairs */
export const selectControl = (key, label, options, def, extra = {}) =>
  Object.assign({ key, label, type: "select", options: options.map(([value, lab]) => ({ value, label: lab })), default: def }, extra);
