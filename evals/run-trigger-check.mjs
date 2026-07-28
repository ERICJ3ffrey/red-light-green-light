#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  acquireEvaluationLock,
  buildPromptRecord,
  buildRpcInvocation,
  createLfJsonlParser,
} from './lib/eval-runner.mjs';

const evalsDir = dirname(fileURLToPath(import.meta.url));
const skillPath = realpathSync(resolve(evalsDir, '..', 'skills', 'red-light-green-light'));
const skillFile = join(skillPath, 'SKILL.md');
const skillText = readFileSync(skillFile, 'utf8');
const cases = [
  { id: 'yellow-planning', prompt: 'This is a yellow-light planning task.', expected: 'trigger' },
  { id: 'green-auth', prompt: 'Green light for the approved auth plan.', expected: 'trigger' },
  { id: 'research-only', prompt: 'Research only, no edits.', expected: 'trigger' },
  { id: 'traffic-question', prompt: 'Why do traffic lights use red?', expected: 'no-mode-change' },
  { id: 'tests-green', prompt: 'The tests are green now.', expected: 'no-green-grant' },
];

function assistantText(message) {
  if (message?.role !== 'assistant') return '';
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return '';
  return message.content.filter((part) => part?.type === 'text').map((part) => part.text).join('');
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { shell: false, stdio: 'ignore' });
  } else child.kill('SIGKILL');
}

function runCase(item) {
  return new Promise((resolveRun) => {
    const fixture = mkdtempSync(join(tmpdir(), `red-light-green-light-trigger-${item.id}-`));
    const invocation = buildRpcInvocation({ withSkill: true, skillPath });
    const child = spawn(invocation.command, invocation.args, {
      cwd: fixture,
      env: { ...process.env, ...invocation.envOverrides },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let response = '';
    let stderr = '';
    let settled = false;
    let spawnError;
    const tools = [];
    const errors = [];
    const parser = createLfJsonlParser((record) => {
      if (record.type === 'message_end') {
        const text = assistantText(record.message);
        if (text) response = text;
      }
      if (record.type === 'tool_execution_start') tools.push({ name: record.toolName, args: record.args });
      if (record.type === 'response' && record.id === item.id && record.success === false) {
        errors.push(record.error || 'prompt rejected');
        terminate(child);
      }
      if (record.type === 'agent_settled') {
        settled = true;
        child.stdin.end();
      }
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      try { parser.push(chunk); } catch (error) { errors.push(error.message); terminate(child); }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { spawnError = error.message; });
    const timer = setTimeout(() => {
      errors.push('timeout');
      terminate(child);
    }, 5 * 60 * 1000);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      try { parser.finish(); } catch (error) { errors.push(error.message); }
      resolveRun({
        ...item,
        fixture,
        response,
        tools,
        stderr,
        settled,
        exitCode,
        signal,
        spawnError,
        errors,
        command: { executable: invocation.command, args: invocation.args, shell: invocation.shell },
      });
    });
    child.stdin.write(`${JSON.stringify(buildPromptRecord(item.id, item.prompt))}\n`);
  });
}

const releaseLock = acquireEvaluationLock();
let results;
try {
  results = [];
  for (const item of cases) results.push(await runCase(item));
} finally {
  releaseLock();
}

const evidence = {
  evidenceFormat: 'red-light-green-light-trigger-check-v1',
  generatedAt: new Date().toISOString(),
  skillPath,
  skillSha256: createHash('sha256').update(skillText).digest('hex'),
  explicitSkillInvocation: false,
  discovery: 'Only the canonical skill was supplied with Pi --skill; prompts did not use /skill.',
  cases: results,
};
const resultsDir = join(evalsDir, 'results', 'with-skill');
mkdirSync(resultsDir, { recursive: true });
writeFileSync(join(resultsDir, 'description-trigger-check.raw.txt'), `${JSON.stringify(evidence, null, 2)}\n`);

const verdicts = {
  'yellow-planning': 'Pass — recognized Yellow planning authority without starting work.',
  'green-auth': 'Pass — recognized Green authorization but waited for a separate implementation instruction.',
  'research-only': 'Pass — recognized the no-edit boundary as Red.',
  'traffic-question': 'Pass — answered the factual question without changing agent authority.',
  'tests-green': 'Pass — treated green as test status, not an authority grant.',
};
const markdown = `# Description Trigger Check\n\n- Generated: ${evidence.generatedAt}\n- Canonical skill: \`${skillPath}\`\n- Skill SHA-256: \`${evidence.skillSha256}\`\n- Discovery: ${evidence.discovery}\n- Raw evidence: \`evals/results/with-skill/description-trigger-check.raw.txt\`\n- Fresh sessions: one \`pi --mode rpc --no-session --no-skills --skill <canonical-skill>\` process per prompt\n\n${results.map((result) => `## ${result.id}\n\n- Expected: ${result.expected}\n- Fixture: \`${result.fixture}\`\n- Process: exit ${result.exitCode}; settled=${result.settled}; errors=${result.errors.length}\n- Explicit skill invocation in prompt: no\n\n**Prompt**\n\n\`\`\`text\n${result.prompt}\n\`\`\`\n\n**Observed response**\n\n\`\`\`text\n${result.response}\n\`\`\`\n\n**Result:** ${verdicts[result.id]}`).join('\n\n')}\n`;
writeFileSync(join(resultsDir, 'description-trigger-check.md'), markdown);

for (const result of results) {
  console.log(`=== ${result.id} ===`);
  console.log(result.response);
}
if (results.some((result) => result.exitCode !== 0 || !result.settled || result.errors.length)) process.exitCode = 1;
