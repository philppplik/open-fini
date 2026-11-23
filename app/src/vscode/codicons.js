// VS Code codicon ids ("$(sync~spin)", ThemeIcon ids) -> icons of OpenFini's vendored Bootstrap set. Only names that
// exist in app/vendor/shoelace/assets/icons (tests/vscode/views.test.js checks it); unknown codicons get null.
const CODICONS = {
  add: "plus-lg", plus: "plus-lg", check: "check-lg", "check-all": "check2", pass: "check-lg", close: "x-lg", x: "x-lg", error: "x-circle", warning: "exclamation-triangle", info: "info-circle",
  sync: "arrow-repeat", refresh: "arrow-clockwise", gear: "gear", settings: "gear", "settings-gear": "gear", settings2: "sliders", search: "search", file: "file-earmark",
  "file-code": "code-slash", folder: "folder", "folder-opened": "folder2-open", trash: "trash3", edit: "pencil", pencil: "pencil", cloud: "cloud",
  link: "link-45deg", eye: "eye", "git-branch": "signpost-split", "source-control": "signpost-split", "list-flat": "list-ul", "list-tree": "diagram-3",
  terminal: "terminal", code: "code-slash", bug: "bug", debug: "bug", zap: "lightning", star: "star", "star-full": "star", package: "box", extensions: "puzzle",
  tag: "tag", history: "clock-history", question: "question-circle", "circle-small": "dot", "chevron-right": "chevron-right", "chevron-down": "chevron-down",
  ellipsis: "three-dots", "arrow-left": "arrow-left", copy: "files", files: "files", filter: "filter", key: "key", lock: "lock", unlock: "unlock",
  person: "person", account: "person", globe: "globe", "cloud-download": "download", "cloud-upload": "upload", "debug-stop": "stop-fill", "primitive-square": "stop-fill",
  symbol: "braces", json: "braces", layers: "layers", run: "play-circle", play: "play-circle",
};

/** Bootstrap icon name for a codicon id ("sync~spin" counts as "sync"), or null. */
export const codiconName = (id) => CODICONS[String(id || "").replace(/~.*$/, "")] || null;

export const CODICON_ICONS = Object.freeze([...new Set(Object.values(CODICONS))]);
