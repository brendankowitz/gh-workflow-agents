#!/usr/bin/env node
/**
 * Bundle GitHub Actions for distribution
 *
 * This script bundles each action into a single file in its dist/ folder
 * so it can be used directly from GitHub without npm install.
 */

import { build } from 'esbuild';
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const actions = [
  'triage-agent',
  'review-agent',
  'research-agent',
];

async function bundleAction(actionName) {
  const actionDir = join(rootDir, 'actions', actionName);
  const distDir = join(actionDir, 'dist');
  const entryPoint = join(rootDir, 'dist', 'actions', actionName, 'index.js');

  // Create dist directory
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Check if entry point exists
  if (!existsSync(entryPoint)) {
    console.error(`Entry point not found: ${entryPoint}`);
    console.error(`Make sure to run 'npm run build' first`);
    process.exit(1);
  }

  console.log(`Bundling ${actionName}...`);

  await build({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    target: 'node20',
    outfile: join(distDir, 'index.js'),
    format: 'cjs', // GitHub Actions requires CommonJS
    minify: false, // Keep readable for debugging
    sourcemap: false,
    external: [], // Bundle everything
  });

  console.log(`  ✓ ${actionName} bundled to ${join(distDir, 'index.js')}`);
}

async function main() {
  console.log('Bundling GitHub Actions...\n');

  for (const action of actions) {
    await bundleAction(action);
  }

  console.log('\nAll actions bundled successfully!');
}

main().catch((err) => {
  console.error('Bundle failed:', err);
  process.exit(1);
});
