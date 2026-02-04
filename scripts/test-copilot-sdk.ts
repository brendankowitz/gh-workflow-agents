#!/usr/bin/env npx ts-node
/**
 * Test the Copilot SDK integration directly
 *
 * Usage:
 *   COPILOT_GITHUB_TOKEN=your_token npx ts-node scripts/test-copilot-sdk.ts
 *
 * Or create a .env file with COPILOT_GITHUB_TOKEN=your_token
 */

import { config } from 'dotenv';
config(); // Load .env file if present

import {
  sendPrompt,
  parseAgentResponse,
  createTriageSystemPrompt,
  buildSecurePrompt,
} from '../src/sdk/copilot-client.js';

async function testCopilotSDK() {
  console.log('='.repeat(60));
  console.log('Testing Copilot SDK Integration');
  console.log('='.repeat(60));

  // Check for token
  if (!process.env.COPILOT_GITHUB_TOKEN) {
    console.error('\nERROR: COPILOT_GITHUB_TOKEN environment variable is required');
    console.log('\nTo set it:');
    console.log('  1. Create a GitHub PAT with "Copilot Requests: Read" permission');
    console.log('  2. Run: COPILOT_GITHUB_TOKEN=your_token npx ts-node scripts/test-copilot-sdk.ts');
    console.log('  3. Or create a .env file with: COPILOT_GITHUB_TOKEN=your_token');
    process.exit(1);
  }

  console.log('\n✓ COPILOT_GITHUB_TOKEN found');

  // Test 1: Simple prompt
  console.log('\n--- Test 1: Simple Prompt ---');
  try {
    const result = await sendPrompt(
      'You are a helpful assistant that responds in JSON format.',
      'Respond with a JSON object containing a "status" field set to "ok" and a "message" field with a greeting.',
      { model: 'claude-sonnet-4.5' }
    );

    console.log('Response received:');
    console.log(`  Finish reason: ${result.finishReason}`);
    console.log(`  Content length: ${result.content.length} chars`);
    console.log(`  Content preview: ${result.content.substring(0, 200)}...`);

    const parsed = parseAgentResponse<{ status: string; message: string }>(result.content);
    if (parsed) {
      console.log('  Parsed JSON:', parsed);
      console.log('✓ Test 1 PASSED');
    } else {
      console.log('  Failed to parse response as JSON');
      console.log('✗ Test 1 FAILED');
    }
  } catch (error) {
    console.error('✗ Test 1 FAILED:', error);
  }

  // Test 2: Triage-style prompt
  console.log('\n--- Test 2: Issue Triage Prompt ---');
  try {
    const systemPrompt = createTriageSystemPrompt()
      .replace('{project_name}', 'test/repo')
      .replace('{context}', 'This is a test repository for healthcare data anonymization.');

    const userPrompt = buildSecurePrompt(
      { title: 'Add support for XML format', body: 'We need XML format support in addition to JSON.' },
      { title: 'Add support for XML format', body: 'We need XML format support in addition to JSON.' },
      'Analyze this issue and classify it.'
    );

    const result = await sendPrompt(systemPrompt, userPrompt, { model: 'claude-sonnet-4.5' });

    console.log('Response received:');
    console.log(`  Finish reason: ${result.finishReason}`);
    console.log(`  Content preview: ${result.content.substring(0, 300)}...`);

    const parsed = parseAgentResponse<{
      classification: string;
      priority: string;
      summary: string;
    }>(result.content);

    if (parsed && parsed.classification) {
      console.log('  Classification:', parsed.classification);
      console.log('  Priority:', parsed.priority);
      console.log('  Summary:', parsed.summary);
      console.log('✓ Test 2 PASSED');
    } else {
      console.log('  Failed to parse triage response');
      console.log('✗ Test 2 FAILED');
    }
  } catch (error) {
    console.error('✗ Test 2 FAILED:', error);
  }

  console.log('\n' + '='.repeat(60));
  console.log('Testing complete');
  console.log('='.repeat(60));
}

testCopilotSDK().catch(console.error);
