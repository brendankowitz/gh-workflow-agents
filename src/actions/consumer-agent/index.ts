/**
 * GH-Agency Consumer Agent
 * Consumer-driven contract testing for downstream repositories
 *
 * This agent reacts to upstream releases and validates that
 * downstream consumers still work correctly.
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  checkCircuitBreaker,
  createCircuitBreakerContext,
  parseDispatchDepth,
  createDispatchPayload,
  DEFAULT_MODEL,
  type ConsumerTestResult,
} from '../../shared/index.js';
import {
  createOctokit,
  dispatchRepositoryEvent,
} from '../../sdk/index.js';

/** Consumer agent configuration */
interface ConsumerConfig {
  githubToken: string;
  upstreamVersion: string;
  dispatchDepth: number;
  testCommand: string;
  upstreamOwner: string;
  upstreamRepo: string;
}

/**
 * Main entry point for the consumer agent
 */
export async function run(): Promise<void> {
  try {
    const config = getConfig();

    // Initialize circuit breaker with dispatch depth
    const circuitBreaker = createCircuitBreakerContext(config.dispatchDepth);
    checkCircuitBreaker(circuitBreaker);

    core.info(`Testing against upstream version: ${config.upstreamVersion}`);

    // Run tests
    const result = await runConsumerTests(config);

    // Output results
    core.setOutput('success', result.success);
    core.setOutput('tests-run', result.testsRun);
    core.setOutput('tests-passed', result.testsPassed);
    core.setOutput('tests-failed', result.testsFailed);
    core.setOutput('compatibility-breaking', result.compatibilityBreaking);

    if (!result.success) {
      // Report failure to upstream
      if (config.upstreamOwner && config.upstreamRepo) {
        await reportFailureToUpstream(config, result);
      }

      if (result.compatibilityBreaking) {
        core.setFailed(`Breaking change detected in upstream version ${config.upstreamVersion}`);
      } else {
        core.warning(`Tests failed but may not be related to upstream changes`);
      }
    } else {
      core.info(`All ${result.testsPassed} tests passed!`);
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('An unknown error occurred');
    }
  }
}

/**
 * Gets configuration from action inputs and event payload
 */
function getConfig(): ConsumerConfig {
  const payload = github.context.payload.client_payload as Record<string, unknown> | undefined;

  return {
    githubToken: core.getInput('github-token', { required: true }),
    upstreamVersion: core.getInput('upstream-version') || String(payload?.['version'] || 'unknown'),
    dispatchDepth: parseDispatchDepth(payload),
    testCommand: core.getInput('test-command') || 'npm test',
    upstreamOwner: core.getInput('upstream-owner') || '',
    upstreamRepo: core.getInput('upstream-repo') || '',
  };
}

/**
 * Runs consumer tests
 */
async function runConsumerTests(config: ConsumerConfig): Promise<ConsumerTestResult> {
  // This would run the actual test command and parse results
  // For now, we return a placeholder indicating test execution
  
  core.info(`Would run: ${config.testCommand}`);

  // Placeholder result
  return {
    upstreamVersion: config.upstreamVersion,
    success: true,
    testsRun: 0,
    testsPassed: 0,
    testsFailed: 0,
    failures: [],
    compatibilityBreaking: false,
  };
}

/**
 * Reports test failure to upstream repository
 */
async function reportFailureToUpstream(
  config: ConsumerConfig,
  result: ConsumerTestResult
): Promise<void> {
  const octokit = createOctokit(config.githubToken);

  const payload = createDispatchPayload(
    createCircuitBreakerContext(config.dispatchDepth),
    {
      consumer_repo: `${github.context.repo.owner}/${github.context.repo.repo}`,
      version: config.upstreamVersion,
      tests_failed: result.testsFailed,
      compatibility_breaking: result.compatibilityBreaking,
      failures: result.failures.slice(0, 5), // Limit failures in payload
    }
  );

  await dispatchRepositoryEvent(
    octokit,
    config.upstreamOwner,
    config.upstreamRepo,
    'consumer-test-failure',
    payload
  );

  core.info(`Reported failure to ${config.upstreamOwner}/${config.upstreamRepo}`);
}

// Run the action
run();
