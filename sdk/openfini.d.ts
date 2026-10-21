// TypeScript typings for OpenFini extensions (API version 1).
// Use in a plain JavaScript extension with a jsconfig/`// @ts-check` and:
//   /// <reference path="path/to/openfini.d.ts" />
// `openfini` is a global inside the extension's sandboxed frame; main.js may also declare
// `async function activate(openfini) {}` which OpenFini calls once after the script loaded.

// ------------------------------------------------------------------ manifest (openfini-extension.json)

export type StudioId = "vector" | "pixel" | "layout" | "code" | "vibe";
export type DockStudioId = Exclude<StudioId, "vibe">;
export type Permission =
  | "document.read"
  | "document.write"
  | "ui"
  | "storage"
  | "files"
  | "export"
  | "vibe"
  | "commands"
  | `network:${"http" | "https"}://${string}`;
export type ActivationEvent = "onStartup" | `onStudio:${StudioId}` | `onCommand:${string}` | `onFileType:${string}`;
export type MenuName = "File" | "Edit" | "Layer" | "Arrange" | "Shape" | "Select" | "Filter" | "Text" | "Document" | "View" | "Insert" | "Go" | "Studio" | "Help" | "context:canvas";

export interface JsonSchema {
  type?: "object" | "string" | "number" | "integer" | "boolean" | "array";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
}

export interface CommandContribution {
  /** Local id, unique inside the extension. */
  id: string;
  title: string;
  category?: string;
  /** Bootstrap Icons name. */
  icon?: string;
  /** Studios in which the command is available (default: all). */
  studios?: StudioId[];
  requires?: "document" | "selection";
}
export interface MenuContribution {
  menu: MenuName;
  command: string;
  studios?: StudioId[];
  group?: string;
}
export interface KeybindingContribution {
  command: string;
  /** For example "Mod+Alt+G" (Mod = Ctrl or Cmd). Conflicts with existing shortcuts are ignored and logged. */
  key: string;
  studios?: StudioId[];
}
export interface PanelContribution {
  id: string;
  title: string;
  /** HTML file inside the package. Local scripts, styles and images are inlined; the page gets the `openfini` API. */
  html: string;
  icon?: string;
  studios?: DockStudioId[];
  location?: "top" | "bottom";
}
export interface ThemeContribution {
  id: string;
  label: string;
  /** CSS variables (--of-*, --sl-*); both variants are required. */
  dark: Record<string, string>;
  light: Record<string, string>;
}
export interface TemplateContribution {
  id: string;
  label: string;
  description?: string;
  kind?: "design" | "website";
  studio?: "vector" | "pixel" | "layout";
  width?: number;
  height?: number;
  /** Design templates: Vibe tool calls that build the document, in order. */
  steps?: { tool: string; args?: Record<string, unknown> }[];
  /** Website templates: project path -> package file. */
  files?: Record<string, string>;
}
export interface FileHandlerContribution {
  id: string;
  title: string;
  /** File extensions without dots. */
  extensions?: string[];
  extension?: string;
  /** Command that receives the file (importers) or runs the export (exporters). */
  command: string;
}
export interface VibeToolContribution {
  /** snake_case; shown to the assistant as ext_<publisher>_<name>_<name>. */
  name: string;
  description: string;
  inputSchema?: JsonSchema;
}
export interface VibeSkillContribution {
  /** Path to a SKILL.md in the package, or inline name, description and body. */
  file?: string;
  name?: string;
  description?: string;
  body?: string;
}
export interface SettingContribution {
  type: "boolean" | "string" | "number";
  title?: string;
  description?: string;
  default?: boolean | string | number;
  enum?: (string | number)[];
  min?: number;
  max?: number;
}
export interface SnippetContribution {
  language: "html" | "css" | "javascript";
  label: string;
  detail?: string;
  /** CodeMirror snippet template, e.g. "<div class=\"${1:name}\"></div>". */
  body: string;
}

export interface ExtensionManifest {
  $schema?: string;
  /** publisher.name, lowercase letters, digits and dashes. */
  id: string;
  name: string;
  /** Semantic version. */
  version: string;
  description?: string;
  icon?: string;
  homepage?: string;
  license?: string;
  engines: { openfini: string };
  /** Entry script (runs sandboxed). */
  main?: string;
  activationEvents?: ActivationEvent[];
  permissions?: Permission[];
  contributes?: {
    commands?: CommandContribution[];
    menus?: MenuContribution[];
    keybindings?: KeybindingContribution[];
    panels?: PanelContribution[];
    themes?: ThemeContribution[];
    templates?: TemplateContribution[];
    importers?: FileHandlerContribution[];
    exporters?: FileHandlerContribution[];
    vibeTools?: VibeToolContribution[];
    vibeSkills?: VibeSkillContribution[];
    settings?: { properties: Record<string, SettingContribution> };
    snippets?: SnippetContribution[];
  };
}

// ------------------------------------------------------------------ runtime API

export type Disposable = () => void;
export type MessageKind = "info" | "success" | "warning" | "error";

export interface FormField {
  name: string;
  label: string;
  type?: "text" | "number" | "boolean" | "select";
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  options?: (string | { value: string; label?: string })[];
}

/** Layer description returned by the document tools (see list_layers / get_selection in docs/vibe-studio.md). */
export interface LayerInfo {
  id: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  children?: LayerInfo[];
  [key: string]: unknown;
}

export interface ExportResult {
  mime: string;
  ext: string;
  width: number;
  height: number;
  /** Encoded image bytes (SVG: UTF-8 text). */
  data: Uint8Array;
  /** false when the layers could not be rendered alone (nested layers) and the page region was rendered instead. */
  isolated: boolean;
}

export interface PageInfo {
  name: string;
  index: number;
  count: number;
  width: number;
  height: number;
  studio: StudioId;
  website: boolean;
}

export interface ToolInfo {
  name: string;
  description: string;
  readOnly: boolean;
  inputSchema: JsonSchema;
}

export interface FetchInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  /** String body, at most 1 MB. */
  body?: string;
  /** "text" (default) or "bytes". */
  responseType?: "text" | "bytes";
}
export interface FetchResult {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  text?: string;
  data?: Uint8Array;
}

export interface OpenedFile {
  name: string;
  mime: string;
  size: number;
  data: Uint8Array;
}

export interface ImportedFile {
  name: string;
  mime: string;
  size: number;
  data: Uint8Array;
}

export interface OpenFiniApi {
  /** Version of this API (1). Additive changes keep the number; breaking changes increase it. */
  readonly apiVersion: 1;
  readonly extension: { readonly id: string; readonly version: string; /** Panel id when running inside a panel frame. */ readonly panel: string | null };

  readonly commands: {
    /** Attach the handler of a command declared in contributes.commands. Importers receive an ImportedFile as `args`. */
    register(id: string, handler: (args?: any) => unknown | Promise<unknown>): Promise<void>;
    /** Run one of your own commands, or (with the "commands" permission) any OpenFini command id. */
    execute(id: string, args?: unknown): Promise<unknown>;
  };

  /** Needs the "ui" permission. */
  readonly ui: {
    showMessage(text: string, kind?: MessageKind): Promise<void>;
    confirm(text: string, options?: { title?: string; ok?: string; cancel?: string }): Promise<boolean>;
    /** Resolves to the entered text, or null when cancelled. */
    prompt(label: string, options?: { title?: string; value?: string; ok?: string }): Promise<string | null>;
    /** A small form; resolves to the values by field name, or null when cancelled. */
    form<T extends Record<string, string | number | boolean> = Record<string, string | number | boolean>>(spec: { title?: string; description?: string; ok?: string; fields: FormField[] }): Promise<T | null>;
    /** Brings one of your panels (contributes.panels) to the front, switching studio when needed. */
    openPanel(id: string): Promise<void>;
    setStatus(text: string): Promise<void>;
  };

  /**
   * Reads and changes the open document through the SAME tools the Vibe assistant uses.
   * Reading needs "document.read", changing needs "document.write". All changes of one command are one undo step.
   */
  readonly document: {
    info(): Promise<Record<string, unknown>>;
    pageInfo(): Promise<PageInfo | null>;
    readSelection(): Promise<{ selection: LayerInfo[] }>;
    readLayers(options?: { page?: number; depth?: number }): Promise<{ layers: LayerInfo[] } & Record<string, unknown>>;
    listTools(): Promise<ToolInfo[]>;
    /** Calls a tool such as add_shape, add_text, set_style, apply_adjustment or insert_html. Arguments are validated against its schema. */
    callTool<T = any>(name: string, args?: Record<string, unknown>): Promise<T>;
    /**
     * Renders layers or a whole page to image data (needs "export"; pair it with "files" to save the result).
     * `ids` renders those layers on their own, cropped to their bounds; without `ids` the page is rendered.
     */
    export(options: { format?: "png" | "jpg" | "webp" | "svg"; scale?: number; ids?: string[]; page?: number; quality?: number; background?: string | null }): Promise<ExportResult>;
  };

  readonly studio: {
    current(): Promise<StudioId>;
    list(): Promise<{ id: StudioId; label: string }[]>;
    /** Needs "ui". */
    set(id: StudioId): Promise<void>;
  };

  /** Private key-value store for this extension (needs "storage"; 256 KB per value, 1 MB in total). */
  readonly storage: {
    get<T = unknown>(key: string, fallback?: T): Promise<T>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    keys(): Promise<string[]>;
    clear(): Promise<void>;
  };

  /** Values of contributes.settings (edited by the user in Studio > Extensions). */
  readonly settings: {
    get<T = unknown>(key: string): T;
    getAll(): Record<string, unknown>;
    onChange(listener: (values: Record<string, unknown>) => void): Disposable;
  };

  readonly network: {
    /**
     * Only to origins granted with network:<origin>; https (or http://localhost), no cookies, no redirects,
     * responses up to 5 MB, 30 s timeout. Blocked completely while offline mode is on.
     */
    fetch(url: string, init?: FetchInit): Promise<FetchResult>;
  };

  /** Needs "files". Both show the system dialog, so the user always chooses the file. */
  readonly files: {
    open(options?: { description?: string; extensions?: string[]; multiple?: boolean }): Promise<OpenedFile[]>;
    save(options: { name: string; data: string | Uint8Array; mime?: string }): Promise<{ saved: boolean; name: string | null }>;
  };

  readonly events: {
    on(event: "documentChanged", listener: (e: { label: string | null; structure: boolean; rev: number; switched?: boolean }) => void): Disposable;
    on(event: "selectionChanged", listener: (e: { ids: string[] }) => void): Disposable;
    on(event: "studioChanged", listener: (e: { studio: StudioId }) => void): Disposable;
  };

  /** Needs "vibe". Tools always ask the user for approval before they run. */
  readonly vibe: {
    /** Attach the handler of a tool declared in contributes.vibeTools, or define a new tool on the fly. */
    registerTool(name: string, handler: (args: any) => unknown | Promise<unknown>): Promise<void>;
    registerTool(def: { name: string; description: string; inputSchema?: JsonSchema; handler: (args: any) => unknown | Promise<unknown> }): Promise<void>;
    registerSkill(def: { name: string; description?: string; body: string }): Promise<void>;
  };

  /** Messages between the extension's background script and its panels. */
  readonly messages: {
    post(data: unknown): Promise<void>;
    onMessage(listener: (data: unknown) => void): Disposable;
  };

  log(...args: unknown[]): void;
}

declare global {
  const openfini: OpenFiniApi;
  /** Optional entry point called once after main.js has loaded. */
  function activate(openfini: OpenFiniApi): void | Promise<void>;
  /** Optional: called when the extension is stopped or reloaded. */
  function deactivate(): void | Promise<void>;
}
