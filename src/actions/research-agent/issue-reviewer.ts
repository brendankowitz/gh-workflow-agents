/**
 * Issue Reviewer Module
 * Reviews existing open issues for staleness, duplicates, and close candidates.
 */

import * as core from '@actions/core';
import type { IssueReviewResult, RepositoryContext } from '../../shared/types.js';
import type { createOctokit } from '../../sdk/index.js';
import {
  hasCopilotAuth,
  sendPrompt,
  parseAgentResponse,
  formatContextForPrompt,
} from '../../sdk/index.js';

interface FetchedIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Reviews existing open issues for staleness, duplicates, and triage opportunities
 */
export async function reviewExistingIssues(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  repoContext: RepositoryContext,
  model: string,
  staleDaysThreshold: number = 30
): Promise<IssueReviewResult> {
  core.info('Reviewing existing open issues...');

  // Fetch open issues (max 100)
  let issues: FetchedIssue[];
  try {
    const response = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
      sort: 'updated',
      direction: 'asc', // Least recently updated first
    });

    issues = response.data
      .filter((i) => !i.pull_request) // Exclude PRs
      .map((i) => ({
        number: i.number,
        title: i.title,
        body: (i.body || '').substring(0, 200),
        labels: (i.labels || []).map((l) => (typeof l === 'string' ? l : l.name || '')),
        createdAt: i.created_at,
        updatedAt: i.updated_at,
      }));
  } catch (error) {
    core.warning(`Failed to fetch issues: ${error instanceof Error ? error.message : String(error)}`);
    return {
      totalReviewed: 0,
      staleIssues: [],
      duplicateCandidates: [],
      closeCandidates: [],
      prioritySuggestions: [],
      summary: 'Failed to fetch issues for review.',
    };
  }

  if (issues.length === 0) {
    return {
      totalReviewed: 0,
      staleIssues: [],
      duplicateCandidates: [],
      closeCandidates: [],
      prioritySuggestions: [],
      summary: 'No open issues to review.',
    };
  }

  core.info(`Reviewing ${issues.length} open issues...`);

  // Heuristic analysis
  const now = Date.now();
  const staleMs = staleDaysThreshold * 24 * 60 * 60 * 1000;

  // 1. Stale issues
  const staleIssues: IssueReviewResult['staleIssues'] = [];
  for (const issue of issues) {
    const lastActivity = new Date(issue.updatedAt).getTime();
    const daysSinceActivity = Math.floor((now - lastActivity) / (24 * 60 * 60 * 1000));

    if (daysSinceActivity >= staleDaysThreshold) {
      staleIssues.push({
        number: issue.number,
        title: issue.title,
        daysSinceActivity,
        labels: issue.labels,
      });
    }
  }

  // 2. Duplicate candidates (title keyword overlap >60%)
  const duplicateCandidates: IssueReviewResult['duplicateCandidates'] = [];
  const issueKeywords = issues.map((i) => ({
    issue: i,
    keywords: extractKeywords(i.title),
  }));

  for (let i = 0; i < issueKeywords.length; i++) {
    for (let j = i + 1; j < issueKeywords.length; j++) {
      const a = issueKeywords[i]!;
      const b = issueKeywords[j]!;

      if (a.keywords.length === 0 || b.keywords.length === 0) continue;

      const overlap = computeKeywordOverlap(a.keywords, b.keywords);
      if (overlap > 0.6) {
        // Check if this pair is already covered
        const alreadyCovered = duplicateCandidates.some(
          (dc) =>
            dc.issues.some((x) => x.number === a.issue.number) &&
            dc.issues.some((x) => x.number === b.issue.number)
        );

        if (!alreadyCovered) {
          duplicateCandidates.push({
            issues: [
              { number: a.issue.number, title: a.issue.title },
              { number: b.issue.number, title: b.issue.title },
            ],
            similarity: Math.round(overlap * 100) / 100,
          });
        }
      }
    }
  }

  // 3. Close candidates (stale + labeled wontfix/duplicate/status:needs-info)
  const closeLabels = new Set(['wontfix', 'duplicate', 'status:needs-info', "won't fix", 'invalid']);
  const closeCandidates: IssueReviewResult['closeCandidates'] = [];
  for (const issue of staleIssues) {
    const hasCloseLabel = issue.labels.some((l) => closeLabels.has(l.toLowerCase()));
    if (hasCloseLabel) {
      const matchedLabel = issue.labels.find((l) => closeLabels.has(l.toLowerCase()));
      closeCandidates.push({
        number: issue.number,
        title: issue.title,
        reason: `Stale (${issue.daysSinceActivity} days) with label "${matchedLabel}"`,
      });
    }
  }

  // 4. Try Copilot for priority suggestions
  let prioritySuggestions: IssueReviewResult['prioritySuggestions'] = [];
  if (hasCopilotAuth() && issues.length > 0) {
    try {
      prioritySuggestions = await analyzeWithCopilot(
        issues.slice(0, 50),
        repoContext,
        model,
        duplicateCandidates,
        staleIssues
      );
    } catch (error) {
      core.warning(
        `AI issue analysis failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const summary = buildSummary(issues.length, staleIssues.length, duplicateCandidates.length, closeCandidates.length);

  core.info(summary);

  return {
    totalReviewed: issues.length,
    staleIssues,
    duplicateCandidates,
    closeCandidates,
    prioritySuggestions,
    summary,
  };
}

/**
 * Extracts meaningful keywords from an issue title
 */
function extractKeywords(title: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
    'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
    'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between', 'and',
    'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
    'this', 'that', 'these', 'those', 'it', 'its', 'when', 'where', 'how',
    'what', 'which', 'who', 'whom', 'why', 'all', 'each', 'every', 'some',
    'any', 'no', 'other', 'such', 'only', 'same', 'than', 'too', 'very',
    'add', 'fix', 'update', 'implement', 'create', 'remove', 'delete',
    'change', 'modify', 'use', 'make', 'get', 'set', 'new', 'need',
  ]);

  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}

/**
 * Computes Jaccard-like keyword overlap between two keyword sets
 */
function computeKeywordOverlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }
  const minLen = Math.min(setA.size, setB.size);
  if (minLen === 0) return 0;
  return intersection / minLen;
}

/**
 * Uses Copilot to identify priority mismatches, duplicates, and consolidation opportunities
 */
async function analyzeWithCopilot(
  issues: FetchedIssue[],
  repoContext: RepositoryContext,
  model: string,
  duplicateCandidates: IssueReviewResult['duplicateCandidates'],
  staleIssues: IssueReviewResult['staleIssues']
): Promise<IssueReviewResult['prioritySuggestions']> {
  const contextSection = formatContextForPrompt(repoContext);

  const issueList = issues
    .map(
      (i) =>
        `#${i.number}: "${i.title}" [${i.labels.join(', ') || 'no labels'}] (updated: ${i.updatedAt.split('T')[0]})`
    )
    .join('\n');

  const prompt = `You are a project manager reviewing open issues for a repository.

## Project Context
${contextSection}

## Open Issues (${issues.length})
${issueList}

## Already Detected
- ${staleIssues.length} stale issues
- ${duplicateCandidates.length} potential duplicate pairs

## Task
Review these issues and identify priority suggestions — issues that appear mis-prioritized,
under-labeled, or that should be escalated/de-escalated based on the project vision.

CRITICAL: Respond with ONLY a JSON array. No explanatory text.
If no suggestions, return an empty array: []

[
  {
    "number": 123,
    "title": "Issue title",
    "currentPriority": "low or null if unlabeled",
    "suggestedPriority": "high",
    "reason": "Why this should be reprioritized"
  }
]`;

  const response = await sendPrompt(
    'You are a project manager. Output ONLY valid JSON.',
    prompt,
    { model }
  );

  if (response.content) {
    const parsed = parseAgentResponse<IssueReviewResult['prioritySuggestions']>(response.content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }

  return [];
}

/**
 * Builds a human-readable summary
 */
function buildSummary(
  total: number,
  stale: number,
  duplicates: number,
  closeCandidates: number
): string {
  const parts = [`Reviewed ${total} open issues.`];
  if (stale > 0) parts.push(`${stale} stale.`);
  if (duplicates > 0) parts.push(`${duplicates} potential duplicate pair(s).`);
  if (closeCandidates > 0) parts.push(`${closeCandidates} close candidate(s).`);
  if (stale === 0 && duplicates === 0 && closeCandidates === 0) {
    parts.push('No major issues found.');
  }
  return parts.join(' ');
}
