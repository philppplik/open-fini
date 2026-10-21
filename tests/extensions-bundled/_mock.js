// A recording stand-in for the `openfini` extension API, for testing the API-driven helpers of bundled extensions.
export function mockApi({ selection = [], layers = [], pages = [{ name: "Page 1", active: true, background: "#ffffff" }], studio = "vector", files = {}, tools = {} } = {}) {
  const calls = [];
  const saved = [];
  const store = {};
  const fileMap = { ...files };
  const api = {
    calls,
    saved,
    fileMap,
    document: {
      readSelection: async () => ({ selection }),
      readLayers: async () => ({ layers }),
      info: async () => ({ activeDocument: { name: "Doc", pages, websiteProject: studio === "code" ? { entry: "index.html" } : null } }),
      pageInfo: async () => ({ name: "Page 1", width: 800, height: 600 }),
      export: async (o) => {
        calls.push(["export", o]);
        return { data: new Uint8Array([1, 2, 3]), mime: "image/png", ext: o.format || "png", width: 10, height: 10, isolated: true };
      },
      callTool: async (name, args) => {
        calls.push([name, args]);
        if (tools[name]) return tools[name](args);
        if (name === "list_files") return { files: Object.keys(fileMap).map((path) => ({ path, bytes: fileMap[path].length, text: true })) };
        if (name === "read_file") {
          const text = fileMap[args.path];
          return `${args.path} (${text.split("\n").length} lines)\n${text.split("\n").map((l, i) => `${i + 1}\t${l}`).join("\n")}`;
        }
        if (name === "write_file") fileMap[args.path] = args.content;
        if (name === "check_problems") return { problems: [], console: [] };
        return { ok: true };
      },
    },
    files: { save: async (o) => (saved.push(o), { saved: true, name: o.name }) },
    studio: { current: async () => studio },
    storage: { get: async (k, d) => (k in store ? store[k] : d), set: async (k, v) => void (store[k] = v) },
  };
  return api;
}
