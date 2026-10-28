// OpenFini AI runtime: provider-neutral agent loop, providers, MCP client, local RAG, skills and vault.
// Pure ES modules (no DOM, no storage); `fetch` is always injected via options.

export { createOpenCodeServerProvider, parseOpenCodeConfig, stripJsonc } from "./providers/opencode.js";
export { createRoutedProvider, resolveRoute, normalizePolicy, DEFAULT_POLICY, RouteError, RouteHealth, RouteStats, suggestFallback, testRoute, fallbackNotice, targetKey, targetLabel } from "./routing.js";
export { classifyProviderError, ProviderError, parseSse, createSseParser, parseJsonLenient, isAbortError } from "./util.js";
export {
  createProvider,
  PROVIDER_PRESETS,
  DEMO_PRESET,
  createOpenAIProvider,
  createOpenAIResponsesProvider,
  createAnthropicProvider,
  createMockProvider,
} from "./providers/index.js";
export { toWireMessages, fromWireMessages, toWireTools } from "./providers/openai.js";
export { toAnthropicMessages, fromAnthropicContent } from "./providers/anthropic.js";
export { planForPrompt, gradientPng } from "./providers/mock.js";
export { runAgent, compactMessages, estimateTokens, validateSchema, truncateText } from "./agent.js";
export { OAuthError, parseWwwAuthenticate, decodeJwt } from "./oauth-core.js";
export { discoverMcpAuth, registerClient, buildAuthUrl, exchangeCode, refreshTokens, revokeTokens, accountLabel, McpAuthSession, McpAuthSession as OAuthSession } from "./mcp-oauth.js";
export { OPENAI_AUTH, newHostId, loopbackRedirect, buildOpenAIAuthUrl, completeSignIn, revokeOpenAI, parseAccountModels, planUsageGranted, friendlyAccountError } from "./openai-account.js";
export { McpClient, McpError, mcpToolsToAgentTools, mcpContentToBlocks, mcpToolName } from "./mcp.js";
export { KnowledgeIndex, chunkText, tokenize, stem } from "./rag.js";
export { parseSkill, serializeSkill, skillsCatalog, buildSystemPrompt, slugify, BUILTIN_SKILLS, BUILTIN_SKILL_LIST, renderSkill, validateSkill, suggestSkills, parseArgString, parseParam } from "./skills.js";
export { encryptJson, decryptJson, maskKey, randomId, createPkce, pkceChallenge, openRouterAuthUrl, exchangeOpenRouterCode, VaultError } from "./vault.js";
