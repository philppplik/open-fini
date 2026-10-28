// Provider factory and presets.

import { createOpenAIProvider } from "./openai.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createMockProvider } from "./mock.js";
import { createOpenCodeServerProvider } from "./opencode.js";
import { createOpenAIResponsesProvider } from "./openai-responses.js";

export { createOpenAIResponsesProvider, createOpenAIProvider, createAnthropicProvider, createMockProvider, createOpenCodeServerProvider };
export { ProviderError } from "../util.js";

const caps = (o = {}) => ({ vision: true, tools: true, images: false, embeddings: false, ...o });

/**
 * Known provider presets. Suggested model ids are only hints; the UI also fetches the live model list.
 * @type {{id:string,label:string,kind:'openai'|'anthropic',baseUrl:string,keyUrl:string,needsKey:boolean,models:string[],capabilities:{vision:boolean,tools:boolean,images:boolean,embeddings:boolean},note:string}[]}
 */
export const PROVIDER_PRESETS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    keyUrl: "https://openrouter.ai/keys",
    needsKey: true,
    models: ["anthropic/claude-sonnet-4.5", "openai/gpt-5", "google/gemini-2.5-pro", "deepseek/deepseek-chat-v3.1", "x-ai/grok-4", "google/gemini-2.5-flash-image"],
    capabilities: caps({ images: true, embeddings: true }),
    note: "One key for hundreds of models, including image generation. Supports sign-in with OAuth.",
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    needsKey: true,
    models: ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o-mini", "gpt-image-1", "text-embedding-3-small"],
    capabilities: caps({ images: true, embeddings: true }),
    note: "GPT models, gpt-image-1 for image generation and editing, and embeddings.",
  },
  {
    id: "openai-account",
    label: "OpenAI account (ChatGPT plan, desktop)",
    kind: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://developers.openai.com/siwc/token-sharing-open-source",
    needsKey: false,
    models: [],
    capabilities: caps({ images: false }),
    note: "Sign in with your ChatGPT account and use its plan instead of an API key (OpenAI preview for open-source apps). Desktop app only; no images, embeddings or hosted tools. Use the OpenAI preset for an API key.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com",
    keyUrl: "https://console.anthropic.com/settings/keys",
    needsKey: true,
    models: ["claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-1"],
    capabilities: caps(),
    note: "Claude models with native tool use, vision, extended thinking and prompt caching.",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    baseUrl: "https://api.deepseek.com",
    keyUrl: "https://platform.deepseek.com/api_keys",
    needsKey: true,
    models: ["deepseek-chat", "deepseek-reasoner"],
    capabilities: caps({ vision: false }),
    note: "Very low prices. No image input.",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai",
    baseUrl: "https://api.x.ai/v1",
    keyUrl: "https://console.x.ai",
    needsKey: true,
    models: ["grok-4", "grok-4-fast", "grok-code-fast-1"],
    capabilities: caps({ images: true }),
    note: "Grok models.",
  },
  {
    id: "groq",
    label: "Groq",
    kind: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    keyUrl: "https://console.groq.com/keys",
    needsKey: true,
    models: ["llama-3.3-70b-versatile", "openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct"],
    capabilities: caps({ vision: false }),
    note: "Extremely fast inference for open models.",
  },
  {
    id: "together",
    label: "Together AI",
    kind: "openai",
    baseUrl: "https://api.together.xyz/v1",
    keyUrl: "https://api.together.ai/settings/api-keys",
    needsKey: true,
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen3-235B-A22B-Instruct-2507-tput", "deepseek-ai/DeepSeek-V3.1"],
    capabilities: caps({ images: true, embeddings: true }),
    note: "Open models, image generation and embeddings.",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai",
    baseUrl: "https://api.mistral.ai/v1",
    keyUrl: "https://console.mistral.ai/api-keys",
    needsKey: true,
    models: ["mistral-large-latest", "mistral-medium-latest", "pixtral-large-latest", "codestral-latest"],
    capabilities: caps({ embeddings: true }),
    note: "European provider. Pixtral models accept images.",
  },
  {
    id: "google-gemini",
    label: "Google Gemini",
    kind: "openai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyUrl: "https://aistudio.google.com/apikey",
    needsKey: true,
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    capabilities: caps({ images: true, embeddings: true }),
    note: "Gemini through its OpenAI-compatible endpoint. Generous free tier.",
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    kind: "openai",
    baseUrl: "http://localhost:11434/v1",
    keyUrl: "https://ollama.com/download",
    needsKey: false,
    models: ["llama3.1", "qwen3", "gemma3", "llava"],
    capabilities: caps({ embeddings: true }),
    note: "Runs on your machine. Browsers need OLLAMA_ORIGINS to allow this app's origin; the desktop app does not.",
  },
  {
    id: "lmstudio",
    label: "LM Studio (local)",
    kind: "openai",
    baseUrl: "http://localhost:1234/v1",
    keyUrl: "https://lmstudio.ai",
    needsKey: false,
    models: [],
    capabilities: caps({ embeddings: true }),
    note: "Start the local server in LM Studio and enable CORS when using the web version.",
  },
  {
    id: "opencode-zen",
    label: "OpenCode Zen",
    kind: "openai",
    baseUrl: "https://opencode.ai/zen/v1",
    keyUrl: "https://opencode.ai/auth",
    needsKey: true,
    models: ["claude-sonnet-5-5", "gpt-5.4-mini", "glm-5.3-flash", "deepseek-v4.1-flash", "big-pickle"],
    capabilities: caps({ vision: true }),
    note: "OpenCode's curated pay-as-you-go model gateway (Claude, GPT, Gemini, GLM, Kimi and more). The model list is public; chat requests may be blocked by browser CORS rules (see the OpenCode guide). Free models only work inside OpenCode itself.",
  },
  {
    id: "opencode-server",
    label: "OpenCode (local server, experimental)",
    kind: "opencode-server",
    baseUrl: "http://127.0.0.1:4096",
    keyUrl: "https://opencode.ai/docs/server/",
    needsKey: false,
    models: [],
    capabilities: caps({ vision: false, tools: false }),
    note: "Talks to your own `opencode serve --cors <this app's origin>`. Answers come from OpenCode's own agent and tools (OpenFini tools are not available), delivered as one message. The key field is OPENCODE_SERVER_PASSWORD if you set one. Models are written providerID/modelID.",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    kind: "openai",
    baseUrl: "",
    keyUrl: "",
    needsKey: false,
    models: [],
    capabilities: caps({ images: true, embeddings: true }),
    note: "Any server that speaks the OpenAI Chat Completions API (vLLM, LiteLLM, llama.cpp, and so on).",
  },
];

/** The offline demo preset (kept out of PROVIDER_PRESETS so UIs can decide where to show it). */
export const DEMO_PRESET = {
  id: "demo",
  label: "Demo (offline)",
  kind: "mock",
  baseUrl: "mock://demo",
  keyUrl: "",
  needsKey: false,
  models: ["demo"],
  capabilities: { vision: false, tools: true, images: true, embeddings: true },
  note: "Scripted answers, no network and no key. Good for trying the app.",
};

/**
 * Creates a provider. Either pass `kind` or a preset id via `preset`.
 * @param {{kind?:'openai'|'anthropic'|'mock', preset?:string, baseUrl?:string, apiKey?:string, headers?:object, fetch?:typeof fetch, name?:string, [k:string]:any}} cfg
 */
export function createProvider(cfg = {}) {
  const preset = cfg.preset ? [...PROVIDER_PRESETS, DEMO_PRESET].find((p) => p.id === cfg.preset) : null;
  if (cfg.preset && !preset) throw new Error(`Unknown provider preset "${cfg.preset}".`);
  const kind = cfg.kind || (preset && preset.kind) || "openai";
  const merged = { ...cfg, baseUrl: cfg.baseUrl || (preset && preset.baseUrl) || undefined, name: cfg.name || (preset && preset.id) || undefined };
  delete merged.kind;
  delete merged.preset;
  if (kind === "openai") return createOpenAIProvider(merged);
  if (kind === "anthropic") return createAnthropicProvider(merged);
  if (kind === "openai-responses") return createOpenAIResponsesProvider(merged);
  if (kind === "mock") return createMockProvider(merged);
  if (kind === "opencode-server") return createOpenCodeServerProvider(merged);
  throw new Error(`Unknown provider kind "${kind}".`);
}
