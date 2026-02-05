/**
 * GitHub App Authentication
 *
 * Provides authentication as a GitHub App installation, giving agents
 * a separate identity (e.g., "ignixa-bot[bot]") from github-actions[bot].
 *
 * This allows the review agent to APPROVE PRs created by the coding agent.
 */

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';

interface AppCredentials {
  appId: string;
  privateKey: string;
  installationId: string;
}

/**
 * Gets GitHub App credentials from environment variables
 *
 * Required env vars:
 * - GH_AGENCY_APP_ID: The GitHub App ID
 * - GH_AGENCY_PRIVATE_KEY: The private key (PEM format)
 * - GH_AGENCY_INSTALLATION_ID: The installation ID for this repo
 */
export function getAppCredentials(): AppCredentials | null {
  const appId = process.env.GH_AGENCY_APP_ID;
  const privateKey = process.env.GH_AGENCY_PRIVATE_KEY;
  const installationId = process.env.GH_AGENCY_INSTALLATION_ID;

  if (!appId || !privateKey || !installationId) {
    return null;
  }

  return { appId, privateKey, installationId };
}

/**
 * Checks if GitHub App authentication is available
 */
export function hasAppAuth(): boolean {
  return getAppCredentials() !== null;
}

/**
 * Creates an Octokit instance authenticated as the GitHub App installation
 *
 * @returns Octokit instance or null if credentials not available
 */
export async function createAppOctokit(): Promise<Octokit | null> {
  const credentials = getAppCredentials();

  if (!credentials) {
    return null;
  }

  try {
    const auth = createAppAuth({
      appId: credentials.appId,
      privateKey: credentials.privateKey,
      installationId: parseInt(credentials.installationId, 10),
    });

    const installationAuth = await auth({ type: 'installation' });

    core.info('Authenticated as GitHub App installation');

    return new Octokit({
      auth: installationAuth.token,
    });
  } catch (error) {
    core.warning(`Failed to authenticate as GitHub App: ${error instanceof Error ? error.message : error}`);
    return null;
  }
}

/**
 * Gets an Octokit instance, preferring GitHub App auth if available
 *
 * @param fallbackToken - Token to use if App auth not available (e.g., GITHUB_TOKEN)
 * @returns Octokit instance and whether it's using App auth
 */
export async function getOctokitWithAppFallback(
  fallbackToken: string
): Promise<{ octokit: Octokit; isAppAuth: boolean }> {
  // Try GitHub App auth first
  const appOctokit = await createAppOctokit();

  if (appOctokit) {
    return { octokit: appOctokit, isAppAuth: true };
  }

  // Fall back to provided token
  core.info('Using fallback token (GitHub App credentials not configured)');
  return {
    octokit: new Octokit({ auth: fallbackToken }),
    isAppAuth: false,
  };
}
