#!/usr/bin/env node

import { acquireEvaluationLock, runEvaluation } from './lib/eval-runner.mjs';

const caseId = process.argv[2];
if (process.argv.length !== 3) {
  console.error('Usage: node evals/run-with-skill.mjs <case-id>');
  process.exit(1);
}

let releaseLock;
try {
  releaseLock = acquireEvaluationLock();
  await runEvaluation({ caseId, withSkill: true });
} catch (error) {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
} finally {
  releaseLock?.();
}
