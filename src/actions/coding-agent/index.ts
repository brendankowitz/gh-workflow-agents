/**
 * GH-Agency Coding Agent
 * AI-powered autonomous code implementation
 *
 * This agent autonomously implements code changes from GitHub issues,
 * creates PRs, and responds to review feedback.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  sanitizeInput,
  checkCircuitBreaker,
  createCircuitBreakerContext,
  isBot,
  hasStopCommand,
  DEFAULT_MODEL,
} from '../../shared/index.js';
import {
  createOctokit,
  loadRepositoryContext,
  formatContextForPrompt,
  sendPrompt,
  parseAgentResponse,
  stopCopilotClient,
  hasCopilotAuth,
  createComment,
  addLabels,
  removeLabels,
  type IssueRef,
  type PullRequestRef,
} from '../../sdk/index.js';

/** Coding agent configuration */
interface CodingConfig {
  githubToken: string;
  copilotToken: string;
  model: string;
  maxIterations: number;
  dryRun: boolean;
}

/** Coding task definition */
interface CodingTask {
  type: 'issue' | 'pr-feedback';
  issueNumber?: number;
  prNumber?: number;
  content: string;
  reviewFeedback?: string;
}

/** Task plan from planning phase */
interface TaskPlan {
  summary: string;
  files: string[];
  approach: string;
  estimatedComplexity: 'low' | 'medium' | 'high';
}

/** Code changes from REPL execution */
interface CodeChanges {
  files: Array<{ path: string; content: string; operation: 'create' | 'modify' | 'delete' }>;
  summary: string;
  testsAdded: boolean;
}

/** Self-review result */
interface ReviewResult {
  passed: boolean;
  issues: string[];
  suggestions: string[];
}

/** Commit result */
interface CommitResult {
  branchName: string;
  commitSha: string;
  pushedSuccessfully: boolean;
}

/** PR management result */
interface PRResult {
  prNumber: number;
  prUrl: string;
  status: 'created' | 'updated' | 'failed';
}

/**
 * Main entry point for the coding agent
 */
export async function run(): Promise<void> {
  // Handle uncaught errors from Copilot SDK stream issues
  process.on('uncaughtException', (error) => {
    if (error.message?.includes('stream') || error.message?.includes('ERR_STREAM_DESTROYED')) {
      core.warning(`Suppressed async SDK error: ${error.message}`);
    } else {
      core.error(`Uncaught exception: ${error.message}`);
      process.exit(1);
    }
  });

  try {
    // Get configuration
    const config = getConfig();

    // Check for bot actors
    const actor = github.context.actor;
    if (isBot(actor)) {
      core.info(`Skipping coding for bot actor: ${actor}`);
      return;
    }

    // Initialize circuit breaker
    const circuitBreaker = createCircuitBreakerContext();
    checkCircuitBreaker(circuitBreaker);

    // Create Octokit instance
    const octokit = createOctokit(config.githubToken);

    // Determine task type and get task details
    const task = await getTaskFromContext(octokit);
    if (!task) {
      core.setFailed('Unable to determine coding task from context');
      return;
    }

    // Check for stop commands
    if (hasStopCommand(task.content)) {
      core.info('Stop command detected, skipping coding');
      return;
    }

    // Check for Copilot authentication
    if (!hasCopilotAuth()) {
      core.setFailed('No valid Copilot authentication found. Set COPILOT_GITHUB_TOKEN with a fine-grained PAT that has Copilot access.');
      return;
    }

    // Update labels: ready-for-agent → assigned-to-agent
    if (task.type === 'issue' && task.issueNumber) {
      const issueRef: IssueRef = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issueNumber: task.issueNumber,
      };

      core.info(`Picking up issue #${task.issueNumber}...`);
      await Promise.all([
        removeLabels(octokit, issueRef, ['ready-for-agent']),
        addLabels(octokit, issueRef, ['assigned-to-agent']),
        createComment(
          octokit,
          issueRef,
          '🤖 Coding agent has picked up this issue and is working on it...\n\nI will analyze the requirements, implement the changes, and create a pull request.'
        ),
      ]);
    }

    // Load repository context
    core.info('Loading repository context...');
    const repoContext = await loadRepositoryContext(
      octokit,
      github.context.repo.owner,
      github.context.repo.repo
    );
    const contextSection = formatContextForPrompt(repoContext);

    // Phase 1: Plan the task
    core.info('Phase 1: Planning task...');
    const plan = await planTask(task, contextSection, config.model);
    core.info(`Plan: ${plan.summary}`);
    core.info(`Files to modify: ${plan.files.join(', ')}`);
    core.info(`Complexity: ${plan.estimatedComplexity}`);

    if (config.dryRun) {
      core.info('Dry run mode - stopping before execution');
      core.setOutput('status', 'dry-run');
      core.setOutput('plan', JSON.stringify(plan));
      return;
    }

    // Phase 2: Execute REPL loop to generate code
    core.info('Phase 2: Executing REPL loop...');
    const changes = await executeREPLLoop(plan, config.maxIterations, contextSection, config.model);
    core.info(`Generated changes for ${changes.files.length} files`);

    // Phase 3: Self-review the changes
    core.info('Phase 3: Self-reviewing changes...');
    const review = await selfReview(changes, contextSection, config.model);
    if (!review.passed) {
      core.warning('Self-review found issues:');
      review.issues.forEach((issue) => core.warning(`  - ${issue}`));
      core.setFailed('Self-review failed. Changes need improvement.');
      return;
    }
    core.info('Self-review passed');

    // Phase 4: Commit and push changes
    core.info('Phase 4: Committing and pushing changes...');
    const commitResult = await commitAndPush(
      changes,
      task.issueNumber || task.prNumber || 0,
      config.githubToken
    );
    core.info(`Committed to branch: ${commitResult.branchName}`);

    // Phase 5: Manage PR (create or update)
    core.info('Phase 5: Managing pull request...');
    const prResult = await managePR(commitResult, task, changes, octokit);
    core.info(`PR ${prResult.status}: ${prResult.prUrl}`);

    // Update issue with success
    if (task.type === 'issue' && task.issueNumber) {
      const issueRef: IssueRef = {
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issueNumber: task.issueNumber,
      };

      await Promise.all([
        removeLabels(octokit, issueRef, ['assigned-to-agent']),
        addLabels(octokit, issueRef, ['agent-coded']),
        createComment(
          octokit,
          issueRef,
          `✅ I've implemented the changes and created PR #${prResult.prNumber}\n\n${changes.summary}\n\nPlease review: ${prResult.prUrl}`
        ),
      ]);
    }

    // Set outputs
    core.setOutput('branch-name', commitResult.branchName);
    core.setOutput('pr-number', prResult.prNumber);
    core.setOutput('changes-summary', changes.summary);
    core.setOutput('status', 'success');

    core.info('Coding complete');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  } finally {
    // Clean up Copilot SDK client to prevent hanging
    try {
      await stopCopilotClient();
    } catch {
      // Ignore cleanup errors
    }
    // Force exit to prevent hanging handles from SDK
    setTimeout(() => process.exit(0), 1000);
  }
}

/**
 * Gets configuration from action inputs
 */
function getConfig(): CodingConfig {
  // Set COPILOT_GITHUB_TOKEN from input if provided
  const copilotToken = core.getInput('copilot-token');
  if (copilotToken) {
    process.env.COPILOT_GITHUB_TOKEN = copilotToken;
  }

  return {
    githubToken: core.getInput('github-token', { required: true }),
    copilotToken: copilotToken || '',
    model: core.getInput('model') || 'claude-sonnet-4.5',
    maxIterations: parseInt(core.getInput('max-iterations') || '5', 10),
    dryRun: core.getBooleanInput('dry-run'),
  };
}

/**
 * Determines the coding task from GitHub context
 */
async function getTaskFromContext(
  octokit: ReturnType<typeof createOctokit>
): Promise<CodingTask | null> {
  const payload = github.context.payload;
  const eventName = github.context.eventName;

  // Case 1: workflow_dispatch with issue-number
  const issueNumberInput = core.getInput('issue-number');
  if (issueNumberInput) {
    const issueNumber = parseInt(issueNumberInput, 10);
    if (!isNaN(issueNumber)) {
      try {
        const { data: issue } = await octokit.rest.issues.get({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issue_number: issueNumber,
        });
        return {
          type: 'issue',
          issueNumber: issue.number,
          content: `${issue.title}\n\n${issue.body || ''}`,
        };
      } catch (error) {
        core.warning(`Failed to fetch issue #${issueNumberInput}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Case 2: workflow_dispatch with pr-number
  const prNumberInput = core.getInput('pr-number');
  if (prNumberInput) {
    const prNumber = parseInt(prNumberInput, 10);
    if (!isNaN(prNumber)) {
      try {
        const { data: pr } = await octokit.rest.pulls.get({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: prNumber,
        });
        // Get latest review feedback
        const { data: reviews } = await octokit.rest.pulls.listReviews({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: prNumber,
        });
        const latestChangesRequested = reviews
          .reverse()
          .find((r) => r.state === 'CHANGES_REQUESTED');

        return {
          type: 'pr-feedback',
          prNumber: pr.number,
          content: `${pr.title}\n\n${pr.body || ''}`,
          reviewFeedback: latestChangesRequested?.body || '',
        };
      } catch (error) {
        core.warning(`Failed to fetch PR #${prNumberInput}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Case 3: Issues event with 'ready-for-agent' label
  if (eventName === 'issues' && payload.issue) {
    const hasLabel = payload.issue.labels?.some((l: any) => l.name === 'ready-for-agent');
    if (hasLabel) {
      return {
        type: 'issue',
        issueNumber: payload.issue.number,
        content: `${payload.issue.title}\n\n${payload.issue.body || ''}`,
      };
    }
  }

  // Case 4: pull_request_review with changes_requested on 'agent-coded' PR
  if (eventName === 'pull_request_review' && payload.review && payload.pull_request) {
    const hasLabel = payload.pull_request.labels?.some((l: any) => l.name === 'agent-coded');
    if (hasLabel && payload.review.state === 'changes_requested') {
      return {
        type: 'pr-feedback',
        prNumber: payload.pull_request.number,
        content: `${payload.pull_request.title}\n\n${payload.pull_request.body || ''}`,
        reviewFeedback: payload.review.body || '',
      };
    }
  }

  return null;
}

/**
 * PLACEHOLDER: Plans the implementation task
 */
async function planTask(
  task: CodingTask,
  contextSection: string,
  model: string
): Promise<TaskPlan> {
  core.info('[PLACEHOLDER] Planning task...');
  core.info(`Task type: ${task.type}`);
  core.info(`Task content: ${task.content.substring(0, 100)}...`);

  // TODO: Implement actual planning logic
  // Will use Copilot SDK to analyze the task and create a detailed plan
  // Should identify files to modify, approach, and complexity

  return {
    summary: 'Placeholder plan - will be implemented in Phase 1',
    files: ['src/example.ts'],
    approach: 'Placeholder approach',
    estimatedComplexity: 'medium',
  };
}

/**
 * PLACEHOLDER: Executes REPL loop to generate code changes
 */
async function executeREPLLoop(
  plan: TaskPlan,
  maxIterations: number,
  contextSection: string,
  model: string
): Promise<CodeChanges> {
  core.info('[PLACEHOLDER] Executing REPL loop...');
  core.info(`Max iterations: ${maxIterations}`);
  core.info(`Plan: ${plan.summary}`);

  // TODO: Implement REPL loop
  // Will iteratively:
  // 1. Read relevant files
  // 2. Generate/modify code
  // 3. Validate changes
  // 4. Iterate until complete or max iterations reached

  return {
    files: [],
    summary: 'Placeholder changes - will be implemented in Phase 2',
    testsAdded: false,
  };
}

/**
 * PLACEHOLDER: Self-reviews the generated changes
 */
async function selfReview(
  changes: CodeChanges,
  contextSection: string,
  model: string
): Promise<ReviewResult> {
  core.info('[PLACEHOLDER] Self-reviewing changes...');
  core.info(`Files changed: ${changes.files.length}`);

  // TODO: Implement self-review logic
  // Will use Copilot SDK to review the changes for:
  // - Completeness (all requirements met)
  // - Code quality
  // - Security issues
  // - Best practices

  return {
    passed: true,
    issues: [],
    suggestions: [],
  };
}

/**
 * PLACEHOLDER: Commits and pushes changes to a new branch
 */
async function commitAndPush(
  changes: CodeChanges,
  issueOrPrNumber: number,
  githubToken: string
): Promise<CommitResult> {
  core.info('[PLACEHOLDER] Committing and pushing changes...');
  core.info(`Issue/PR number: ${issueOrPrNumber}`);

  // TODO: Implement git operations
  // Will:
  // 1. Create a new branch (e.g., "agent/fix-issue-123")
  // 2. Commit all changes
  // 3. Push to remote

  return {
    branchName: `agent/placeholder-${issueOrPrNumber}`,
    commitSha: 'placeholder-sha',
    pushedSuccessfully: false,
  };
}

/**
 * PLACEHOLDER: Manages PR creation or updates
 */
async function managePR(
  commitResult: CommitResult,
  task: CodingTask,
  changes: CodeChanges,
  octokit: ReturnType<typeof createOctokit>
): Promise<PRResult> {
  core.info('[PLACEHOLDER] Managing pull request...');
  core.info(`Branch: ${commitResult.branchName}`);

  // TODO: Implement PR management
  // Will:
  // 1. Check if PR already exists for this branch
  // 2. Create new PR or update existing one
  // 3. Link to the original issue
  // 4. Add 'agent-coded' label

  return {
    prNumber: 0,
    prUrl: 'https://github.com/placeholder',
    status: 'failed',
  };
}

// Run the action
run();
