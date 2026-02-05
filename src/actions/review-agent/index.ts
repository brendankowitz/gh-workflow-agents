/**
 * GH-Agency Review Agent
 * AI-powered code review for pull requests
 *
 * This agent analyzes pull requests for security issues,
 * code quality, and provides actionable feedback.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  sanitizeInput,
  validateReviewOutput,
  checkCircuitBreaker,
  createCircuitBreakerContext,
  isBot,
  hasStopCommand,
  DEFAULT_MODEL,
  type ReviewResult,
} from '../../shared/index.js';
import {
  createOctokit,
  loadRepositoryContext,
  formatContextForPrompt,
  getPullRequestDiff,
  getPullRequestFiles,
  createPullRequestReview,
  isDependabotPR,
  logAgentDecision,
  createAuditEntry,
  createReviewSystemPrompt,
  buildReviewPrompt,
  sendPrompt,
  parseAgentResponse,
  stopCopilotClient,
  hasCopilotAuth,
  type PullRequestRef,
} from '../../sdk/index.js';

/** Review agent configuration */
interface ReviewConfig {
  githubToken: string;
  copilotToken: string;
  model: string;
  mode: 'analyze-only' | 'full';
  autoApproveDependabot: boolean;
  securityFocus: boolean;
}

/**
 * Main entry point for the review agent
 */
export async function run(): Promise<void> {
  // Handle uncaught errors from Copilot SDK stream issues
  // The SDK can throw async errors even after we've stopped it
  process.on('uncaughtException', (error) => {
    if (error.message?.includes('stream') || error.message?.includes('ERR_STREAM_DESTROYED')) {
      core.warning(`Suppressed async SDK error: ${error.message}`);
    } else {
      core.error(`Uncaught exception: ${error.message}`);
      process.exit(1);
    }
  });

  try {
    const config = getConfig();

    // Check for bot actors (but allow Copilot PRs - we want to review those!)
    const actor = github.context.actor;
    const isCopilotActor = actor.toLowerCase() === 'copilot-swe-agent';
    if (isBot(actor) && !isCopilotActor) {
      core.info(`Skipping review for bot actor: ${actor}`);
      return;
    }
    if (isCopilotActor) {
      core.info(`Reviewing Copilot-generated PR from: ${actor}`);
    }

    // Initialize circuit breaker
    const circuitBreaker = createCircuitBreakerContext();
    checkCircuitBreaker(circuitBreaker);

    // Create octokit early (needed for workflow_dispatch PR fetch)
    const octokit = createOctokit(config.githubToken);

    // Get PR data (may fetch via API for workflow_dispatch)
    const pr = await getPRFromContext(octokit);
    if (!pr) {
      core.setFailed('No pull request found in event context. For workflow_dispatch, ensure pr-number input is provided.');
      return;
    }

    // Check for stop commands in PR body
    if (hasStopCommand(pr.body)) {
      core.info('Stop command detected in PR body, skipping review');
      return;
    }

    const ref: PullRequestRef = {
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pullNumber: pr.number,
    };

    // Check if this is a Dependabot PR
    const isDependabot = await isDependabotPR(octokit, ref);
    if (isDependabot && config.autoApproveDependabot) {
      core.info('Dependabot PR detected - applying lighter review');
      await handleDependabotPR(octokit, ref, config);
      return;
    }

    // Load repository context
    core.info('Loading repository context...');
    const repoContext = await loadRepositoryContext(
      octokit,
      ref.owner,
      ref.repo
    );

    // Get PR diff and files
    core.info('Fetching PR diff...');
    const [diff, files] = await Promise.all([
      getPullRequestDiff(octokit, ref),
      getPullRequestFiles(octokit, ref),
    ]);

    // Sanitize PR content
    const sanitizedTitle = sanitizeInput(pr.title, 'pr-title');
    const sanitizedBody = sanitizeInput(pr.body, 'pr-body');
    const sanitizedDiff = sanitizeInput(diff, 'pr-diff');

    // Format context for the prompt
    const contextSection = formatContextForPrompt(repoContext);

    // Analyze the PR using Copilot SDK
    const result = await analyzePR(
      sanitizedDiff.sanitized,
      files,
      {
        title: sanitizedTitle.sanitized,
        body: sanitizedBody.sanitized,
      },
      config.securityFocus,
      contextSection,
      ref.owner,
      ref.repo,
      config.model
    );

    // Validate the result
    const validated = validateReviewOutput(result);

    // Output results
    core.setOutput('assessment', validated.overallAssessment);
    core.setOutput('security-issues', JSON.stringify(validated.securityIssues));
    core.setOutput('quality-issues', JSON.stringify(validated.codeQualityIssues));
    core.setOutput('summary', validated.summary);

    if (config.mode === 'analyze-only') {
      core.info('Analyze-only mode - saving results to artifact');
      // In analyze-only mode, just output the results
      // The post-review action would use these in a workflow_run trigger
      core.setOutput('review-result', JSON.stringify(validated));
      return;
    }

    // Determine review action
    const event = mapAssessmentToEvent(validated);

    // Build review comment
    const reviewBody = buildReviewComment(validated);

    // Build inline comments
    const inlineComments = buildInlineComments(validated);

    // Post the review
    core.info(`Posting review with assessment: ${validated.overallAssessment}`);
    await createPullRequestReview(
      octokit,
      ref,
      event,
      reviewBody,
      inlineComments
    );

    // If there are fixable issues and we have a user token, post @copilot mention
    // using the user's PAT so Copilot responds (bots can't trigger Copilot)
    const hasFixableIssues = validated.securityIssues.length > 0 || validated.codeQualityIssues.length > 0;
    if (hasFixableIssues && validated.overallAssessment !== 'approve' && config.copilotToken) {
      try {
        // Use the user's PAT to post the @copilot mention
        const userOctokit = createOctokit(config.copilotToken);
        await userOctokit.rest.issues.createComment({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: pr.number,
          body: '@copilot please address the issues identified in the review above.',
        });
        core.info('Posted @copilot mention using user token');
      } catch (error) {
        core.warning(`Failed to post @copilot mention: ${error instanceof Error ? error.message : error}`);
      }
    }

    // Log audit entry
    const auditEntry = createAuditEntry(
      'review-agent',
      `${pr.title}\n${diff.substring(0, 1000)}`,
      [
        ...sanitizedTitle.detectedPatterns,
        ...sanitizedBody.detectedPatterns,
      ],
      [
        `assessment:${validated.overallAssessment}`,
        `security-issues:${validated.securityIssues.length}`,
        `quality-issues:${validated.codeQualityIssues.length}`,
      ],
      DEFAULT_MODEL
    );

    // Log to PR as collapsed comment
    await logAgentDecision(
      octokit,
      { ...ref, issueNumber: pr.number },
      auditEntry
    );

    core.info('Review complete');
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
function getConfig(): ReviewConfig {
  // Set COPILOT_GITHUB_TOKEN from input if provided (allows passing via workflow)
  const copilotToken = core.getInput('copilot-token');
  if (copilotToken) {
    process.env.COPILOT_GITHUB_TOKEN = copilotToken;
  }

  return {
    githubToken: core.getInput('github-token', { required: true }),
    copilotToken: copilotToken || '',
    model: core.getInput('model') || 'claude-sonnet-4.5',
    mode: (core.getInput('mode') || 'full') as 'analyze-only' | 'full',
    autoApproveDependabot: core.getBooleanInput('auto-approve-dependabot'),
    securityFocus: core.getBooleanInput('security-focus'),
  };
}

/**
 * Extracts PR data from context or fetches from API for workflow_dispatch
 */
async function getPRFromContext(
  octokit?: ReturnType<typeof createOctokit>
): Promise<{ number: number; title: string; body: string } | null> {
  const payload = github.context.payload;

  // Check for workflow_dispatch with pr-number input
  const prNumberInput = core.getInput('pr-number');
  if (prNumberInput && octokit) {
    const prNumber = parseInt(prNumberInput, 10);
    if (!isNaN(prNumber)) {
      core.info(`Fetching PR #${prNumber} via API (workflow_dispatch)`);
      try {
        const response = await octokit.rest.pulls.get({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          pull_number: prNumber,
        });
        return {
          number: response.data.number,
          title: response.data.title || '',
          body: response.data.body || '',
        };
      } catch (error) {
        core.error(`Failed to fetch PR #${prNumber}: ${error}`);
        return null;
      }
    }
  }

  // Standard pull_request event
  if (payload.pull_request) {
    return {
      number: payload.pull_request.number,
      title: payload.pull_request.title || '',
      body: payload.pull_request.body || '',
    };
  }

  return null;
}

/**
 * Handles Dependabot PRs with simplified review
 */
async function handleDependabotPR(
  octokit: ReturnType<typeof createOctokit>,
  ref: PullRequestRef,
  config: ReviewConfig
): Promise<void> {
  const files = await getPullRequestFiles(octokit, ref);

  // Check if only package files were changed
  const onlyPackageFiles = files.every(
    (f) =>
      f.filename.includes('package.json') ||
      f.filename.includes('package-lock.json') ||
      f.filename.includes('yarn.lock') ||
      f.filename.includes('.csproj') ||
      f.filename.includes('packages.lock.json') ||
      f.filename.includes('requirements.txt') ||
      f.filename.includes('Pipfile.lock') ||
      f.filename.includes('go.mod') ||
      f.filename.includes('go.sum')
  );

  if (onlyPackageFiles) {
    core.info('Dependabot PR with only package file changes - auto-approving');
    await createPullRequestReview(
      octokit,
      ref,
      'APPROVE',
      '✅ Automated approval for Dependabot dependency update.\n\n*This PR only modifies package files and was auto-approved by the GH-Agency Review Agent.*'
    );
  } else {
    core.info('Dependabot PR with code changes - requesting human review');
    await createPullRequestReview(
      octokit,
      ref,
      'COMMENT',
      '⚠️ This Dependabot PR includes changes beyond package files. Human review recommended.\n\n*GH-Agency Review Agent*'
    );
  }
}

/**
 * Analyzes a PR using the Copilot SDK
 */
async function analyzePR(
  diff: string,
  files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>,
  prContent: { title: string; body: string },
  securityFocus: boolean,
  contextSection: string,
  owner: string,
  repo: string,
  model: string
): Promise<ReviewResult> {
  // Check for Copilot auth early to fail fast
  if (!hasCopilotAuth()) {
    core.warning('No valid Copilot authentication found. Set COPILOT_GITHUB_TOKEN with a fine-grained PAT that has Copilot access.');
    core.warning('Falling back to basic pattern-based analysis (no AI)...');
    return createFallbackReviewResult(diff, files);
  }

  // Build the system prompt
  const systemPrompt = createReviewSystemPrompt()
    .replace('{project_name}', `${owner}/${repo}`)
    .replace('{context}', contextSection);

  // Build the user prompt with PR details
  const filesSummary = files
    .map((f) => `- ${f.filename} (${f.status}: +${f.additions}/-${f.deletions})`)
    .join('\n');

  const instructions = `
Review this pull request for security issues, code quality, and best practices.

## PR Information
**Title:** ${prContent.title}
**Description:** ${prContent.body || '(No description provided)'}

## Files Changed
${filesSummary}

${securityFocus ? '## Security Focus Mode\nPay extra attention to security vulnerabilities, credentials, and injection risks.' : ''}

## Analysis Request
1. Identify any security issues (critical, high, medium, low severity)
2. Identify code quality issues
3. Provide constructive suggestions
4. Determine overall assessment (approve, request-changes, or comment)
  `.trim();

  const userPrompt = buildReviewPrompt(diff, instructions);

  // Send to Copilot SDK with error handling for stream issues
  core.info(`Analyzing PR with Copilot SDK (model: ${model})...`);
  let response;
  try {
    response = await sendPrompt(systemPrompt, userPrompt, { model });
  } catch (error) {
    core.warning(`Copilot SDK error: ${error instanceof Error ? error.message : error}`);
    core.warning('Falling back to basic pattern-based analysis...');
    // Stop the client immediately to prevent background errors
    try {
      await stopCopilotClient();
    } catch {
      // Ignore stop errors
    }
    return createFallbackReviewResult(diff, files);
  }

  if (response.finishReason === 'error' || !response.content) {
    core.warning('Copilot SDK returned an error, falling back to basic analysis');
    return createFallbackReviewResult(diff, files);
  }

  // Parse the response
  const parsed = parseAgentResponse<ReviewResult>(response.content);

  if (!parsed) {
    core.warning('Failed to parse Copilot SDK response, falling back to basic analysis');
    core.debug(`Raw response: ${response.content}`);
    return createFallbackReviewResult(diff, files);
  }

  return parsed;
}

/**
 * Creates a fallback review result when Copilot SDK fails
 */
function createFallbackReviewResult(
  diff: string,
  files: Array<{ filename: string; status: string; additions: number; deletions: number; patch?: string }>
): ReviewResult {
  const securityIssues: ReviewResult['securityIssues'] = [];

  // Basic security pattern detection as fallback
  const securityPatterns = [
    { pattern: () => /password\s*=\s*["'][^"']+["']/i, msg: 'Potential hardcoded password' },
    { pattern: () => /api[_-]?key\s*=\s*["'][^"']+["']/i, msg: 'Potential hardcoded API key' },
    { pattern: () => /secret\s*=\s*["'][^"']+["']/i, msg: 'Potential hardcoded secret' },
    { pattern: () => /eval\s*\(/i, msg: 'Use of eval() - potential code injection' },
    { pattern: () => /innerHTML\s*=/i, msg: 'Use of innerHTML - potential XSS vulnerability' },
  ];

  for (const file of files) {
    if (!file.patch) continue;

    for (const { pattern, msg } of securityPatterns) {
      if (pattern().test(file.patch)) {
        securityIssues.push({
          severity: 'high',
          file: file.filename,
          description: msg,
          suggestion: 'Review and ensure this is intentional and secure.',
        });
      }
    }
  }

  return {
    overallAssessment: securityIssues.length > 0 ? 'comment' : 'comment',
    securityIssues,
    codeQualityIssues: [],
    suggestions: [],
    summary: `Basic analysis of ${files.length} files (AI analysis unavailable). Manual review recommended.`,
  };
}

/**
 * Maps assessment to GitHub review event
 */
function mapAssessmentToEvent(result: ReviewResult): 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' {
  switch (result.overallAssessment) {
    case 'approve':
      return 'APPROVE';
    case 'request-changes':
      return 'REQUEST_CHANGES';
    default:
      return 'COMMENT';
  }
}

/**
 * Builds the review comment body with structured sections
 */
function buildReviewComment(result: ReviewResult): string {
  const sections: string[] = ['## 🤖 AI Code Review\n'];

  // Overview/Summary
  sections.push('### Overview\n');
  sections.push(result.summary);

  // Security Issues (by severity)
  if (result.securityIssues.length > 0) {
    sections.push('\n### 🔒 Security Issues\n');

    // Group by severity
    const critical = result.securityIssues.filter(i => i.severity === 'critical');
    const high = result.securityIssues.filter(i => i.severity === 'high');
    const medium = result.securityIssues.filter(i => i.severity === 'medium');
    const low = result.securityIssues.filter(i => i.severity === 'low');

    if (critical.length > 0) {
      sections.push('**🚨 Critical**');
      for (const issue of critical) {
        sections.push(`- \`${issue.file}\`: ${issue.description}`);
        if (issue.suggestion) sections.push(`  - 💡 ${issue.suggestion}`);
      }
    }
    if (high.length > 0) {
      sections.push('**⚠️ High**');
      for (const issue of high) {
        sections.push(`- \`${issue.file}\`: ${issue.description}`);
        if (issue.suggestion) sections.push(`  - 💡 ${issue.suggestion}`);
      }
    }
    if (medium.length > 0) {
      sections.push('**🟡 Medium**');
      for (const issue of medium) {
        sections.push(`- \`${issue.file}\`: ${issue.description}`);
        if (issue.suggestion) sections.push(`  - 💡 ${issue.suggestion}`);
      }
    }
    if (low.length > 0) {
      sections.push('**🟢 Low/Informational**');
      for (const issue of low) {
        sections.push(`- \`${issue.file}\`: ${issue.description}`);
        if (issue.suggestion) sections.push(`  - 💡 ${issue.suggestion}`);
      }
    }
  }

  // Code Quality Issues
  if (result.codeQualityIssues.length > 0) {
    sections.push('\n### 📝 Code Quality\n');
    for (const issue of result.codeQualityIssues) {
      sections.push(`- **\`${issue.file}\`**: ${issue.description}`);
      if (issue.suggestion) sections.push(`  - 💡 ${issue.suggestion}`);
    }
  }

  // Suggestions (if any)
  if (result.suggestions && result.suggestions.length > 0) {
    sections.push('\n### 💡 Suggestions\n');
    for (const suggestion of result.suggestions) {
      const fileRef = suggestion.file ? `**\`${suggestion.file}\`**: ` : '';
      sections.push(`- ${fileRef}${suggestion.suggestion}`);
      if (suggestion.rationale) {
        sections.push(`  - *Rationale: ${suggestion.rationale}*`);
      }
    }
  }

  // Final Recommendation
  sections.push('\n### 📋 Final Recommendation\n');
  const criticalCount = result.securityIssues.filter(i => i.severity === 'critical').length;
  const highCount = result.securityIssues.filter(i => i.severity === 'high').length;
  const mediumCount = result.securityIssues.filter(i => i.severity === 'medium').length;
  const qualityCount = result.codeQualityIssues.length;

  if (result.overallAssessment === 'approve') {
    sections.push('✅ **APPROVE** - No blocking issues found. Code looks good to merge.');
  } else if (result.overallAssessment === 'request-changes') {
    if (criticalCount > 0 || highCount > 0) {
      sections.push(`🚫 **REQUEST CHANGES** - Found ${criticalCount + highCount} critical/high severity issue(s) that must be addressed before merging.`);
    } else {
      sections.push('🚫 **REQUEST CHANGES** - Issues found that should be addressed before merging.');
    }
  } else {
    // Comment
    if (criticalCount === 0 && highCount === 0 && (mediumCount > 0 || qualityCount > 0)) {
      sections.push(`✅ **APPROVE with suggestions** - No blocking issues. ${mediumCount + qualityCount} minor item(s) for consideration.`);
    } else if (criticalCount === 0 && highCount === 0) {
      sections.push('✅ **APPROVE** - No significant issues found.');
    } else {
      sections.push('⚠️ **NEEDS ATTENTION** - Review the issues above before merging.');
    }
  }

  // Note: @copilot mention is posted separately using user's token
  // because Copilot doesn't respond to mentions from bots

  sections.push('\n---\n*Review by GH-Agency Review Agent*');

  return sections.join('\n');
}

/**
 * Builds inline comments for the review
 */
function buildInlineComments(
  result: ReviewResult
): Array<{ path: string; line: number; body: string }> {
  const comments: Array<{ path: string; line: number; body: string }> = [];

  // Add security issue comments
  for (const issue of result.securityIssues) {
    if (issue.line) {
      comments.push({
        path: issue.file,
        line: issue.line,
        body: `🔒 **Security (${issue.severity})**: ${issue.description}${issue.suggestion ? `\n\n💡 ${issue.suggestion}` : ''}`,
      });
    }
  }

  // Add quality issue comments
  for (const issue of result.codeQualityIssues) {
    if (issue.line) {
      comments.push({
        path: issue.file,
        line: issue.line,
        body: `📝 **${issue.severity}**: ${issue.description}${issue.suggestion ? `\n\n💡 ${issue.suggestion}` : ''}`,
      });
    }
  }

  return comments;
}

// Run the action
run();
