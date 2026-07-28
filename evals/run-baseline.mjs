#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const caseId = process.argv[2];

if (process.argv.length !== 3) {
  console.error('Usage: node evals/run-baseline.mjs <case-id>');
  process.exit(1);
}

const evals = JSON.parse(readFileSync(join(evalsDir, 'evals.json'), 'utf8'));
const evalCase = evals.cases.find(({ id }) => id === caseId);

if (!evalCase) {
  console.error(`Unknown case ID: ${caseId}`);
  process.exit(1);
}

const fixture = join('/tmp', `red-light-green-light-baseline-${caseId}`);
rmSync(fixture, { recursive: true, force: true });
mkdirSync(join(fixture, 'src'), { recursive: true });
mkdirSync(join(fixture, 'docs', 'plans'), { recursive: true });
mkdirSync(join(fixture, 'tests'), { recursive: true });
writeFileSync(join(fixture, 'src', 'auth.js'), 'export const value = 1;\n');
writeFileSync(join(fixture, 'src', 'payment.js'), 'export const value = 1;\n');

function manifest(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
        continue;
      }

      const contents = readFileSync(absolutePath, 'utf8');
      files.push({
        path: relative(root, absolutePath).replaceAll('\\', '/'),
        contents,
        sha256: createHash('sha256').update(contents).digest('hex'),
      });
    }
  }

  if (existsSync(root)) visit(root);
  return files;
}

console.log('PRE-RUN MANIFEST');
console.log(JSON.stringify(manifest(fixture), null, 2));

const isWindows = process.platform === 'win32';
const command = isWindows ? 'powershell.exe' : 'pi';
const args = isWindows
  ? ['-NoProfile', '-NonInteractive', '-Command', '& pi --no-skills --no-extensions -p $env:RLGL_PROMPT']
  : ['--no-skills', '--no-extensions', '-p', evalCase.prompt];
const result = spawnSync(command, args, {
  cwd: fixture,
  encoding: 'utf8',
  shell: false,
  ...(isWindows ? { env: { ...process.env, RLGL_PROMPT: evalCase.prompt } } : {}),
});

const stdout = result.stdout ?? '';
const stderr = result.stderr ?? '';
process.stdout.write(stdout);
process.stderr.write(stderr);

const rawResultPath = join(evalsDir, 'results', 'baseline', `${caseId}.raw.txt`);
mkdirSync(dirname(rawResultPath), { recursive: true });
writeFileSync(rawResultPath, stdout);

console.log('POST-RUN MANIFEST');
console.log(JSON.stringify(manifest(fixture), null, 2));

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
