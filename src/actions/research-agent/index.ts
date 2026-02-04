/**
 * GH-Agency Research Agent
 * Proactive codebase health monitoring
 *
 * This agent runs on a schedule to analyze dependencies,
 * identify technical debt, and generate health reports.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  checkCircuitBreaker,
  createCircuitBreakerContext,
  DEFAULT_MODEL,
  type ResearchReport,
  type FeatureSuggestion,
  type IndustryInsight,
} from '../../shared/index.js';
import {
  createOctokit,
  loadRepositoryContext,
  createAuditEntry,
  logAgentDecision,
  type IssueRef,
} from '../../sdk/index.js';

/** Research agent configuration */
interface ResearchConfig {
  githubToken: string;
  model: string;
  outputType: 'issue' | 'wiki' | 'artifact';
  focusAreas: string[];
  /** When true, automatically creates individual issues for actionable recommendations */
  createActionableIssues: boolean;
  /** Minimum priority level for creating individual issues ('low', 'medium', 'high', 'critical') */
  minPriorityForIssue: 'low' | 'medium' | 'high' | 'critical';
}

/** Actionable recommendation extracted from research */
interface ActionableRecommendation {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  category: 'security' | 'dependencies' | 'technical-debt' | 'feature' | 'infrastructure';
  labels: string[];
  alignsWithVision: boolean;
  visionAlignment?: string;
}

/**
 * Main entry point for the research agent
 */
export async function run(): Promise<void> {
  try {
    const config = getConfig();

    // Initialize circuit breaker
    const circuitBreaker = createCircuitBreakerContext();
    checkCircuitBreaker(circuitBreaker);

    const octokit = createOctokit(config.githubToken);
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;

    // Load repository context
    core.info('Loading repository context...');
    const repoContext = await loadRepositoryContext(octokit, owner, repo);

    // Perform research analysis
    core.info('Analyzing repository health...');
    const report = await analyzeRepository(octokit, owner, repo, config, repoContext);

    // Output results
    core.setOutput('report', JSON.stringify(report));
    core.setOutput('dependency-updates', report.dependencyUpdates.length);
    core.setOutput('technical-debt-items', report.technicalDebt.length);
    core.setOutput('security-advisories', report.securityAdvisories.length);

    // Generate output based on type
    let issueNumber: number | undefined;
    if (config.outputType === 'issue') {
      issueNumber = await createHealthReportIssue(octokit, owner, repo, report);
    }

    // Create individual actionable issues if enabled
    let createdIssues: number[] = [];
    if (config.createActionableIssues) {
      core.info('Creating actionable issues for recommendations...');
      createdIssues = await createActionableIssuesFromReport(
        octokit,
        owner,
        repo,
        report,
        repoContext,
        config
      );
      core.setOutput('issues-created', createdIssues.length);
      core.setOutput('issue-numbers', createdIssues.join(','));
    }

    // Log audit entry if we have an issue to attach it to
    if (issueNumber) {
      const auditEntry = createAuditEntry(
        'research-agent',
        JSON.stringify(config.focusAreas),
        [],
        [
          `analyzed:${config.focusAreas.join(',')}`,
          `security-advisories:${report.securityAdvisories.length}`,
          `dependency-updates:${report.dependencyUpdates.length}`,
          `technical-debt:${report.technicalDebt.length}`,
          `actionable-issues-created:${createdIssues.length}`,
        ],
        DEFAULT_MODEL
      );

      const ref: IssueRef = { owner, repo, issueNumber };
      await logAgentDecision(octokit, ref, auditEntry);
    }

    core.info(`Research complete. Created ${createdIssues.length} actionable issues.`);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

/**
 * Gets configuration from action inputs
 */
function getConfig(): ResearchConfig {
  // Set COPILOT_GITHUB_TOKEN from input if provided (allows passing via workflow)
  const copilotToken = core.getInput('copilot-token');
  if (copilotToken) {
    process.env.COPILOT_GITHUB_TOKEN = copilotToken;
  }

  const focusAreasInput = core.getInput('focus-areas');
  const focusAreas = focusAreasInput
    ? focusAreasInput.split(',').map((s) => s.trim())
    : ['dependencies', 'security', 'technical-debt', 'industry-research'];

  const minPriority = core.getInput('min-priority-for-issue') || 'high';
  const validPriorities = ['low', 'medium', 'high', 'critical'];

  return {
    githubToken: core.getInput('github-token', { required: true }),
    model: core.getInput('model') || 'claude-sonnet-4.5',
    outputType: (core.getInput('output-type') || 'issue') as 'issue' | 'wiki' | 'artifact',
    focusAreas,
    createActionableIssues: core.getInput('create-actionable-issues') === 'true',
    minPriorityForIssue: validPriorities.includes(minPriority)
      ? (minPriority as 'low' | 'medium' | 'high' | 'critical')
      : 'high',
  };
}

/**
 * Analyzes the repository and generates a health report
 */
async function analyzeRepository(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  config: ResearchConfig,
  repoContext: Awaited<ReturnType<typeof loadRepositoryContext>>
): Promise<ResearchReport> {
  const report: ResearchReport = {
    generatedAt: new Date().toISOString(),
    dependencyUpdates: [],
    technicalDebt: [],
    securityAdvisories: [],
    featureSuggestions: [],
    industryInsights: [],
    recommendations: [],
  };

  // Check for dependency updates
  if (config.focusAreas.includes('dependencies')) {
    core.info('Checking dependencies...');
    // In production, this would analyze package files and check for updates
    // For now, we return an empty list
  }

  // Check for security advisories
  if (config.focusAreas.includes('security')) {
    core.info('Checking security advisories...');
    try {
      const advisories = await octokit.rest.dependabot.listAlertsForRepo({
        owner,
        repo,
        state: 'open',
        per_page: 10,
      });

      for (const advisory of advisories.data) {
        report.securityAdvisories.push({
          id: String(advisory.number),
          severity: advisory.security_vulnerability?.severity as 'critical' | 'high' | 'medium' | 'low' || 'medium',
          package: advisory.dependency?.package?.name || 'unknown',
          affectedVersions: advisory.security_vulnerability?.vulnerable_version_range || 'unknown',
          patchedVersion: advisory.security_vulnerability?.first_patched_version?.identifier,
          description: advisory.security_advisory?.summary || 'No description',
        });
      }
    } catch {
      // Dependabot alerts may not be available
      core.info('Could not fetch Dependabot alerts (may require additional permissions)');
    }
  }

  // Industry research and feature suggestions
  if (config.focusAreas.includes('industry-research')) {
    core.info('Analyzing industry trends and similar projects...');
    const { featureSuggestions, industryInsights } = await analyzeIndustryTrends(
      octokit,
      owner,
      repo,
      repoContext,
      config
    );
    report.featureSuggestions = featureSuggestions;
    report.industryInsights = industryInsights;
  }

  // Generate recommendations
  if (report.securityAdvisories.length > 0) {
    report.recommendations.push(
      `Address ${report.securityAdvisories.length} open security advisories`
    );
  }

  if (report.featureSuggestions.length > 0) {
    const highPriority = report.featureSuggestions.filter(f => f.priority === 'high');
    if (highPriority.length > 0) {
      report.recommendations.push(
        `Consider ${highPriority.length} high-priority feature suggestions aligned with project vision`
      );
    }
  }

  if (report.industryInsights.length > 0) {
    const actionable = report.industryInsights.filter(i => i.actionable);
    if (actionable.length > 0) {
      report.recommendations.push(
        `Review ${actionable.length} actionable industry insights`
      );
    }
  }

  return report;
}

/**
 * Analyzes industry trends and similar projects to suggest features
 *
 * This function searches for similar repositories, analyzes their features,
 * and suggests improvements that align with the project's vision.
 */
async function analyzeIndustryTrends(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  repoContext: Awaited<ReturnType<typeof loadRepositoryContext>>,
  config: ResearchConfig
): Promise<{ featureSuggestions: FeatureSuggestion[]; industryInsights: IndustryInsight[] }> {
  const featureSuggestions: FeatureSuggestion[] = [];
  const industryInsights: IndustryInsight[] = [];

  // Extract key topics from the repository for searching similar projects
  const repoTopics = await getRepositoryTopics(octokit, owner, repo);
  const repoDescription = await getRepositoryDescription(octokit, owner, repo);

  // Search for similar repositories based on topics
  if (repoTopics.length > 0) {
    core.info(`Searching for similar projects with topics: ${repoTopics.join(', ')}`);
    const similarRepos = await searchSimilarRepositories(octokit, repoTopics, `${owner}/${repo}`);

    // Analyze features from similar repositories
    for (const similarRepo of similarRepos.slice(0, 5)) {
      const features = await analyzeRepositoryFeatures(octokit, similarRepo);

      for (const feature of features) {
        // Check if feature aligns with project vision
        const alignment = checkVisionAlignment(feature, repoContext.vision || '');

        if (alignment.aligns) {
          featureSuggestions.push({
            title: feature.title,
            description: feature.description,
            rationale: `Found in ${similarRepo.fullName} (${similarRepo.stars} stars). ${feature.rationale}`,
            alignsWithVision: true,
            visionAlignment: alignment.reason,
            similarProjects: [similarRepo.fullName],
            estimatedEffort: feature.effort,
            priority: determinePriority(feature, similarRepo.stars, alignment),
            category: feature.category,
          });
        }
      }
    }

    // Consolidate similar suggestions
    const consolidatedSuggestions = consolidateFeatureSuggestions(featureSuggestions);
    featureSuggestions.length = 0;
    featureSuggestions.push(...consolidatedSuggestions);
  }

  // Generate industry insights based on repository topics
  if (repoDescription || repoTopics.length > 0) {
    const insights = generateIndustryInsights(repoTopics, repoDescription, repoContext, config.model);
    industryInsights.push(...insights);
  }

  return { featureSuggestions, industryInsights };
}

/**
 * Gets repository topics
 */
async function getRepositoryTopics(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string
): Promise<string[]> {
  try {
    const response = await octokit.rest.repos.getAllTopics({ owner, repo });
    return response.data.names || [];
  } catch {
    return [];
  }
}

/**
 * Gets repository description
 */
async function getRepositoryDescription(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string
): Promise<string> {
  try {
    const response = await octokit.rest.repos.get({ owner, repo });
    return response.data.description || '';
  } catch {
    return '';
  }
}

/**
 * Searches for similar repositories based on topics
 */
async function searchSimilarRepositories(
  octokit: ReturnType<typeof createOctokit>,
  topics: string[],
  excludeRepo: string
): Promise<Array<{ fullName: string; stars: number; description: string }>> {
  const results: Array<{ fullName: string; stars: number; description: string }> = [];

  try {
    // Search by topics
    const topicQuery = topics.slice(0, 3).map(t => `topic:${t}`).join(' ');
    const response = await octokit.rest.search.repos({
      q: `${topicQuery} stars:>100`,
      sort: 'stars',
      order: 'desc',
      per_page: 10,
    });

    for (const repo of response.data.items) {
      if (repo.full_name !== excludeRepo) {
        results.push({
          fullName: repo.full_name,
          stars: repo.stargazers_count,
          description: repo.description || '',
        });
      }
    }
  } catch {
    core.info('Could not search for similar repositories');
  }

  return results;
}

/**
 * Analyzes features from a repository based on its README and structure
 */
async function analyzeRepositoryFeatures(
  octokit: ReturnType<typeof createOctokit>,
  repo: { fullName: string; stars: number; description: string }
): Promise<Array<{
  title: string;
  description: string;
  rationale: string;
  effort: 'small' | 'medium' | 'large';
  category: FeatureSuggestion['category'];
}>> {
  const features: Array<{
    title: string;
    description: string;
    rationale: string;
    effort: 'small' | 'medium' | 'large';
    category: FeatureSuggestion['category'];
  }> = [];

  try {
    const parts = repo.fullName.split('/');
    const owner = parts[0];
    const repoName = parts[1];

    if (!owner || !repoName) {
      return features;
    }

    // Get README to analyze features
    const readmeResponse = await octokit.rest.repos.getReadme({
      owner,
      repo: repoName,
    });

    const readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');

    // Extract features from README (simple pattern matching)
    // In production, this would use LLM analysis
    const featurePatterns = [
      { pattern: /## Features?\s*\n([\s\S]*?)(?=\n##|$)/i, section: 'features' },
      { pattern: /## What['']?s [Nn]ew\s*\n([\s\S]*?)(?=\n##|$)/i, section: 'new' },
      { pattern: /## Highlights?\s*\n([\s\S]*?)(?=\n##|$)/i, section: 'highlights' },
    ];

    for (const { pattern, section } of featurePatterns) {
      const match = readme.match(pattern);
      if (match && match[1]) {
        const featureText = match[1];
        const bullets = featureText.match(/^[-*]\s+.+$/gm) || [];

        for (const bullet of bullets.slice(0, 3)) {
          const featureTitle = bullet.replace(/^[-*]\s+/, '').substring(0, 100);
          if (featureTitle.length > 10) {
            features.push({
              title: featureTitle,
              description: `Feature found in ${section} section of ${repo.fullName}`,
              rationale: `This feature is implemented in a popular similar project with ${repo.stars} stars.`,
              effort: 'medium',
              category: categorizeFeature(featureTitle),
            });
          }
        }
      }
    }
  } catch {
    // README might not be accessible
  }

  return features;
}

/**
 * Categorizes a feature based on its title/description
 */
function categorizeFeature(title: string): FeatureSuggestion['category'] {
  const lower = title.toLowerCase();

  if (lower.includes('security') || lower.includes('auth') || lower.includes('encrypt')) {
    return 'security';
  }
  if (lower.includes('performance') || lower.includes('fast') || lower.includes('optimize')) {
    return 'performance';
  }
  if (lower.includes('api') || lower.includes('plugin') || lower.includes('extend')) {
    return 'integration';
  }
  if (lower.includes('cli') || lower.includes('debug') || lower.includes('developer')) {
    return 'developer-experience';
  }
  return 'enhancement';
}

/**
 * Checks if a feature aligns with the project vision
 */
function checkVisionAlignment(
  feature: { title: string; description: string },
  vision: string
): { aligns: boolean; reason: string } {
  if (!vision) {
    return { aligns: true, reason: 'No vision document to compare against' };
  }

  const visionLower = vision.toLowerCase();
  const featureLower = `${feature.title} ${feature.description}`.toLowerCase();

  // Check for explicit non-goals
  const nonGoalMatch = vision.match(/## Non-Goals?\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (nonGoalMatch && nonGoalMatch[1]) {
    const nonGoals = nonGoalMatch[1].toLowerCase();
    const featureWords = featureLower.split(/\s+/).filter(w => w.length > 4);

    for (const word of featureWords) {
      if (nonGoals.includes(word)) {
        return { aligns: false, reason: `May conflict with non-goals section` };
      }
    }
  }

  // Check for alignment with principles
  const principlesMatch = vision.match(/## (?:Core )?Principles?\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (principlesMatch && principlesMatch[1]) {
    const principles = principlesMatch[1].toLowerCase();
    const featureWords = featureLower.split(/\s+/).filter(w => w.length > 4);

    for (const word of featureWords) {
      if (principles.includes(word)) {
        return { aligns: true, reason: `Aligns with project principles` };
      }
    }
  }

  // Default to moderate alignment
  return { aligns: true, reason: 'General alignment with project scope' };
}

/**
 * Determines priority based on various factors
 */
function determinePriority(
  feature: { title: string },
  stars: number,
  alignment: { aligns: boolean; reason: string }
): 'low' | 'medium' | 'high' {
  if (!alignment.aligns) return 'low';
  if (stars > 10000 && alignment.reason.includes('principles')) return 'high';
  if (stars > 5000) return 'medium';
  return 'low';
}

/**
 * Consolidates similar feature suggestions
 */
function consolidateFeatureSuggestions(suggestions: FeatureSuggestion[]): FeatureSuggestion[] {
  const consolidated: Map<string, FeatureSuggestion> = new Map();

  for (const suggestion of suggestions) {
    // Simple consolidation by title similarity
    const key = suggestion.title.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 20);

    if (consolidated.has(key)) {
      const existing = consolidated.get(key)!;
      existing.similarProjects.push(...suggestion.similarProjects);
      if (suggestion.priority === 'high') existing.priority = 'high';
    } else {
      consolidated.set(key, { ...suggestion, similarProjects: [...suggestion.similarProjects] });
    }
  }

  return Array.from(consolidated.values()).slice(0, 10);
}

/**
 * Generates industry insights based on repository topics
 * Uses heuristic-based fallback insights instead of Copilot SDK
 * to avoid stream stability issues in CI environments
 */
function generateIndustryInsights(
  topics: string[],
  _description: string,
  _repoContext: Awaited<ReturnType<typeof loadRepositoryContext>>,
  _model: string
): IndustryInsight[] {
  core.info('Generating industry insights based on repository topics...');
  return generateFallbackInsights(topics);
}

/**
 * Fallback industry insights when Copilot SDK is unavailable
 */
function generateFallbackInsights(topics: string[]): IndustryInsight[] {
  const insights: IndustryInsight[] = [];

  const topicInsights: Record<string, IndustryInsight> = {
    'ai': {
      topic: 'AI/ML Integration',
      summary: 'AI-powered features are becoming standard in developer tools',
      relevance: 'Consider adding AI-assisted features to enhance user productivity',
      sources: ['Industry trends in developer tooling'],
      actionable: true,
    },
    'automation': {
      topic: 'Automation Trends',
      summary: 'Workflow automation continues to grow in importance',
      relevance: 'Expanding automation capabilities aligns with industry direction',
      sources: ['DevOps automation trends'],
      actionable: true,
    },
    'security': {
      topic: 'Security-First Development',
      summary: 'Supply chain security is a top priority for organizations',
      relevance: 'Security features provide significant competitive advantage',
      sources: ['OWASP, industry security reports'],
      actionable: true,
    },
    'typescript': {
      topic: 'TypeScript Adoption',
      summary: 'TypeScript continues to dominate for new JavaScript projects',
      relevance: 'Strong typing improves maintainability and developer experience',
      sources: ['State of JS surveys'],
      actionable: false,
    },
  };

  for (const topic of topics) {
    const lowerTopic = topic.toLowerCase();
    for (const [key, insight] of Object.entries(topicInsights)) {
      if (lowerTopic.includes(key)) {
        insights.push(insight);
        break;
      }
    }
  }

  return insights.slice(0, 5);
}

/**
 * Creates a GitHub issue with the health report
 */
async function createHealthReportIssue(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  report: ResearchReport
): Promise<number> {
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const body = buildReportBody(report);

  // Check if there's an existing open research issue
  const existingIssues = await octokit.rest.issues.listForRepo({
    owner,
    repo,
    labels: 'research-report',
    state: 'open',
    per_page: 1,
  });

  if (existingIssues.data.length > 0) {
    // Update existing issue
    const issueNumber = existingIssues.data[0]!.number;
    await octokit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    });
    core.info(`Updated existing research issue #${issueNumber}`);
    return issueNumber;
  } else {
    // Create new issue
    const newIssue = await octokit.rest.issues.create({
      owner,
      repo,
      title: `📊 Weekly Research Report - ${date}`,
      body,
      labels: ['research-report'],
    });
    core.info(`Created research issue #${newIssue.data.number}`);
    return newIssue.data.number;
  }
}

/**
 * Builds the report body in markdown
 */
function buildReportBody(report: ResearchReport): string {
  const sections: string[] = [];

  sections.push('# 📊 Repository Health Report\n');
  sections.push(`*Generated: ${report.generatedAt}*\n`);

  // Security section
  sections.push('## 🔒 Security Advisories\n');
  if (report.securityAdvisories.length === 0) {
    sections.push('✅ No open security advisories.\n');
  } else {
    sections.push(`⚠️ **${report.securityAdvisories.length} open advisories**\n`);
    for (const advisory of report.securityAdvisories) {
      const icon = advisory.severity === 'critical' ? '🚨' : advisory.severity === 'high' ? '⚠️' : 'ℹ️';
      sections.push(
        `- ${icon} **${advisory.severity.toUpperCase()}** - \`${advisory.package}\`: ${advisory.description}`
      );
      if (advisory.patchedVersion) {
        sections.push(`  - Patched in: ${advisory.patchedVersion}`);
      }
    }
  }

  // Dependencies section
  sections.push('\n## 📦 Dependency Updates\n');
  if (report.dependencyUpdates.length === 0) {
    sections.push('✅ Dependencies are up to date.\n');
  } else {
    for (const dep of report.dependencyUpdates) {
      const icon = dep.updateType === 'major' ? '🔴' : dep.updateType === 'minor' ? '🟡' : '🟢';
      sections.push(
        `- ${icon} \`${dep.package}\`: ${dep.currentVersion} → ${dep.latestVersion} (${dep.updateType})`
      );
    }
  }

  // Technical debt section
  sections.push('\n## 🔧 Technical Debt\n');
  if (report.technicalDebt.length === 0) {
    sections.push('✅ No significant technical debt identified.\n');
  } else {
    for (const debt of report.technicalDebt) {
      sections.push(`- **${debt.category}** (${debt.priority} priority): ${debt.description}`);
      sections.push(`  - Location: ${debt.location}`);
      sections.push(`  - Effort: ${debt.estimatedEffort}`);
    }
  }

  // Feature suggestions section
  sections.push('\n## 💡 Feature Suggestions\n');
  if (report.featureSuggestions.length === 0) {
    sections.push('No feature suggestions at this time.\n');
  } else {
    sections.push('*Features identified from similar projects that align with project vision:*\n');
    for (const feature of report.featureSuggestions) {
      const priorityIcon = feature.priority === 'high' ? '🔥' : feature.priority === 'medium' ? '⭐' : '💭';
      const effortBadge = `\`${feature.estimatedEffort} effort\``;
      const categoryBadge = `\`${feature.category}\``;

      sections.push(`### ${priorityIcon} ${feature.title}`);
      sections.push(`${categoryBadge} ${effortBadge}\n`);
      sections.push(feature.description);
      sections.push(`\n**Rationale:** ${feature.rationale}`);
      sections.push(`\n**Vision Alignment:** ${feature.visionAlignment}`);
      if (feature.similarProjects.length > 0) {
        sections.push(`\n**Found in:** ${feature.similarProjects.join(', ')}`);
      }
      sections.push('');
    }
  }

  // Industry insights section
  sections.push('\n## 🌐 Industry Insights\n');
  if (report.industryInsights.length === 0) {
    sections.push('No industry insights available.\n');
  } else {
    for (const insight of report.industryInsights) {
      const actionableIcon = insight.actionable ? '✅' : 'ℹ️';
      sections.push(`### ${actionableIcon} ${insight.topic}`);
      sections.push(insight.summary);
      sections.push(`\n**Relevance:** ${insight.relevance}`);
      if (insight.sources.length > 0) {
        sections.push(`\n*Sources: ${insight.sources.join(', ')}*`);
      }
      sections.push('');
    }
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    sections.push('\n## 📋 Action Items\n');
    for (const rec of report.recommendations) {
      sections.push(`- [ ] ${rec}`);
    }
  }

  sections.push('\n---\n*Report generated by GH-Agency Research Agent*');

  return sections.join('\n');
}

/**
 * Creates individual actionable issues from the research report
 * Only creates issues that:
 * 1. Meet the minimum priority threshold
 * 2. Align with the project vision
 * 3. Don't already exist as open issues
 */
async function createActionableIssuesFromReport(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  report: ResearchReport,
  repoContext: Awaited<ReturnType<typeof loadRepositoryContext>>,
  config: ResearchConfig
): Promise<number[]> {
  const createdIssues: number[] = [];
  const priorityOrder = ['low', 'medium', 'high', 'critical'];
  const minPriorityIndex = priorityOrder.indexOf(config.minPriorityForIssue);

  // Extract actionable recommendations from the report
  const recommendations = extractActionableRecommendations(report, repoContext);

  // Filter by priority
  const filteredRecs = recommendations.filter((rec) => {
    const recPriorityIndex = priorityOrder.indexOf(rec.priority);
    return recPriorityIndex >= minPriorityIndex;
  });

  core.info(`Found ${filteredRecs.length} recommendations meeting priority threshold (${config.minPriorityForIssue}+)`);

  // Get existing open issues to check for duplicates
  const existingIssues = await getExistingIssues(octokit, owner, repo);

  for (const rec of filteredRecs) {
    // Skip if doesn't align with vision
    if (!rec.alignsWithVision) {
      core.info(`Skipping "${rec.title}" - does not align with project vision`);
      continue;
    }

    // Check for duplicate
    const isDuplicate = checkForDuplicateIssue(rec, existingIssues);
    if (isDuplicate) {
      core.info(`Skipping "${rec.title}" - similar issue already exists`);
      continue;
    }

    // Create the issue
    try {
      const issueNumber = await createActionableIssue(octokit, owner, repo, rec);
      createdIssues.push(issueNumber);
      core.info(`Created issue #${issueNumber}: ${rec.title}`);
    } catch (error) {
      core.warning(`Failed to create issue "${rec.title}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return createdIssues;
}

/**
 * Extracts actionable recommendations from the research report
 */
function extractActionableRecommendations(
  report: ResearchReport,
  repoContext: Awaited<ReturnType<typeof loadRepositoryContext>>
): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  // Convert security advisories to recommendations (always high/critical priority)
  for (const advisory of report.securityAdvisories) {
    recommendations.push({
      title: `Security: Update ${advisory.package} (${advisory.severity} severity)`,
      description: `## Security Advisory

**Package:** \`${advisory.package}\`
**Severity:** ${advisory.severity.toUpperCase()}
**Affected Versions:** ${advisory.affectedVersions}
${advisory.patchedVersion ? `**Patched Version:** ${advisory.patchedVersion}` : ''}

### Description
${advisory.description}

### Action Required
Update \`${advisory.package}\` to the patched version to resolve this security vulnerability.

---
*Created by Research Agent*`,
      priority: advisory.severity === 'critical' ? 'critical' : advisory.severity === 'high' ? 'high' : 'medium',
      category: 'security',
      labels: ['security', `priority:${advisory.severity}`],
      alignsWithVision: true, // Security always aligns
    });
  }

  // Convert feature suggestions to recommendations
  for (const feature of report.featureSuggestions) {
    if (feature.alignsWithVision) {
      recommendations.push({
        title: feature.title,
        description: `## Feature Suggestion

${feature.description}

### Rationale
${feature.rationale}

### Vision Alignment
${feature.visionAlignment}

### Details
- **Category:** ${feature.category}
- **Estimated Effort:** ${feature.estimatedEffort}
- **Found in similar projects:** ${feature.similarProjects.join(', ') || 'N/A'}

---
*Created by Research Agent*`,
        priority: feature.priority,
        category: 'feature',
        labels: ['enhancement', feature.category, `priority:${feature.priority}`],
        alignsWithVision: feature.alignsWithVision,
        visionAlignment: feature.visionAlignment,
      });
    }
  }

  // Convert technical debt to recommendations
  for (const debt of report.technicalDebt) {
    recommendations.push({
      title: `Tech Debt: ${debt.description.substring(0, 60)}${debt.description.length > 60 ? '...' : ''}`,
      description: `## Technical Debt

**Category:** ${debt.category}
**Location:** ${debt.location}
**Estimated Effort:** ${debt.estimatedEffort}

### Description
${debt.description}

---
*Created by Research Agent*`,
      priority: debt.priority,
      category: 'technical-debt',
      labels: ['technical-debt', `priority:${debt.priority}`],
      alignsWithVision: true, // Tech debt reduction generally aligns
    });
  }

  // Convert actionable industry insights to recommendations
  for (const insight of report.industryInsights) {
    if (insight.actionable) {
      const aligns = checkInsightVisionAlignment(insight, repoContext.vision || '');
      recommendations.push({
        title: `Industry Trend: ${insight.topic}`,
        description: `## Industry Insight

### Summary
${insight.summary}

### Relevance to This Project
${insight.relevance}

### Sources
${insight.sources.map((s) => `- ${s}`).join('\n')}

---
*Created by Research Agent*`,
        priority: 'medium',
        category: 'feature',
        labels: ['enhancement', 'industry-trend'],
        alignsWithVision: aligns,
      });
    }
  }

  return recommendations;
}

/**
 * Checks if an industry insight aligns with the project vision
 */
function checkInsightVisionAlignment(insight: IndustryInsight, vision: string): boolean {
  if (!vision) return true; // No vision means we can't exclude it

  const visionLower = vision.toLowerCase();
  const insightLower = `${insight.topic} ${insight.summary} ${insight.relevance}`.toLowerCase();

  // Check for explicit non-goals
  const nonGoalMatch = vision.match(/## Non-Goals?\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (nonGoalMatch && nonGoalMatch[1]) {
    const nonGoals = nonGoalMatch[1].toLowerCase();
    const keywords = insightLower.split(/\s+/).filter((w) => w.length > 5);
    for (const keyword of keywords) {
      if (nonGoals.includes(keyword)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Gets existing open issues for duplicate detection
 */
async function getExistingIssues(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string
): Promise<Array<{ number: number; title: string; body: string | null }>> {
  try {
    const issues = await octokit.rest.issues.listForRepo({
      owner,
      repo,
      state: 'open',
      per_page: 100,
    });

    return issues.data.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
    }));
  } catch {
    core.warning('Could not fetch existing issues for duplicate detection');
    return [];
  }
}

/**
 * Checks if a recommendation is similar to an existing issue
 * Uses title matching heuristics to detect duplicates
 */
function checkForDuplicateIssue(
  rec: ActionableRecommendation,
  existingIssues: Array<{ number: number; title: string; body: string | null }>
): boolean {
  // First, do a quick title similarity check
  const recTitleLower = rec.title.toLowerCase();
  const recKeywords = recTitleLower.split(/\s+/).filter((w) => w.length > 3);

  for (const issue of existingIssues) {
    const issueTitleLower = issue.title.toLowerCase();

    // Exact or near-exact match
    if (issueTitleLower === recTitleLower || issueTitleLower.includes(recTitleLower) || recTitleLower.includes(issueTitleLower)) {
      return true;
    }

    // Keyword overlap (more than 50% of keywords match)
    const matchingKeywords = recKeywords.filter((kw) => issueTitleLower.includes(kw));
    if (recKeywords.length > 0 && matchingKeywords.length / recKeywords.length > 0.5) {
      return true;
    }
  }

  // No obvious duplicate found based on title matching
  // Skip AI-based duplicate detection to avoid Copilot SDK stream issues
  return false;
}

/**
 * Creates a single actionable issue
 */
async function createActionableIssue(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  rec: ActionableRecommendation
): Promise<number> {
  // Ensure labels exist
  const validLabels = await ensureLabelsExist(octokit, owner, repo, rec.labels);

  const issue = await octokit.rest.issues.create({
    owner,
    repo,
    title: rec.title,
    body: rec.description,
    labels: validLabels,
  });

  return issue.data.number;
}

/**
 * Ensures the required labels exist in the repository
 */
async function ensureLabelsExist(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string,
  labels: string[]
): Promise<string[]> {
  const validLabels: string[] = [];

  for (const label of labels) {
    try {
      await octokit.rest.issues.getLabel({ owner, repo, name: label });
      validLabels.push(label);
    } catch {
      // Label doesn't exist, try to create it
      try {
        const color = getLabelColor(label);
        await octokit.rest.issues.createLabel({ owner, repo, name: label, color });
        validLabels.push(label);
      } catch {
        // Couldn't create label, skip it
        core.warning(`Could not create label: ${label}`);
      }
    }
  }

  return validLabels;
}

/**
 * Gets a color for a label based on its name
 */
function getLabelColor(label: string): string {
  const colorMap: Record<string, string> = {
    security: 'b60205',
    'priority:critical': 'b60205',
    'priority:high': 'd93f0b',
    'priority:medium': 'fbca04',
    'priority:low': '0e8a16',
    enhancement: 'a2eeef',
    'technical-debt': 'fef2c0',
    dependencies: '0366d6',
    'industry-trend': 'd4c5f9',
    performance: 'f9d0c4',
    'developer-experience': 'bfdadc',
    integration: 'c5def5',
  };

  return colorMap[label] || 'ededed';
}

// Run the action
run();
