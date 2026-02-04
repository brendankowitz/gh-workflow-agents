# AI Agent-Driven Open Source Product Management for Medino

**Bottom Line Up Front**: Building an autonomous AI agent system for managing Medino—a lightweight .NET 8+ mediator library—is feasible today using GitHub Copilot SDK, the Copilot Coding Agent, and GitHub Actions as the orchestration backbone. The architecture should combine **MCP servers** for reusable .NET tooling with **release-please** for automated versioning and cross-repository dispatch events for coordinating between Medino and medino-samples. Key risks include runaway API costs (**$0.04/premium request**), infinite loops in multi-agent workflows, and prompt injection attacks. A phased deployment with human approval gates is essential.

---

## Medino: Understanding the target repository

Medino is a lightweight, high-performance in-process mediator for **.NET 8/9/10+** created by **Brendan Kowitz**, a Microsoft engineer who works on microsoft/fhir-server. The library implements the mediator pattern with support for commands, queries, events, pipeline behaviors, and exception handling—similar to MediatR but with a performance focus and MIT licensing.

**Current State Assessment**:
- **5 stars, 3 forks** (early-stage adoption)
- Last updated January 8, 2026
- Author has extensive experience with AI tooling, including `dotnet-roslyn-mcp` and `claude-code-template` repositories
- Target framework: Modern .NET 8+ only

The author's existing ecosystem suggests strong alignment with AI-assisted development patterns. Medino would benefit from automated release management, cross-repository coordination with sample projects, and AI-assisted issue triage and PR generation.

---

## GitHub Copilot SDK capabilities and integration patterns

The **GitHub Copilot SDK** (Technical Preview, launched January 22, 2026) provides programmatic access to the same agentic engine powering GitHub Copilot CLI. It supports **Node.js, Python, Go, and .NET** through the `GitHub.Copilot.SDK` NuGet package.

### Core capabilities for agent development

The SDK enables multi-turn conversations, streaming responses, custom agent definitions, and full **MCP (Model Context Protocol) support**. It communicates with the Copilot CLI via JSON-RPC in server mode, managing the CLI process lifecycle automatically.

**Model Selection and Pricing**: The SDK supports all Copilot models including Claude Sonnet 4.5 (1x multiplier), GPT-5 (1x), Claude Opus 4.5 (3x premium), and cost-efficient options like GPT-5 mini (0x—included free) and Claude Haiku 4.5 (0.33x). Each SDK prompt counts as one premium request toward your subscription allowance: **50/month on Free tier, 300+ on Pro, 1,000+ on Pro+**.

**Web Research and GitHub API Integration**: The SDK includes built-in URL fetching controlled via `allowed_urls` patterns in configuration. For GitHub operations, it natively integrates with the GitHub MCP Server, providing tools for issues, PRs, comments, releases, and Actions—exactly what's needed for product management automation.

```typescript
// .NET Copilot SDK with MCP integration
await using var client = new CopilotClient();
await using var session = await client.CreateSessionAsync(new SessionConfig {
    Model = "claude-sonnet-4.5",
    McpServers = new Dictionary<string, object> {
        ["github"] = new { type = "http", url = "https://api.githubcopilot.com/mcp/" }
    }
});
```

**Running in GitHub Actions**: The SDK can be installed and executed in CI environments. Store a PAT with `Copilot Requests: Read` permission in `secrets.COPILOT_GITHUB_TOKEN` and use `npm i -g @github/copilot` to install the CLI.

---

## GitHub Copilot Coding Agent: Programmatic orchestration

The **Copilot Coding Agent** is GitHub's production-ready (GA September 2025) autonomous software engineering agent. Unlike IDE-based agent mode, it runs asynchronously in an ephemeral, firewall-controlled GitHub Actions environment.

### Triggering mechanisms and API support

The coding agent can be triggered programmatically via REST and GraphQL APIs—critical for building orchestrated multi-agent systems:

```bash
# REST API: Assign Copilot to an existing issue
gh api --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/OWNER/REPO/issues/ISSUE_NUMBER/assignees \
  --input - <<< '{
    "assignees": ["copilot-swe-agent[bot]"],
    "agent_assignment": {
      "target_repo": "OWNER/REPO",
      "base_branch": "main",
      "custom_instructions": "Focus on performance optimization"
    }
  }'
```

The agent reacts with a 👀 emoji, opens a **draft pull request**, breaks down the task into a checklist, and iteratively commits changes. It can only push to `copilot/` branches and requires a different person to approve the final merge—a built-in safety mechanism.

**Pricing for Open Source**: Copilot Pro is free for verified maintainers of popular open source projects (evaluated monthly). Each coding agent session consumes **1 premium request + GitHub Actions minutes**. Overage costs are **$0.04/request**.

### Capabilities and limitations

The agent handles bug fixes, incremental features, test coverage, documentation, and refactoring effectively. However, it operates within a **single repository** per task, cannot make cross-repo changes, and is incompatible with "Require signed commits" branch protection without bypass configuration.

---

## GitHub Actions architecture for multi-agent workflows

Building a product management system requires orchestrating multiple agents across events like issue creation, PR comments, and releases. GitHub Actions provides the foundation through event triggers, workflow dispatch, and repository dispatch.

### Event-driven patterns for conversational agents

```yaml
name: AI Agent Comment Handler
on:
  issue_comment:
    types: [created]
    
jobs:
  handle-comment:
    runs-on: ubuntu-latest
    if: contains(github.event.comment.body, '/agent')
    steps:
      - name: Get Conversation History
        uses: actions/github-script@v6
        with:
          script: |
            const comments = await github.rest.issues.listComments({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number
            });
            // Build context from conversation history
```

**Multi-turn conversation handling**: Store agent state in hidden issue comments using markers like `<!-- AGENT_STATE_V1 -->` with JSON payloads in collapsed `<details>` blocks. This persists context across workflow runs without external infrastructure.

### Cross-repository coordination for medino-samples

The `repository_dispatch` event enables coordinating agents across repositories—essential for triggering consumer testing in medino-samples when Medino releases:

```yaml
# In Medino: Notify downstream repos on release
name: Notify Downstream
on:
  release:
    types: [published]

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: peter-evans/repository-dispatch@v4
        with:
          token: ${{ secrets.CROSS_REPO_PAT }}
          repository: brendankowitz/medino-samples
          event-type: medino-release
          client-payload: |
            { "version": "${{ github.ref_name }}", "sha": "${{ github.sha }}" }
```

```yaml
# In medino-samples: React to upstream releases
on:
  repository_dispatch:
    types: [medino-release]

jobs:
  update-samples:
    runs-on: ubuntu-latest
    steps:
      - name: Update Medino Reference
        run: |
          echo "Updating to version ${{ github.event.client_payload.version }}"
```

### Preventing infinite loops in multi-agent systems

When agents create events that trigger other agents, infinite loops become a critical risk. Key prevention patterns:

1. **Use `GITHUB_TOKEN` by default**: Commits and actions using this token don't trigger new workflows
2. **Actor filtering**: `if: github.actor != 'github-actions[bot]'`
3. **Skip flags**: Commit messages with `[skip ci]` prevent workflow triggers
4. **Depth tracking**: Pass recursion depth in `client_payload` and enforce hard limits (e.g., max 3)
5. **Concurrency groups**: `concurrency: { group: ai-agent-${{ github.ref }}, cancel-in-progress: true }`

---

## MCP servers versus custom .NET inline tooling

The **Model Context Protocol (MCP)** is an open standard from Anthropic (November 2024) that standardizes how AI applications connect to external tools. It's now adopted by OpenAI, Google DeepMind, and maintained by The Linux Foundation.

### .NET MCP server development

Microsoft maintains the official C# SDK via the `ModelContextProtocol` NuGet package (preview). Building a Medino-specific MCP server enables reusability across Claude Desktop, GitHub Copilot, VS Code, and other MCP hosts:

```csharp
using Microsoft.Extensions.Hosting;
using ModelContextProtocol.Server;
using System.ComponentModel;

var builder = Host.CreateApplicationBuilder(args);
builder.Services
    .AddMcpServer()
    .WithStdioServerTransport()
    .WithToolsFromAssembly();
await builder.Build().RunAsync();

[McpServerToolType]
public static class MedinoTools
{
    [McpServerTool, Description("Analyzes mediator handler registrations")]
    public static async Task<AnalysisResult> AnalyzeHandlers(
        string projectPath,
        CancellationToken cancellationToken)
    {
        // Implementation using Roslyn analysis
    }
}
```

### Comparison: MCP servers versus inline tooling

| Aspect | MCP Servers | Inline GitHub Actions Tooling |
|--------|-------------|-------------------------------|
| **Reusability** | High—same server works with Claude, Copilot, IDEs | Low—tied to specific workflow |
| **Performance** | Network/process overhead | Direct in-process, fastest |
| **Maintenance** | Single server, multiple clients | Multiple integration points |
| **Best for** | Shared tools, domain expertise | Simple, workflow-specific operations |

**Recommendation for Medino**: Use a **hybrid approach**. Build an MCP server for Medino-specific tools (handler analysis, pipeline inspection) that can be used across development environments. Use inline tooling for simple workflow operations like labeling issues or triggering releases.

---

## Dependabot integration with AI-assisted review

Automating Dependabot PR handling requires balancing security with efficiency. A tiered approach works best:

```yaml
name: Dependabot Auto-Merge
on: pull_request

permissions:
  contents: write
  pull-requests: write

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.event.pull_request.user.login == 'dependabot[bot]'
    steps:
      - name: Dependabot metadata
        id: metadata
        uses: dependabot/fetch-metadata@v2
        
      - name: Auto-merge patches and dev minors
        if: |
          steps.metadata.outputs.update-type == 'version-update:semver-patch' ||
          (steps.metadata.outputs.dependency-type == 'direct:development' && 
           steps.metadata.outputs.update-type == 'version-update:semver-minor') ||
          steps.metadata.outputs.package-ecosystem == 'github_actions'
        run: |
          gh pr review --approve "$PR_URL"
          gh pr merge --auto --squash "$PR_URL"
        env:
          PR_URL: ${{ github.event.pull_request.html_url }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

**AI-assisted review** can analyze dependency updates for security implications:

```yaml
- name: AI Review Dependency Update
  run: |
    copilot --model claude-sonnet-4.5 --allow-all-tools \
      -p "Review this Dependabot PR. Analyze: 1) Security implications 2) Breaking changes 3) Actual usage in codebase. Title: $PR_TITLE" \
      > review.md
    gh pr comment "$PR_URL" --body-file review.md
```

---

## Automated release management with release-please

**release-please** (Google-maintained) provides the ideal human-in-the-loop release pattern for OSS projects. It creates release PRs automatically from conventional commits, requiring a merge approval before publishing:

```yaml
name: Release
on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          release-type: simple  # For .NET projects without package.json
          
      - name: Publish NuGet Package
        if: steps.release.outputs.release_created
        run: |
          dotnet pack -c Release
          dotnet nuget push **/*.nupkg -k ${{ secrets.NUGET_API_KEY }} -s https://api.nuget.org/v3/index.json
```

For AI-generated release notes, combine GitHub's built-in auto-generation with LLM refinement to create user-friendly changelogs from technical commit messages.

---

## Risks and mitigation strategies for autonomous agents

### Cost containment is critical

API costs can escalate rapidly: **$0.04 per premium request × model multiplier**. A runaway loop with Claude Opus 4.5 (3x multiplier) could cost hundreds of dollars in hours.

**Mitigations**:
- Use included models (GPT-5 mini, GPT-4o) for routine operations—**0x multiplier**
- Set hard spending limits in GitHub billing
- Implement per-agent daily budget caps with circuit breakers
- Use prompt caching where available (reported **90% cost reduction**)

### Infinite loop prevention requires multiple layers

Loop drift—where agents misinterpret termination signals—occurs in **50%+ of complex tool-calling scenarios** based on community reports. Implement:

1. **Dual-threshold systems**: Soft warning ("time to deliver") before hard termination
2. **State tracking**: Detect repetitive outputs and action hash collisions
3. **Maximum iteration limits**: Cap at 5-20 iterations per task type
4. **Timeout mechanisms**: Force completion after reasonable duration

### Security hardening against prompt injection

OWASP ranks prompt injection as the **#1 LLM security risk for 2025**, with indirect injection attacks achieving up to **86% partial success rates**.

**Defense layers**:
- Remove invisible Unicode/HTML before processing any external content
- Firewall agent environments—limit network access to approved domains
- Never pass CI secrets to agent context automatically
- Revoke tokens after session completion
- Use ephemeral runtimes destroyed after each task
- Implement trust boundaries at every data ingestion point

### Human oversight is non-negotiable

The Copilot Coding Agent's design—requiring a different person to approve PRs—exemplifies proper oversight. Extend this pattern:

- Approval required for all production releases
- Major version dependency updates require human review
- Sensitive operations (security, auth, crypto) need explicit authorization
- Phased deployment: start strict, gradually auto-approve low-risk operations

---

## Similar projects and prior art

Several projects implement AI-driven GitHub management with varying success:

**Sweep AI** transforms issues into PRs autonomously, supporting Python, JavaScript, Rust, Go, Java, and C#. It struggles with repositories over 5,000 files and limits changes to 3 files/150 lines per PR—reasonable constraints that prevent runaway modifications.

**Devin AI** provides a fully autonomous software engineer with VM, browser, and CLI access. However, testing showed only **15% success on complex tasks** without human assistance. Promotional materials were exposed as misleading, and the agent frequently creates infinite loops in recursive functions.

**GitHub Copilot Coding Agent** takes a constrained approach: PRs only, no direct main commits, draft PRs don't auto-run CI, and firewall-controlled network access. This demonstrates that effective guardrails enable production use.

**OpenHands** (formerly OpenDevin) provides an open-source alternative to Devin for teams wanting more control over the autonomous coding pipeline.

---

## Recommended architecture for Medino

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Medino AI Agent Orchestrator                     │
│                    (GitHub Actions + Copilot SDK)                    │
└────────────────────────────┬───────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼────┐        ┌──────▼──────┐      ┌──────▼──────┐
   │ Issue   │        │  PR Review  │      │  Release    │
   │ Triage  │        │  Agent      │      │  Agent      │
   │ Agent   │        │             │      │             │
   └────┬────┘        └──────┬──────┘      └──────┬──────┘
        │                    │                    │
        │    ┌───────────────┼───────────────┐    │
        │    │               │               │    │
        ▼    ▼               ▼               ▼    ▼
   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
   │Medino MCP   │    │GitHub MCP   │    │release-     │
   │Server (.NET)│    │Server       │    │please       │
   │- Roslyn     │    │- Issues     │    │             │
   │- Handlers   │    │- PRs        │    │             │
   └─────────────┘    └─────────────┘    └─────────────┘
```

### Implementation phases

**Phase 1 (Low Risk)**: Deploy release-please for automated versioning, Dependabot auto-merge for patches only, and cross-repo dispatch to medino-samples on release.

**Phase 2 (Medium Risk)**: Add Copilot SDK-powered issue triage agent triggered on issue creation. Implement AI-assisted PR review for documentation and test changes.

**Phase 3 (Higher Risk)**: Enable Copilot Coding Agent assignment for labeled issues (`good-first-issue`, `bug-confirmed`). Implement multi-agent workflow with consumer testing in medino-samples.

### Essential guardrails

- **Budget limit**: Set GitHub Actions spending cap and monitor premium request usage
- **Loop prevention**: Maximum 5 iterations per agent task, depth tracking in dispatches
- **Human gates**: All PRs require manual merge, no auto-commit to main
- **Audit trail**: Store agent decisions in issue comments with full reasoning
- **Circuit breaker**: Auto-disable agents if error rate exceeds 20% over 24 hours

---

## Code examples for key workflows

### Issue triage agent

```yaml
name: AI Issue Triage
on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    permissions:
      issues: write
      models: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install Copilot CLI
        run: npm i -g @github/copilot
      - name: Analyze Issue
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.COPILOT_PAT }}
          ISSUE_BODY: ${{ github.event.issue.body }}
          ISSUE_TITLE: ${{ github.event.issue.title }}
        run: |
          copilot --model gpt-5-mini \
            -p "Analyze this GitHub issue for Medino (a .NET mediator library).
                Title: $ISSUE_TITLE
                Body: $ISSUE_BODY
                
                Output JSON: { \"labels\": [...], \"priority\": \"low|medium|high\", \"summary\": \"...\" }" \
            > analysis.json
      - name: Apply Labels
        uses: actions/github-script@v6
        with:
          script: |
            const analysis = require('./analysis.json');
            await github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: analysis.labels
            });
```

### Cross-repo consumer testing

```yaml
# In medino-samples repository
name: Test Against New Medino Release
on:
  repository_dispatch:
    types: [medino-release]

jobs:
  test-samples:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '9.0.x'
      - name: Update Medino Reference
        run: |
          VERSION="${{ github.event.client_payload.version }}"
          dotnet add package Medino --version $VERSION
      - name: Build and Test
        run: |
          dotnet build
          dotnet test
      - name: Report Results
        if: failure()
        uses: peter-evans/repository-dispatch@v4
        with:
          token: ${{ secrets.CROSS_REPO_PAT }}
          repository: brendankowitz/Medino
          event-type: sample-test-failure
          client-payload: '{ "version": "${{ github.event.client_payload.version }}" }'
```

---

## Conclusion and key recommendations

An AI agent-driven product management system for Medino is technically feasible and increasingly practical with the GitHub Copilot SDK's native MCP support and the Copilot Coding Agent's programmatic API. The architecture should prioritize **defense in depth**—combining budget limits, loop prevention, human approval gates, and security hardening.

**Start conservative**: Begin with release-please and Dependabot automation before introducing autonomous coding agents. Medino's position as a .NET 8+ library by a Microsoft engineer creates natural alignment with GitHub's AI tooling ecosystem.

**Measure everything**: Track premium request consumption, agent success rates, and time-to-resolution improvements. The 40% failure rate Gartner predicts for agentic AI projects by 2027 comes primarily from cost overruns and quality issues—both preventable with proper monitoring.

**Build for human trust**: Every agent action should be transparent, attributable, and reversible. The goal isn't to eliminate human involvement but to amplify maintainer effectiveness through intelligent automation that handles routine work while escalating decisions that require judgment.