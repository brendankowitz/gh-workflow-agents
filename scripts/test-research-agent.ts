#!/usr/bin/env npx tsx
/**
 * Test the Research Agent against a specific repository
 *
 * Usage:
 *   npx tsx scripts/test-research-agent.ts [owner/repo]
 *
 * Example:
 *   npx tsx scripts/test-research-agent.ts brendankowitz/FHIR-Tools-for-Anonymization
 */

import { config } from 'dotenv';
config(); // Load .env file

import { Octokit } from '@octokit/rest';

// Check for required tokens
if (!process.env.COPILOT_GITHUB_TOKEN) {
  console.error('ERROR: COPILOT_GITHUB_TOKEN is required in .env file');
  process.exit(1);
}

// Use COPILOT_GITHUB_TOKEN for both GitHub API and Copilot SDK
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.COPILOT_GITHUB_TOKEN;

// Parse repo argument
const repoArg = process.argv[2] || 'brendankowitz/FHIR-Tools-for-Anonymization';
const [owner, repo] = repoArg.split('/');

if (!owner || !repo) {
  console.error('ERROR: Invalid repo format. Use owner/repo');
  process.exit(1);
}

console.log('='.repeat(60));
console.log('Research Agent Test');
console.log('='.repeat(60));
console.log(`Repository: ${owner}/${repo}`);
console.log('='.repeat(60));

async function loadRepositoryContext(octokit: Octokit, owner: string, repo: string) {
  console.log('\nLoading repository context...');

  const context: {
    owner: string;
    name: string;
    vision?: string;
    readme?: string;
    goals?: string;
  } = { owner, name: repo };

  // Try to load VISION.md
  try {
    const visionResponse = await octokit.rest.repos.getContent({
      owner, repo, path: 'VISION.md',
    });
    if ('content' in visionResponse.data) {
      context.vision = Buffer.from(visionResponse.data.content, 'base64').toString('utf-8');
      console.log('  ✓ VISION.md loaded');
    }
  } catch {
    console.log('  - VISION.md not found');
  }

  // Try to load goals.md
  try {
    const goalsResponse = await octokit.rest.repos.getContent({
      owner, repo, path: 'goals.md',
    });
    if ('content' in goalsResponse.data) {
      context.goals = Buffer.from(goalsResponse.data.content, 'base64').toString('utf-8');
      console.log('  ✓ goals.md loaded');
    }
  } catch {
    console.log('  - goals.md not found');
  }

  // Try to load README.md
  try {
    const readmeResponse = await octokit.rest.repos.getReadme({ owner, repo });
    if ('content' in readmeResponse.data) {
      context.readme = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
      console.log('  ✓ README.md loaded');
    }
  } catch {
    console.log('  - README.md not found');
  }

  return context;
}

async function getSecurityAdvisories(octokit: Octokit, owner: string, repo: string) {
  console.log('\nChecking security advisories...');
  try {
    const advisories = await octokit.rest.dependabot.listAlertsForRepo({
      owner, repo, state: 'open', per_page: 10,
    });
    console.log(`  Found ${advisories.data.length} open Dependabot alerts`);
    return advisories.data;
  } catch (error: any) {
    if (error.status === 403) {
      console.log('  - Dependabot alerts not accessible (may need additional permissions)');
    } else {
      console.log(`  - Error fetching alerts: ${error.message}`);
    }
    return [];
  }
}

async function getRepositoryInfo(octokit: Octokit, owner: string, repo: string) {
  console.log('\nFetching repository info...');
  const repoInfo = await octokit.rest.repos.get({ owner, repo });
  const topics = await octokit.rest.repos.getAllTopics({ owner, repo });

  console.log(`  Description: ${repoInfo.data.description || '(none)'}`);
  console.log(`  Topics: ${topics.data.names?.join(', ') || '(none)'}`);
  console.log(`  Stars: ${repoInfo.data.stargazers_count}`);
  console.log(`  Open Issues: ${repoInfo.data.open_issues_count}`);
  console.log(`  Language: ${repoInfo.data.language}`);

  return { repoInfo: repoInfo.data, topics: topics.data.names || [] };
}

async function analyzeWithCopilot(context: any, repoInfo: any, topics: string[]) {
  console.log('\nAnalyzing with Copilot SDK...');

  const { CopilotClient } = await import('@github/copilot-sdk');
  const { parseAgentResponse } = await import('../src/sdk/copilot-client.js');

  const prompt = `You are analyzing the GitHub repository "${context.owner}/${context.name}".

Repository Info:
- Language: ${repoInfo.language}
- Description: ${repoInfo.description || 'No description'}
- Stars: ${repoInfo.stargazers_count}

Analyze this repository and respond with JSON containing:
- observations: array of 3-5 key observations about the project
- improvements: array of 3-5 areas for improvement
- industryTrends: array of objects with {topic, relevance, actionable} for 2-3 relevant trends
- recommendations: array of 5-8 prioritized recommendations (prefix with CRITICAL:, HIGH:, MEDIUM:, or LOW:)
- summary: one paragraph executive summary

Respond with valid JSON only, no markdown.`;

  const client = new CopilotClient();

  try {
    await client.start();
    console.log('  Client started');

    const session = await client.createSession({
      model: 'claude-sonnet-4.5',
    });
    console.log('  Session created:', session.sessionId);

    // Use sendAndWait like the working simple test
    console.log('  Sending prompt (waiting up to 2 minutes)...');
    const response = await session.sendAndWait({ prompt }, 120000);

    if (response?.data?.content) {
      console.log('  ✓ Response received, length:', response.data.content.length);

      await session.destroy();
      await client.stop();

      const parsed = parseAgentResponse<{
        observations: string[];
        improvements: string[];
        industryTrends: { topic: string; relevance: string; actionable: boolean }[];
        recommendations: string[];
        summary: string;
      }>(response.data.content);

      return parsed;
    } else {
      console.log('  ✗ No content in response');
      await session.destroy();
      await client.stop();
      return null;
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error instanceof Error ? error.message : String(error)}`);
    try {
      await client.stop();
    } catch {
      // Ignore cleanup errors
    }
    return null;
  }
}

async function checkExistingIssues(octokit: Octokit, owner: string, repo: string) {
  console.log('\nChecking existing issues...');
  try {
    const issues = await octokit.rest.issues.listForRepo({
      owner, repo, state: 'open', per_page: 50,
    });
    console.log(`  Found ${issues.data.length} open issues`);
    return issues.data.map(i => ({ number: i.number, title: i.title }));
  } catch {
    console.log('  - Could not fetch existing issues');
    return [];
  }
}

function extractActionableRecommendations(analysis: any, advisories: any[]) {
  const recommendations: Array<{
    title: string;
    priority: string;
    category: string;
    description: string;
  }> = [];

  // Add security advisories as recommendations
  for (const advisory of advisories) {
    recommendations.push({
      title: `Security: Update ${advisory.dependency?.package?.name || 'package'} (${advisory.security_vulnerability?.severity || 'unknown'} severity)`,
      priority: advisory.security_vulnerability?.severity === 'critical' ? 'critical' : 'high',
      category: 'security',
      description: advisory.security_advisory?.summary || 'Security vulnerability detected',
    });
  }

  // Add recommendations from analysis
  if (analysis?.recommendations) {
    for (const rec of analysis.recommendations) {
      // Parse priority from recommendation text
      let priority = 'medium';
      if (rec.toLowerCase().includes('critical')) priority = 'critical';
      else if (rec.toLowerCase().includes('high')) priority = 'high';
      else if (rec.toLowerCase().includes('low')) priority = 'low';

      // Parse category
      let category = 'enhancement';
      if (rec.toLowerCase().includes('security')) category = 'security';
      else if (rec.toLowerCase().includes('depend') || rec.toLowerCase().includes('upgrade')) category = 'dependencies';
      else if (rec.toLowerCase().includes('debt') || rec.toLowerCase().includes('refactor')) category = 'technical-debt';

      recommendations.push({
        title: rec.substring(0, 80) + (rec.length > 80 ? '...' : ''),
        priority,
        category,
        description: rec,
      });
    }
  }

  return recommendations;
}

async function main() {
  const octokit = new Octokit({ auth: GITHUB_TOKEN });

  try {
    // Load context
    const context = await loadRepositoryContext(octokit, owner, repo);

    // Get repo info
    const { repoInfo, topics } = await getRepositoryInfo(octokit, owner, repo);

    // Get security advisories
    const advisories = await getSecurityAdvisories(octokit, owner, repo);

    // Check existing issues
    const existingIssues = await checkExistingIssues(octokit, owner, repo);

    // Analyze with Copilot
    const analysis = await analyzeWithCopilot(context, repoInfo, topics);

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('RESEARCH REPORT');
    console.log('='.repeat(60));

    if (advisories.length > 0) {
      console.log('\n## Security Advisories');
      for (const advisory of advisories.slice(0, 5)) {
        console.log(`  - [${advisory.security_vulnerability?.severity || 'unknown'}] ${advisory.dependency?.package?.name}: ${advisory.security_advisory?.summary || 'No summary'}`);
      }
    }

    if (analysis) {
      console.log('\n## Executive Summary');
      console.log(`  ${analysis.summary}`);

      console.log('\n## Key Observations');
      for (const obs of analysis.observations || []) {
        console.log(`  - ${obs}`);
      }

      console.log('\n## Areas for Improvement');
      for (const imp of analysis.improvements || []) {
        console.log(`  - ${imp}`);
      }

      console.log('\n## Industry Trends');
      for (const trend of analysis.industryTrends || []) {
        console.log(`  - ${trend.topic}: ${trend.relevance}`);
      }

      console.log('\n## Recommendations');
      for (const rec of analysis.recommendations || []) {
        console.log(`  - ${rec}`);
      }

      // Show what issues WOULD be created
      console.log('\n' + '='.repeat(60));
      console.log('AUTONOMOUS ISSUE CREATION (DRY RUN)');
      console.log('='.repeat(60));

      const actionableRecs = extractActionableRecommendations(analysis, advisories);
      const highPriorityRecs = actionableRecs.filter(r => r.priority === 'high' || r.priority === 'critical');

      console.log(`\nFound ${actionableRecs.length} actionable recommendations`);
      console.log(`  - ${highPriorityRecs.length} meet high/critical priority threshold`);

      console.log('\n## Issues that would be created:');
      for (const rec of highPriorityRecs) {
        // Check for duplicate
        const isDuplicate = existingIssues.some(issue =>
          issue.title.toLowerCase().includes(rec.title.toLowerCase().substring(0, 30)) ||
          rec.title.toLowerCase().includes(issue.title.toLowerCase().substring(0, 30))
        );

        const status = isDuplicate ? '[SKIP - duplicate]' : '[WOULD CREATE]';
        console.log(`\n  ${status}`);
        console.log(`    Title: ${rec.title}`);
        console.log(`    Priority: ${rec.priority}`);
        console.log(`    Category: ${rec.category}`);
      }
    } else {
      console.log('\n(Copilot analysis unavailable)');
    }

    console.log('\n' + '='.repeat(60));
    console.log('Report complete');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  }
}

main();
