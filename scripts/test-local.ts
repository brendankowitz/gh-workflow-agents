#!/usr/bin/env npx ts-node
/**
 * Local testing script for GH-Agency agents
 *
 * Usage:
 *   npx ts-node scripts/test-local.ts triage
 *   npx ts-node scripts/test-local.ts review
 *   npx ts-node scripts/test-local.ts research
 *
 * Required environment variables:
 *   GITHUB_TOKEN - GitHub PAT for API access
 *   COPILOT_GITHUB_TOKEN - GitHub PAT with Copilot Requests permission
 */

import * as core from '@actions/core';

// Mock @actions/core inputs
const mockInputs: Record<string, string> = {
  'github-token': process.env.GITHUB_TOKEN || '',
  'copilot-token': process.env.COPILOT_GITHUB_TOKEN || '',
  'model': 'claude-sonnet-4.5',
  'dry-run': 'true',  // Always dry-run for local testing
  'enable-duplicate-detection': 'true',
  'enable-auto-label': 'true',
  'security-focus': 'true',
  'auto-approve-dependabot': 'false',
  'mode': 'analyze-only',
  'output-type': 'artifact',
  'focus-areas': 'dependencies,security',
};

// Mock core.getInput
const originalGetInput = core.getInput;
(core as any).getInput = (name: string, options?: core.InputOptions) => {
  const value = mockInputs[name];
  if (options?.required && !value) {
    throw new Error(`Input required and not supplied: ${name}`);
  }
  return value || '';
};

// Mock core.getBooleanInput
(core as any).getBooleanInput = (name: string) => {
  const value = mockInputs[name];
  return value === 'true';
};

// Mock GitHub context
const mockContext = {
  repo: {
    owner: process.env.TEST_OWNER || 'brendankowitz',
    repo: process.env.TEST_REPO || 'gh-workflow-agents',
  },
  actor: 'test-user',
  payload: {
    issue: {
      number: parseInt(process.env.TEST_ISSUE || '1'),
      title: process.env.TEST_TITLE || 'Test issue for local development',
      body: process.env.TEST_BODY || `
## Description
This is a test issue for local development of the GH-Agency triage agent.

## Expected Behavior
The agent should classify this as a feature request.

## Steps to Reproduce
1. Run the local test script
2. Observe the classification output
      `.trim(),
    },
    pull_request: {
      number: parseInt(process.env.TEST_PR || '1'),
      title: 'Test PR',
      body: 'Test PR body',
    },
    action: 'opened',
  },
};

// Mock @actions/github
jest.mock('@actions/github', () => ({
  context: mockContext,
  getOctokit: () => {
    throw new Error('Use createOctokit from sdk instead');
  },
}), { virtual: true });

async function main() {
  const agent = process.argv[2] || 'triage';

  console.log('='.repeat(60));
  console.log(`Testing ${agent} agent locally`);
  console.log('='.repeat(60));
  console.log(`Owner: ${mockContext.repo.owner}`);
  console.log(`Repo: ${mockContext.repo.repo}`);
  console.log(`Dry Run: ${mockInputs['dry-run']}`);
  console.log('='.repeat(60));

  if (!process.env.GITHUB_TOKEN) {
    console.error('ERROR: GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }

  if (!process.env.COPILOT_GITHUB_TOKEN) {
    console.warn('WARNING: COPILOT_GITHUB_TOKEN not set - AI features will fail');
  }

  try {
    switch (agent) {
      case 'triage':
        console.log('\nTest Issue:');
        console.log(`  Title: ${mockContext.payload.issue?.title}`);
        console.log(`  Body: ${mockContext.payload.issue?.body?.substring(0, 100)}...`);
        console.log('\nRunning triage agent...\n');

        // Dynamic import to allow mocks to be set up first
        const { run: runTriage } = await import('../src/actions/triage-agent/index.js');
        await runTriage();
        break;

      case 'review':
        console.log('\nTest PR:');
        console.log(`  Number: ${mockContext.payload.pull_request?.number}`);
        console.log('\nRunning review agent...\n');

        const { run: runReview } = await import('../src/actions/review-agent/index.js');
        await runReview();
        break;

      case 'research':
        console.log('\nRunning research agent...\n');

        const { run: runResearch } = await import('../src/actions/research-agent/index.js');
        await runResearch();
        break;

      default:
        console.error(`Unknown agent: ${agent}`);
        console.log('Available agents: triage, review, research');
        process.exit(1);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Test completed successfully');
    console.log('='.repeat(60));
  } catch (error) {
    console.error('\nTest failed:', error);
    process.exit(1);
  }
}

main();
