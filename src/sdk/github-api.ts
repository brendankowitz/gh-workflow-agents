/**
 * GH-Agency GitHub API Utilities
 * Helper functions for common GitHub API operations
 */

import { Octokit } from '@octokit/rest';
import { createHash } from 'crypto';
import type { AgentAuditEntry, AllowedLabel, ModelId } from '../shared/types.js';

/** Creates an authenticated Octokit instance */
export function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    userAgent: 'gh-workflow-agents/0.1.0',
  });
}

/** Repository reference */
export interface RepoRef {
  owner: string;
  repo: string;
}

/** Issue reference */
export interface IssueRef extends RepoRef {
  issueNumber: number;
}

/** Pull request reference */
export interface PullRequestRef extends RepoRef {
  pullNumber: number;
}

/**
 * Adds labels to an issue
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param labels - Labels to add
 */
export async function addLabels(
  octokit: Octokit,
  ref: IssueRef,
  labels: AllowedLabel[]
): Promise<void> {
  if (labels.length === 0) return;

  await octokit.rest.issues.addLabels({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    labels,
  });
}

/**
 * Removes labels from an issue
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param labels - Labels to remove
 */
export async function removeLabels(
  octokit: Octokit,
  ref: IssueRef,
  labels: AllowedLabel[]
): Promise<void> {
  if (labels.length === 0) return;

  // Remove each label individually as GitHub API doesn't support batch removal
  for (const label of labels) {
    try {
      await octokit.rest.issues.removeLabel({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: ref.issueNumber,
        name: label,
      });
    } catch (error) {
      // Ignore errors if label doesn't exist on issue (404 or "Label does not exist")
      const msg = error instanceof Error ? error.message.toLowerCase() : '';
      const isNotFound =
        (error && typeof error === 'object' && 'status' in error && (error as any).status === 404) ||
        msg.includes('404') || msg.includes('not found') || msg.includes('does not exist');
      if (!isNotFound) {
        throw error;
      }
    }
  }
}

/**
 * Posts a comment on an issue or PR
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param body - Comment body
 * @returns Created comment ID
 */
export async function createComment(
  octokit: Octokit,
  ref: IssueRef,
  body: string
): Promise<number> {
  const response = await octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    body,
  });

  return response.data.id;
}

/**
 * Adds a reaction to an issue or PR (best-effort, never throws)
 *
 * @param octokit - Authenticated Octokit
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue or PR number
 * @param content - Reaction type
 * @returns Reaction ID if successful, null otherwise
 */
export async function addReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  content: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'
): Promise<number | null> {
  try {
    const response = await octokit.rest.reactions.createForIssue({
      owner,
      repo,
      issue_number: issueNumber,
      content,
    });
    return response.data.id;
  } catch {
    // Best-effort — never fail the agent over a reaction
    return null;
  }
}

/**
 * Removes a reaction from an issue or PR (best-effort, never throws)
 *
 * @param octokit - Authenticated Octokit
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param issueNumber - Issue or PR number
 * @param reactionId - Reaction ID to remove
 */
export async function removeReaction(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  reactionId: number
): Promise<void> {
  try {
    await octokit.rest.reactions.deleteForIssue({
      owner,
      repo,
      issue_number: issueNumber,
      reaction_id: reactionId,
    });
  } catch {
    // Best-effort — never fail the agent over a reaction
  }
}

/**
 * Posts an agent audit log as a collapsed comment
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param auditEntry - Audit log entry
 */
export async function logAgentDecision(
  octokit: Octokit,
  ref: IssueRef,
  auditEntry: AgentAuditEntry
): Promise<void> {
  const comment =
    `<details><summary>✨ Agent Decision Log</summary>\n\n` +
    '```json\n' +
    JSON.stringify(auditEntry, null, 2) +
    '\n```\n</details>';

  await createComment(octokit, ref, comment);
}

/**
 * Searches for duplicate issues using semantic similarity
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Repository reference
 * @param title - Issue title to search for
 * @param body - Issue body to search for
 * @returns Array of potential duplicate issue numbers
 */
export async function searchDuplicates(
  octokit: Octokit,
  ref: RepoRef,
  title: string,
  body: string
): Promise<number[]> {
  // Extract key terms from title (simple approach)
  const keywords = title
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 5)
    .join(' ');

  if (!keywords) return [];

  try {
    const response = await octokit.rest.search.issuesAndPullRequests({
      q: `repo:${ref.owner}/${ref.repo} is:issue is:open ${keywords}`,
      per_page: 10,
      sort: 'updated',
    });

    return response.data.items.map((item) => item.number);
  } catch {
    // Search may fail due to rate limits
    return [];
  }
}

/**
 * Gets the diff for a pull request
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Pull request reference
 * @returns Diff string
 */
export async function getPullRequestDiff(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<string> {
  const response = await octokit.rest.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pullNumber,
    mediaType: { format: 'diff' },
  });

  return response.data as unknown as string;
}

/**
 * Gets files changed in a pull request
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Pull request reference
 * @returns Array of changed files
 */
export async function getPullRequestFiles(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<
  Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>
> {
  const response = await octokit.rest.pulls.listFiles({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pullNumber,
    per_page: 100,
  });

  return response.data.map((file) => ({
    filename: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  }));
}

/**
 * Creates a review on a pull request
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Pull request reference
 * @param event - Review event type
 * @param body - Review body
 * @param comments - Inline comments
 * @param commitId - Optional commit SHA to anchor comments to (recommended for accuracy)
 */
export async function createPullRequestReview(
  octokit: Octokit,
  ref: PullRequestRef,
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
  body: string,
  comments?: Array<{ path: string; line: number; body: string }>,
  commitId?: string
): Promise<void> {
  // If comments are provided but no commitId, fetch the latest commit
  let commit_id = commitId;
  if (comments && comments.length > 0 && !commit_id) {
    const pr = await octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
    });
    commit_id = pr.data.head.sha;
  }

  // Helper to post review with self-approval fallback
  const postReview = async (
    reviewEvent: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    reviewBody: string,
    reviewComments?: Array<{ path: string; line: number; body: string }>
  ) => {
    try {
      await octokit.rest.pulls.createReview({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: ref.pullNumber,
        commit_id,
        event: reviewEvent,
        body: reviewBody,
        comments: reviewComments,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message.toLowerCase() : '';
      // If can't approve own PR, fall back to COMMENT
      if (reviewEvent === 'APPROVE' && msg.includes('approve your own')) {
        console.log('Cannot approve own PR, posting as COMMENT instead...');
        await octokit.rest.pulls.createReview({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.pullNumber,
          commit_id,
          event: 'COMMENT',
          body: reviewBody + '\n\n*Note: Auto-approval not possible for bot-created PRs.*',
          comments: reviewComments,
        });
        return;
      }
      throw err;
    }
  };

  try {
    await postReview(event, body, comments);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message.toLowerCase() : '';

    // If inline comments fail (e.g., "Line could not be resolved"), retry without them
    const isLineError = errorMsg.includes('line') || errorMsg.includes('could not be resolved');

    if (comments && comments.length > 0 && isLineError) {
      console.log('Inline comments failed, retrying without them and adding to body...');

      // Add failed inline comments to the body instead
      let updatedBody = body;
      updatedBody += '\n\n---\n\n**Inline Comments** (could not attach to specific lines):\n\n';
      for (const comment of comments) {
        updatedBody += `**${comment.path}** (line ${comment.line}):\n${comment.body}\n\n`;
      }

      // Retry without inline comments (postReview handles self-approval fallback)
      await postReview(event, updatedBody);
      return;
    }

    // Re-throw other errors
    throw error;
  }
}

/**
 * Merges a pull request
 *
 * @param octokit - Authenticated Octokit with write permissions
 * @param ref - Pull request reference
 * @param mergeMethod - Merge method (default: 'squash')
 * @returns Result indicating if merge succeeded
 */
export async function mergePullRequest(
  octokit: Octokit,
  ref: PullRequestRef,
  mergeMethod: 'merge' | 'squash' | 'rebase' = 'squash'
): Promise<{ merged: boolean; message: string }> {
  try {
    const result = await octokit.rest.pulls.merge({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
      merge_method: mergeMethod,
    });

    if (result.status === 200) {
      return {
        merged: true,
        message: `PR #${ref.pullNumber} merged successfully using ${mergeMethod}`,
      };
    }

    return {
      merged: false,
      message: `Unexpected response status: ${result.status}`,
    };
  } catch (error: any) {
    // Handle common merge failures gracefully
    if (error.status === 405) {
      // Merge not allowed (e.g., checks not passing, conflicts)
      return {
        merged: false,
        message: `Merge not allowed: ${error.message || 'PR may have conflicts or required checks not passing'}`,
      };
    }

    if (error.status === 409) {
      // PR not mergeable (e.g., already merged, closed)
      return {
        merged: false,
        message: `PR not mergeable: ${error.message || 'PR may be already merged or closed'}`,
      };
    }

    // For other errors, log and return failure
    return {
      merged: false,
      message: `Merge failed: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Closes linked issues referenced in a PR body
 *
 * @param octokit - Authenticated Octokit with write permissions
 * @param ref - Pull request reference
 */
export async function closeLinkedIssue(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<void> {
  try {
    // Fetch the PR to get its body
    const prResponse = await octokit.rest.pulls.get({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
    });

    const prBody = prResponse.data.body || '';

    // Find issue references (e.g., "Closes #123", "Fixes #456", "Resolves #789")
    const issueReferencePattern = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
    const matches = [...prBody.matchAll(issueReferencePattern)];

    if (matches.length === 0) {
      return;
    }

    // Close each referenced issue
    for (const match of matches) {
      if (!match[1]) continue;
      const issueNumber = parseInt(match[1], 10);
      try {
        await octokit.rest.issues.createComment({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: issueNumber,
          body: `✅ Closed automatically because PR #${ref.pullNumber} was merged.`,
        });

        await octokit.rest.issues.update({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: issueNumber,
          state: 'closed',
        });
      } catch (error: any) {
        // Ignore individual issue close failures (may already be closed or not exist)
        console.warn(`Failed to close issue #${issueNumber}: ${error.message}`);
      }
    }
  } catch (error: any) {
    // Ignore failures in fetching PR or closing issues
    console.warn(`Failed to close linked issues: ${error.message}`);
  }
}

/**
 * Gets reviews for a pull request
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Pull request reference
 * @returns Array of reviews
 */
export async function getPullRequestReviews(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<Array<{ id: number; user: string; state: string; body: string; commitId: string; submittedAt: string }>> {
  try {
    const response = await octokit.rest.pulls.listReviews({
      owner: ref.owner,
      repo: ref.repo,
      pull_number: ref.pullNumber,
    });

    return response.data.map((review) => ({
      id: review.id,
      user: review.user?.login || 'unknown',
      state: review.state,
      body: review.body || '',
      commitId: review.commit_id || '',
      submittedAt: review.submitted_at || '',
    }));
  } catch (error: any) {
    throw new Error(`Failed to fetch PR reviews: ${error.message}`);
  }
}

/**
 * Checks if a PR is from Dependabot
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Pull request reference
 * @returns True if PR is from Dependabot
 */
export async function isDependabotPR(
  octokit: Octokit,
  ref: PullRequestRef
): Promise<boolean> {
  const response = await octokit.rest.pulls.get({
    owner: ref.owner,
    repo: ref.repo,
    pull_number: ref.pullNumber,
  });

  return response.data.user?.login === 'dependabot[bot]';
}

/**
 * Dispatches an event to another repository
 *
 * @param octokit - Authenticated Octokit (needs repo scope on target)
 * @param targetOwner - Target repository owner
 * @param targetRepo - Target repository name
 * @param eventType - Event type string
 * @param payload - Event payload
 */
export async function dispatchRepositoryEvent(
  octokit: Octokit,
  targetOwner: string,
  targetRepo: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<void> {
  await octokit.rest.repos.createDispatchEvent({
    owner: targetOwner,
    repo: targetRepo,
    event_type: eventType,
    client_payload: payload,
  });
}

/**
 * Creates a formatted audit entry
 *
 * @param agent - Agent name
 * @param rawInput - Raw input (will be hashed)
 * @param injectionFlags - Detected injection flags
 * @param actions - Actions taken
 * @param model - Model used
 * @returns Audit entry object
 */
export function createAuditEntry(
  agent: string,
  rawInput: string,
  injectionFlags: string[],
  actions: string[],
  model: ModelId
): AgentAuditEntry {
  // Create SHA256 hash of input for audit trail
  const inputHash = createHash('sha256')
    .update(rawInput)
    .digest('hex')
    .substring(0, 12);

  return {
    timestamp: new Date().toISOString(),
    agent,
    inputHash,
    injectionFlags,
    actionsTaken: actions,
    model,
  };
}

/**
 * Assigns a Copilot coding agent to work on an issue
 * Triggers Copilot by assigning the issue to "Copilot" user
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param instructions - Instructions for the coding agent
 */
export async function assignToCodingAgent(
  octokit: Octokit,
  ref: IssueRef,
  instructions: string
): Promise<void> {
  // Add label to indicate AI assignment
  await octokit.rest.issues.addLabels({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    labels: ['copilot-assigned', 'ready-for-agent', 'status:in-progress'],
  });

  // Assign the issue to Copilot - this triggers the coding agent
  // See: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent
  try {
    await octokit.rest.issues.addAssignees({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.issueNumber,
      assignees: ['Copilot'],
    });
  } catch (error) {
    // Copilot assignment may fail if not enabled for repo
    // Fall back to @copilot mention which works in some contexts
    await octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.issueNumber,
      body: `@copilot please implement this issue.`,
    });
  }

  // Post comment with implementation details for Copilot
  await octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    body: `## ✨ Assigned to Copilot Coding Agent

This issue has been assessed as **concrete and actionable** and aligns with project goals.

**Instructions:**
${instructions}

---
*Copilot will create a pull request to address this issue.*`,
  });
}

/**
 * Requests clarification on an ambiguous issue
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param questions - Questions to ask for clarification
 */
export async function requestClarification(
  octokit: Octokit,
  ref: IssueRef,
  questions: string
): Promise<void> {
  await octokit.rest.issues.addLabels({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    labels: ['status:needs-info'],
  });

  await octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    body: `## 📝 Clarification Needed

Before this issue can be worked on, we need some additional information:

${questions}

---
*Please provide the requested details so this issue can be properly addressed.*`,
  });
}

/**
 * Closes an issue with a reason
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @param reason - Reason for closing
 * @param stateReason - GitHub state reason
 */
export async function closeIssue(
  octokit: Octokit,
  ref: IssueRef,
  reason: string,
  stateReason: 'completed' | 'not_planned' = 'not_planned'
): Promise<void> {
  await octokit.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    body: `## Issue Closed

${reason}

---
*If you believe this was closed in error, please reopen with additional context.*`,
  });

  await octokit.rest.issues.update({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    state: 'closed',
    state_reason: stateReason,
  });
}

/**
 * Gets issue details
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference
 * @returns Issue data
 */
export async function getIssue(
  octokit: Octokit,
  ref: IssueRef
): Promise<{
  title: string;
  body: string;
  labels: string[];
  state: string;
  user: string;
}> {
  const response = await octokit.rest.issues.get({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
  });

  return {
    title: response.data.title,
    body: response.data.body || '',
    labels: response.data.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
    state: response.data.state,
    user: response.data.user?.login || 'unknown',
  };
}

/**
 * Creates a new issue
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Repository reference
 * @param title - Issue title
 * @param body - Issue body
 * @param labels - Optional labels to add
 * @param parentIssue - Optional parent issue number for tracking
 * @returns Created issue number
 */
export async function createIssue(
  octokit: Octokit,
  ref: RepoRef,
  title: string,
  body: string,
  labels?: string[],
  parentIssue?: number
): Promise<number> {
  // Add parent reference if provided
  const fullBody = parentIssue
    ? `${body}\n\n---\n*Sub-issue of #${parentIssue}*`
    : body;

  const response = await octokit.rest.issues.create({
    owner: ref.owner,
    repo: ref.repo,
    title,
    body: fullBody,
    labels,
  });

  return response.data.number;
}

/**
 * Creates multiple sub-issues from a parent issue
 *
 * @param octokit - Authenticated Octokit
 * @param ref - Issue reference (parent)
 * @param subIssues - Array of sub-issues to create
 * @returns Array of created issue numbers
 */
export async function createSubIssues(
  octokit: Octokit,
  ref: IssueRef,
  subIssues: Array<{
    title: string;
    body: string;
    labels?: string[];
  }>
): Promise<number[]> {
  const createdIssues: number[] = [];

  for (const subIssue of subIssues) {
    const issueNumber = await createIssue(
      octokit,
      ref,
      subIssue.title,
      subIssue.body,
      subIssue.labels,
      ref.issueNumber
    );
    createdIssues.push(issueNumber);
  }

  // Update parent issue with links to sub-issues
  if (createdIssues.length > 0) {
    const subIssueLinks = createdIssues
      .map((num, i) => `- [ ] #${num} - ${subIssues[i]?.title ?? 'Sub-issue'}`)
      .join('\n');

    await octokit.rest.issues.createComment({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.issueNumber,
      body: `## 📋 Sub-Issues Created

This issue has been broken down into the following actionable items:

${subIssueLinks}

---
*Each sub-issue will be triaged and assigned independently.*`,
    });

    // Add label to indicate this issue has been decomposed
    await octokit.rest.issues.addLabels({
      owner: ref.owner,
      repo: ref.repo,
      issue_number: ref.issueNumber,
      labels: ['has-sub-issues', 'triaged'],
    });
  }

  return createdIssues;
}
