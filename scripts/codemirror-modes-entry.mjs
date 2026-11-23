// Entry point of the lazily loaded CodeMirror legacy-mode bundle (app/vendor/codemirror/modes.js, see scripts/vendor.mjs).
// The stream parsers are plain objects with no dependency on the main CodeMirror bundle, so this file is built on its
// own and loaded only when the Code studio opens a file in one of these languages (ui/code/languages.js).
export { python } from "@codemirror/legacy-modes/mode/python";
export { shell } from "@codemirror/legacy-modes/mode/shell";
export { powerShell } from "@codemirror/legacy-modes/mode/powershell";
export { clike, c, cpp, java, csharp, kotlin, scala, dart, objectiveC } from "@codemirror/legacy-modes/mode/clike";
export { go } from "@codemirror/legacy-modes/mode/go";
export { rust } from "@codemirror/legacy-modes/mode/rust";
export { ruby } from "@codemirror/legacy-modes/mode/ruby";
export { lua } from "@codemirror/legacy-modes/mode/lua";
export { standardSQL } from "@codemirror/legacy-modes/mode/sql";
export { swift } from "@codemirror/legacy-modes/mode/swift";
export { perl } from "@codemirror/legacy-modes/mode/perl";
export { r } from "@codemirror/legacy-modes/mode/r";
export { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
export { diff } from "@codemirror/legacy-modes/mode/diff";
export { nginx } from "@codemirror/legacy-modes/mode/nginx";
export { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
export { groovy } from "@codemirror/legacy-modes/mode/groovy";
export { cmake } from "@codemirror/legacy-modes/mode/cmake";
export { haskell } from "@codemirror/legacy-modes/mode/haskell";
export { julia } from "@codemirror/legacy-modes/mode/julia";
export { vb } from "@codemirror/legacy-modes/mode/vb";
export { erlang } from "@codemirror/legacy-modes/mode/erlang";
export { clojure } from "@codemirror/legacy-modes/mode/clojure";
export { fortran } from "@codemirror/legacy-modes/mode/fortran";
export { pascal } from "@codemirror/legacy-modes/mode/pascal";
export { sass } from "@codemirror/legacy-modes/mode/sass";
export { stylus } from "@codemirror/legacy-modes/mode/stylus";
export { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
export { elm } from "@codemirror/legacy-modes/mode/elm";
export { tcl } from "@codemirror/legacy-modes/mode/tcl";
export { oCaml, fSharp } from "@codemirror/legacy-modes/mode/mllike";
export { verilog } from "@codemirror/legacy-modes/mode/verilog";
export { vhdl } from "@codemirror/legacy-modes/mode/vhdl";
export { pug } from "@codemirror/legacy-modes/mode/pug";
export { jinja2 } from "@codemirror/legacy-modes/mode/jinja2";
export { http } from "@codemirror/legacy-modes/mode/http";
