// The text and source-code file types the Code studio reads and writes: one table for the open dispatch
// (core/text-docs.js), "save back to the original format" (core/source-format.js), the File ▸ Open filters
// (core/io.js), MIME types and language ids (engine/web/paths.js), syntax highlighting (ui/code/languages.js) and
// file icons (ui/code/util.js).
// Pure data and functions (no DOM): runs in browsers, workers and Node.js. Tests: tests/web/code-langs.test.js.
//
// Public API
//   CODE_LANGUAGES                 [{ id, name, ext, names?, mime, icon, mode? }]
//   TEXT_FILE_EXTS                 every extension in the table (lower case, no dot)
//   TEXT_FILE_NAMES                exact file names without a usable extension (Dockerfile, .gitignore …), lower case
//   codeLanguageOf(path)           the table row of a path, or null
//   isCodeFileName(path)           true when the table knows the path (by extension or exact name)
//
// `mode` names the highlighter: "builtin:<lang>" for the CodeMirror language packages in the main bundle, otherwise the
// export name of a stream mode in vendor/codemirror-modes/modes.js or a small mode of ui/code/languages.js ("app:<id>").
// `id` is the language id languageOf() reports; HTML, CSS, JavaScript and JSON keep their existing ids because the
// formatter, linter and preview key on them.

/**
 * @typedef {Object} CodeLanguage
 * @property {string} id       language id (languageOf)
 * @property {string} name     display name
 * @property {string[]} ext    extensions without the dot, lower case
 * @property {string[]} [names] exact file names (lower case) that have this language
 * @property {string} mime     MIME type used for blobs, previews and data URIs
 * @property {string} icon     Bootstrap icon name of the vendored set
 * @property {string} [mode]   highlighter (see above); none means plain text
 */

/** @type {CodeLanguage[]} */
export const CODE_LANGUAGES = [
  // web languages (the main bundle)
  { id: "html", name: "HTML", ext: ["html", "htm", "xhtml", "tmpl"], mime: "text/html", icon: "filetype-html", mode: "builtin:html" },
  { id: "html", name: "Vue component", ext: ["vue"], mime: "text/x-vue", icon: "filetype-html", mode: "builtin:html" },
  { id: "html", name: "Svelte component", ext: ["svelte"], mime: "text/x-svelte", icon: "filetype-html", mode: "builtin:html" },
  { id: "html", name: "Astro component", ext: ["astro"], mime: "text/x-astro", icon: "filetype-html", mode: "builtin:html" },
  { id: "css", name: "CSS", ext: ["css"], mime: "text/css", icon: "filetype-css", mode: "builtin:css" },
  { id: "scss", name: "Sass", ext: ["scss", "sass"], mime: "text/x-scss", icon: "filetype-css", mode: "sass" },
  { id: "less", name: "Less", ext: ["less"], mime: "text/x-less", icon: "filetype-css", mode: "builtin:css" },
  { id: "stylus", name: "Stylus", ext: ["styl"], mime: "text/x-styl", icon: "filetype-css", mode: "stylus" },
  { id: "javascript", name: "JavaScript", ext: ["js", "mjs", "cjs"], mime: "text/javascript", icon: "filetype-js", mode: "builtin:javascript" },
  { id: "javascript", name: "JavaScript (JSX)", ext: ["jsx"], mime: "text/javascript", icon: "filetype-js", mode: "builtin:jsx" },
  { id: "javascript", name: "TypeScript", ext: ["ts", "mts", "cts"], mime: "text/typescript", icon: "filetype-js", mode: "builtin:typescript" },
  { id: "javascript", name: "TypeScript (TSX)", ext: ["tsx"], mime: "text/typescript", icon: "filetype-js", mode: "builtin:tsx" },
  { id: "coffeescript", name: "CoffeeScript", ext: ["coffee"], mime: "text/x-coffeescript", icon: "filetype-js", mode: "coffeeScript" },
  { id: "json", name: "JSON", ext: ["json", "map", "webmanifest", "jsonc", "json5", "geojson", "har"], names: [".babelrc", ".eslintrc", ".prettierrc"], mime: "application/json", icon: "filetype-json", mode: "builtin:json" },
  { id: "markdown", name: "Markdown", ext: ["md", "markdown", "mdx", "mkd"], mime: "text/markdown", icon: "filetype-md", mode: "builtin:markdown" },
  { id: "xml", name: "XML", ext: ["xml", "svg", "rss", "atom", "xsd", "xsl", "xslt", "plist", "csproj", "vbproj", "fsproj", "props", "targets", "resx", "xaml", "kml", "gpx", "wsdl"], mime: "application/xml", icon: "filetype-xml", mode: "builtin:xml" },
  { id: "latex", name: "LaTeX", ext: ["tex", "latex", "sty", "cls", "bib", "ltx", "dtx"], mime: "application/x-tex", icon: "file-earmark-text", mode: "builtin:latex" },
  { id: "yaml", name: "YAML", ext: ["yaml", "yml"], names: [".clang-format"], mime: "application/yaml", icon: "file-earmark-code", mode: "builtin:yaml" },
  { id: "toml", name: "TOML", ext: ["toml"], names: ["cargo.lock", "pipfile"], mime: "application/toml", icon: "gear", mode: "builtin:toml" },
  { id: "properties", name: "INI / properties", ext: ["ini", "conf", "cfg", "properties", "env", "editorconfig", "desktop", "reg", "inf", "npmrc"], names: [".env", ".editorconfig", ".npmrc", ".gitconfig", ".gitattributes", ".gitmodules"], mime: "text/plain", icon: "gear", mode: "builtin:properties" },
  { id: "ignore", name: "Ignore file", ext: ["gitignore", "dockerignore", "npmignore", "prettierignore", "eslintignore"], names: [".gitignore", ".dockerignore", ".npmignore", ".prettierignore", ".eslintignore", ".htaccess", "codeowners"], mime: "text/plain", icon: "gear", mode: "app:ignore" },
  // data and plain text
  { id: "csv", name: "CSV", ext: ["csv"], mime: "text/csv", icon: "file-earmark-spreadsheet" },
  { id: "csv", name: "TSV", ext: ["tsv", "tab"], mime: "text/tab-separated-values", icon: "file-earmark-spreadsheet" },
  { id: "text", name: "Plain text", ext: ["txt", "text", "rst", "adoc", "asciidoc", "org", "nfo", "srt", "vtt"], names: ["readme", "changelog", "license", "licence", "copying", "authors", "notice", "contributors"], mime: "text/plain", icon: "filetype-txt" },
  { id: "log", name: "Log", ext: ["log"], mime: "text/plain", icon: "file-earmark-text", mode: "app:log" },
  { id: "diff", name: "Diff / patch", ext: ["diff", "patch"], mime: "text/x-diff", icon: "file-earmark-diff", mode: "diff" },
  { id: "sql", name: "SQL", ext: ["sql", "psql", "ddl"], mime: "application/sql", icon: "file-earmark-code", mode: "standardSQL" },
  { id: "graphql", name: "GraphQL", ext: ["graphql", "gql"], mime: "application/graphql", icon: "file-earmark-code" },
  { id: "protobuf", name: "Protocol Buffers", ext: ["proto"], mime: "text/x-protobuf", icon: "file-earmark-code", mode: "protobuf" },
  { id: "http", name: "HTTP request", ext: ["http", "rest"], mime: "text/plain", icon: "file-earmark-code", mode: "http" },
  // scripts and shells
  { id: "shell", name: "Shell script", ext: ["sh", "bash", "zsh", "fish", "ksh", "command"], names: [".bashrc", ".zshrc", ".profile", ".bash_profile"], mime: "application/x-sh", icon: "terminal", mode: "shell" },
  { id: "powershell", name: "PowerShell", ext: ["ps1", "psm1", "psd1"], mime: "text/plain", icon: "terminal", mode: "powerShell" },
  { id: "batch", name: "Batch file", ext: ["bat", "cmd"], mime: "text/plain", icon: "terminal", mode: "app:batch" },
  { id: "makefile", name: "Makefile", ext: ["mk", "mak"], names: ["makefile", "gnumakefile"], mime: "text/x-makefile", icon: "file-earmark-code", mode: "shell" },
  { id: "dockerfile", name: "Dockerfile", ext: ["dockerfile", "containerfile"], names: ["dockerfile", "containerfile"], mime: "text/plain", icon: "file-earmark-code", mode: "dockerFile" },
  { id: "cmake", name: "CMake", ext: ["cmake"], names: ["cmakelists.txt"], mime: "text/plain", icon: "file-earmark-code", mode: "cmake" },
  { id: "nginx", name: "nginx config", ext: ["nginx"], names: ["nginx.conf"], mime: "text/plain", icon: "gear", mode: "nginx" },
  // programming languages
  { id: "python", name: "Python", ext: ["py", "pyw", "pyi", "pyx", "gyp"], names: ["sconstruct", "sconscript"], mime: "text/x-python", icon: "file-earmark-code", mode: "python" },
  { id: "ruby", name: "Ruby", ext: ["rb", "rake", "gemspec", "ru", "erb"], names: ["gemfile", "rakefile", "podfile", "vagrantfile"], mime: "text/x-ruby", icon: "file-earmark-code", mode: "ruby" },
  { id: "php", name: "PHP", ext: ["php", "phtml", "php3", "php4", "php5", "phps"], mime: "application/x-httpd-php", icon: "file-earmark-code", mode: "app:php" },
  { id: "perl", name: "Perl", ext: ["pl", "pm", "t"], mime: "text/x-perl", icon: "file-earmark-code", mode: "perl" },
  { id: "lua", name: "Lua", ext: ["lua"], mime: "text/x-lua", icon: "file-earmark-code", mode: "lua" },
  { id: "r", name: "R", ext: ["r", "rmd"], mime: "text/x-r", icon: "file-earmark-code", mode: "r" },
  { id: "julia", name: "Julia", ext: ["jl"], mime: "text/x-julia", icon: "file-earmark-code", mode: "julia" },
  { id: "go", name: "Go", ext: ["go"], names: ["go.mod", "go.sum"], mime: "text/x-go", icon: "file-earmark-code", mode: "go" },
  { id: "rust", name: "Rust", ext: ["rs"], mime: "text/x-rust", icon: "file-earmark-code", mode: "rust" },
  { id: "c", name: "C", ext: ["c", "h"], mime: "text/x-c", icon: "file-earmark-code", mode: "c" },
  { id: "cpp", name: "C++", ext: ["cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ino", "ipp", "inl"], mime: "text/x-c++src", icon: "file-earmark-code", mode: "cpp" },
  { id: "objectivec", name: "Objective-C", ext: ["m", "mm"], mime: "text/x-objectivec", icon: "file-earmark-code", mode: "objectiveC" },
  { id: "csharp", name: "C#", ext: ["cs", "csx"], mime: "text/x-csharp", icon: "file-earmark-code", mode: "csharp" },
  { id: "fsharp", name: "F#", ext: ["fs", "fsi", "fsx"], mime: "text/x-fsharp", icon: "file-earmark-code", mode: "fSharp" },
  { id: "vb", name: "Visual Basic", ext: ["vb", "vbs", "bas"], mime: "text/x-vb", icon: "file-earmark-code", mode: "vb" },
  { id: "java", name: "Java", ext: ["java"], mime: "text/x-java", icon: "file-earmark-code", mode: "java" },
  { id: "kotlin", name: "Kotlin", ext: ["kt", "kts"], mime: "text/x-kotlin", icon: "file-earmark-code", mode: "kotlin" },
  { id: "scala", name: "Scala", ext: ["scala", "sc", "sbt"], mime: "text/x-scala", icon: "file-earmark-code", mode: "scala" },
  { id: "groovy", name: "Groovy", ext: ["groovy", "gradle", "gvy"], names: ["jenkinsfile"], mime: "text/x-groovy", icon: "file-earmark-code", mode: "groovy" },
  { id: "dart", name: "Dart", ext: ["dart"], mime: "application/dart", icon: "file-earmark-code", mode: "dart" },
  { id: "swift", name: "Swift", ext: ["swift"], mime: "text/x-swift", icon: "file-earmark-code", mode: "swift" },
  { id: "haskell", name: "Haskell", ext: ["hs", "lhs"], mime: "text/x-haskell", icon: "file-earmark-code", mode: "haskell" },
  { id: "elm", name: "Elm", ext: ["elm"], mime: "text/x-elm", icon: "file-earmark-code", mode: "elm" },
  { id: "erlang", name: "Erlang / Elixir", ext: ["erl", "hrl", "ex", "exs"], mime: "text/x-erlang", icon: "file-earmark-code", mode: "erlang" },
  { id: "clojure", name: "Clojure", ext: ["clj", "cljs", "cljc", "edn"], mime: "text/x-clojure", icon: "file-earmark-code", mode: "clojure" },
  { id: "ocaml", name: "OCaml", ext: ["ml", "mli"], mime: "text/x-ocaml", icon: "file-earmark-code", mode: "oCaml" },
  { id: "fortran", name: "Fortran", ext: ["f", "f90", "f95", "for"], mime: "text/x-fortran", icon: "file-earmark-code", mode: "fortran" },
  { id: "pascal", name: "Pascal", ext: ["pas", "pp", "dpr"], mime: "text/x-pascal", icon: "file-earmark-code", mode: "pascal" },
  { id: "tcl", name: "Tcl", ext: ["tcl"], mime: "text/x-tcl", icon: "file-earmark-code", mode: "tcl" },
  { id: "verilog", name: "Verilog", ext: ["v", "sv", "svh", "vh"], mime: "text/x-verilog", icon: "file-earmark-code", mode: "verilog" },
  { id: "vhdl", name: "VHDL", ext: ["vhd", "vhdl"], mime: "text/x-vhdl", icon: "file-earmark-code", mode: "vhdl" },
  { id: "glsl", name: "Shader", ext: ["glsl", "vert", "frag", "hlsl", "wgsl", "shader"], mime: "text/plain", icon: "file-earmark-code", mode: "c" },
  { id: "zig", name: "Zig", ext: ["zig"], mime: "text/plain", icon: "file-earmark-code", mode: "c" },
  // templates
  { id: "pug", name: "Pug", ext: ["pug", "jade"], mime: "text/x-pug", icon: "filetype-html", mode: "pug" },
  { id: "jinja", name: "Jinja / Twig / Liquid", ext: ["j2", "jinja", "jinja2", "twig", "njk", "liquid", "hbs", "handlebars", "mustache"], mime: "text/plain", icon: "filetype-html", mode: "jinja2" },
];

const BY_EXT = new Map();
const BY_NAME = new Map();
for (const lang of CODE_LANGUAGES) {
  for (const e of lang.ext) if (!BY_EXT.has(e)) BY_EXT.set(e, lang);
  for (const n of lang.names || []) if (!BY_NAME.has(n)) BY_NAME.set(n, lang);
}

/** Every extension the Code studio opens as text (lower case, no dot). */
export const TEXT_FILE_EXTS = [...BY_EXT.keys()];
/** Exact file names (lower case) the Code studio opens as text although their extension says nothing (or nothing). */
export const TEXT_FILE_NAMES = [...BY_NAME.keys()];

const baseOf = (path) => String(path ?? "").replace(/\\/g, "/").split("/").pop() || "";

/**
 * The language row of a path: an exact file name wins (Dockerfile, .gitignore, CMakeLists.txt), then the extension.
 * Names such as `Dockerfile.dev` or `.env.local` count as their stem.
 * @param {string} path
 * @returns {CodeLanguage | null}
 */
export function codeLanguageOf(path) {
  const base = baseOf(path).toLowerCase();
  if (!base) return null;
  const named = BY_NAME.get(base);
  if (named) return named;
  const i = base.lastIndexOf(".");
  if (i > 0) {
    const byExt = BY_EXT.get(base.slice(i + 1));
    if (byExt) return byExt;
  }
  // "Dockerfile.dev", ".env.production", "Makefile.win": the part before the first dot (or the first two parts of a dotfile)
  const stem = base.startsWith(".") ? "." + base.slice(1).split(".")[0] : base.split(".")[0];
  return BY_NAME.get(stem) || (i === 0 ? BY_EXT.get(base.slice(1)) || null : null);
}

/** Does the Code studio know this file name as text or source code? */
export function isCodeFileName(path) {
  return codeLanguageOf(path) !== null;
}
