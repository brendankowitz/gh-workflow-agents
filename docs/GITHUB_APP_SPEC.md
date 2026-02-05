# GitHub App Specification for GH-Agency

## Problem Statement

Currently, all GH-Agency agents run as `github-actions[bot]` using the `GITHUB_TOKEN` provided by GitHub Actions. This creates limitations:

1. **Self-approval blocked**: The review agent cannot APPROVE PRs created by the coding agent (same identity)
2. **Rate limits shared**: All workflows share the same rate limit pool
3. **No persistent identity**: Can't track which agent performed which action
4. **Limited permissions**: `GITHUB_TOKEN` permissions are workflow-scoped

## Proposed Solution

Create a dedicated **GitHub App** (`gh-agency-bot`) that provides distinct identities for different agent roles.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GitHub App: gh-agency                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Installation provides:                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ App ID      │  │ Private Key │  │ Install ID  │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│  Generates Installation Access Tokens for:                  │
│  ┌──────────────────────────────────────────────┐          │
│  │ gh-agency[bot] - Single bot identity          │          │
│  │ Can approve PRs created by github-actions     │          │
│  └──────────────────────────────────────────────┘          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## GitHub App Configuration

### Basic Information

| Field | Value |
|-------|-------|
| **App Name** | `gh-agency` |
| **Description** | AI-powered GitHub workflow agents for triage, review, research, and coding |
| **Homepage URL** | `https://github.com/brendankowitz/gh-workflow-agents` |
| **Webhook** | Disabled (not needed for this use case) |

### Permissions Required

#### Repository Permissions

| Permission | Access | Reason |
|------------|--------|--------|
| **Contents** | Read & Write | Create branches, commit code |
| **Issues** | Read & Write | Triage, label, comment on issues |
| **Pull requests** | Read & Write | Create PRs, post reviews, approve/request changes |
| **Metadata** | Read | Required for all apps |
| **Workflows** | Read | Check workflow status |

#### Organization Permissions

| Permission | Access | Reason |
|------------|--------|--------|
| **Members** | Read | (Optional) Check team membership for assignments |

### Installation Settings

- **Only on this account**: Start with single-account installation
- **Any account**: Enable later for public distribution

## Implementation

### 1. Secrets Configuration

Add these secrets to repositories using GH-Agency:

```yaml
# Required secrets
GH_AGENCY_APP_ID: "123456"           # GitHub App ID
GH_AGENCY_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----..."  # PEM format
GH_AGENCY_INSTALLATION_ID: "12345678" # Installation ID for this repo
```

### 2. Token Generation

Create a utility function to generate installation access tokens:

```typescript
// src/sdk/github-app.ts

import { createAppAuth } from '@octokit/auth-app';
import { Octokit } from '@octokit/rest';

interface AppCredentials {
  appId: string;
  privateKey: string;
  installationId: string;
}

/**
 * Creates an Octokit instance authenticated as the GitHub App installation
 */
export async function createAppOctokit(credentials: AppCredentials): Promise<Octokit> {
  const auth = createAppAuth({
    appId: credentials.appId,
    privateKey: credentials.privateKey,
    installationId: credentials.installationId,
  });

  const installationAuth = await auth({ type: 'installation' });

  return new Octokit({
    auth: installationAuth.token,
  });
}

/**
 * Gets app credentials from environment/inputs
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
```

### 3. Agent Updates

Update agents to prefer App authentication when available:

```typescript
// In each agent's index.ts

import { createAppOctokit, getAppCredentials, hasAppAuth } from '../../sdk/github-app.js';

// Prefer GitHub App auth, fall back to GITHUB_TOKEN
let octokit: Octokit;
if (hasAppAuth()) {
  const credentials = getAppCredentials()!;
  octokit = await createAppOctokit(credentials);
  core.info('Authenticated as gh-agency[bot]');
} else {
  octokit = createOctokit(config.githubToken);
  core.info('Authenticated as github-actions[bot]');
}
```

### 4. Workflow Updates

Update example workflows to use App credentials:

```yaml
# examples/ai-review.yml

- name: AI Review Agent
  uses: brendankowitz/gh-workflow-agents/actions/review-agent@main
  env:
    GH_AGENCY_APP_ID: ${{ secrets.GH_AGENCY_APP_ID }}
    GH_AGENCY_PRIVATE_KEY: ${{ secrets.GH_AGENCY_PRIVATE_KEY }}
    GH_AGENCY_INSTALLATION_ID: ${{ secrets.GH_AGENCY_INSTALLATION_ID }}
    COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}  # Fallback
    copilot-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
```

## Benefits

### 1. Self-Approval Works
```
Coding Agent (github-actions[bot]) creates PR
    ↓
Review Agent (gh-agency[bot]) can APPROVE
    ↓
PR shows green checkmark from bot review
```

### 2. Clear Attribution
```
Issue #42 triaged by gh-agency[bot]
PR #43 created by github-actions[bot]
PR #43 approved by gh-agency[bot]
```

### 3. Separate Rate Limits
- GitHub App has its own rate limit (5000 requests/hour per installation)
- Doesn't compete with other workflow actions

### 4. Granular Permissions
- App permissions are explicit and auditable
- Can be restricted per-repository

## Security Considerations

### Private Key Storage
- Store private key as a **repository secret** or **organization secret**
- Never commit to repository
- Rotate periodically (recommended: every 90 days)

### Minimal Permissions
- Only request permissions actually needed
- Review and reduce permissions over time

### Installation Scope
- Start with single-repository installation
- Expand to organization-wide only if needed

### Audit Trail
- All actions by the App are logged by GitHub
- App identity makes it clear which actions were automated

## Migration Path

### Phase 1: Create App (Manual)
1. Go to GitHub Settings → Developer Settings → GitHub Apps
2. Create new app with permissions above
3. Generate private key
4. Install on target repositories
5. Note App ID and Installation ID

### Phase 2: Add Secrets
```bash
# For each repository
gh secret set GH_AGENCY_APP_ID --body "123456"
gh secret set GH_AGENCY_PRIVATE_KEY < private-key.pem
gh secret set GH_AGENCY_INSTALLATION_ID --body "12345678"
```

### Phase 3: Update Code
1. Add `@octokit/auth-app` dependency
2. Implement `github-app.ts` utility
3. Update agents to use App auth when available
4. Update example workflows

### Phase 4: Test
1. Run review agent on bot-created PR
2. Verify APPROVE works
3. Verify all agent functions work with new identity

## Alternative: Hybrid Approach

If you want different identities per agent role, create multiple GitHub Apps:

| App | Used By | Identity |
|-----|---------|----------|
| `gh-agency-coder` | Coding Agent | `gh-agency-coder[bot]` |
| `gh-agency-reviewer` | Review Agent | `gh-agency-reviewer[bot]` |
| `gh-agency-triage` | Triage Agent | `gh-agency-triage[bot]` |

This provides maximum separation but requires more setup and secrets management.

## Recommendation

**Start with a single `gh-agency` app** for simplicity. The main goal (review agent can approve coding agent's PRs) is achieved with one app. Split into multiple apps later only if there's a strong need for separate identities.

## Dependencies to Add

```json
{
  "dependencies": {
    "@octokit/auth-app": "^6.0.0"
  }
}
```

## References

- [GitHub Apps Documentation](https://docs.github.com/en/developers/apps/getting-started-with-apps/about-apps)
- [Creating a GitHub App](https://docs.github.com/en/developers/apps/building-github-apps/creating-a-github-app)
- [Authenticating as a GitHub App Installation](https://docs.github.com/en/developers/apps/building-github-apps/authenticating-as-a-github-app-installation)
- [@octokit/auth-app](https://github.com/octokit/auth-app.js)
