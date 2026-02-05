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
  createPullRequestReview,
  dispatchRepositoryEvent,
  getIssue,
  getPullRequestDiff,
  getPullRequestFiles,
  isDependabotPR,
  logAgentDecision,
  searchDuplicates,
  createAuditEntry,
  assignToCodingAgent,
  requestClarification,
  closeIssue,
  createIssue,
  createSubIssues,
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
