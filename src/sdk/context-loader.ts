/**
 * GH-Agency Repository Context Loader
 * Loads vision and context files from repositories
 *
 * Automatically reads VISION.md, README.md, CONTRIBUTING.md,
 * ROADMAP.md, and ARCHITECTURE.md to provide context for agents.
 */

import type { Octokit } from '@octokit/rest';
import type { RepositoryContext } from '../shared/types.js';

/** Files to load for context, in priority order */
const CONTEXT_FILES = [
  { name: 'VISION.md', key: 'vision' },
  { name: 'README.md', key: 'readme' },
  { name: 'CONTRIBUTING.md', key: 'contributing' },
  { name: 'ROADMAP.md', key: 'roadmap' },
  { name: 'ARCHITECTURE.md', key: 'architecture' },
] as const;

/** Maximum file size to load (100KB) */
const MAX_FILE_SIZE = 100 * 1024;

/** Maximum total context size (500KB) */
const MAX_TOTAL_SIZE = 500 * 1024;

/** Logger interface for context loader */
export interface ContextLoaderLogger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

/** Default console logger */
const defaultLogger: ContextLoaderLogger = {
  info: (msg) => {}, // Silent by default
  warn: (msg) => console.warn(`[context-loader] ${msg}`),
  error: (msg) => console.error(`[context-loader] ${msg}`),
};

/** Options for context loading */
export interface ContextLoaderOptions {
  /** Only load specific files */
  files?: Array<(typeof CONTEXT_FILES)[number]['name']>;
  /** Custom file paths to load */
  customFiles?: Array<{ name: string; path: string; key: string }>;
  /** Branch/ref to load from */
  ref?: string;
  /** Maximum total size for all context */
  maxTotalSize?: number;
  /** Logger for diagnostic messages */
  logger?: ContextLoaderLogger;
}

/**
 * Loads repository context files for agent grounding
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param options - Loading options
 * @returns Repository context with loaded files
 */
export async function loadRepositoryContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  options: ContextLoaderOptions = {}
): Promise<RepositoryContext> {
  const context: RepositoryContext = {
    name: repo,
    owner,
  };

  const maxTotal = options.maxTotalSize || MAX_TOTAL_SIZE;
  const logger = options.logger || defaultLogger;
  let totalSize = 0;

  // Determine which files to load
  const filesToLoad = options.files
    ? CONTEXT_FILES.filter((f) => options.files?.includes(f.name))
    : CONTEXT_FILES;

  // Load standard context files
  for (const file of filesToLoad) {
    if (totalSize >= maxTotal) {
      logger.warn(`Context size limit reached, skipping ${file.name}`);
      break;
    }

    const content = await loadFile(octokit, owner, repo, file.name, options.ref, logger);

    if (content) {
      const truncated = truncateContent(content, MAX_FILE_SIZE, maxTotal - totalSize);
      (context as unknown as Record<string, string | undefined>)[file.key] = truncated;
      totalSize += truncated.length;
    }
  }

  // Load custom files if specified
  if (options.customFiles) {
    for (const file of options.customFiles) {
      if (totalSize >= maxTotal) {
        logger.warn(`Context size limit reached, skipping custom file ${file.name}`);
        break;
      }

      const content = await loadFile(octokit, owner, repo, file.path, options.ref, logger);

      if (content) {
        const truncated = truncateContent(content, MAX_FILE_SIZE, maxTotal - totalSize);
        (context as unknown as Record<string, string | undefined>)[file.key] = truncated;
        totalSize += truncated.length;
      }
    }
  }

  logger.info(`Loaded context for ${owner}/${repo}: ${totalSize} bytes`);
  return context;
}

/**
 * Loads a single file from the repository
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @param path - File path
 * @param ref - Git ref (branch/tag/sha)
 * @returns File content or null if not found
 */
async function loadFile(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
  logger: ContextLoaderLogger = defaultLogger
): Promise<string | null> {
  try {
    const response = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    // Handle file response (not directory)
    if ('type' in response.data && response.data.type === 'file') {
      const file = response.data;

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        logger.warn(`File ${path} exceeds size limit (${file.size} > ${MAX_FILE_SIZE})`);
        return null;
      }

      // Decode base64 content
      if (file.encoding === 'base64' && file.content) {
        return Buffer.from(file.content, 'base64').toString('utf-8');
      }
    }

    return null;
  } catch (error) {
    // 404 is expected for optional files
    if (isNotFoundError(error)) {
      return null;
    }

    logger.error(`Error loading file ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Checks if an error is a 404 Not Found
 */
function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    (error as { status: number }).status === 404
  );
}

/**
 * Truncates content to fit within limits
 *
 * @param content - Content to truncate
 * @param maxFileSize - Maximum size per file
 * @param remainingBudget - Remaining context budget
 * @returns Truncated content
 */
function truncateContent(content: string, maxFileSize: number, remainingBudget: number): string {
  const limit = Math.min(maxFileSize, remainingBudget);

  if (content.length <= limit) {
    return content;
  }

  // Try to truncate at a line boundary
  const truncated = content.substring(0, limit);
  const lastNewline = truncated.lastIndexOf('\n');

  if (lastNewline > limit * 0.8) {
    return truncated.substring(0, lastNewline) + '\n\n[...content truncated for context limits...]';
  }

  return truncated + '\n\n[...content truncated for context limits...]';
}

/**
 * Formats repository context as a system prompt section
 *
 * @param context - Loaded repository context
 * @returns Formatted string for system prompt
 */
export function formatContextForPrompt(context: RepositoryContext): string {
  const sections: string[] = [];

  sections.push(`# Repository: ${context.owner}/${context.name}`);

  if (context.vision) {
    sections.push('## Project Vision\n' + context.vision);
  }

  if (context.readme) {
    sections.push('## README (Project Overview)\n' + context.readme);
  }

  if (context.contributing) {
    sections.push('## Contributing Guidelines\n' + context.contributing);
  }

  if (context.architecture) {
    sections.push('## Architecture\n' + context.architecture);
  }

  if (context.roadmap) {
    sections.push('## Roadmap\n' + context.roadmap);
  }

  if (sections.length === 1) {
    sections.push(
      '\n*No vision or context documents found in repository. ' +
        'Using generic open source project guidelines.*'
    );
  }

  return sections.join('\n\n');
}

/**
 * Quick check if repository has a VISION.md file
 *
 * @param octokit - Authenticated Octokit instance
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns True if VISION.md exists
 */
export async function hasVisionDocument(
  octokit: Octokit,
  owner: string,
  repo: string
): Promise<boolean> {
  try {
    await octokit.rest.repos.getContent({
      owner,
      repo,
      path: 'VISION.md',
    });
    return true;
  } catch {
    return false;
  }
}
