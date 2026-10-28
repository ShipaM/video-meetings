// Ralph loop runner for one phase: implements the open issues of the phase's milestone, one `claude -p`
// run per issue, then pushes the branch and opens a pull request into `base`.
// Usage: `npm run ralph -- <phase>` (1-based; default: the first phase with open issues).
// `--merge` also merges the pull request and updates the local `base` (used by `npm run ralph:all`).
// Exit codes: 0 phase done, 1 an issue is still open after its run, 2 iteration limit reached.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { openSync, readFileSync, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';

const config = JSON.parse(readFileSync('.claude/ralph.config.json', 'utf8'));
const { base, maxIterations, maxTurns } = config;

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

// fetch / pull can fail on a ref another git process (e.g. the editor) holds for a moment: retry.
function gitRemote(...args) {
  for (let attempt = 1; ; attempt++) {
    try {
      return git(...args);
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`⚠ git ${args[0]} failed, retrying in 5 s...`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
    }
  }
}

// Oldest open issue first: issues are numbered in the order the plan was written.
const openIssues = (milestone) =>
  JSON.parse(
    gh('issue', 'list', '--milestone', milestone, '--state', 'open', '--json', 'number,title'),
  ).sort((a, b) => a.number - b.number);

const isOpen = (number) =>
  JSON.parse(gh('issue', 'view', String(number), '--json', 'state')).state === 'OPEN';

const branchExists = (branch) => git('branch', '--list', branch) !== '';

// Whether the working tree (untracked files included) holds exactly the files of `ref`:
// stages it into a throwaway index and compares the trees.
function treeMatches(ref) {
  const index = git('rev-parse', '--git-path', 'ralph-check.index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  // stderr is piped: `add` warns about every file whose line endings it converts.
  const run = (...args) =>
    execFileSync('git', args, { encoding: 'utf8', env, stdio: 'pipe' }).trim();
  try {
    run('read-tree', ref);
    run('add', '-A');
    return run('write-tree') === git('rev-parse', `${ref}^{tree}`);
  } finally {
    rmSync(index, { force: true });
  }
}

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

const DEV_PORTS = [3000, 4000];
const DEV_URLS = DEV_PORTS.map((port) => `http://localhost:${port}`);
const DEV_LOG = '.claude/ralph.dev.log';
const reachable = (url) =>
  fetch(url).then(
    () => true,
    () => false,
  );

// Ids of the processes listening on the dev ports.
function devPortPids() {
  if (process.platform !== 'win32') {
    const args = DEV_PORTS.flatMap((port) => ['-i', `tcp:${port}`]);
    const out = spawnSync('lsof', ['-t', '-sTCP:LISTEN', ...args], { encoding: 'utf8' }).stdout;
    return [...new Set(out.split(/\s+/).filter(Boolean))];
  }
  const ports = new RegExp(`:(${DEV_PORTS.join('|')})\\s.*LISTENING\\s+(\\d+)`);
  const lines = execFileSync('netstat', ['-ano'], { encoding: 'utf8' }).split('\n');
  return [...new Set(lines.map((line) => line.match(ports)?.[2]).filter(Boolean))];
}

const killTree = (pid) =>
  process.platform === 'win32'
    ? spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'])
    : spawnSync('kill', [String(pid)]);

// UI issues are checked in the browser against the dev servers; agents must not start them.
// Servers that were already running may serve another branch's code (watch builds miss changes
// on a branch switch), so stop them and start `npm run dev` on the current branch (output in
// DEV_LOG); it is stopped when this process exits.
async function startDevServers() {
  const stale = devPortPids();
  if (stale.length > 0) {
    console.log(`🛑 Stopping the running dev servers (pid ${stale.join(', ')})...`);
    stale.forEach(killTree);
  }
  // Next.js leftovers from earlier servers can break its manifest writes (EPERM on rename).
  rmSync('apps/web/.next/dev', { recursive: true, force: true, maxRetries: 5 });

  console.log(`🚀 Starting the dev servers (npm run dev, log in ${DEV_LOG})...`);
  const log = openSync(DEV_LOG, 'w');
  const dev = spawn('npm run dev', {
    shell: true,
    stdio: ['ignore', log, log],
    detached: process.platform !== 'win32',
  });
  process.on('exit', () => {
    if (process.platform === 'win32') killTree(dev.pid);
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
  if (branchExists(branch)) {
    git('switch', branch);
  } else {
    gitRemote('fetch', 'origin', base);
    git('switch', '-c', branch, `origin/${base}`);
  }
  await startDevServers();
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
gitRemote('fetch', 'origin', base);
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
  try {
    gitRemote('pull', '--ff-only', 'origin', base);
  } catch (error) {
    // A pull interrupted by a lock can update the files but not the branch, and every retry
    // then fails on "local changes": finish it when the files already match the remote.
    if (!treeMatches(`origin/${base}`)) throw error;
    git('reset', '-q', `origin/${base}`);
  }
}
