// Runs every phase of .claude/ralph.config.json in order through scripts/ralph.mjs: each phase's
// pull request is merged into `base` before the next phase starts from it. Stops at the first phase
// that does not finish. Usage: `npm run ralph:all`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { phases } = JSON.parse(readFileSync('.claude/ralph.config.json', 'utf8'));

for (let phase = 1; phase <= phases.length; phase++) {
  const { status } = spawnSync('node', ['scripts/ralph.mjs', String(phase), '--merge'], {
    stdio: 'inherit',
  });
  if (status !== 0) {
    console.log(`\n⛔ Phase ${phase} did not finish (exit code ${status}). Fix it and run again.`);
    process.exit(status ?? 1);
  }
}
console.log('\n🎉 All phases are done.');
