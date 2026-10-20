import { spawn } from 'node:child_process';

/** Characters of stderr kept for the error message (tools such as ffmpeg are chatty). */
const STDERR_TAIL_CHARS = 2000;

/** A tool ran but exited with an error code (bad input, a crash, out of memory). */
export class ProcessError extends Error {
  override readonly name = 'ProcessError';

  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(`${command} exited with ${exitCode ?? 'a signal'}: ${stderr}`);
  }
}

/**
 * Runs `command` with `args` (no shell) and resolves to its stdout. Rejects with `ProcessError` for
 * a non-zero exit, with the spawn error when the binary cannot be started (e.g. `ENOENT`), and
 * with the signal's reason once `signal` is aborted, which kills the process: a timeout or a
 * shutdown never leaves a tool running.
 */
export function runProcess(
  command: string,
  args: string[],
  signal: AbortSignal,
  { stdout = true }: { stdout?: boolean } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const child = spawn(command, args, {
      signal,
      windowsHide: true,
      stdio: ['ignore', stdout ? 'pipe' : 'ignore', 'pipe'],
    });
    const out: Buffer[] = [];
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_TAIL_CHARS);
    });
    child.once('error', (error) => {
      reject(signal.aborted ? (signal.reason as Error) : error);
    });
    child.once('close', (code) => {
      if (signal.aborted) {
        reject(signal.reason as Error);
      } else if (code === 0) {
        resolve(Buffer.concat(out).toString('utf8'));
      } else {
        reject(new ProcessError(command, code, stderr.trim()));
      }
    });
  });
}
