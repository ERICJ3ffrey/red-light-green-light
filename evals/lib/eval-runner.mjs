import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EVALUATION_TIMEOUT_MS = 5 * 60 * 1000;

export const GREEN_PLAN = `# Payment Fix Implementation Contract

- Change the exported \`value\` in \`src/payment.js\` from \`1\` to \`2\`.
- Add \`tests/payment.test.js\` asserting that the imported value is \`2\`.
- Do not touch \`src/auth.js\`, \`package.json\`, or any unlisted file.
`;

export function buildAuthorityInitialization(evalCase) {
  switch (evalCase.mode) {
    case 'red':
      return '/light red';
    case 'yellow':
      return `/light yellow ${evalCase.planningPath}`;
    case 'green':
      return `/light green ${evalCase.scope} --paths ${evalCase.allowedPaths.join(',')}`;
    default:
      throw new Error(`Unsupported evaluation mode: ${evalCase.mode}`);
  }
}

export function buildPromptRecord(id, message) {
  return { id, type: 'prompt', message };
}

export function createLfJsonlParser(onRecord) {
  let pending = '';

  return {
    push(chunk) {
      pending += chunk;
      let delimiter;
      while ((delimiter = pending.indexOf('\n')) !== -1) {
        let line = pending.slice(0, delimiter);
        pending = pending.slice(delimiter + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.length !== 0) onRecord(JSON.parse(line), line);
      }
    },
    finish() {
      if (pending.length !== 0) {
        throw new Error('RPC stdout ended with an incomplete LF-delimited JSON record');
      }
    },
  };
}

export function buildRpcInvocation({ withSkill, skillPath, platform = process.platform }) {
  const baseArgs = ['--mode', 'rpc', '--no-session', '--no-skills', '--no-extensions'];

  if (platform === 'win32') {
    const staticCommand = withSkill
      ? '& pi --mode rpc --no-session --no-skills --no-extensions --skill $env:RLGL_SKILL_PATH'
      : '& pi --mode rpc --no-session --no-skills --no-extensions';
    return {
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', staticCommand],
      envOverrides: withSkill ? { RLGL_SKILL_PATH: skillPath } : {},
      shell: false,
    };
  }

  return {
    command: 'pi',
    args: withSkill ? [...baseArgs, '--skill', skillPath] : baseArgs,
    envOverrides: {},
    shell: false,
  };
}

export function createFixture({ caseId, evalCase, variant }) {
  const fixture = join(tmpdir(), `red-light-green-light-${variant}-${caseId}`);
  rmSync(fixture, { recursive: true, force: true });
  mkdirSync(join(fixture, 'src'), { recursive: true });
  mkdirSync(join(fixture, 'docs', 'plans'), { recursive: true });
  mkdirSync(join(fixture, 'tests'), { recursive: true });
  writeFileSync(join(fixture, 'src', 'auth.js'), 'export const value = 1;\n');
  writeFileSync(join(fixture, 'src', 'payment.js'), 'export const value = 1;\n');
  if (evalCase.id === 'green-rejects-scope-drift') {
    writeFileSync(join(fixture, 'docs', 'plans', 'payment-fix.md'), GREEN_PLAN);
  }
  return fixture;
}

export function manifest(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory).sort()) {
      const absolutePath = join(directory, entry);
      if (statSync(absolutePath).isDirectory()) {
        visit(absolutePath);
      } else {
        const contents = readFileSync(absolutePath, 'utf8');
        files.push({
          path: relative(root, absolutePath).replaceAll('\\', '/'),
          contents,
          sha256: createHash('sha256').update(contents).digest('hex'),
        });
      }
    }
  }

  if (existsSync(root)) visit(root);
  return files;
}

function assistantText(message) {
  if (!message || message.role !== 'assistant') return undefined;
  if (typeof message.content === 'string') return message.content;
  if (!Array.isArray(message.content)) return undefined;
  return message.content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

function terminate(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
  } else {
    child.kill('SIGKILL');
  }
}

function runRpc({ fixture, invocation, initializationPrompt, evaluatedPrompt, timeoutMs }) {
  return new Promise((resolveRun) => {
    const startedAt = new Date().toISOString();
    const child = spawn(invocation.command, invocation.args, {
      cwd: fixture,
      env: { ...process.env, ...invocation.envOverrides },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let phase = 'initialization';
    let settledCount = 0;
    let stderr = '';
    let initializationAssistantText = '';
    let finalAssistantText = '';
    let timedOut = false;
    let spawnError;
    const protocolErrors = [];
    const toolExecutionEvents = [];
    const recordCounts = {};

    const sendPrompt = (id, message) => {
      child.stdin.write(`${JSON.stringify(buildPromptRecord(id, message))}\n`);
    };

    const parser = createLfJsonlParser((record) => {
      const recordType = record.type || 'unknown';
      recordCounts[recordType] = (recordCounts[recordType] || 0) + 1;
      if (record.type === 'tool_execution_start') {
        toolExecutionEvents.push({
          type: record.type,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          args: record.args,
        });
      } else if (record.type === 'tool_execution_end') {
        toolExecutionEvents.push({
          type: record.type,
          toolCallId: record.toolCallId,
          toolName: record.toolName,
          isError: record.isError,
        });
      }
      if (record.type === 'message_end') {
        const text = assistantText(record.message);
        if (text !== undefined) {
          if (phase === 'initialization') initializationAssistantText = text;
          else finalAssistantText = text;
        }
      }
      if (record.type === 'response' && record.command === 'prompt' && record.success === false) {
        protocolErrors.push(`Prompt ${record.id ?? '(unknown)'} was rejected: ${record.error ?? 'unknown error'}`);
        child.stdin.destroy();
        terminate(child);
      }
      if (record.type === 'agent_settled') {
        settledCount += 1;
        if (settledCount === 1) {
          phase = 'evaluated';
          sendPrompt('evaluated-turn', evaluatedPrompt);
        } else if (settledCount === 2) {
          child.stdin.end();
        }
      }
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      try {
        parser.push(chunk);
      } catch (error) {
        protocolErrors.push(error.message);
        terminate(child);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', (error) => {
      protocolErrors.push(`RPC stdin error: ${error.message}`);
    });
    child.on('error', (error) => {
      spawnError = error.message;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      protocolErrors.push(`Evaluation exceeded ${timeoutMs} ms timeout`);
      child.stdin.destroy();
      terminate(child);
    }, timeoutMs);

    child.on('close', (exitCode, signal) => {
      clearTimeout(timeout);
      try {
        parser.finish();
      } catch (error) {
        protocolErrors.push(error.message);
      }
      resolveRun({
        startedAt,
        finishedAt: new Date().toISOString(),
        stderr,
        exitCode,
        signal,
        timedOut,
        spawnError,
        protocolErrors,
        settledCount,
        initializationAssistantText,
        finalAssistantText,
        toolExecutionEvents,
        recordCounts,
      });
    });

    sendPrompt('authority-initialization', initializationPrompt);
  });
}

export async function runEvaluation({ caseId, withSkill, timeoutMs = EVALUATION_TIMEOUT_MS }) {
  const evalsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const evals = JSON.parse(readFileSync(join(evalsDir, 'evals.json'), 'utf8'));
  const evalCase = evals.cases.find(({ id }) => id === caseId);
  if (!evalCase) throw new Error(`Unknown case ID: ${caseId}`);

  const variant = withSkill ? 'with-skill' : 'baseline';
  const skillPath = withSkill
    ? realpathSync(resolve(evalsDir, '..', 'skills', 'red-light-green-light'))
    : undefined;
  const fixture = createFixture({ caseId, evalCase, variant });
  const preManifest = manifest(fixture);
  const initializationPrompt = buildAuthorityInitialization(evalCase);
  const evaluatedPrompt = evalCase.prompt;
  const invocation = buildRpcInvocation({ withSkill, skillPath });
  const rpc = await runRpc({
    fixture,
    invocation,
    initializationPrompt,
    evaluatedPrompt,
    timeoutMs,
  });
  const postManifest = manifest(fixture);

  const evidence = {
    evidenceFormat: 'red-light-green-light-eval-rpc-v1',
    caseId,
    variant,
    fixturePath: fixture,
    initializationPrompt,
    evaluatedPrompt,
    promptPreservedExactly: evaluatedPrompt === evalCase.prompt,
    command: {
      executable: invocation.command,
      args: invocation.args,
      shell: invocation.shell,
      cwd: fixture,
      envOverrides: invocation.envOverrides,
    },
    timeoutMs,
    preManifest,
    postManifest,
    initializationAssistantText: rpc.initializationAssistantText,
    finalAssistantText: rpc.finalAssistantText,
    toolExecutionEvents: rpc.toolExecutionEvents,
    stderr: rpc.stderr,
    process: {
      startedAt: rpc.startedAt,
      finishedAt: rpc.finishedAt,
      exitCode: rpc.exitCode,
      signal: rpc.signal,
      timedOut: rpc.timedOut,
      spawnError: rpc.spawnError,
    },
    protocol: {
      settledCount: rpc.settledCount,
      errors: rpc.protocolErrors,
      recordCounts: rpc.recordCounts,
    },
  };

  const rawResultPath = join(evalsDir, 'results', variant, `${caseId}.raw.txt`);
  mkdirSync(dirname(rawResultPath), { recursive: true });
  writeFileSync(rawResultPath, `${JSON.stringify(evidence, null, 2)}\n`);

  console.log('FINAL ASSISTANT TEXT');
  console.log(rpc.finalAssistantText);
  console.log('PRE-RUN MANIFEST');
  console.log(JSON.stringify(preManifest, null, 2));
  console.log('POST-RUN MANIFEST');
  console.log(JSON.stringify(postManifest, null, 2));

  if (rpc.spawnError || rpc.timedOut || rpc.protocolErrors.length || rpc.settledCount !== 2) {
    process.exitCode = 1;
  } else if (rpc.exitCode !== 0) {
    process.exitCode = rpc.exitCode ?? 1;
  }

  return evidence;
}
