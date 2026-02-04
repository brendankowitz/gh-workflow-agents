import { describe, it, expect } from 'vitest';
import {
  validateTriageOutput,
  validateReviewOutput,
  safeParseJson,
} from '../output-validator.js';

describe('validateTriageOutput', () => {
  it('should parse valid JSON output', () => {
    const output = JSON.stringify({
      classification: 'bug',
      labels: ['bug', 'security'],
      priority: 'high',
      summary: 'Test summary',
      reasoning: 'Test reasoning',
      needsHumanReview: false,
    });

    const result = validateTriageOutput(output);
    expect(result.classification).toBe('bug');
    expect(result.priority).toBe('high');
    expect(result.labels).toContain('bug');
    expect(result.labels).toContain('security');
  });

  it('should extract JSON from markdown code blocks', () => {
    const output = '```json\n{"classification": "feature", "priority": "medium"}\n```';
    const result = validateTriageOutput(output);
    expect(result.classification).toBe('feature');
    expect(result.priority).toBe('medium');
  });

  it('should filter invalid labels', () => {
    const output = JSON.stringify({
      classification: 'bug',
      labels: ['bug', 'invalid-label', 'security', 'malicious-label'],
      priority: 'medium',
    });

    const result = validateTriageOutput(output);
    expect(result.labels).toContain('bug');
    expect(result.labels).toContain('security');
    expect(result.labels).not.toContain('invalid-label');
    expect(result.labels).not.toContain('malicious-label');
  });

  it('should default invalid classification to question', () => {
    const output = JSON.stringify({
      classification: 'malicious-type',
      priority: 'medium',
    });

    const result = validateTriageOutput(output);
    expect(result.classification).toBe('question');
  });

  it('should default invalid priority to medium', () => {
    const output = JSON.stringify({
      classification: 'bug',
      priority: 'extreme',
    });

    const result = validateTriageOutput(output);
    expect(result.priority).toBe('medium');
  });

  it('should return safe default on parse failure', () => {
    const result = validateTriageOutput('not valid json at all');
    expect(result.classification).toBe('question');
    expect(result.needsHumanReview).toBe(true);
    expect(result.labels).toContain('needs-human-review');
  });

  it('should truncate overly long text fields', () => {
    const output = JSON.stringify({
      classification: 'bug',
      summary: 'a'.repeat(5000),
      priority: 'medium',
    });

    const result = validateTriageOutput(output);
    expect(result.summary.length).toBeLessThanOrEqual(2003); // 2000 + "..."
  });
});

describe('validateReviewOutput', () => {
  it('should parse valid review output', () => {
    const output = JSON.stringify({
      overallAssessment: 'approve',
      securityIssues: [],
      codeQualityIssues: [],
      suggestions: [],
      summary: 'LGTM',
    });

    const result = validateReviewOutput(output);
    expect(result.overallAssessment).toBe('approve');
    expect(result.summary).toBe('LGTM');
  });

  it('should validate security issues', () => {
    const output = JSON.stringify({
      overallAssessment: 'request-changes',
      securityIssues: [
        {
          severity: 'high',
          file: 'src/auth.ts',
          line: 42,
          description: 'Hardcoded password',
          suggestion: 'Use environment variable',
        },
      ],
      summary: 'Security issue found',
    });

    const result = validateReviewOutput(output);
    expect(result.securityIssues).toHaveLength(1);
    expect(result.securityIssues[0].severity).toBe('high');
    expect(result.securityIssues[0].file).toBe('src/auth.ts');
  });

  it('should sanitize file paths to prevent traversal', () => {
    const output = JSON.stringify({
      overallAssessment: 'comment',
      securityIssues: [
        {
          severity: 'medium',
          file: '../../../etc/passwd',
          description: 'Test',
        },
      ],
      summary: 'Test',
    });

    const result = validateReviewOutput(output);
    expect(result.securityIssues[0].file).not.toContain('..');
  });

  it('should handle Windows paths in file sanitization', () => {
    const output = JSON.stringify({
      overallAssessment: 'comment',
      securityIssues: [
        {
          severity: 'medium',
          file: 'C:/Windows/System32/config',
          description: 'Test',
        },
      ],
      summary: 'Test',
    });

    const result = validateReviewOutput(output);
    // Windows drive letter should be removed (security requirement)
    expect(result.securityIssues[0].file).not.toMatch(/^[A-Za-z]:/);
    // Should not start with slash (no absolute paths)
    expect(result.securityIssues[0].file).not.toMatch(/^[/\\]/);
    // Path should be preserved without drive letter
    expect(result.securityIssues[0].file).toBe('Windows/System32/config');
  });

  it('should default invalid assessment to comment', () => {
    const output = JSON.stringify({
      overallAssessment: 'force-merge',
      summary: 'Test',
    });

    const result = validateReviewOutput(output);
    expect(result.overallAssessment).toBe('comment');
  });
});

describe('safeParseJson', () => {
  it('should parse valid JSON', () => {
    const result = safeParseJson<{ foo: string }>('{"foo": "bar"}');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('should return null for invalid JSON', () => {
    const result = safeParseJson('not json');
    expect(result).toBeNull();
  });
});
