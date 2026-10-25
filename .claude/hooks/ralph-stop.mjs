// Stop hook of the Ralph loop: hands the agent the next open issue of the milestone from
// .claude/ralph.config.json, and opens the pull request once the milestone has no open issues.
// Active only when the session was started with RALPH=1; otherwise it lets the agent stop.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.env.RALPH !== '1') process.exit(0);

let input = '';
for await (const chunk of process.stdin) input += chunk;

const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const statePath = path.join(root, '.claude', 'ralph.state.json');
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf-8' }).trim();
const stop = (message) => {
  console.error(`Ralph: ${message}`);
  process.exit(0);
};

try {
  const { stop_hook_active: continued } = JSON.parse(input || '{}');
  const config = JSON.parse(readFileSync(path.join(root, '.claude', 'ralph.config.json'), 'utf-8'));
  const state =
    continued && existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf-8')) : {};

  const issues = JSON.parse(
    run('gh', [
      'issue',
      'list',
      '--milestone',
      config.milestone,
      '--state',
      'open',
      '--limit',
      '100',
      '--json',
      'number,title',
    ]),
  ).sort((a, b) => a.number - b.number);

  if (issues.length > 0) {
    const next = issues[0];
    // The agent was handed this issue and stopped without closing it: it is stuck, end the loop.
    if (next.number === state.issue) {
      rmSync(statePath, { force: true });
      stop(`issue #${next.number} is still open after its iteration, stopping the loop.`);
    }

    writeFileSync(statePath, JSON.stringify({ issue: next.number }));
    const reason = config.prompt
      .replaceAll('{issue}', String(next.number))
      .replaceAll('{milestone}', config.milestone)
      .replaceAll('{branch}', config.branch);
    console.log(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  }

  rmSync(statePath, { force: true });
  const existing = JSON.parse(
    run('gh', ['pr', 'list', '--head', config.branch, '--state', 'open', '--json', 'url']),
  );
  if (existing.length > 0) stop(`milestone done, pull request already open: ${existing[0].url}`);

  run('git', ['push', '-u', 'origin', config.branch]);
  const url = run('gh', [
    'pr',
    'create',
    '--base',
    config.base,
    '--head',
    config.branch,
    '--title',
    config.milestone,
    '--body',
    `Implements all issues of the milestone "${config.milestone}".`,
  ]);
  stop(`milestone done, pull request created: ${url}`);
} catch (error) {
  stop(`hook failed, letting the agent stop: ${error.message}`);
}
