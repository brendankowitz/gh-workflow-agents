import { describe, it, expect } from 'vitest';
import {
  checkCircuitBreaker,
  createCircuitBreakerContext,
  updateCircuitBreaker,
  parseDispatchDepth,
  isBot,
  hasStopCommand,
  CircuitBreakerError,
} from '../circuit-breaker.js';

describe('createCircuitBreakerContext', () => {
  it('should create default context', () => {
    const ctx = createCircuitBreakerContext();
    expect(ctx.dispatchDepth).toBe(0);
    expect(ctx.iterationCount).toBe(0);
    expect(ctx.previousHashes).toEqual([]);
    expect(ctx.lastOutput).toBeUndefined();
  });

  it('should accept initial values', () => {
    const ctx = createCircuitBreakerContext(2, 3);
    expect(ctx.dispatchDepth).toBe(2);
    expect(ctx.iterationCount).toBe(3);
  });
});

describe('checkCircuitBreaker', () => {
  it('should pass for fresh context', () => {
    const ctx = createCircuitBreakerContext();
    expect(() => checkCircuitBreaker(ctx)).not.toThrow();
  });

  it('should throw on max dispatch depth', () => {
    const ctx = createCircuitBreakerContext(3, 0);
    expect(() => checkCircuitBreaker(ctx)).toThrow(CircuitBreakerError);
    expect(() => checkCircuitBreaker(ctx)).toThrow('Maximum dispatch depth');
  });

  it('should throw on max iterations', () => {
    const ctx = createCircuitBreakerContext(0, 5);
    expect(() => checkCircuitBreaker(ctx)).toThrow(CircuitBreakerError);
    expect(() => checkCircuitBreaker(ctx)).toThrow('Maximum iterations');
  });

  it('should throw on repetitive output', () => {
    let ctx = createCircuitBreakerContext();
    ctx = updateCircuitBreaker(ctx, 'same output');
    ctx = updateCircuitBreaker(ctx, 'different output');
    ctx = { ...ctx, lastOutput: 'same output' };
    
    expect(() => checkCircuitBreaker(ctx)).toThrow('repetitive output');
  });
});

describe('updateCircuitBreaker', () => {
  it('should increment iteration count', () => {
    const ctx = createCircuitBreakerContext();
    const updated = updateCircuitBreaker(ctx, 'output');
    expect(updated.iterationCount).toBe(1);
  });

  it('should track output hash', () => {
    const ctx = createCircuitBreakerContext();
    const updated = updateCircuitBreaker(ctx, 'output');
    expect(updated.previousHashes).toHaveLength(1);
    expect(updated.lastOutput).toBe('output');
  });

  it('should limit hash history to 10', () => {
    let ctx = createCircuitBreakerContext();
    for (let i = 0; i < 15; i++) {
      ctx = updateCircuitBreaker(ctx, `output-${i}`);
    }
    expect(ctx.previousHashes.length).toBeLessThanOrEqual(10);
  });
});

describe('parseDispatchDepth', () => {
  it('should parse number from payload', () => {
    expect(parseDispatchDepth({ dispatch_depth: 2 })).toBe(2);
  });

  it('should parse string from payload', () => {
    expect(parseDispatchDepth({ dispatch_depth: '3' })).toBe(3);
  });

  it('should return 0 for missing depth', () => {
    expect(parseDispatchDepth({})).toBe(0);
    expect(parseDispatchDepth(null)).toBe(0);
    expect(parseDispatchDepth(undefined)).toBe(0);
  });

  it('should return 0 for negative values', () => {
    expect(parseDispatchDepth({ dispatch_depth: -1 })).toBe(0);
  });
});

describe('isBot', () => {
  it('should detect bot accounts', () => {
    expect(isBot('dependabot[bot]')).toBe(true);
    expect(isBot('github-actions[bot]')).toBe(true);
    expect(isBot('renovate[bot]')).toBe(true);
    expect(isBot('codecov[bot]')).toBe(true);
    expect(isBot('someapp[bot]')).toBe(true);
  });

  it('should detect bots without [bot] suffix', () => {
    expect(isBot('github-actions')).toBe(true);
    expect(isBot('dependabot')).toBe(true);
    expect(isBot('copilot-swe-agent')).toBe(true);
  });

  it('should not flag normal users', () => {
    expect(isBot('octocat')).toBe(false);
    expect(isBot('john-doe')).toBe(false);
    expect(isBot('mybotuser')).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isBot('DEPENDABOT[BOT]')).toBe(true);
    expect(isBot('GitHub-Actions[bot]')).toBe(true);
  });
});

describe('hasStopCommand', () => {
  it('should detect stop commands', () => {
    expect(hasStopCommand('/stop')).toBe(true);
    expect(hasStopCommand('Please /stop the bot')).toBe(true);
    expect(hasStopCommand('/override')).toBe(true);
    expect(hasStopCommand('/human review needed')).toBe(true);
    expect(hasStopCommand('/halt')).toBe(true);
    expect(hasStopCommand('/cancel this')).toBe(true);
  });

  it('should be case insensitive', () => {
    expect(hasStopCommand('/STOP')).toBe(true);
    expect(hasStopCommand('/Stop')).toBe(true);
  });

  it('should not flag normal content', () => {
    expect(hasStopCommand('Please stop doing this')).toBe(false);
    expect(hasStopCommand('This is a normal comment')).toBe(false);
  });
});
