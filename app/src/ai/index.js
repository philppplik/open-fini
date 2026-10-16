// OpenFini AI runtime: provider-neutral agent loop, providers, MCP client, local RAG, skills and vault.
// Pure ES modules (no DOM, no storage); `fetch` is always injected via options.

export { ProviderError, parseSse, createSseParser, parseJsonLenient, isAbortError } from "./util.js";
export {
  createProvider,
  PROVIDER_PRESETS,
  DEMO_PRESET,
  createOpenAIProvider,
  createAnthropicProvider,
  createMockProvider,
} from "./providers/index.js";
export { toWireMessages, fromWireMessages, toWireTools } from "./providers/openai.js";
export { toAnthropicMessages, fromAnthropicContent } from "./providers/anthropic.js";
export { planForPrompt, gradientPng } from "./providers/mock.js";
export { runAgent, compactMessages, estimateTokens, validateSchema, truncateText } from "./agent.js";
export { McpClient, McpError, mcpToolsToAgentTools, mcpContentToBlocks, mcpToolName } from "./mcp.js";
export { KnowledgeIndex, chunkText, tokenize, stem } from "./rag.js";
export { parseSkill, serializeSkill, skillsCatalog, buildSystemPrompt, slugify, BUILTIN_SKILLS, BUILTIN_SKILL_LIST } from "./skills.js";
export { encryptJson, decryptJson, maskKey, randomId, createPkce, pkceChallenge, openRouterAuthUrl, exchangeOpenRouterCode, VaultError } from "./vault.js";
