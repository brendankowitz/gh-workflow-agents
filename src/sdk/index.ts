/**
 * GH-Agency SDK Module Exports
 */

// Context loading
export {
  loadRepositoryContext,
  formatContextForPrompt,
  hasVisionDocument,
  type ContextLoaderOptions,
  type ContextLoaderLogger,
} from './context-loader.js';

// GitHub API utilities
export {
  createOctokit,
  addLabels,
  removeLabels,
  createComment,
  addReaction,
  removeReaction,
  createPullRequestReview,
  dispatchRepositoryEvent,
  getIssue,
  getPullRequestDiff,
  getPullRequestFiles,
  getPullRequestReviews,
  isDependabotPR,
  formatAuditLog,
  logAgentDecision,
  searchDuplicates,
  createAuditEntry,
  assignToCodingAgent,
  assignToResearchAgent,
  requestClarification,
  closeIssue,
  closeLinkedIssue,
  createIssue,
  createSubIssues,
  mergePullRequest,
  type RepoRef,
  type IssueRef,
  type PullRequestRef,
} from './github-api.js';

// Copilot client
export {
  getCopilotClient,
  stopCopilotClient,
  sendPrompt,
  createAgentSession,
  AgentSession,
  createSessionConfig,
  buildSecurePrompt,
  buildReviewPrompt,
  parseAgentResponse,
  createTriageSystemPrompt,
  createReviewSystemPrompt,
  createResearchSystemPrompt,
  hasCopilotAuth,
  isCopilotAvailable,
  type SessionConfig,
  type McpServerDefinition,
  type Message,
  type AgentResult,
  type ToolCall,
  type CompletionOptions,
} from './copilot-client.js';

// GitHub App authentication
export {
  hasAppAuth,
  getAppCredentials,
  createAppOctokit,
  getOctokitWithAppFallback,
} from './github-app.js';
