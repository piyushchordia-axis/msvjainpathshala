#!/usr/bin/env -S npx tsx

import { execSync, type ExecSyncOptions } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// ---------- Types ----------

type GroundTruthCmd = {
  label: string;
  command: string;
  allowFailure?: boolean;
  maxBytes?: number;
};

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';
type SettingSource = 'user' | 'project' | 'local';

type RunnerConfig = {
  promptsFile: string;
  promptsFormat: 'markdown' | 'json';
  promptsPattern: string;

  model: string;
  effort: Effort;
  thinking: { type: 'adaptive' | 'enabled' | 'disabled'; budget_tokens?: number };
  settingSources: SettingSource[];
  permissionMode: PermissionMode;
  allowedTools: string[] | null;
  disallowedTools: string[] | null;
  maxTurns: number | null;

  cwd: string;

  blockSize: number;
  contextWindowTokens: number;
  compactAtPercent: number;
  extraContext: string;
  groundTruth: GroundTruthCmd[];

  planModePrompts: number[];
  planPhaseInstruction: string;
  execPhaseInstruction: string;
  autoAnswerQuestions: boolean;

  stateDir: string;
  stopOnError: boolean;
  commitBetweenSteps: boolean;
  commitMessageTemplate: string;

  startAt: number | null;
  endAt: number | null;
  only: number | null;
  dryRun: boolean;
};

type LoadedPrompt = { index: number; title: string; body: string };

type HistoryEntry = {
  index: number;
  title: string;
  sessionId: string;
  durationMs: number;
  costUsd: number;
  success: boolean;
  error?: string;
};

type RunnerState = {
  lastCompletedIndex: number | null;
  lastSessionId: string | null;
  lastInputTokens: number;
  blockCheckpoint: string;
  history: HistoryEntry[];
};

// ---------- Defaults ----------

const DEFAULTS: RunnerConfig = {
  promptsFile: 'prompts.md',
  promptsFormat: 'markdown',
  promptsPattern: '^## PROMPT (\\d+)\\s*[—-]?\\s*(.*)$',

  model: 'claude-opus-4-7[1m]',
  effort: 'xhigh',
  thinking: { type: 'adaptive' },
  settingSources: ['user', 'project', 'local'],
  permissionMode: 'bypassPermissions',
  allowedTools: null,
  disallowedTools: null,
  maxTurns: null,

  cwd: process.cwd(),

  blockSize: 6,
  contextWindowTokens: 1_000_000,
  compactAtPercent: 0.6,
  extraContext: '',
  groundTruth: [
    { label: 'git status', command: 'git status --short', allowFailure: true, maxBytes: 4000 },
    {
      label: 'git diff (HEAD)',
      command: 'git diff --stat HEAD',
      allowFailure: true,
      maxBytes: 4000,
    },
  ],

  planModePrompts: [4, 5, 8, 13, 14, 23],
  planPhaseInstruction:
    'Use plan mode. Read every file you need to understand the current state, then produce a complete step-by-step implementation plan via ExitPlanMode. Number the steps, name every file you will create or modify, and call out the verification commands. Do NOT modify any files in this phase.',
  execPhaseInstruction:
    'Now execute the plan you just produced. Permissions are bypassed for this phase — apply every file change in the plan, run any required commands, and verify with typecheck/tests at the end. If you discover that part of the plan is wrong, adapt minimally but stay close to it. Do not re-plan; execute.',
  autoAnswerQuestions: true,

  stateDir: '.agent-runner',
  stopOnError: true,
  commitBetweenSteps: false,
  commitMessageTemplate: 'feat: prompt {{n}} — {{title}}',

  startAt: null,
  endAt: null,
  only: null,
  dryRun: false,
};

// ---------- CLI ----------

const HELP = `
Sequential prompt runner (Claude Agent SDK)

Usage:
  yarn start --config config.json
  yarn start --config config.json --from 9              # resume after manual prompts 0-8
  yarn start --config config.json --start 5 --end 10
  yarn start --config config.json --only 8 --dry-run

Options:
  --config <path>         JSON config file (relative to cwd or absolute)
  --prompts <path>        Override promptsFile
  --from <n>              Alias for --start (resume from prompt N)
  --start <n>             Start at prompt N (matches the number in the prompt header)
  --end <n>               Stop after prompt N (inclusive)
  --only <n>              Run only prompt N
  --block-size <n>        Session pyramiding block size (default 6)
  --compact-at <0..1>     Force a new session when prior turn's input tokens
                          exceed this fraction of contextWindowTokens
                          (default 0.6 = 60% of 1M for claude-opus-4-7[1m])
  --model <id>            Model id (default claude-opus-4-7[1m] for 1M context)
  --effort <level>        low|medium|high|xhigh|max (default xhigh)
  --permission-mode <m>   default|acceptEdits|bypassPermissions|plan|dontAsk|auto
                          (default: bypassPermissions — runs unattended)
  --plan-prompts <csv>    Comma-separated prompt numbers that should use
                          two-phase plan-then-execute (default: 4,5,8,13,14,23)
  --no-plan-mode          Disable plan mode for all prompts
  --no-auto-answer        Don't auto-pick first option for AskUserQuestion
                          (without this flag, questions are auto-answered)
  --cwd <path>            Working directory the agent should operate in
  --dry-run               Print plan without executing
  --no-stop-on-error      Continue past failed prompts
  --commit                Commit after each successful prompt
  --help                  Show this message

Context behaviour:
  Within one block, prompts use continue:true and share the full transcript
  of all prior prompts in that block — same as a single interactive Claude
  Code session. At a block boundary (prompt-count OR token-threshold), the
  runner starts a fresh session and injects a synthesized summary of the
  prior block plus current git state. The SDK does not expose an auto-
  compaction threshold; the token-threshold trigger is how this runner
  approximates "compact at 60%".

Fast mode (Opus) is a user-level toggle, not an SDK option. To enable it
for runs, toggle /fast once in an interactive Claude Code session — it
persists in your user settings and applies to SDK calls too.
`.trim();

function parseCli() {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      prompts: { type: 'string' },
      start: { type: 'string' },
      from: { type: 'string' },
      end: { type: 'string' },
      only: { type: 'string' },
      'block-size': { type: 'string' },
      'compact-at': { type: 'string' },
      model: { type: 'string' },
      effort: { type: 'string' },
      'permission-mode': { type: 'string' },
      'plan-prompts': { type: 'string' },
      'no-plan-mode': { type: 'boolean' },
      'no-auto-answer': { type: 'boolean' },
      cwd: { type: 'string' },
      'dry-run': { type: 'boolean' },
      'no-stop-on-error': { type: 'boolean' },
      commit: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  return values;
}

// ---------- Helpers ----------

function loadConfig(configPath: string | undefined): RunnerConfig {
  if (!configPath) return { ...DEFAULTS };
  const abs = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);
  const raw = JSON.parse(readFileSync(abs, 'utf8')) as Partial<RunnerConfig>;
  return { ...DEFAULTS, ...raw };
}

function mergeCliOverrides(cfg: RunnerConfig, cli: ReturnType<typeof parseCli>): RunnerConfig {
  const out = { ...cfg };
  if (cli.prompts) out.promptsFile = cli.prompts;
  if (cli.from) out.startAt = Number(cli.from);
  if (cli.start) out.startAt = Number(cli.start);
  if (cli.end) out.endAt = Number(cli.end);
  if (cli.only) out.only = Number(cli.only);
  if (cli['block-size']) out.blockSize = Number(cli['block-size']);
  if (cli['compact-at']) out.compactAtPercent = Number(cli['compact-at']);
  if (cli.model) out.model = cli.model;
  if (cli.effort) out.effort = cli.effort as Effort;
  if (cli['permission-mode']) out.permissionMode = cli['permission-mode'] as PermissionMode;
  if (cli['plan-prompts']) {
    out.planModePrompts = cli['plan-prompts']
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));
  }
  if (cli['no-plan-mode']) out.planModePrompts = [];
  if (cli['no-auto-answer']) out.autoAnswerQuestions = false;
  if (cli.cwd) out.cwd = cli.cwd;
  if (cli['dry-run']) out.dryRun = true;
  if (cli['no-stop-on-error']) out.stopOnError = false;
  if (cli.commit) out.commitBetweenSteps = true;
  return out;
}

function resolveFromCwd(p: string, baseCwd: string) {
  return isAbsolute(p) ? p : resolve(baseCwd, p);
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function loadPrompts(cfg: RunnerConfig): LoadedPrompt[] {
  const path = resolveFromCwd(cfg.promptsFile, process.cwd());
  const raw = readFileSync(path, 'utf8');

  if (cfg.promptsFormat === 'json') {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) throw new Error('promptsFile JSON must be an array');
    return data.map((item, i) => {
      if (typeof item === 'string') return { index: i + 1, title: `Prompt ${i + 1}`, body: item };
      const obj = item as { index?: number; title?: string; prompt?: string; body?: string };
      return {
        index: obj.index ?? i + 1,
        title: obj.title ?? `Prompt ${i + 1}`,
        body: obj.prompt ?? obj.body ?? '',
      };
    });
  }

  const re = new RegExp(cfg.promptsPattern);
  const lines = raw.split('\n');
  const segments: { index: number; title: string; startLine: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(re);
    if (m) {
      segments.push({
        index: Number(m[1]),
        title: (m[2] ?? '').trim() || `Prompt ${m[1]}`,
        startLine: i,
      });
    }
  }
  const prompts: LoadedPrompt[] = [];
  for (let s = 0; s < segments.length; s++) {
    const start = segments[s]!.startLine;
    const end = s + 1 < segments.length ? segments[s + 1]!.startLine : lines.length;
    const body = lines.slice(start, end).join('\n').trim();
    prompts.push({ index: segments[s]!.index, title: segments[s]!.title, body });
  }
  return prompts;
}

function filterPrompts(prompts: LoadedPrompt[], cfg: RunnerConfig): LoadedPrompt[] {
  return prompts.filter((p) => {
    if (cfg.only != null) return p.index === cfg.only;
    if (cfg.startAt != null && p.index < cfg.startAt) return false;
    if (cfg.endAt != null && p.index > cfg.endAt) return false;
    return true;
  });
}

function runGroundTruth(cfg: RunnerConfig): string {
  if (!cfg.groundTruth.length) return '';
  const opts: ExecSyncOptions = {
    cwd: cfg.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  };
  const blocks: string[] = [];
  for (const g of cfg.groundTruth) {
    try {
      let out = execSync(g.command, opts).toString();
      if (g.maxBytes && out.length > g.maxBytes) {
        out = out.slice(-g.maxBytes) + '\n...(truncated)...';
      }
      blocks.push(`### ${g.label}\n\`\`\`\n${out.trim() || '(empty)'}\n\`\`\``);
    } catch (e) {
      if (g.allowFailure) {
        const msg = e instanceof Error ? e.message : String(e);
        blocks.push(`### ${g.label}\n\`\`\`\n(command failed: ${msg})\n\`\`\``);
      } else {
        throw e;
      }
    }
  }
  return blocks.join('\n\n');
}

function loadState(stateDir: string): RunnerState {
  const f = join(stateDir, 'state.json');
  if (!existsSync(f)) {
    return {
      lastCompletedIndex: null,
      lastSessionId: null,
      lastInputTokens: 0,
      blockCheckpoint: '',
      history: [],
    };
  }
  return JSON.parse(readFileSync(f, 'utf8')) as RunnerState;
}

function saveState(stateDir: string, state: RunnerState) {
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state, null, 2));
}

function buildPromptBody(args: {
  prompt: LoadedPrompt;
  startsNewBlock: boolean;
  blockCheckpoint: string;
  groundTruth: string;
  extraContext: string;
}): string {
  const parts: string[] = [];
  if (args.extraContext) parts.push(args.extraContext.trim());
  if (args.startsNewBlock && args.blockCheckpoint) {
    parts.push(`## Summary of prior block\n\n${args.blockCheckpoint.trim()}`);
  }
  if (args.groundTruth) {
    parts.push(`## Current repository state\n\n${args.groundTruth}`);
  }
  parts.push(
    `## Your task — Prompt ${args.prompt.index}: ${args.prompt.title}\n\n${args.prompt.body}`,
  );
  return parts.join('\n\n---\n\n');
}

function makeCanUseTool(cfg: RunnerConfig): NonNullable<Options['canUseTool']> {
  return async (toolName, input) => {
    if (toolName === 'AskUserQuestion' && cfg.autoAnswerQuestions) {
      const questions =
        (
          input as {
            questions?: Array<{
              question: string;
              options: Array<{ label: string }>;
              multiSelect?: boolean;
            }>;
          }
        ).questions ?? [];
      const answers: Record<string, string | string[]> = {};
      for (const q of questions) {
        const first = q.options[0]?.label ?? '';
        answers[q.question] = q.multiSelect ? [first] : first;
      }
      return { behavior: 'allow', updatedInput: { questions, answers } };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

function buildOptions(args: {
  cfg: RunnerConfig;
  permissionMode: PermissionMode;
  useContinue: boolean;
  canUseTool: NonNullable<Options['canUseTool']>;
}): Options {
  const { cfg, permissionMode, useContinue, canUseTool } = args;
  return {
    model: cfg.model,
    effort: cfg.effort,
    thinking: cfg.thinking,
    settingSources: cfg.settingSources,
    permissionMode,
    cwd: cfg.cwd,
    canUseTool,
    ...(cfg.allowedTools ? { allowedTools: cfg.allowedTools } : {}),
    ...(cfg.disallowedTools ? { disallowedTools: cfg.disallowedTools } : {}),
    ...(cfg.maxTurns ? { maxTurns: cfg.maxTurns } : {}),
    ...(useContinue ? { continue: true } : {}),
  };
}

type SdkCallResult = {
  sessionId: string;
  cost: number;
  success: boolean;
  resultText: string;
  errorMsg?: string;
  inputTokens: number;
  durationMs: number;
};

async function runSdkCall(args: {
  body: string;
  options: Options;
  logFile: string;
  phase?: string;
}): Promise<SdkCallResult> {
  const { body, options, logFile, phase } = args;
  if (phase) appendFileSync(logFile, JSON.stringify({ kind: 'phase', phase }) + '\n');
  appendFileSync(logFile, JSON.stringify({ kind: 'prompt', phase, body }) + '\n');

  const started = Date.now();
  let sessionId = '';
  let cost = 0;
  let success = false;
  let resultText = '';
  let errorMsg: string | undefined;
  let inputTokens = 0;

  try {
    for await (const msg of query({ prompt: body, options })) {
      appendFileSync(logFile, JSON.stringify(msg) + '\n');
      streamToStdout(msg);
      if (msg.type === 'result') {
        const r = msg as unknown as {
          session_id: string;
          total_cost_usd?: number;
          is_error?: boolean;
          result?: string;
          errors?: string[];
          subtype?: string;
          usage?: {
            input_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
        sessionId = r.session_id;
        cost = r.total_cost_usd ?? 0;
        success = !r.is_error;
        resultText = r.result ?? '';
        const u = r.usage ?? {};
        inputTokens =
          (u.input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) +
          (u.cache_creation_input_tokens ?? 0);
        if (!success) errorMsg = (r.errors ?? []).join('; ') || r.subtype || 'unknown error';
      }
    }
  } catch (e) {
    success = false;
    errorMsg = e instanceof Error ? e.message : String(e);
    appendFileSync(logFile, JSON.stringify({ kind: 'exception', error: errorMsg }) + '\n');
  }

  return {
    sessionId,
    cost,
    success,
    resultText,
    inputTokens,
    durationMs: Date.now() - started,
    ...(errorMsg ? { errorMsg } : {}),
  };
}

// ---------- Main ----------

async function main() {
  const cli = parseCli();
  if (cli.help) {
    console.log(HELP);
    return;
  }

  const cfg = mergeCliOverrides(loadConfig(cli.config), cli);
  cfg.cwd = resolveFromCwd(cfg.cwd, process.cwd());

  const stateDir = resolveFromCwd(cfg.stateDir, cfg.cwd);
  const logDir = join(stateDir, 'logs');
  ensureDir(stateDir);
  ensureDir(logDir);

  const allPrompts = loadPrompts(cfg);
  const toRun = filterPrompts(allPrompts, cfg);

  console.log('\nSequential build runner');
  console.log(`  prompts file:   ${cfg.promptsFile}`);
  console.log(`  model:          ${cfg.model}`);
  console.log(`  effort:         ${cfg.effort}`);
  console.log(`  thinking:       ${JSON.stringify(cfg.thinking)}`);
  console.log(`  settings:       ${cfg.settingSources.join(',')}`);
  console.log(`  permission:     ${cfg.permissionMode}`);
  console.log(`  cwd:            ${cfg.cwd}`);
  console.log(`  block size:     ${cfg.blockSize}`);
  console.log(`  ctx window:     ${cfg.contextWindowTokens.toLocaleString()} tokens`);
  console.log(
    `  compact at:     ${(cfg.compactAtPercent * 100).toFixed(0)}% (${Math.floor(cfg.contextWindowTokens * cfg.compactAtPercent).toLocaleString()} tokens)`,
  );
  console.log(
    `  plan-mode:      ${cfg.planModePrompts.length ? cfg.planModePrompts.join(', ') : '(none)'}`,
  );
  console.log(`  auto-answer:    ${cfg.autoAnswerQuestions ? 'yes (pick first option)' : 'no'}`);
  console.log(`  state dir:      ${stateDir}`);
  console.log(`  queued:         ${toRun.length} of ${allPrompts.length} prompts`);
  console.log(`  range:          ${toRun[0]?.index ?? '-'} to ${toRun.at(-1)?.index ?? '-'}`);
  console.log();

  const planSetForBanner = new Set(cfg.planModePrompts);

  if (cfg.dryRun) {
    for (const p of toRun) {
      const planTag = planSetForBanner.has(p.index) ? ' [PLAN]' : '';
      console.log(`  * prompt ${p.index} - ${p.title}${planTag}`);
    }
    console.log('\nDry run complete - no prompts executed.');
    return;
  }

  const state = loadState(stateDir);
  const canUseTool = makeCanUseTool(cfg);

  const tokenThreshold = Math.floor(cfg.contextWindowTokens * cfg.compactAtPercent);
  const planSet = new Set(cfg.planModePrompts);

  for (let i = 0; i < toRun.length; i++) {
    const prompt = toRun[i]!;
    const tokenForcedNewBlock =
      state.lastInputTokens > 0 && state.lastInputTokens >= tokenThreshold;
    const startsNewBlock = i % cfg.blockSize === 0 || tokenForcedNewBlock;
    const useContinue = !startsNewBlock && state.lastSessionId != null;
    const isPlanMode = planSet.has(prompt.index);

    const groundTruth = runGroundTruth(cfg);
    const body = buildPromptBody({
      prompt,
      startsNewBlock,
      blockCheckpoint: state.blockCheckpoint,
      groundTruth,
      extraContext: cfg.extraContext,
    });

    const logFile = join(logDir, `prompt-${String(prompt.index).padStart(3, '0')}.jsonl`);
    writeFileSync(logFile, '');

    const blockTag = startsNewBlock ? '[NEW BLOCK]' : '[continue ]';
    const reason = tokenForcedNewBlock
      ? ` (token threshold: prior ${state.lastInputTokens.toLocaleString()} >= ${tokenThreshold.toLocaleString()})`
      : '';
    const modeTag = isPlanMode ? ' [PLAN MODE]' : '';
    console.log(`\n${blockTag}${modeTag} Prompt ${prompt.index} - ${prompt.title}${reason}`);
    console.log(`            logging -> ${logFile}`);

    let combined: SdkCallResult;

    if (!isPlanMode) {
      combined = await runSdkCall({
        body,
        options: buildOptions({ cfg, permissionMode: cfg.permissionMode, useContinue, canUseTool }),
        logFile,
      });
    } else {
      console.log('            phase 1/2: planning (permissionMode: plan)');
      const planBody = `${body}\n\n---\n\n## Plan-Mode Instructions\n\n${cfg.planPhaseInstruction}`;
      const planResult = await runSdkCall({
        body: planBody,
        options: buildOptions({ cfg, permissionMode: 'plan', useContinue, canUseTool }),
        logFile,
        phase: 'plan',
      });

      if (!planResult.success) {
        combined = planResult;
      } else {
        console.log('\n            phase 2/2: execute (permissionMode: bypassPermissions)');
        const execResult = await runSdkCall({
          body: cfg.execPhaseInstruction,
          options: buildOptions({
            cfg,
            permissionMode: 'bypassPermissions',
            useContinue: true,
            canUseTool,
          }),
          logFile,
          phase: 'exec',
        });
        combined = {
          sessionId: execResult.sessionId || planResult.sessionId,
          cost: planResult.cost + execResult.cost,
          success: execResult.success,
          resultText: execResult.resultText || planResult.resultText,
          inputTokens: execResult.inputTokens,
          durationMs: planResult.durationMs + execResult.durationMs,
          ...(execResult.errorMsg ? { errorMsg: execResult.errorMsg } : {}),
        };
      }
    }

    state.lastInputTokens = combined.inputTokens;
    state.lastCompletedIndex = prompt.index;
    state.lastSessionId = combined.sessionId || state.lastSessionId;
    state.history.push({
      index: prompt.index,
      title: prompt.title,
      sessionId: combined.sessionId,
      durationMs: combined.durationMs,
      costUsd: combined.cost,
      success: combined.success,
      ...(combined.errorMsg ? { error: combined.errorMsg } : {}),
    });

    const isBlockEnd =
      (i + 1) % cfg.blockSize === 0 ||
      i === toRun.length - 1 ||
      (state.lastInputTokens > 0 && state.lastInputTokens >= tokenThreshold);
    if (isBlockEnd && combined.resultText) state.blockCheckpoint = combined.resultText;

    const { success, errorMsg, cost, durationMs } = combined;

    saveState(stateDir, state);

    const status = success ? 'OK' : 'FAIL';
    console.log(`\n   [${status}] ${(durationMs / 1000).toFixed(1)}s  $${cost.toFixed(4)}`);

    if (success && cfg.commitBetweenSteps) {
      const msg = cfg.commitMessageTemplate
        .replace('{{n}}', String(prompt.index))
        .replace('{{title}}', prompt.title);
      try {
        execSync('git add -A', { cwd: cfg.cwd, stdio: 'inherit' });
        execSync(`git diff --cached --quiet || git commit -m ${JSON.stringify(msg)}`, {
          cwd: cfg.cwd,
          stdio: 'inherit',
          shell: '/bin/bash',
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        console.log(`   WARN: commit failed: ${m}`);
      }
    }

    if (!success && cfg.stopOnError) {
      console.log(`\nStopping at prompt ${prompt.index}: ${errorMsg}`);
      process.exit(1);
    }
  }

  const totalCost = state.history.reduce((s, h) => s + h.costUsd, 0);
  console.log(
    `\nDone. ${state.history.length} prompts processed. Total cost: $${totalCost.toFixed(4)}`,
  );
}

function streamToStdout(msg: SDKMessage) {
  if (msg.type !== 'assistant') return;
  const content = (
    msg as unknown as { message?: { content?: Array<{ type: string; text?: string }> } }
  ).message?.content;
  if (!content) return;
  const text = content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('');
  if (text.trim()) process.stdout.write(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
