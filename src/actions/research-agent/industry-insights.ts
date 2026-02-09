/**
 * Industry Insights Module
 * Extracts project context from VISION.md/README.md and generates
 * domain-specific industry insights using Copilot SDK.
 */

import * as core from '@actions/core';
import type { IndustryInsight, RepositoryContext } from '../../shared/types.js';
import {
  hasCopilotAuth,
  sendPrompt,
  parseAgentResponse,
  formatContextForPrompt,
} from '../../sdk/index.js';

/** Extracted project context for driving insights */
export interface ProjectContext {
  domain: string;
  techStack: string[];
  goals: string[];
  keywords: string[];
}

/**
 * Extracts project context from VISION.md + README.md
 * This replaces the repoTopics.length > 0 gate — works even with no topics set
 */
export async function extractProjectContext(
  repoContext: RepositoryContext,
  repoDescription: string,
  repoTopics: string[],
  model: string
): Promise<ProjectContext> {
  // Try AI extraction first
  if (hasCopilotAuth() && (repoContext.vision || repoContext.readme)) {
    try {
      const contextSection = formatContextForPrompt(repoContext);

      const prompt = `Analyze this project and extract structured context.

## Project Information
${contextSection}

${repoDescription ? `**Repository Description:** ${repoDescription}` : ''}
${repoTopics.length > 0 ? `**Topics:** ${repoTopics.join(', ')}` : ''}

## Task
Extract the project's domain, tech stack, goals, and keywords.

CRITICAL: Respond with ONLY a JSON object. No explanatory text.

{
  "domain": "Brief domain description (e.g., 'healthcare data interoperability', 'developer tooling', 'e-commerce')",
  "techStack": ["tech1", "tech2"],
  "goals": ["goal1", "goal2"],
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;

      const response = await sendPrompt(
        'You are a project analyst. Output ONLY valid JSON.',
        prompt,
        { model }
      );

      if (response.content) {
        const parsed = parseAgentResponse<ProjectContext>(response.content);
        if (parsed?.domain && parsed?.keywords?.length > 0) {
          core.info(`AI extracted project context: domain="${parsed.domain}", ${parsed.keywords.length} keywords`);
          return parsed;
        }
      }
    } catch (error) {
      core.warning(
        `AI context extraction failed, using heuristic fallback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Fallback: heuristic extraction
  return extractContextHeuristic(repoContext, repoDescription, repoTopics);
}

/**
 * Heuristic-based project context extraction
 */
function extractContextHeuristic(
  repoContext: RepositoryContext,
  repoDescription: string,
  repoTopics: string[]
): ProjectContext {
  const allText = [
    repoContext.vision || '',
    repoContext.readme || '',
    repoDescription,
  ]
    .join(' ')
    .toLowerCase();

  // Detect tech stack from text
  const techKeywords: Record<string, string> = {
    typescript: 'TypeScript', javascript: 'JavaScript', python: 'Python',
    rust: 'Rust', go: 'Go', java: 'Java', 'c#': 'C#', '.net': '.NET',
    dotnet: '.NET', react: 'React', vue: 'Vue', angular: 'Angular',
    node: 'Node.js', django: 'Django', flask: 'Flask', rails: 'Rails',
    docker: 'Docker', kubernetes: 'Kubernetes', terraform: 'Terraform',
    graphql: 'GraphQL', 'rest api': 'REST API', postgresql: 'PostgreSQL',
    mongodb: 'MongoDB', redis: 'Redis', aws: 'AWS', azure: 'Azure', gcp: 'GCP',
  };

  const techStack: string[] = [];
  for (const [keyword, display] of Object.entries(techKeywords)) {
    if (allText.includes(keyword)) {
      techStack.push(display);
    }
  }

  // Extract goals from VISION.md sections
  const goals: string[] = [];
  const vision = repoContext.vision || '';
  const goalPatterns = [
    /## (?:Goals?|Objectives?|Mission)\s*\n([\s\S]*?)(?=\n##|$)/i,
    /## (?:Core )?Principles?\s*\n([\s\S]*?)(?=\n##|$)/i,
  ];

  for (const pattern of goalPatterns) {
    const match = vision.match(pattern);
    if (match?.[1]) {
      const bullets = match[1].match(/^[-*]\s+(.+)$/gm) || [];
      for (const bullet of bullets.slice(0, 5)) {
        goals.push(bullet.replace(/^[-*]\s+/, '').trim());
      }
    }
  }

  // Build keywords from topics + detected tech + description words
  const keywords = [...repoTopics];
  for (const tech of techStack) {
    if (!keywords.includes(tech.toLowerCase())) {
      keywords.push(tech.toLowerCase());
    }
  }

  // Extract meaningful words from description
  if (repoDescription) {
    const words = repoDescription.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    for (const w of words.slice(0, 5)) {
      if (!keywords.includes(w)) keywords.push(w);
    }
  }

  const domain = repoDescription || repoContext.name || 'software project';

  core.info(`Heuristic context: domain="${domain}", ${techStack.length} tech, ${keywords.length} keywords`);

  return { domain, techStack, goals, keywords };
}

/**
 * Generates industry insights using Copilot SDK or fallback keyword map
 */
export async function generateIndustryInsights(
  projectContext: ProjectContext,
  repoContext: RepositoryContext,
  model: string
): Promise<IndustryInsight[]> {
  // Try AI-powered insights
  if (hasCopilotAuth()) {
    try {
      const contextSection = formatContextForPrompt(repoContext);

      const prompt = `You are an industry analyst generating insights for a software project.

## Project Context
${contextSection}

## Project Profile
- **Domain:** ${projectContext.domain}
- **Tech Stack:** ${projectContext.techStack.join(', ') || 'Not specified'}
- **Goals:** ${projectContext.goals.join('; ') || 'Not specified'}
- **Keywords:** ${projectContext.keywords.join(', ')}

## Task
Generate 3-5 industry insights SPECIFIC to this project's domain and technology stack.
Focus on trends, best practices, and emerging patterns relevant to this project.

CRITICAL: Respond with ONLY a JSON array. No explanatory text.

[
  {
    "topic": "Trend or insight title",
    "summary": "2-3 sentence description of the trend",
    "relevance": "How this specifically applies to this project",
    "sources": ["General source reference"],
    "actionable": true
  }
]`;

      const response = await sendPrompt(
        'You are an industry analyst. Output ONLY valid JSON.',
        prompt,
        { model }
      );

      if (response.content) {
        const parsed = parseAgentResponse<IndustryInsight[]>(response.content);
        if (Array.isArray(parsed) && parsed.length > 0) {
          core.info(`AI generated ${parsed.length} industry insights`);
          return parsed;
        }
      }
    } catch (error) {
      core.warning(
        `AI industry insights failed, using fallback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Fallback: expanded keyword map
  return generateFallbackInsights(projectContext.keywords, projectContext.techStack);
}

/**
 * Fallback insights with expanded keyword coverage
 */
function generateFallbackInsights(keywords: string[], techStack: string[]): IndustryInsight[] {
  const insights: IndustryInsight[] = [];
  const allTerms = [...keywords, ...techStack.map((t) => t.toLowerCase())];

  const topicInsights: Record<string, IndustryInsight> = {
    ai: {
      topic: 'AI/ML Integration',
      summary: 'AI-powered features are becoming standard in developer tools and applications. LLM-based code generation, natural language interfaces, and intelligent automation are reshaping how software is built.',
      relevance: 'Consider adding AI-assisted features to enhance user productivity',
      sources: ['Industry trends in AI-powered development'],
      actionable: true,
    },
    automation: {
      topic: 'Automation Trends',
      summary: 'Workflow automation continues to grow in importance with CI/CD, GitOps, and infrastructure-as-code patterns becoming standard practice.',
      relevance: 'Expanding automation capabilities aligns with industry direction',
      sources: ['DevOps automation trends'],
      actionable: true,
    },
    security: {
      topic: 'Security-First Development',
      summary: 'Supply chain security, SBOM generation, and shift-left security testing are top priorities. SLSA framework adoption is accelerating.',
      relevance: 'Security features provide significant competitive advantage',
      sources: ['OWASP, SLSA framework, industry security reports'],
      actionable: true,
    },
    typescript: {
      topic: 'TypeScript Ecosystem',
      summary: 'TypeScript continues to dominate for new JavaScript projects. Type-safe APIs, runtime validation (Zod, Valibot), and edge-first frameworks are key trends.',
      relevance: 'Strong typing improves maintainability and developer experience',
      sources: ['State of JS surveys'],
      actionable: false,
    },
    javascript: {
      topic: 'JavaScript Runtime Evolution',
      summary: 'Modern runtimes (Bun, Deno) are gaining traction. ESM-first approaches, native test runners, and cross-runtime compatibility are emerging patterns.',
      relevance: 'Staying current with runtime capabilities can improve performance and DX',
      sources: ['JavaScript ecosystem trends'],
      actionable: true,
    },
    python: {
      topic: 'Python Modernization',
      summary: 'Type hints, async patterns, and modern package managers (uv, rye) are reshaping Python development. FastAPI and Pydantic have become the standard for APIs.',
      relevance: 'Modern Python practices improve code quality and performance',
      sources: ['Python developer surveys'],
      actionable: true,
    },
    rust: {
      topic: 'Rust Adoption in Systems',
      summary: 'Rust is increasingly adopted for performance-critical tools, CLI applications, and WebAssembly targets. Memory safety without GC overhead is the key driver.',
      relevance: 'Rust components can improve performance for critical paths',
      sources: ['Rust ecosystem reports'],
      actionable: true,
    },
    go: {
      topic: 'Go for Cloud Native',
      summary: 'Go remains the dominant language for cloud-native infrastructure, CLIs, and microservices. Generics adoption and improved error handling are evolving the ecosystem.',
      relevance: 'Go is well-suited for building reliable, concurrent services',
      sources: ['Go developer surveys'],
      actionable: false,
    },
    docker: {
      topic: 'Container Best Practices',
      summary: 'Multi-stage builds, distroless images, and BuildKit optimizations are now standard. Container security scanning and SBOM generation are increasingly required.',
      relevance: 'Optimized container workflows improve security and deployment speed',
      sources: ['Container security best practices'],
      actionable: true,
    },
    kubernetes: {
      topic: 'Kubernetes Ecosystem',
      summary: 'Platform engineering, GitOps (ArgoCD/Flux), and service mesh simplification are key trends. Developer portals (Backstage) are gaining adoption.',
      relevance: 'Modern K8s patterns improve operational efficiency',
      sources: ['CNCF ecosystem reports'],
      actionable: true,
    },
    api: {
      topic: 'API Design Evolution',
      summary: 'OpenAPI 3.1, AsyncAPI for event-driven systems, and API-first development are standard. GraphQL federation and tRPC for type-safe APIs are growing.',
      relevance: 'Strong API design improves integration and developer experience',
      sources: ['API ecosystem trends'],
      actionable: true,
    },
    testing: {
      topic: 'Modern Testing Practices',
      summary: 'Component testing, visual regression, and AI-assisted test generation are emerging. Property-based testing and mutation testing provide higher confidence.',
      relevance: 'Advanced testing strategies improve reliability and reduce bugs',
      sources: ['Testing trends in software engineering'],
      actionable: true,
    },
    devops: {
      topic: 'Platform Engineering',
      summary: 'Internal developer platforms (IDPs), self-service infrastructure, and golden paths are replacing traditional DevOps. Developer experience is the focus.',
      relevance: 'Platform engineering reduces friction and improves developer productivity',
      sources: ['Platform engineering trends'],
      actionable: true,
    },
    cloud: {
      topic: 'Cloud-Native Patterns',
      summary: 'Serverless-first architectures, edge computing, and multi-cloud strategies continue to evolve. Cost optimization and FinOps are increasingly important.',
      relevance: 'Cloud-native patterns improve scalability and reduce operational overhead',
      sources: ['Cloud computing trends'],
      actionable: true,
    },
    database: {
      topic: 'Modern Data Layer',
      summary: 'Vector databases for AI workloads, edge-local databases (SQLite-based), and serverless database offerings are key trends. Schema-as-code and migration automation are standard.',
      relevance: 'Modern data patterns improve scalability and developer experience',
      sources: ['Database technology trends'],
      actionable: true,
    },
    dotnet: {
      topic: '.NET Modernization',
      summary: '.NET 8+ with native AOT compilation, minimal APIs, and Aspire for cloud-native development are reshaping the ecosystem. Blazor for full-stack C# is maturing.',
      relevance: '.NET modernization improves performance and developer productivity',
      sources: ['.NET ecosystem reports'],
      actionable: true,
    },
    java: {
      topic: 'Java Ecosystem Evolution',
      summary: 'Virtual threads (Project Loom), GraalVM native images, and modern frameworks (Quarkus, Micronaut) are transforming Java development. Records and sealed classes improve code expressiveness.',
      relevance: 'Modern Java features improve concurrency and startup performance',
      sources: ['Java ecosystem trends'],
      actionable: true,
    },
  };

  const matched = new Set<string>();
  for (const term of allTerms) {
    const lower = term.toLowerCase();
    for (const [key, insight] of Object.entries(topicInsights)) {
      if (lower.includes(key) && !matched.has(key)) {
        insights.push(insight);
        matched.add(key);
      }
    }
  }

  return insights.slice(0, 5);
}
