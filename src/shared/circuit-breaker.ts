/**
 * GH-Agency Circuit Breaker
 * Prevents infinite loops, runaway costs, and repetitive behavior
 *
 * Implements multiple safety mechanisms:
 * - Maximum iteration limits
 * - Dispatch depth tracking
 * - Repetitive output detection
 * - Timeout enforcement
 */

import { createHash } from 'crypto';
import type { CircuitBreakerContext } from './types.js';

/** Maximum number of iterations before hard stop */
const MAX_ITERATIONS = 5;

/** Maximum dispatch depth (for cross-repo triggers) */
const MAX_DISPATCH_DEPTH = 3;

/** Maximum number of output hashes to track for repetition detection */
const MAX_HASH_HISTORY = 10;

/** Circuit breaker error types */
export class CircuitBreakerError extends Error {
  constructor(
    message: string,
    public readonly errorType: CircuitBreakerErrorType
  ) {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export type CircuitBreakerErrorType =
  | 'max-iterations'
  | 'max-depth'
  | 'repetitive-output'
  | 'timeout';

/**
 * Creates a new circuit breaker context
 */
export function createCircuitBreakerContext(
  dispatchDepth = 0,
  iterationCount = 0
): CircuitBreakerContext {
  return {
    dispatchDepth,
    iterationCount,
    previousHashes: [],
    lastOutput: undefined,
  };
}

/**
 * Parses dispatch depth from GitHub event payload
 *
 * @param payload - GitHub event client_payload
 * @returns Dispatch depth from payload or 0
 */
export function parseDispatchDepth(payload: unknown): number {
  if (typeof payload !== 'object' || payload === null) {
    return 0;
  }

  const obj = payload as Record<string, unknown>;
  const depth = obj['dispatch_depth'];

  if (typeof depth === 'number' && depth >= 0) {
    return Math.floor(depth);
  }

  if (typeof depth === 'string') {
    const parsed = parseInt(depth, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

/**
 * Checks the circuit breaker and throws if limits exceeded
 *
 * @param context - Current circuit breaker context
 * @throws CircuitBreakerError if any limit is exceeded
 */
export function checkCircuitBreaker(context: CircuitBreakerContext): void {
  // Check dispatch depth
  if (context.dispatchDepth >= MAX_DISPATCH_DEPTH) {
    throw new CircuitBreakerError(
      `Maximum dispatch depth (${MAX_DISPATCH_DEPTH}) exceeded. ` +
        `Current depth: ${context.dispatchDepth}. ` +
        `This prevents infinite cross-repository trigger loops.`,
      'max-depth'
    );
  }

  // Check iteration count
  if (context.iterationCount >= MAX_ITERATIONS) {
    throw new CircuitBreakerError(
      `Maximum iterations (${MAX_ITERATIONS}) exceeded. ` +
        `Current count: ${context.iterationCount}. ` +
        `This prevents runaway agent behavior.`,
      'max-iterations'
    );
  }

  // Check for repetitive outputs
  if (context.lastOutput) {
    const outputHash = hashOutput(context.lastOutput);
    if (context.previousHashes.includes(outputHash)) {
      throw new CircuitBreakerError(
        'Detected repetitive output pattern. ' +
          'The agent is producing identical outputs, indicating a potential loop. ' +
          'Halting to prevent waste.',
        'repetitive-output'
      );
    }
  }
}

/**
 * Updates the circuit breaker context after an iteration
 *
 * @param context - Current context
 * @param output - Output from this iteration
 * @returns Updated context
 */
export function updateCircuitBreaker(
  context: CircuitBreakerContext,
  output: string
): CircuitBreakerContext {
  const outputHash = hashOutput(output);

  // Add new hash and keep history bounded
  const previousHashes = [...context.previousHashes, outputHash].slice(-MAX_HASH_HISTORY);

  return {
    dispatchDepth: context.dispatchDepth,
    iterationCount: context.iterationCount + 1,
    previousHashes,
    lastOutput: output,
  };
}

/**
 * Increments dispatch depth for cross-repository events
 *
 * @param context - Current context
 * @returns Context with incremented dispatch depth
 */
export function incrementDispatchDepth(context: CircuitBreakerContext): CircuitBreakerContext {
  return {
    ...context,
    dispatchDepth: context.dispatchDepth + 1,
  };
}

/**
 * Hashes an output for repetition detection
 *
 * @param output - Output string to hash
 * @returns Short hash of the output
 */
function hashOutput(output: string): string {
  return createHash('sha256').update(output).digest('hex').substring(0, 16);
}

/**
 * Creates a timeout promise that rejects after specified duration
 *
 * @param ms - Timeout in milliseconds
 * @param operation - Description of the operation for error message
 * @returns Promise that rejects after timeout
 */
export function createTimeout(ms: number, operation: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new CircuitBreakerError(`Operation "${operation}" timed out after ${ms}ms`, 'timeout'));
    }, ms);
  });
}

/**
 * Wraps an async operation with a timeout
 *
 * @param operation - The async operation to run
 * @param timeoutMs - Maximum time allowed
 * @param operationName - Name for error messages
 * @returns Result of the operation
 * @throws CircuitBreakerError if timeout exceeded
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  operationName: string
): Promise<T> {
  return Promise.race([operation, createTimeout(timeoutMs, operationName)]);
}

/**
 * Generates client payload with circuit breaker info for repository dispatch
 *
 * @param context - Current circuit breaker context
 * @param additionalPayload - Additional data to include
 * @returns Payload object with circuit breaker info
 */
export function createDispatchPayload(
  context: CircuitBreakerContext,
  additionalPayload: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...additionalPayload,
    dispatch_depth: context.dispatchDepth + 1,
    iteration_count: context.iterationCount,
  };
}

/**
 * Checks if the current actor is a bot (to prevent self-triggering loops)
 *
 * @param actor - GitHub actor username
 * @returns True if actor is a bot
 */
export function isBot(actor: string): boolean {
  const botPatterns = [
    /\[bot\]$/i,                    // Any bot suffix (e.g., "dependabot[bot]")
    /^github-actions(\[bot\])?$/i,  // github-actions or github-actions[bot]
    /^dependabot(\[bot\])?$/i,      // dependabot or dependabot[bot]
    /^renovate(\[bot\])?$/i,        // renovate or renovate[bot]
    /^copilot-swe-agent$/i,         // Copilot SWE agent
    /^codecov(\[bot\])?$/i,         // Codecov bot
    /^greenkeeper(\[bot\])?$/i,     // Greenkeeper bot
    /^snyk-bot$/i,                  // Snyk bot
  ];

  const lowerActor = actor.toLowerCase();
  return botPatterns.some((pattern) => pattern.test(lowerActor));
}

/**
 * Checks if a comment contains a stop command
 *
 * @param body - Comment body
 * @returns True if stop command detected
 */
export function hasStopCommand(body: string): boolean {
  const stopCommands = ['/stop', '/override', '/human', '/halt', '/cancel'];
  const lowerBody = body.toLowerCase();
  return stopCommands.some((cmd) => lowerBody.includes(cmd));
}
