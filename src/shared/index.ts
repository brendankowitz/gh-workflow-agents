/**
 * GH-Agency Shared Module Exports
 */

// Types
export * from './types.js';

// Sanitization
export {
  sanitizeInput,
  sanitizeIssue,
  sanitizeUrl,
  stripShellMetacharacters,
  wrapWithTrustBoundary,
  type SanitizeResult,
} from './sanitizer.js';

// Output validation
export {
  validateTriageOutput,
  validateReviewOutput,
  safeParseJson,
} from './output-validator.js';

// Circuit breaker
export {
  checkCircuitBreaker,
  createCircuitBreakerContext,
  createDispatchPayload,
  createTimeout,
  hasStopCommand,
  incrementDispatchDepth,
  isBot,
  parseDispatchDepth,
  updateCircuitBreaker,
  withTimeout,
  CircuitBreakerError,
  type CircuitBreakerErrorType,
} from './circuit-breaker.js';
