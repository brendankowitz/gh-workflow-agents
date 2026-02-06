# Example Workflows

This directory contains example workflow configurations for GH-Agency agents.

## Available Examples

- [`ai-triage.yml`](ai-triage.yml) - Automatic issue classification and triage
- [`ai-coding.yml`](ai-coding.yml) - Autonomous code implementation from issues and PR feedback
- [`ai-review.yml`](ai-review.yml) - AI-powered code review for pull requests
- [`ai-research.yml`](ai-research.yml) - Weekly codebase health monitoring
- [`ai-consumer.yml`](ai-consumer.yml) - Consumer-driven contract testing

## Prerequisites

Before installing the workflows, enable these settings on your GitHub repository:

1. **Allow auto-merge** — Required for the review agent to merge approved PRs automatically.
   Settings → General → Pull Requests → ✅ *Allow auto-merge*

2. **Automatically delete head branches** — Keeps the repo clean after PRs are merged.
   Settings → General → Pull Requests → ✅ *Automatically delete head branches*

## Installation

Copy the desired workflow files to your repository's `.github/workflows/` directory.

## Configuration

Each workflow can be customized through inputs. See the [README](../README.md) for full configuration options.
