// Ralph loop runner for one phase: implements the open issues of the phase's milestone, one `claude -p`
// run per issue, then pushes the branch and opens a pull request into `base`.
// Usage: `npm run ralph -- <phase>` (1-based; default: the first phase with open issues).
// `--merge` also merges the pull request and updates the local `base` (used by `npm run ralph:all`).
// Exit codes: 0 phase done, 1 an issue is still open after its run, 2 iteration limit reached.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const config = JSON.parse(readFileSync('.claude/ralph.config.json', 'utf8'));
const { base, maxIterations, maxTurns } = config;

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// Oldest open issue first: issues are numbered in the order the plan was written.
const openIssues = (milestone) =>
  JSON.parse(
    gh('issue', 'list', '--milestone', milestone, '--state', 'open', '--json', 'number,title'),
  ).sort((a, b) => a.number - b.number);

const isOpen = (number) =>
  JSON.parse(gh('issue', 'view', String(number), '--json', 'state')).state === 'OPEN';

const branchExists = (branch) => git('branch', '--list', branch) !== '';

// Streams the agent's progress: text replies and the tools it calls.
// Only the project MCP servers (.mcp.json) are loaded: user plugins slow the start down.
function runClaude(prompt) {
  const args = ['-p', prompt, '--max-turns', String(maxTurns), '--permission-mode', 'acceptEdits'];
  args.push('--output-format', 'stream-json', '--verbose');
  args.push('--strict-mcp-config', '--mcp-config', '.mcp.json');
  return new Promise((resolve) => {
    const child = spawn('claude', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    createInterface({ input: child.stdout }).on('line', (line) => {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === 'assistant') {
        for (const block of event.message.content) {
          if (block.type === 'text') console.log(block.text);
          if (block.type === 'tool_use') console.log(`  → ${block.name}`);
        }
      }
      if (event.type === 'result') console.log(`\n[${event.subtype}, ${event.num_turns} turns]`);
    });
    child.on('close', resolve);
  });
}

const DEV_URLS = ['http://localhost:3000', 'http://localhost:4000'];
const DEV_LOG = '.claude/ralph.dev.log';
const reachable = (url) =>
  fetch(url).then(
    () => true,
    () => false,
  );

// UI issues are checked in the browser against the dev servers; agents must not start them.
// Reuses servers that are already running; otherwise starts `npm run dev` (output in DEV_LOG)
// and stops it when this process exits.
async function ensureDevServers() {
  if ((await Promise.all(DEV_URLS.map(reachable))).every(Boolean)) return;

  console.log(`🚀 Starting the dev servers (npm run dev, log in ${DEV_LOG})...`);
  const log = openSync(DEV_LOG, 'w');
  const dev = spawn('npm run dev', {
    shell: true,
    stdio: ['ignore', log, log],
    detached: process.platform !== 'win32',
  });
  process.on('exit', () => {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(dev.pid), '/t', '/f']);
    else process.kill(-dev.pid);
  });
  process.on('SIGINT', () => process.exit(130));

  for (let waited = 0; waited < 180; waited += 3) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if ((await Promise.all(DEV_URLS.map(reachable))).every(Boolean)) return;
  }
  console.log(`⛔ The dev servers did not start within 3 minutes. See ${DEV_LOG}.`);
  process.exit(1);
}

const args = process.argv.slice(2);
const merge = args.includes('--merge');
const phaseArg = args.find((a) => !a.startsWith('--'));
const index = phaseArg
  ? Number(phaseArg) - 1
  : config.phases.findIndex((p) => openIssues(p.milestone).length > 0);
const phase = config.phases[index];
if (!phase) {
  console.log(phaseArg ? `No phase ${phaseArg} in the config.` : '🎉 No phase has open issues.');
  process.exit(phaseArg ? 1 : 0);
}
const { milestone, branch } = phase;
console.log(`\n═══ Phase ${index + 1}: ${milestone} (${branch}) ═══`);

let issues = openIssues(milestone);
if (issues.length > 0) {
  await ensureDevServers();

  if (branchExists(branch)) {
    git('switch', branch);
  } else {
    git('fetch', 'origin', base);
    git('switch', '-c', branch, `origin/${base}`);
  }
}

for (let iteration = 1; issues.length > 0; iteration++) {
  if (iteration > maxIterations) {
    console.log(`⏸ Iteration limit (${maxIterations}) reached. Run again to continue.`);
    process.exit(2);
  }

  const issue = issues[0];
  console.log(`\n🔄 Iteration ${iteration}/${maxIterations} — #${issue.number}: ${issue.title}`);
  console.log(`📋 Remaining: ${issues.length}\n`);

  const prompt = config.prompt
    .replace('{issue}', issue.number)
    .replace('{milestone}', milestone)
    .replace('{branch}', branch);
  await runClaude(prompt);

  if (isOpen(issue.number)) {
    console.log(`⛔ Issue #${issue.number} is still open, stopping. See its comments on GitHub.`);
    process.exit(1);
  }
  issues = openIssues(milestone);
}

// A phase merged earlier has no local branch or no commits ahead of base: nothing to ship.
git('fetch', 'origin', base);
if (!branchExists(branch) || git('rev-list', '--count', `origin/${base}..${branch}`) === '0') {
  console.log(`✅ Phase ${index + 1} has nothing left to ship.`);
  process.exit(0);
}

console.log(`✅ Milestone has no open issues. Pushing ${branch} and opening a PR into ${base}...`);
execFileSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' });
const openPr = JSON.parse(gh('pr', 'list', '--head', branch, '--state', 'open', '--json', 'url'));
if (openPr.length === 0) {
  gh('pr', 'create', '--base', base, '--head', branch, '--title', `feat: ${milestone}`, '--fill');
}
console.log(gh('pr', 'view', branch, '--json', 'url', '--jq', '.url'));

if (merge) {
  console.log(`🔀 Merging the PR into ${base}...`);
  gh('pr', 'merge', branch, '--merge');
  git('switch', base);
  git('pull', '--ff-only', 'origin', base);
}
