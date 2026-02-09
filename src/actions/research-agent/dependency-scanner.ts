/**
 * Dependency Scanner Module
 * Scans workspace for dependency manifests across multiple ecosystems
 * and optionally uses Copilot SDK for analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import type { DependencyFinding, RepositoryContext } from '../../shared/types.js';
import {
  hasCopilotAuth,
  sendPrompt,
  parseAgentResponse,
  formatContextForPrompt,
} from '../../sdk/index.js';

export interface DependencyScanResult {
  findings: DependencyFinding[];
  ecosystems: Map<string, number>;
  totalDependencies: number;
  summary: string;
}

interface RawDependency {
  name: string;
  version: string;
  ecosystem: string;
  isDev: boolean;
}

/**
 * Scans the workspace for dependency manifests and analyzes them
 */
export async function scanDependencies(
  workspace: string,
  repoContext: RepositoryContext,
  model: string
): Promise<DependencyScanResult> {
  core.info('Scanning for dependency manifests...');

  const dependencies: RawDependency[] = [];

  // Parse all manifest types
  dependencies.push(...parsePackageJson(workspace));
  dependencies.push(...parseCsprojFiles(workspace));
  dependencies.push(...parseRequirementsTxt(workspace));
  dependencies.push(...parsePyprojectToml(workspace));
  dependencies.push(...parseCargoToml(workspace));
  dependencies.push(...parseGoMod(workspace));
  dependencies.push(...parseGemfile(workspace));

  // Group by ecosystem
  const ecosystems = new Map<string, number>();
  for (const dep of dependencies) {
    ecosystems.set(dep.ecosystem, (ecosystems.get(dep.ecosystem) || 0) + 1);
  }

  core.info(
    `Found ${dependencies.length} dependencies across ${ecosystems.size} ecosystem(s): ${[...ecosystems.entries()].map(([e, c]) => `${e}(${c})`).join(', ')}`
  );

  if (dependencies.length === 0) {
    return {
      findings: [],
      ecosystems,
      totalDependencies: 0,
      summary: 'No dependency manifests found in the repository.',
    };
  }

  // Try Copilot-powered analysis
  if (hasCopilotAuth() && dependencies.length > 0) {
    try {
      const findings = await analyzeWithCopilot(dependencies, repoContext, model);
      if (findings.length > 0) {
        return {
          findings,
          ecosystems,
          totalDependencies: dependencies.length,
          summary: `Analyzed ${dependencies.length} dependencies across ${ecosystems.size} ecosystem(s). Found ${findings.length} item(s) worth reviewing.`,
        };
      }
    } catch (error) {
      core.warning(
        `Copilot dependency analysis failed, using summary fallback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Fallback: return summary without AI analysis
  return {
    findings: [],
    ecosystems,
    totalDependencies: dependencies.length,
    summary: `${dependencies.length} dependencies across ${ecosystems.size} ecosystem(s): ${[...ecosystems.entries()].map(([e, c]) => `${e} (${c})`).join(', ')}. AI analysis unavailable — consider reviewing manually.`,
  };
}

/**
 * Uses Copilot SDK to analyze dependencies for outdated patterns, security concerns
 */
async function analyzeWithCopilot(
  dependencies: RawDependency[],
  repoContext: RepositoryContext,
  model: string
): Promise<DependencyFinding[]> {
  const contextSection = formatContextForPrompt(repoContext);

  // Truncate dependency list for prompt
  const depList = dependencies
    .slice(0, 100)
    .map((d) => `${d.name}@${d.version} (${d.ecosystem}${d.isDev ? ', dev' : ''})`)
    .join('\n');

  const prompt = `You are a dependency analyst reviewing a project's dependencies.

## Project Context
${contextSection}

## Dependencies (${dependencies.length} total)
${depList}
${dependencies.length > 100 ? `\n... and ${dependencies.length - 100} more` : ''}

## Task
Identify 3-8 notable findings about these dependencies:
- Known outdated major versions (e.g., React 17 when 18+ is current)
- Packages commonly known to have security issues at these versions
- Consolidation opportunities (multiple packages for the same purpose)
- Deprecated packages that should be replaced

CRITICAL: Respond with ONLY a JSON array. No explanatory text.

[
  {
    "package": "package-name",
    "currentVersion": "1.0.0",
    "latestVersion": "2.0.0",
    "updateType": "major",
    "breakingChanges": true,
    "changelog": "Brief note about what changed"
  }
]

If nothing notable, return an empty array: []`;

  const response = await sendPrompt(
    'You are a dependency analyst. Output ONLY valid JSON.',
    prompt,
    { model }
  );

  if (response.content) {
    const parsed = parseAgentResponse<DependencyFinding[]>(response.content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }

  return [];
}

// --- Manifest Parsers ---

function parsePackageJson(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'package.json');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    if (content.dependencies) {
      for (const [name, version] of Object.entries(content.dependencies)) {
        deps.push({ name, version: String(version), ecosystem: 'npm', isDev: false });
      }
    }

    if (content.devDependencies) {
      for (const [name, version] of Object.entries(content.devDependencies)) {
        deps.push({ name, version: String(version), ecosystem: 'npm', isDev: true });
      }
    }
  } catch {
    core.info('Failed to parse package.json');
  }

  return deps;
}

function parseCsprojFiles(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const csprojPattern = /\.csproj$/;
  const propsFile = path.join(workspace, 'Directory.Build.props');

  const filesToScan: string[] = [];

  // Find *.csproj files (one level deep to avoid scanning too many dirs)
  try {
    const entries = fs.readdirSync(workspace, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && csprojPattern.test(entry.name)) {
        filesToScan.push(path.join(workspace, entry.name));
      } else if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        try {
          const subEntries = fs.readdirSync(path.join(workspace, entry.name));
          for (const sub of subEntries) {
            if (csprojPattern.test(sub)) {
              filesToScan.push(path.join(workspace, entry.name, sub));
            }
          }
        } catch { /* skip inaccessible dirs */ }
      }
    }
  } catch { /* skip */ }

  if (fs.existsSync(propsFile)) {
    filesToScan.push(propsFile);
  }

  const packageRefRegex = /<PackageReference\s+Include="([^"]+)"\s+Version="([^"]+)"/gi;

  for (const file of filesToScan) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = packageRefRegex.exec(content)) !== null) {
        deps.push({ name: match[1]!, version: match[2]!, ecosystem: 'nuget', isDev: false });
      }
      // Reset regex lastIndex for next file
      packageRefRegex.lastIndex = 0;
    } catch { /* skip */ }
  }

  return deps;
}

function parseRequirementsTxt(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'requirements.txt');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('-')) continue;

      const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*(?:==|>=|~=|!=|<=|>|<)\s*([^\s,;]+)/);
      if (match) {
        deps.push({ name: match[1]!, version: match[2]!, ecosystem: 'pip', isDev: false });
      } else if (/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        deps.push({ name: trimmed, version: '*', ecosystem: 'pip', isDev: false });
      }
    }
  } catch {
    core.info('Failed to parse requirements.txt');
  }

  return deps;
}

function parsePyprojectToml(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'pyproject.toml');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Simple section-based parsing for [project.dependencies]
    const depsMatch = content.match(/\[project\]\s*[\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsMatch?.[1]) {
      const depLines = depsMatch[1].match(/"([^"]+)"/g) || [];
      for (const depLine of depLines) {
        const raw = depLine.replace(/"/g, '');
        const match = raw.match(/^([a-zA-Z0-9_.-]+)\s*(?:([><=!~]+)\s*(.+))?/);
        if (match) {
          deps.push({
            name: match[1]!,
            version: match[3] || '*',
            ecosystem: 'pip',
            isDev: false,
          });
        }
      }
    }
  } catch {
    core.info('Failed to parse pyproject.toml');
  }

  return deps;
}

function parseCargoToml(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'Cargo.toml');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Parse [dependencies] section
    const depsSection = content.match(/\[dependencies\]\s*\n([\s\S]*?)(?=\n\[|\n*$)/);
    if (depsSection?.[1]) {
      const lines = depsSection[1].split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // name = "version" or name = { version = "..." }
        const simpleMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
        if (simpleMatch) {
          deps.push({ name: simpleMatch[1]!, version: simpleMatch[2]!, ecosystem: 'cargo', isDev: false });
          continue;
        }

        const tableMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/);
        if (tableMatch) {
          deps.push({ name: tableMatch[1]!, version: tableMatch[2]!, ecosystem: 'cargo', isDev: false });
        }
      }
    }
  } catch {
    core.info('Failed to parse Cargo.toml');
  }

  return deps;
}

function parseGoMod(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'go.mod');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');

    // Parse require block
    const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
    if (requireBlock?.[1]) {
      const lines = requireBlock[1].split('\n');
      for (const line of lines) {
        const match = line.trim().match(/^(\S+)\s+(v[\S]+)/);
        if (match) {
          deps.push({ name: match[1]!, version: match[2]!, ecosystem: 'go', isDev: false });
        }
      }
    }

    // Also parse single-line requires
    const singleRequires = content.matchAll(/^require\s+(\S+)\s+(v[\S]+)/gm);
    for (const match of singleRequires) {
      deps.push({ name: match[1]!, version: match[2]!, ecosystem: 'go', isDev: false });
    }
  } catch {
    core.info('Failed to parse go.mod');
  }

  return deps;
}

function parseGemfile(workspace: string): RawDependency[] {
  const deps: RawDependency[] = [];
  const filePath = path.join(workspace, 'Gemfile');

  if (!fs.existsSync(filePath)) return deps;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      // gem 'name', '~> 1.0' or gem "name", ">= 2.0"
      const match = trimmed.match(/gem\s+['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"])?/);
      if (match) {
        deps.push({
          name: match[1]!,
          version: match[2] || '*',
          ecosystem: 'ruby',
          isDev: false,
        });
      }
    }
  } catch {
    core.info('Failed to parse Gemfile');
  }

  return deps;
}
