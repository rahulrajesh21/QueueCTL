import { spawn } from 'node:child_process';

class Executor {
    async run(command, timeout = 60, options = {}){
        const silent = options.silent ?? (process.env.NODE_ENV === 'test');
        return new Promise((resolve)=>{
            let stdout = '';
            let stderr = '';            

            const child = spawn(command,{
                shell:true,
                stdio:'pipe'
            });

            child.stdout.on('data',(data)=>{
                const output = data.toString();
                stdout += output;
                if (!silent) process.stdout.write(output);
            });

            child.stderr.on('data',(data)=>{
                const output = data.toString();
                stderr += output;
                if (!silent) process.stderr.write(output);
            });

            let killTimer = null;
            const timer = setTimeout(()=>{
                  try { child.kill('SIGTERM'); } catch (e) {}

                  killTimer = setTimeout(()=>{
                    try { child.kill('SIGKILL'); } catch (e) {}
                  }, 2000);
                  if (killTimer.unref) killTimer.unref();

                  resolve({
                    success:false,
                    error: new Error(`Command timeout after ${timeout}`)
                  });
            }, timeout * 1000);

            child.on('close',(exitCode)=>{
                clearTimeout(timer);
                if (killTimer) clearTimeout(killTimer);
                const output = stdout + stderr;
                if(exitCode===0){
                    resolve({success:true,output:output});
                }else{
                    resolve({
                        success:false,
                        error: new Error(`Command exited with code ${exitCode}`),
                        output:output
                    });
                }
            });

            child.on('error',(error)=>{
                clearTimeout(timer);
                if (killTimer) clearTimeout(killTimer);
                resolve({success:false,error,output: stdout + stderr});
            });
        });
    }
}

export { Executor };
export default new Executor();