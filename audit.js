#!/usr/bin/env node
import { execSync } from 'node:child_process';
const url = process.argv[2];
if (!url) {
  console.error('Usage: npm run flash:all -- <url>');
  process.exit(1);
}
execSync(`npm run flash:all --url=${url}`, { stdio: 'inherit' });