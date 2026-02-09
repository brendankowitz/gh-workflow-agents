<div align="center">
  <img src="docs/assets/gh-agency-logo.svg" alt="GH-Agency Logo" width="350"/>
  <h1>GH-Agency</h1>
  <p>
    <b>Reusable AI Workflow Agents for GitHub</b>
  </p>
  <p>
    <i>Automate product management, code review, research, and QA with intelligent agents</i>
  </p>

[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-2088FF?logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![AI Powered](https://img.shields.io/badge/AI_Powered-Claude_Sonnet_4.5-orange)](https://www.anthropic.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Defense_in_Depth-red)](docs/gh-agency.md#4-security-architecture)

</div>

---

> **Status:** Active Development. GH-Agency provides production-ready AI agents for GitHub automation with enterprise-grade security controls. Built with a security-first architecture to defend against prompt injection and ensure safe autonomous operation.

---

## ✨ Overview

**GH-Agency** is a suite of specialized AI agents packaged as reusable GitHub Actions. When installed on a repository, agents read `VISION.md` and `README.md` to understand their mission within their defined role, enabling any project to benefit from autonomous AI-driven workflows without building custom infrastructure.

### Key Design Principles

| Principle | Description |
|-----------|-------------|
| 🔄 **Reusable** | Install via standard GitHub Actions syntax with SHA-pinned references |
| 🎯 **Context-Aware** | Agents ground decisions in repository-specific vision and documentation |
| 🔒 **Secure by Default** | Defense-in-depth against prompt injection and privilege escalation |
| 👤 **Human-in-the-Loop** | All critical actions require human approval |

---

## 🤖 Agent Personas

### Product Manager Agent (Triage)

**Role**: Custodian of project vision and primary interface for user interaction.

- Issue triage and classification (bug, feature, question, spam)
- Duplicate detection via semantic search
- Vision alignment checking against `VISION.md`
- State management via GitHub Labels

```yaml
- uses: brendankowitz/gh-workflow-agents/actions/triage-agent@<sha>
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    model: claude-sonnet-4.5
```

### Review Engineer Agent

**Role**: Gatekeeper of code quality and security.

- Semantic code review with inline comments
- Security vulnerability detection
- Dependabot PR auto-triage and merge (patches only)
- Breaking change detection

```yaml
- uses: brendankowitz/gh-workflow-agents/actions/review-agent@<sha>
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    auto-approve-dependabot: 'true'
```

### Coding Agent

**Role**: Autonomous code implementation from issues and PR feedback.

- Implements features and bug fixes from triaged issues
- Responds to code review feedback with iterative changes
- Creates branches and pull requests automatically
- Supports `/agent` slash commands for on-demand coding tasks
- Graceful degradation: posts code as comments when push fails

```yaml
- uses: brendankowitz/gh-workflow-agents/actions/coding-agent@<sha>
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    copilot-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
    app-token: ${{ steps.app-token.outputs.token }}
    model: claude-sonnet-4.5
```

### Research Engineer Agent

**Role**: Proactive environmental scanning and codebase health monitoring.

- Dependency analysis and update impact assessment
- Technical debt identification
- Security advisory monitoring
- Weekly "State of the Code" reports
- Issue-focused research mode (triggered by triage agent)

```yaml
- uses: brendankowitz/gh-workflow-agents/actions/research-agent@<sha>
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    output-type: issue
```

### Consumer Agent (QA)

**Role**: Consumer-driven contract testing in downstream repositories.

- Integration test execution against new releases
- Regression detection and reporting
- Automatic issue creation in upstream repository on failure

```yaml
- uses: brendankowitz/gh-workflow-agents/actions/consumer-agent@<sha>
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    upstream-owner: owner
    upstream-repo: repo
```

---

## 🚀 Quick Start

### 0. Repository Settings

Enable these settings on your GitHub repository before installing the agent workflows:

| Setting | Path | Why |
|---------|------|-----|
| **Allow auto-merge** | Settings → General → Pull Requests | Lets the review agent merge approved PRs automatically |
| **Automatically delete head branches** | Settings → General → Pull Requests | Cleans up agent branches after merge |

### 1. Install the Triage Agent

Create `.github/workflows/ai-triage.yml`:

```yaml
name: AI Issue Triage
on:
  issues:
    types: [opened, edited]
  issue_comment:
    types: [created]
  workflow_dispatch:
    inputs:
      issue_number:
        description: 'Issue number to triage'
        required: true
        type: number

concurrency:
  group: ai-triage-${{ github.event.issue.number || github.event.inputs.issue_number }}
  cancel-in-progress: true

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      contents: read
      actions: write
    # Allow bot-created issues for autonomous pipelines, but skip dependabot
    if: |
      github.event_name == 'workflow_dispatch' || (
        github.actor != 'dependabot[bot]' &&
        !contains(github.event.comment.body || '', '/stop')
      )
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - uses: brendankowitz/gh-workflow-agents/actions/triage-agent@main
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_GITHUB_TOKEN }}
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          copilot-token: ${{ secrets.COPILOT_GITHUB_TOKEN }}
          issue-number: ${{ github.event.inputs.issue_number || '' }}
          model: claude-sonnet-4.5
```

### 2. Add Repository Context

Create `VISION.md` to guide agent decisions:

```markdown
# Project Vision

## Core Principles
1. Performance over feature density
2. Minimal dependencies
3. Security first

## Architectural Constraints
- All handlers must be registered via DI
- Maximum 300 lines per file

## Non-Goals
- GUI tooling
- Legacy runtime support
```

### 3. Pin to Commit SHAs (Recommended)

```yaml
# ❌ VULNERABLE — tags can be moved
- uses: brendankowitz/gh-workflow-agents/actions/triage-agent@v1

# ✅ SECURE — immutable reference
- uses: brendankowitz/gh-workflow-agents/actions/triage-agent@a1b2c3d4e5f6789...
```

---

## 🔒 Security Architecture

GH-Agency implements **defense in depth** with multiple security layers:

### Input Sanitization

All user content is sanitized before reaching the LLM:

```typescript
// Detected patterns include:
// - "ignore previous instructions"
// - "system prompt" references
// - "you are now" role overrides
// - Unicode/steganographic injection
```

### Prompt Architecture

System prompts establish clear trust boundaries:

```markdown
---BEGIN UNTRUSTED ISSUE CONTENT---
{sanitized_content}
---END UNTRUSTED ISSUE CONTENT---
```

### Tool Permission Restriction

Agents receive minimal tool access—read-only by default.

### Output Validation

All LLM outputs are validated against allowlists:

- Labels validated against permitted set
- Priorities validated against enum
- Shell metacharacters stripped
- Content length enforced

### Loop Prevention

Built-in circuit breaker prevents runaway agents:

- Maximum iteration limits (5)
- Dispatch depth tracking (3)
- Repetitive output detection
- Bot actor filtering

---

## 📦 Repository Structure

```
gh-workflow-agents/
├── actions/
│   ├── triage-agent/       # Issue classification & routing
│   ├── coding-agent/       # Autonomous code implementation
│   ├── review-agent/       # Code review & auto-merge
│   ├── research-agent/     # Health monitoring & research
│   └── consumer-agent/     # Contract testing
├── src/
│   ├── shared/             # Shared utilities
│   │   ├── sanitizer.ts    # Input sanitization
│   │   ├── output-validator.ts
│   │   ├── circuit-breaker.ts
│   │   ├── github-app.ts   # GitHub App token generation
│   │   └── types.ts
│   ├── sdk/                # SDK wrappers
│   │   ├── copilot-client.ts
│   │   ├── github-api.ts
│   │   └── context-loader.ts
│   └── actions/            # Agent implementations
├── examples/               # Example workflow files
└── docs/
    └── gh-agency.md        # Full specification
```

---

## 🛠️ Development

### Prerequisites

- Node.js 20+
- npm or pnpm

### Build

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Type check
npm run typecheck

# Bundle actions (REQUIRED after TypeScript changes)
# GitHub Actions runs compiled JS from actions/*/dist/, not TypeScript
node scripts/bundle-actions.js
```

### Local Testing

```bash
# Set required environment variables
export GITHUB_TOKEN=your_token
export GITHUB_REPOSITORY=owner/repo

# Run an agent
npx ts-node src/actions/triage-agent/index.ts
```

---

## 📋 Context Files

Agents automatically read these files to understand their mission:

| File | Purpose | Required |
|------|---------|----------|
| `VISION.md` | Project goals, principles, and constraints | Recommended |
| `README.md` | Project overview | Yes |
| `CONTRIBUTING.md` | Contribution guidelines | Recommended |
| `ROADMAP.md` | Feature priorities | Optional |
| `ARCHITECTURE.md` | Technical patterns | Optional |

---

## 🔧 Configuration

### Triage Agent

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | Required |
| `copilot-token` | GitHub PAT for Copilot SDK | Optional |
| `issue-number` | Issue number to triage (for `workflow_dispatch`) | — |
| `model` | AI model to use | `claude-sonnet-4.5` |
| `dry-run` | Only output analysis | `false` |
| `enable-duplicate-detection` | Search for duplicates | `true` |
| `enable-auto-label` | Auto-apply labels | `true` |

### Coding Agent

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | Required |
| `copilot-token` | GitHub PAT for Copilot SDK API calls | Required |
| `app-token` | GitHub App token for elevated operations (workflow file pushes) | Optional |
| `issue-number` | Issue number to implement (for `workflow_dispatch`) | — |
| `pr-number` | PR number for review feedback (for `workflow_dispatch`) | — |
| `model` | AI model to use | `claude-sonnet-4.5` |
| `max-iterations` | Maximum REPL iterations | `5` |
| `dry-run` | Plan only without executing changes | `false` |

### Review Agent

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | Required |
| `copilot-token` | GitHub PAT for Copilot SDK | Optional |
| `pr-number` | PR number to review (for `workflow_dispatch`) | — |
| `model` | AI model to use | `claude-sonnet-4.5` |
| `mode` | `analyze-only` or `full` | `full` |
| `auto-approve-dependabot` | Auto-approve Dependabot patches | `true` |
| `security-focus` | Prioritize security analysis | `true` |
| `auto-merge` | Auto-merge agent-coded PRs after approval | `true` |

### Research Agent

| Input | Description | Default |
|-------|-------------|---------|
| `github-token` | GitHub token for API access | Required |
| `copilot-token` | GitHub PAT for Copilot SDK | Optional |
| `model` | AI model to use | `claude-sonnet-4.5` |
| `output-type` | `issue`, `wiki`, or `artifact` | `issue` |
| `focus-areas` | Areas to analyze | `dependencies,security,technical-debt,industry-research` |
| `create-actionable-issues` | Auto-create issues for recommendations | `false` |
| `min-priority-for-issue` | Minimum priority for auto-created issues | `high` |
| `issue-number` | Issue number for focused research (from triage) | — |
| `mode` | `scheduled` or `issue-focused` | `scheduled` |

---

## 🔗 Autonomous Pipeline

When all four workflow agents are installed, they form a self-maintaining pipeline:

```
┌──────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│ Research  │────>│ Triage  │────>│  Coding  │────>│  Review  │
│  Agent   │     │  Agent  │     │  Agent   │     │  Agent   │
└──────────┘     └─────────┘     └──────────┘     └──────────┘
     │                │               │                 │
     │           route-to-       assign-to-        approve &
     │           research         agent            auto-merge
     │                │               │                 │
     └────────────────┘               │            ┌────┘
                                      │            │
                                      ▼            ▼
                                 changes_requested ──> Coding Agent
                                 (feedback loop)
```

**Flow**: Research finds gaps and creates issues → Triage evaluates and routes → Coding implements and creates PRs → Review approves/merges or requests changes → feedback loops back to coding.

Agents chain via `workflow_dispatch` events using `actions/github-script`. Each agent's workflow includes a dispatch step to trigger the next agent in the pipeline (see [examples/](examples/)).

### Label State Machine

Labels coordinate agent handoffs:

| Label | Meaning |
|-------|---------|
| `ready-for-agent` | Issue triaged and ready for coding agent |
| `assigned-to-agent` | Coding agent is actively working |
| `agent-coded` | PR created by coding agent, ready for review |
| `needs-human-review` | Agent failed or needs human intervention |

---

## 🔑 Token Architecture

Agents use up to three token types depending on the operation:

| Token | Source | Used For |
|-------|--------|----------|
| `GITHUB_TOKEN` | Built-in | Most operations: commits, push, PR creation, issues. **Cannot** push `.github/workflows/` files. |
| `COPILOT_GITHUB_TOKEN` | Repository secret (PAT) | Copilot SDK API calls only. Set as both `copilot-token` input and `COPILOT_GITHUB_TOKEN` env var. |
| GitHub App token | `actions/create-github-app-token` | Elevated operations: approve PRs as a separate identity, push workflow files. Requires a GitHub App with `contents: write` and `workflows: write` permissions. |

### GitHub App Setup (Optional)

A GitHub App provides a separate bot identity for reviews and can push workflow files that `GITHUB_TOKEN` cannot:

1. Create a GitHub App with **Contents: Write** and **Workflows: Write** permissions
2. Install it on the target repository
3. Add `GH_AGENCY_APP_ID` and `GH_AGENCY_PRIVATE_KEY` as repository secrets
4. Use `actions/create-github-app-token` to generate tokens at runtime (see [examples/ai-coding.yml](examples/ai-coding.yml))

### Workflow File Push Limitation

`GITHUB_TOKEN` cannot push `.github/workflows/` files (GitHub security restriction). When the coding agent detects a push failure for workflow files, it:
1. Posts the generated file contents as an issue comment for manual addition
2. Cleans up labels (`assigned-to-agent` → `needs-human-review`)
3. Prevents retry loops via comment-based failure detection

To enable automatic workflow file pushes, provide an `app-token` from a GitHub App with `workflows: write` permission.

---

## 💬 Slash Commands

Post these as comments on issues or PRs to trigger the coding agent:

| Command | Description |
|---------|-------------|
| `/agent fix [instructions]` | Fix review issues on a PR |
| `/agent implement [instructions]` | Implement an issue |
| `/agent update [instructions]` | Update code based on instructions |

Human comments on `agent-coded` PRs also trigger the coding agent automatically.

---

## 👤 Human-in-the-Loop Controls

### Override Commands

Users can halt agent operations with special commands in comments:

- `/stop` - Immediately halt agent processing
- `/override` - Cancel pending agent actions
- `/human` - Request human review, skip automation

### Approval Gates

| Operation | Approval Required |
|-----------|-------------------|
| Add labels | No |
| Post comments | No |
| Merge Dependabot patches | No (auto-approve) |
| Merge agent-coded PRs | No (auto-merge after AI review) |
| Merge human PRs | Yes (human or AI review) |
| Create releases | Yes (human) |

---

## 🤝 Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Code Standards

- TypeScript strict mode
- ESLint + Prettier formatting
- Security-first design
- Comprehensive type definitions

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

GH-Agency builds on patterns and practices from:

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)
- [GitHub Actions Security Best Practices](https://docs.github.com/en/actions/security-guides)
- [OWASP LLM Top 10 2025](https://owasp.org/www-project-top-10-for-large-language-model-applications/)

---

<p align="center">
  <b>GH-Agency</b> — Intelligent automation for the modern software development lifecycle.
</p>
