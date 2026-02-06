/**
 * GH-Agency Shared Type Definitions
 * Core interfaces and types used across all agents
 */

/** Supported AI models with their capability tiers */
export type ModelId =
  | 'claude-sonnet-4.5'
  | 'claude-opus-4.5'
  | 'claude-haiku-4.5'
  | 'gpt-5'
  | 'gpt-5-mini';

/** Default model for intelligent tasks */
export const DEFAULT_MODEL: ModelId = 'claude-sonnet-4.5';

/** Agent persona configuration */
export interface AgentPersona {
  name: string;
  model: ModelId;
  systemPrompt: string;
  tools: string[];
  mcpServers?: Record<string, McpServerConfig>;
}

/** MCP server configuration */
export interface McpServerConfig {
  type: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

/** Repository context loaded from vision/readme files */
export interface RepositoryContext {
  name: string;
  owner: string;
  vision?: string;
  readme?: string;
  contributing?: string;
  roadmap?: string;
  architecture?: string;
}

/** Sub-issue definition for breaking down complex issues */
export interface SubIssueDefinition {
  title: string;
  body: string;
  labels?: string[];
}

/** Issue classification result */
export interface TriageResult {
  classification: 'bug' | 'feature' | 'question' | 'documentation' | 'spam' | 'research-report';
  labels: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  reasoning: string;
  duplicateOf?: number;
  needsHumanReview: boolean;
  injectionFlagsDetected: string[];
  /** Whether the issue is concrete and actionable (not ambiguous) */
  isActionable: boolean;
  /** Reason why issue is or isn't actionable */
  actionabilityReason: string;
  /** Whether the issue aligns with project vision/goals */
  alignsWithVision: boolean;
  /** How the issue aligns (or conflicts) with vision */
  visionAlignmentReason: string;
  /** Recommended action for this issue */
  recommendedAction: 'assign-to-agent' | 'request-clarification' | 'close-as-wontfix' | 'close-as-duplicate' | 'human-review' | 'create-sub-issues' | 'route-to-research';
  /** Sub-issues to create (when recommendedAction is 'create-sub-issues') */
  subIssues?: SubIssueDefinition[];
  /** Files examined during codebase exploration */
  filesExamined?: string[];
  /** Files that would need modification to implement this issue */
  filesToModify?: string[];
}

/** Code review result */
export interface ReviewResult {
  overallAssessment: 'approve' | 'request-changes' | 'comment';
  securityIssues: ReviewIssue[];
  codeQualityIssues: ReviewIssue[];
  suggestions: ReviewSuggestion[];
  summary: string;
}

/** Individual review issue */
export interface ReviewIssue {
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}

/** Review suggestion (non-blocking) */
export interface ReviewSuggestion {
  file: string;
  line?: number;
  suggestion: string;
  rationale: string;
}

/** Research agent findings */
export interface ResearchReport {
  generatedAt: string;
  dependencyUpdates: DependencyFinding[];
  technicalDebt: TechnicalDebtItem[];
  securityAdvisories: SecurityAdvisory[];
  featureSuggestions: FeatureSuggestion[];
  industryInsights: IndustryInsight[];
  recommendations: string[];
}

/** Feature suggestion from industry research */
export interface FeatureSuggestion {
  title: string;
  description: string;
  rationale: string;
  alignsWithVision: boolean;
  visionAlignment: string;
  similarProjects: string[];
  estimatedEffort: 'small' | 'medium' | 'large';
  priority: 'low' | 'medium' | 'high';
  category: 'enhancement' | 'integration' | 'performance' | 'developer-experience' | 'security';
}

/** Industry insight from web research */
export interface IndustryInsight {
  topic: string;
  summary: string;
  relevance: string;
  sources: string[];
  actionable: boolean;
}

/** Dependency finding from research */
export interface DependencyFinding {
  package: string;
  currentVersion: string;
  latestVersion: string;
  updateType: 'patch' | 'minor' | 'major';
  breakingChanges: boolean;
  changelog?: string;
}

/** Technical debt item */
export interface TechnicalDebtItem {
  category: string;
  description: string;
  location: string;
  estimatedEffort: 'small' | 'medium' | 'large';
  priority: 'low' | 'medium' | 'high';
}

/** Security advisory */
export interface SecurityAdvisory {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  package: string;
  affectedVersions: string;
  patchedVersion?: string;
  description: string;
}

/** Consumer test result */
export interface ConsumerTestResult {
  upstreamVersion: string;
  success: boolean;
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failures: TestFailure[];
  compatibilityBreaking: boolean;
}

/** Individual test failure */
export interface TestFailure {
  testName: string;
  error: string;
  stackTrace?: string;
}

/** Circuit breaker context */
export interface CircuitBreakerContext {
  dispatchDepth: number;
  iterationCount: number;
  previousHashes: string[];
  lastOutput?: string;
}

/** Agent decision audit log entry */
export interface AgentAuditEntry {
  timestamp: string;
  agent: string;
  inputHash: string;
  injectionFlags: string[];
  actionsTaken: string[];
  model: ModelId;
}

/** Allowed labels for issues */
export const ALLOWED_LABELS = [
  'bug',
  'feature',
  'question',
  'documentation',
  'good-first-issue',
  'needs-human-review',
  'duplicate',
  'wontfix',
  'performance',
  'breaking-change',
  'security',
  'enhancement',
  'help-wanted',
  'status:triage',
  'status:needs-info',
  'status:spec-ready',
  'status:ready-for-dev',
  'status:in-progress',
  'status:blocked',
  'priority:low',
  'priority:medium',
  'priority:high',
  'priority:critical',
  'copilot-assigned',
  'agent-assigned',
  'ready-for-agent',
  'assigned-to-agent',
  'agent-coded',
  'ready-for-research',
  'has-sub-issues',
  'triaged',
  'stale',
  'research-report',
] as const;

export type AllowedLabel = (typeof ALLOWED_LABELS)[number];
