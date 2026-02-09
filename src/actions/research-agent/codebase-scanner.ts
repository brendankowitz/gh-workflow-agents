/**
 * Codebase Scanner Module
 * Scans the workspace for technical debt indicators via filesystem analysis.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as core from '@actions/core';
import type { TechnicalDebtItem, RepositoryContext } from '../../shared/types.js';
import {
  hasCopilotAuth,
  sendPrompt,
  parseAgentResponse,
  formatContextForPrompt,
} from '../../sdk/index.js';

export interface CodebaseScanResult {
  items: TechnicalDebtItem[];
  filesScanned: number;
  summary: string;
}

interface RawFinding {
  file: string;
  category: string;
  detail: string;
  line?: number;
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'vendor', '.next', 'out',
  'coverage', '__pycache__', '.tox', 'target', 'bin', 'obj', '.cache',
]);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.cs', '.go', '.rs', '.rb',
  '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp', '.vue', '.svelte',
]);

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX|WORKAROUND|TEMP|KLUDGE)\b/i;
const IMPORT_PATTERN = /^(?:import\s|from\s|require\(|using\s|#include\s)/;

/**
 * Scans the codebase for technical debt indicators
 */
export async function scanCodebaseForDebt(
  workspace: string,
  repoContext: RepositoryContext,
  model: string,
  maxFiles: number = 500
): Promise<CodebaseScanResult> {
  core.info('Scanning codebase for technical debt indicators...');

  const findings: RawFinding[] = [];
  let filesScanned = 0;

  // Recursive file walk
  const walk = (dir: string): void => {
    if (maxFiles > 0 && filesScanned >= maxFiles) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (maxFiles > 0 && filesScanned >= maxFiles) return;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext)) continue;

      const filePath = path.join(dir, entry.name);
      const relativePath = path.relative(workspace, filePath).replace(/\\/g, '/');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        filesScanned++;

        // Check: large file (>500 lines)
        if (lines.length > 500) {
          findings.push({
            file: relativePath,
            category: 'complexity',
            detail: `Large file with ${lines.length} lines — consider splitting into smaller modules`,
          });
        }

        // Check: TODO/FIXME/HACK/XXX comments
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          const match = line.match(TODO_PATTERN);
          if (match) {
            const tag = match[1]!.toUpperCase();
            const category = tag === 'HACK' || tag === 'KLUDGE' || tag === 'WORKAROUND'
              ? 'code-quality'
              : 'maintenance';
            findings.push({
              file: relativePath,
              category,
              detail: `${tag}: ${line.trim().substring(0, 120)}`,
              line: i + 1,
            });
          }
        }

        // Check: excessive imports (>20)
        let importCount = 0;
        for (const line of lines) {
          if (IMPORT_PATTERN.test(line.trim())) {
            importCount++;
          }
        }
        if (importCount > 20) {
          findings.push({
            file: relativePath,
            category: 'architecture',
            detail: `File has ${importCount} imports — may indicate too many responsibilities`,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }
  };

  walk(workspace);

  core.info(`Scanned ${filesScanned} source files, found ${findings.length} raw findings`);

  if (findings.length === 0) {
    return {
      items: [],
      filesScanned,
      summary: `Scanned ${filesScanned} source files. No notable technical debt indicators found.`,
    };
  }

  // Try Copilot-powered prioritization
  if (hasCopilotAuth() && findings.length > 0) {
    try {
      const items = await prioritizeWithCopilot(findings, repoContext, model);
      if (items.length > 0) {
        return {
          items,
          filesScanned,
          summary: `Scanned ${filesScanned} files. AI identified ${items.length} prioritized technical debt items from ${findings.length} raw findings.`,
        };
      }
    } catch (error) {
      core.warning(
        `Copilot debt analysis failed, using heuristic fallback: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Fallback: convert heuristic findings directly
  const items = heuristicToDebtItems(findings);
  return {
    items,
    filesScanned,
    summary: `Scanned ${filesScanned} files. Found ${items.length} technical debt items (heuristic analysis).`,
  };
}

/**
 * Uses Copilot to prioritize and consolidate findings
 */
async function prioritizeWithCopilot(
  findings: RawFinding[],
  repoContext: RepositoryContext,
  model: string
): Promise<TechnicalDebtItem[]> {
  const contextSection = formatContextForPrompt(repoContext);

  // Send top findings (limit to 30 for prompt size)
  const topFindings = findings.slice(0, 30);
  const findingsText = topFindings
    .map((f) => `[${f.category}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.detail}`)
    .join('\n');

  const prompt = `You are a technical debt analyst reviewing codebase scan results.

## Project Context
${contextSection}

## Raw Findings (${findings.length} total, showing top ${topFindings.length})
${findingsText}

## Task
Consolidate and prioritize these findings into 5-15 actionable technical debt items.
Group related findings, assign priorities based on project context, and estimate effort.

CRITICAL: Respond with ONLY a JSON array. No explanatory text.

[
  {
    "category": "complexity|maintenance|code-quality|architecture",
    "description": "Actionable description of the debt",
    "location": "file or area affected",
    "estimatedEffort": "small|medium|large",
    "priority": "low|medium|high"
  }
]`;

  const response = await sendPrompt(
    'You are a technical debt analyst. Output ONLY valid JSON.',
    prompt,
    { model }
  );

  if (response.content) {
    const parsed = parseAgentResponse<TechnicalDebtItem[]>(response.content);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }

  return [];
}

/**
 * Converts raw findings to TechnicalDebtItem[] without AI
 */
function heuristicToDebtItems(findings: RawFinding[]): TechnicalDebtItem[] {
  // Group by category and file
  const grouped = new Map<string, RawFinding[]>();
  for (const f of findings) {
    const key = `${f.category}:${f.file}`;
    const list = grouped.get(key) || [];
    list.push(f);
    grouped.set(key, list);
  }

  const items: TechnicalDebtItem[] = [];

  for (const [, group] of grouped) {
    const first = group[0]!;

    // Priority heuristic: HACK/FIXME > TODO > complexity > architecture
    let priority: 'low' | 'medium' | 'high' = 'low';
    const hasHack = group.some((f) => /HACK|FIXME|KLUDGE/i.test(f.detail));
    if (hasHack) priority = 'high';
    else if (first.category === 'complexity') priority = 'medium';
    else if (first.category === 'architecture') priority = 'medium';

    // Effort heuristic based on category
    const effort: 'small' | 'medium' | 'large' =
      first.category === 'maintenance' ? 'small' :
      first.category === 'complexity' ? 'large' : 'medium';

    if (group.length > 1) {
      items.push({
        category: first.category,
        description: `${group.length} ${first.category} items in ${first.file} (e.g., ${first.detail.substring(0, 80)})`,
        location: first.file,
        estimatedEffort: effort,
        priority,
      });
    } else {
      items.push({
        category: first.category,
        description: first.detail,
        location: first.file + (first.line ? `:${first.line}` : ''),
        estimatedEffort: effort,
        priority,
      });
    }
  }

  // Sort by priority (high first) and limit
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return items.slice(0, 20);
}
