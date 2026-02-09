# Example Workflows

This directory contains example workflow configurations for GH-Agency agents.

## Available Examples

| Workflow | Description |
|----------|-------------|
| [`ai-triage.yml`](ai-triage.yml) | Issue classification, routing to coding or research agents |
| [`ai-triage-with-assignment.yml`](ai-triage-with-assignment.yml) | Triage with automatic assignment (simpler, no chaining) |
| [`ai-coding.yml`](ai-coding.yml) | Autonomous code implementation from issues and PR feedback |
| [`ai-review.yml`](ai-review.yml) | AI-powered code review with auto-merge |
| [`ai-research.yml`](ai-research.yml) | Weekly codebase health monitoring and issue-focused research |
| [`ai-consumer.yml`](ai-consumer.yml) | Consumer-driven contract testing |
| [`stale-issue-cleanup.yml`](stale-issue-cleanup.yml) | Daily cleanup of stale agent issues |

## Full Autonomous Pipeline

For a self-maintaining repository, install all four core workflows:

1. **`ai-triage.yml`** — Routes new issues to coding or research agents
2. **`ai-coding.yml`** — Implements code changes, creates PRs, chains to review
3. **`ai-review.yml`** — Reviews PRs, approves/merges or requests changes
4. **`ai-research.yml`** — Scheduled health monitoring, creates issues for triage

## Prerequisites

Before installing the workflows, enable these settings on your GitHub repository:

1. **Allow auto-merge** — Required for the review agent to merge approved PRs automatically.
   Settings → General → Pull Requests → ✅ *Allow auto-merge*

2. **Automatically delete head branches** — Keeps the repo clean after PRs are merged.
   Settings → General → Pull Requests → ✅ *Automatically delete head branches*

## Required Secrets

| Secret | Required By | Description |
|--------|-------------|-------------|
| `COPILOT_GITHUB_TOKEN` | All agents | GitHub PAT with "Copilot Requests: Read" permission |
| `GH_AGENCY_APP_ID` | Coding agent | GitHub App ID (for workflow file pushes and separate bot identity) |
| `GH_AGENCY_PRIVATE_KEY` | Coding agent | GitHub App private key |

> **Note**: `GITHUB_TOKEN` is provided automatically by GitHub Actions — no secret needed.

### GitHub App Setup (Optional but Recommended)

A GitHub App allows the coding agent to push `.github/workflows/` files and gives the review agent a separate identity for approvals. Without it, workflow file changes will be posted as issue comments for manual application.

1. Create a GitHub App with **Contents: Write** and **Workflows: Write** permissions
2. Install it on the target repository
3. Add `GH_AGENCY_APP_ID` and `GH_AGENCY_PRIVATE_KEY` as repository secrets

## Installation

Copy the desired workflow files to your repository's `.github/workflows/` directory.

## Configuration

Each workflow can be customized through inputs. See the [README](../README.md) for full configuration options.
