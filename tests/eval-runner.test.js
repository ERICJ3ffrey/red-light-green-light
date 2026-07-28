import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  GREEN_PLAN,
  buildAuthorityInitialization,
  buildPromptRecord,
  buildRpcInvocation,
  createFixture,
  createLfJsonlParser,
} from '../evals/lib/eval-runner.mjs';

const helper = readFileSync(new URL('../evals/lib/eval-runner.mjs', import.meta.url), 'utf8');
const baseline = readFileSync(new URL('../evals/run-baseline.mjs', import.meta.url), 'utf8');
const withSkill = readFileSync(new URL('../evals/run-with-skill.mjs', import.meta.url), 'utf8');
const skill = readFileSync(
  new URL('../skills/red-light-green-light/SKILL.md', import.meta.url),
  'utf8',
);

const cases = {
  red: { mode: 'red' },
  yellow: { mode: 'yellow', planningPath: 'docs/plans/payment-fix.md' },
  green: {
    mode: 'green',
    scope: 'Implement docs/plans/payment-fix.md',
    allowedPaths: ['src/payment.js', 'tests/payment.test.js'],
  },
};

test('authority initialization is derived exactly from evaluation metadata', () => {
  assert.equal(buildAuthorityInitialization(cases.red), '/light red');
  assert.equal(
    buildAuthorityInitialization(cases.yellow),
    '/light yellow docs/plans/payment-fix.md',
  );
  assert.equal(
    buildAuthorityInitialization(cases.green),
    '/light green Implement docs/plans/payment-fix.md --paths src/payment.js,tests/payment.test.js',
  );
});

test('prompt records preserve evaluated prompt bytes without rewriting', () => {
  const prompt = 'first\r\nsecond\nUnicode separators remain: \u2028 and \u2029';
  const record = buildPromptRecord('evaluated-turn', prompt);
  assert.equal(record.message, prompt);
  assert.equal(JSON.parse(JSON.stringify(record)).message, prompt);
  assert.match(helper, /const evaluatedPrompt = evalCase\.prompt;/);
  assert.match(helper, /sendPrompt\('evaluated-turn', evaluatedPrompt\)/);
  assert.doesNotMatch(helper, /evaluatedPrompt\s*=\s*[^;]*(?:trim|replace|concat)/);
});

test('runner waits for initialization to settle before sending evaluated turn', () => {
  assert.match(helper, /settledCount === 1/);
  assert.match(helper, /phase = 'evaluated';\s*sendPrompt\('evaluated-turn', evaluatedPrompt\)/s);
  assert.match(helper, /settledCount === 2/);
  assert.match(helper, /sendPrompt\('authority-initialization', initializationPrompt\)/);
});

test('Green fixture plan is concrete and identical for baseline and with-skill', () => {
  assert.match(GREEN_PLAN, /src\/payment\.js[^\n]*from `1` to `2`/);
  assert.match(GREEN_PLAN, /tests\/payment\.test\.js[^\n]*value is `2`/);
  assert.match(GREEN_PLAN, /Do not touch `src\/auth\.js`, `package\.json`, or any unlisted file/);

  for (const variant of ['baseline', 'with-skill']) {
    const fixture = createFixture({
      caseId: 'green-rejects-scope-drift',
      evalCase: { id: 'green-rejects-scope-drift' },
      variant,
    });
    try {
      assert.equal(readFileSync(join(fixture, 'docs', 'plans', 'payment-fix.md'), 'utf8'), GREEN_PLAN);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('non-Windows RPC invocation uses required flags without a shell', () => {
  const baselineInvocation = buildRpcInvocation({ withSkill: false, platform: 'linux' });
  assert.equal(baselineInvocation.command, 'pi');
  assert.deepEqual(baselineInvocation.args, [
    '--mode',
    'rpc',
    '--no-session',
    '--no-skills',
    '--no-extensions',
  ]);
  assert.equal(baselineInvocation.shell, false);

  const skillInvocation = buildRpcInvocation({
    withSkill: true,
    skillPath: '/canonical/skill',
    platform: 'linux',
  });
  assert.deepEqual(skillInvocation.args, [
    '--mode',
    'rpc',
    '--no-session',
    '--no-skills',
    '--no-extensions',
    '--skill',
    '/canonical/skill',
  ]);
  assert.equal(skillInvocation.shell, false);
});

test('Windows RPC invocation is static and passes only skill path through env', () => {
  const dangerousPrompt = 'DO NOT INTERPOLATE; Write-Error hacked';
  const baselineInvocation = buildRpcInvocation({
    withSkill: false,
    skillPath: dangerousPrompt,
    platform: 'win32',
  });
  assert.equal(baselineInvocation.command, 'powershell.exe');
  assert.equal(baselineInvocation.shell, false);
  assert.deepEqual(baselineInvocation.envOverrides, {});
  assert.doesNotMatch(baselineInvocation.args.join(' '), /DO NOT INTERPOLATE/);

  const skillInvocation = buildRpcInvocation({
    withSkill: true,
    skillPath: 'C:\\canonical skill',
    platform: 'win32',
  });
  assert.equal(
    skillInvocation.args.at(-1),
    '& pi --mode rpc --no-session --no-skills --no-extensions --skill $env:RLGL_SKILL_PATH',
  );
  assert.deepEqual(skillInvocation.envOverrides, { RLGL_SKILL_PATH: 'C:\\canonical skill' });
  assert.equal(skillInvocation.shell, false);
  assert.doesNotMatch(JSON.stringify(skillInvocation), /RLGL_PROMPT/);
});

test('RPC output parser splits only on LF and rejects an unterminated record', () => {
  const records = [];
  const parser = createLfJsonlParser((record) => records.push(record));
  parser.push('{"text":"a\u2028b\u2029c"}\r');
  parser.push('\n{"type":"agent_settled"}\n');
  parser.finish();
  assert.deepEqual(records, [{ text: 'a\u2028b\u2029c' }, { type: 'agent_settled' }]);
  assert.doesNotMatch(helper, /node:readline|createInterface\(/);

  const incomplete = createLfJsonlParser(() => {});
  incomplete.push('{"incomplete":true}');
  assert.throws(() => incomplete.finish(), /incomplete LF-delimited JSON record/);
});

test('runners write complete evidence to distinct raw result directories', () => {
  assert.match(helper, /join\(evalsDir, 'results', variant, `\$\{caseId\}\.raw\.txt`\)/);
  assert.match(helper, /toolExecutionEvents/);
  assert.match(helper, /preManifest/);
  assert.match(helper, /postManifest/);
  assert.match(helper, /initializationAssistantText/);
  assert.match(helper, /finalAssistantText/);
  assert.match(helper, /recordCounts/);
  assert.match(helper, /stderr: rpc\.stderr/);
  assert.doesNotMatch(helper, /stdout: rpc\.stdout|rpcRecords|records: rpc\./);
  assert.doesNotMatch(helper, /`\$\{caseId\}\.md`/);
  assert.match(baseline, /withSkill: false/);
  assert.match(withSkill, /withSkill: true/);
});

test('skill description is cue-focused without promising native always-on loading', () => {
  const description = skill.match(/^description: (.+)$/m)?.[1] ?? '';
  assert.doesNotMatch(description, /start of coding-agent sessions/i);
  for (const cue of [
    'authority discovery',
    'red light',
    'yellow light',
    'green light',
    'planning-only work',
  ]) {
    assert.match(description, new RegExp(cue));
  }
});
