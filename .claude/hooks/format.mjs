// PostToolUse hook: run Prettier and ESLint --fix on the file the agent just edited.
// Never blocks the agent: all failures are swallowed and the exit code is always 0.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FORMAT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', '.css', '.md']);
const LINT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx']);
const SKIP = /[\/](node_modules|dist|\.next|coverage|out|build)[\/]|package-lock\.json$/;

let input = '';
for await (const chunk of process.stdin) input += chunk;

try {
  const payload = JSON.parse(input);
  const file = payload.tool_response?.filePath ?? payload.tool_input?.file_path;
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!file || !existsSync(file) || SKIP.test(file)) process.exit(0);

  const ext = path.extname(file).toLowerCase();
  const quoted = `"${file}"`;
  const run = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, stdio: 'ignore', timeout: 60_000 });

  if (FORMAT_EXT.has(ext)) run(`npx prettier --write --log-level silent ${quoted}`, root);

  // ESLint config lives per app, so run it from the owning app directory.
  const app = ['web', 'api'].find((a) =>
    path.resolve(file).startsWith(path.resolve(root, 'apps', a) + path.sep),
  );
  if (app && LINT_EXT.has(ext)) run(`npx eslint --fix ${quoted}`, path.join(root, 'apps', app));
} catch {
  // ignore: formatting is best-effort
}
process.exit(0);
