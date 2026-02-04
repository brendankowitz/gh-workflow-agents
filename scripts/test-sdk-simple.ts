#!/usr/bin/env npx tsx
/**
 * Simple diagnostic test for Copilot SDK connectivity
 */

import { CopilotClient } from '@github/copilot-sdk';

async function main() {
  console.log('Testing Copilot SDK connectivity...\n');

  const client = new CopilotClient({
    logLevel: 'info',
  });

  try {
    console.log('1. Starting client...');
    await client.start();
    console.log('   Client started successfully\n');

    console.log('2. Checking auth status...');
    const authStatus = await client.getAuthStatus();
    console.log('   Auth status:', authStatus);
    console.log('   Authenticated:', authStatus.isAuthenticated);
    console.log('   Auth type:', authStatus.authType || '(none)');
    console.log('   User:', authStatus.login || '(unknown)');
    console.log();

    if (!authStatus.isAuthenticated) {
      console.log('ERROR: Not authenticated. Please run: copilot auth login');
      await client.stop();
      process.exit(1);
    }

    console.log('3. Listing available models...');
    const models = await client.listModels();
    console.log('   Available models:', models.map(m => m.id).join(', '));
    console.log();

    console.log('4. Creating session with a simple prompt...');
    const session = await client.createSession({
      model: 'claude-sonnet-4.5',
    });
    console.log('   Session created:', session.sessionId);

    // Listen for events
    session.on((event) => {
      if (event.type === 'assistant.message') {
        console.log('   Assistant response:', event.data.content.substring(0, 200));
      } else if (event.type === 'session.error') {
        console.log('   Session error:', event.data);
      }
    });

    console.log('5. Sending a simple prompt (30s timeout)...');
    const response = await session.sendAndWait({
      prompt: 'Reply with exactly: "Hello, the SDK is working!"',
    }, 30000);

    if (response) {
      console.log('   Response received!');
      console.log('   Content:', response.data.content);
    } else {
      console.log('   No response received');
    }

    console.log('\n6. Cleaning up...');
    await session.destroy();
    await client.stop();

    console.log('\nAll tests passed!');
  } catch (error) {
    console.error('\nError:', error);
    try {
      await client.stop();
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

main();
