// Git engine (Source Control in the Code studio): see docs/git-and-publishing.md.
export * from "./objects.js";
export * from "./diff.js";
export * from "./ignore.js";
export * from "./repo.js";
export * from "./archive.js";
export { fetchRemote, pushRemote, discoverRefs, proxied, basicAuth } from "./smart.js";
export { GitHubApi, pushToGitHub, fetchFromGitHub, cloneFromGitHub, commitFiles, parseGitHubRepo, markSynced } from "./github.js";
