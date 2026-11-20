import { spawn } from 'node:child_process';

class Executor {
    async run(command, timeout = 60, options = {}) {
        const effectiveTimeout = timeout ?? 60;
        const silent = options.silent ?? (process.env.NODE_ENV === 'test');
        const isPosix = process.platform !== 'win32';

        return new Promise((resolve) => {
            let stdout = '';
            let stderr = '';
            let settled = false;
            let timedOut = false;
            let killTimer = null;

            const child = spawn(command, {
                shell: true,
                stdio: 'pipe',
                detached: isPosix
            });

            const terminateProcessTree = (signal) => {
                if (isPosix && child.pid) {
                    try {
                        process.kill(-child.pid, signal);
                        return;
                    } catch (_) {
                        // Process group may already have exited; fall back to direct child kill
                    }
                }
                try {
                    child.kill(signal);
                } catch (_) {
                    // Process already exited
                }
            };

            const finish = (result) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (killTimer) clearTimeout(killTimer);
                resolve(result);
            };

            child.stdout.on('data', (data) => {
                const output = data.toString();
                stdout += output;
                if (!silent) process.stdout.write(output);
            });

            child.stderr.on('data', (data) => {
                const output = data.toString();
                stderr += output;
                if (!silent) process.stderr.write(output);
            });

            const timer = setTimeout(() => {
                timedOut = true;
                terminateProcessTree('SIGTERM');

                killTimer = setTimeout(() => {
                    terminateProcessTree('SIGKILL');
                    if (child.stdout) child.stdout.destroy();
                    if (child.stderr) child.stderr.destroy();
                    finish({
                        success: false,
                        error: new Error(`Command timeout after ${effectiveTimeout}`),
                        output: stdout + stderr
                    });
                }, 500);
                if (killTimer.unref) killTimer.unref();
            }, effectiveTimeout * 1000);

            child.on('close', (exitCode) => {
                const output = stdout + stderr;
                if (timedOut) {
                    finish({
                        success: false,
                        error: new Error(`Command timeout after ${effectiveTimeout}`),
                        output
                    });
                    return;
                }
                if (exitCode === 0) {
                    finish({ success: true, output });
                } else {
                    finish({
                        success: false,
                        error: new Error(`Command exited with code ${exitCode}`),
                        output
                    });
                }
            });

            child.on('error', (error) => {
                finish({ success: false, error, output: stdout + stderr });
            });
        });
    }
}

export { Executor };
export default new Executor();