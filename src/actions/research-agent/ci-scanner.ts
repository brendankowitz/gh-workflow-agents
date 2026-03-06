/**
 * CI Health Scanner
 *
 * Checks recent GitHub Actions workflow runs for the repository and
 * reports any workflows that are currently failing on the default branch.
 */

import * as core from '@actions/core';
import type { createOctokit } from '../../sdk/index.js';
import type { CiFailure } from '../../shared/types.js';

/** How many recent runs to inspect per workflow */
const RUNS_TO_CHECK = 5;

/** Conclusions that count as a failure */
const FAILURE_CONCLUSIONS = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure']);

/** Workflows whose failures we ignore (they're expected or agent-internal) */
const IGNORED_WORKFLOW_NAMES = new Set([
  'CodeQL',
  'Dependabot',
]);

export interface CiHealthResult {
  failures: CiFailure[];
  summary: string;
}

/**
 * Lists all repo workflows, checks recent runs on the default branch,
 * and returns any that are currently failing.
 */
export async function scanCiHealth(
  octokit: ReturnType<typeof createOctokit>,
  owner: string,
  repo: string
): Promise<CiHealthResult> {
  const failures: CiFailure[] = [];

  // Get the default branch
  let defaultBranch = 'main';
  try {
    const { data: repoData } = await octokit.rest.repos.get({ owner, repo });
    defaultBranch = repoData.default_branch;
  } catch {
    core.debug('ci-scanner: could not fetch default branch, defaulting to main');
  }

  // List all workflows
  let workflows: Array<{ id: number; name: string; state: string }> = [];
  try {
    const { data } = await octokit.rest.actions.listRepoWorkflows({ owner, repo, per_page: 100 });
    workflows = data.workflows.filter(w => w.state === 'active');
  } catch (err) {
    core.warning(`ci-scanner: could not list workflows — ${err instanceof Error ? err.message : String(err)}`);
    return { failures: [], summary: 'Could not fetch workflow list.' };
  }

  core.info(`ci-scanner: checking ${workflows.length} active workflow(s) on branch '${defaultBranch}'`);

  for (const workflow of workflows) {
    if (IGNORED_WORKFLOW_NAMES.has(workflow.name)) continue;

    try {
      const { data: runsData } = await octokit.rest.actions.listWorkflowRuns({
        owner,
        repo,
        workflow_id: workflow.id,
        branch: defaultBranch,
        per_page: RUNS_TO_CHECK,
        // Only completed runs — in-progress runs are not failures yet
        status: 'completed',
      });

      const runs = runsData.workflow_runs;
      if (runs.length === 0) continue;

      const latest = runs[0]!;
      const conclusion = latest.conclusion ?? '';

      if (!FAILURE_CONCLUSIONS.has(conclusion)) continue;

      // Count consecutive failures from the head of the list
      let consecutive = 0;
      for (const run of runs) {
        if (FAILURE_CONCLUSIONS.has(run.conclusion ?? '')) {
          consecutive++;
        } else {
          break;
        }
      }

      failures.push({
        workflowName: workflow.name,
        workflowId: workflow.id,
        branch: defaultBranch,
        lastRunStatus: latest.status ?? 'completed',
        lastRunConclusion: conclusion,
        lastRunAt: latest.updated_at,
        lastRunUrl: latest.html_url,
        consecutiveFailures: consecutive,
      });

      core.info(`ci-scanner: '${workflow.name}' is failing (${consecutive} consecutive failure(s))`);
    } catch (err) {
      core.debug(`ci-scanner: skipping workflow '${workflow.name}' — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const summary =
    failures.length === 0
      ? 'All CI workflows are passing.'
      : `${failures.length} workflow(s) are currently failing on '${defaultBranch}': ${failures.map(f => `'${f.workflowName}' (${f.consecutiveFailures} run(s))`).join(', ')}.`;

  return { failures, summary };
}
