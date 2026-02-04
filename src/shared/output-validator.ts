/**
 * GH-Agency Output Validator
 * Validates and sanitizes LLM outputs before use
 *
 * Ensures all outputs conform to expected schemas and don't contain
 * any unauthorized or dangerous content.
 */

import {
  ALLOWED_LABELS,
  type AllowedLabel,
  type TriageResult,
  type ReviewResult,
  type ReviewIssue,
} from './types.js';
import { stripShellMetacharacters } from './sanitizer.js';

/** Maximum allowed length for text fields */
const MAX_TEXT_LENGTH = {
  summary: 2000,
  reasoning: 1000,
  description: 500,
  suggestion: 500,
};

/** Priority values that are allowed */
const ALLOWED_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
type Priority = (typeof ALLOWED_PRIORITIES)[number];

/** Classification values that are allowed */
const ALLOWED_CLASSIFICATIONS = ['bug', 'feature', 'question', 'documentation', 'spam'] as const;
type Classification = (typeof ALLOWED_CLASSIFICATIONS)[number];

/** Review assessment values */
const ALLOWED_ASSESSMENTS = ['approve', 'request-changes', 'comment'] as const;
type Assessment = (typeof ALLOWED_ASSESSMENTS)[number];

/** Severity values */
const ALLOWED_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;
type Severity = (typeof ALLOWED_SEVERITIES)[number];

/**
 * Validates and sanitizes a triage output from the LLM
 *
 * @param output - Raw output from LLM (JSON string or object)
 * @returns Validated and sanitized triage result
 */
export function validateTriageOutput(output: string | object): TriageResult {
  let parsed: Record<string, unknown>;

  // Parse if string
  if (typeof output === 'string') {
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch?.[1] ?? output;
      parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
    } catch {
      // If parsing fails, return a safe default
      return createDefaultTriageResult('Failed to parse LLM output as JSON');
    }
  } else {
    parsed = output as Record<string, unknown>;
  }

  // Validate classification
  const rawClassification = String(parsed['classification'] || 'question').toLowerCase();
  const classification: Classification = ALLOWED_CLASSIFICATIONS.includes(
    rawClassification as Classification
  )
    ? (rawClassification as Classification)
    : 'question';

  // Validate and filter labels
  const rawLabels = Array.isArray(parsed['labels']) ? parsed['labels'] : [];
  const labels: AllowedLabel[] = rawLabels
    .map((l) => String(l).toLowerCase())
    .filter((l): l is AllowedLabel => ALLOWED_LABELS.includes(l as AllowedLabel));

  // Validate priority
  const rawPriority = String(parsed['priority'] || 'medium').toLowerCase();
  const priority: Priority = ALLOWED_PRIORITIES.includes(rawPriority as Priority)
    ? (rawPriority as Priority)
    : 'medium';

  // Sanitize text fields
  const summary = sanitizeTextField(String(parsed['summary'] || ''), MAX_TEXT_LENGTH.summary);
  const reasoning = sanitizeTextField(
    String(parsed['reasoning'] || ''),
    MAX_TEXT_LENGTH.reasoning
  );

  // Validate duplicate reference
  let duplicateOf: number | undefined;
  if (parsed['duplicateOf'] !== undefined && parsed['duplicateOf'] !== null) {
    const dupNum = parseInt(String(parsed['duplicateOf']), 10);
    if (!isNaN(dupNum) && dupNum > 0) {
      duplicateOf = dupNum;
    }
  }

  // Validate boolean fields
  const needsHumanReview = Boolean(parsed['needsHumanReview']);
  const isActionable = Boolean(parsed['isActionable']);
  const alignsWithVision = parsed['alignsWithVision'] !== false; // Default to true

  // Validate string fields for actionability
  const actionabilityReason = sanitizeTextField(
    String(parsed['actionabilityReason'] || ''),
    MAX_TEXT_LENGTH.reasoning
  );
  const visionAlignmentReason = sanitizeTextField(
    String(parsed['visionAlignmentReason'] || ''),
    MAX_TEXT_LENGTH.reasoning
  );

  // Validate recommended action
  const allowedActions = ['assign-to-agent', 'request-clarification', 'close-as-wontfix', 'close-as-duplicate', 'human-review'] as const;
  type RecommendedAction = (typeof allowedActions)[number];
  const rawAction = String(parsed['recommendedAction'] || 'human-review').toLowerCase();
  const recommendedAction: RecommendedAction = allowedActions.includes(rawAction as RecommendedAction)
    ? (rawAction as RecommendedAction)
    : 'human-review';

  // Collect any injection flags from validation
  const injectionFlagsDetected: string[] = [];
  if (Array.isArray(parsed['injectionFlagsDetected'])) {
    for (const flag of parsed['injectionFlagsDetected']) {
      if (typeof flag === 'string' && flag.length < 100) {
        injectionFlagsDetected.push(flag);
      }
    }
  }

  return {
    classification,
    labels,
    priority,
    summary,
    reasoning,
    duplicateOf,
    needsHumanReview,
    injectionFlagsDetected,
    isActionable,
    actionabilityReason,
    alignsWithVision,
    visionAlignmentReason,
    recommendedAction,
  };
}

/**
 * Validates and sanitizes a review output from the LLM
 *
 * @param output - Raw output from LLM
 * @returns Validated review result
 */
export function validateReviewOutput(output: string | object): ReviewResult {
  let parsed: Record<string, unknown>;

  if (typeof output === 'string') {
    try {
      const jsonMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch?.[1] ?? output;
      parsed = JSON.parse(jsonStr.trim()) as Record<string, unknown>;
    } catch {
      return createDefaultReviewResult('Failed to parse LLM output as JSON');
    }
  } else {
    parsed = output as Record<string, unknown>;
  }

  // Validate assessment
  const rawAssessment = String(parsed['overallAssessment'] || 'comment').toLowerCase();
  const overallAssessment: Assessment = ALLOWED_ASSESSMENTS.includes(rawAssessment as Assessment)
    ? (rawAssessment as Assessment)
    : 'comment';

  // Validate issues arrays
  const securityIssues = validateIssueArray(parsed['securityIssues']);
  const codeQualityIssues = validateIssueArray(parsed['codeQualityIssues']);

  // Validate suggestions
  const suggestions = validateSuggestionArray(parsed['suggestions']);

  // Sanitize summary
  const summary = sanitizeTextField(String(parsed['summary'] || ''), MAX_TEXT_LENGTH.summary);

  return {
    overallAssessment,
    securityIssues,
    codeQualityIssues,
    suggestions,
    summary,
  };
}

/**
 * Validates an array of review issues
 */
function validateIssueArray(input: unknown): ReviewIssue[] {
  if (!Array.isArray(input)) return [];

  return input
    .slice(0, 50) // Limit to 50 issues max
    .map((item): ReviewIssue | null => {
      if (typeof item !== 'object' || item === null) return null;

      const obj = item as Record<string, unknown>;

      const rawSeverity = String(obj['severity'] || 'medium').toLowerCase();
      const severity: Severity = ALLOWED_SEVERITIES.includes(rawSeverity as Severity)
        ? (rawSeverity as Severity)
        : 'medium';

      const file = sanitizeFilePath(String(obj['file'] || 'unknown'));
      const line =
        typeof obj['line'] === 'number' && obj['line'] > 0 ? Math.floor(obj['line']) : undefined;
      const description = sanitizeTextField(
        String(obj['description'] || ''),
        MAX_TEXT_LENGTH.description
      );
      const suggestion = obj['suggestion']
        ? sanitizeTextField(String(obj['suggestion']), MAX_TEXT_LENGTH.suggestion)
        : undefined;

      return { severity, file, line, description, suggestion };
    })
    .filter((item): item is ReviewIssue => item !== null);
}

/**
 * Validates an array of suggestions
 */
function validateSuggestionArray(
  input: unknown
): Array<{ file: string; line?: number; suggestion: string; rationale: string }> {
  if (!Array.isArray(input)) return [];

  const result: Array<{ file: string; line?: number; suggestion: string; rationale: string }> = [];
  
  for (const item of input.slice(0, 20)) {
    if (typeof item !== 'object' || item === null) continue;

    const obj = item as Record<string, unknown>;

    result.push({
      file: sanitizeFilePath(String(obj['file'] || 'unknown')),
      line:
        typeof obj['line'] === 'number' && obj['line'] > 0 ? Math.floor(obj['line']) : undefined,
      suggestion: sanitizeTextField(
        String(obj['suggestion'] || ''),
        MAX_TEXT_LENGTH.suggestion
      ),
      rationale: sanitizeTextField(String(obj['rationale'] || ''), MAX_TEXT_LENGTH.reasoning),
    });
  }
  
  return result;
}

/**
 * Sanitizes a text field by removing dangerous characters and truncating
 */
function sanitizeTextField(text: string, maxLength: number): string {
  // Remove shell metacharacters
  let sanitized = stripShellMetacharacters(text);

  // Normalize whitespace
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Truncate
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength - 3) + '...';
  }

  return sanitized;
}

/**
 * Sanitizes a file path to prevent path traversal
 */
function sanitizeFilePath(path: string): string {
  let sanitized = path;

  // Remove Windows drive letters (e.g., C:\, C:/, D:\, D:/)
  sanitized = sanitized.replace(/^[a-zA-Z]:[/\\]?/, '');

  // Remove Windows UNC paths (e.g., \\server\share, //server/share)
  sanitized = sanitized.replace(/^[/\\]{2,}[^/\\]+[/\\]?/, '');

  // Normalize backslashes to forward slashes
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove any path traversal attempts
  sanitized = sanitized.replace(/\.\./g, '').replace(/\/\//g, '/');

  // Remove leading slashes (keep relative paths)
  sanitized = sanitized.replace(/^\/+/, '');

  // Limit length
  if (sanitized.length > 256) {
    sanitized = sanitized.substring(0, 256);
  }

  return sanitized || 'unknown';
}

/**
 * Creates a default triage result for error cases
 */
function createDefaultTriageResult(reason: string): TriageResult {
  return {
    classification: 'question',
    labels: ['needs-human-review'],
    priority: 'medium',
    summary: reason,
    reasoning: 'Automatic fallback due to processing error',
    needsHumanReview: true,
    injectionFlagsDetected: [],
    isActionable: false,
    actionabilityReason: 'Unable to assess due to processing error',
    alignsWithVision: true,
    visionAlignmentReason: 'Unable to assess due to processing error',
    recommendedAction: 'human-review',
  };
}

/**
 * Creates a default review result for error cases
 */
function createDefaultReviewResult(reason: string): ReviewResult {
  return {
    overallAssessment: 'comment',
    securityIssues: [],
    codeQualityIssues: [],
    suggestions: [],
    summary: reason,
  };
}

/**
 * Validates that a string is valid JSON and returns parsed object
 */
export function safeParseJson<T>(json: string): T | null {
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
