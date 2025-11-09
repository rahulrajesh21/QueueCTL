import { spawn } from 'node:child_process';
import { stdout } from 'node:process';

class Executor {
    async run(command, timeout = 60){
        return new Promise((resolve)=>{
            
            let stdout = '';
            let stderr = '';            


            const child = spawn(command,{
                shell:true,
                stdio:'pipe'
            })

            child.stdout.on('data',(data)=>{
                const output = data.toString();
                stdout += output;
                process.stdout.write(output);
            })

            child.stderr.on('data',(data)=>{
                const output = data.toString();
                stderr += output;
                process.stderr.write(output);
            })


            const timer = setTimeout(()=>{
                  child.kill('SIGTERM'); 

                  setTimeout(()=>{
                    child.kill('SIGKILL');
                  },2000);
                  resolve({
                    success:false,
                    error: new Error(`Command timeout after ${timeout}`)
                  });
            },timeout*1000)

            child.on('close',(exitCode)=>{
                const output = stdout + stderr;
                clearTimeout(timer)
                if(exitCode===0){
                    resolve({success:true,output:output})
                }else{
                    resolve({
                        success:false,
                        error: new Error(`Command exited with code ${exitCode}`),
                        output:output
                    });
                }
            });

            child.on('error',(error)=>{
                
                clearTimeout(timer)
                resolve({success:false,error,output: stdout + stderr})
            });
        })
    }
}

export default new Executor();