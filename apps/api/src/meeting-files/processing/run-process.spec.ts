import { ProcessError, runProcess } from './run-process.js';

/** Uses the running Node binary as a well-behaved child process. */
describe('runProcess', () => {
  const node = process.execPath;
  const signal = new AbortController().signal;

  it('resolves to the stdout of a successful run', async () => {
    await expect(runProcess(node, ['-e', 'process.stdout.write("ok")'], signal)).resolves.toBe(
      'ok',
    );
  });

  it('rejects with ProcessError, exit code and stderr for a failed run', async () => {
    const run = runProcess(node, ['-e', 'console.error("bad input"); process.exit(3)'], signal);

    await expect(run).rejects.toThrow(ProcessError);
    await expect(run).rejects.toMatchObject({ exitCode: 3, stderr: 'bad input' });
  });

  it('rejects with the spawn error when the binary does not exist', async () => {
    await expect(runProcess('no-such-binary-for-tests', [], signal)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('kills the process and rejects with the reason once the signal is aborted', async () => {
    const started = Date.now();

    await expect(
      runProcess(node, ['-e', 'setTimeout(() => {}, 60_000)'], AbortSignal.timeout(300)),
    ).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
