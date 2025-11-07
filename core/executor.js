import { spawn } from 'node:child_process';
import { error } from 'node:console';

class Executor {
    async run(command){
        return new Promise((resolve)=>{
            const child = spawn(command,{
                shell:true,
                stdio:'inherit'
            })

            child.on('close',(exitCode)=>{
                if(exitCode===0){
                    resolve({success:true})
                }else{
                    resolve({
                        success:false,
                        error: new Error(`Command exited with code ${exitCode}`)
                    });
                }
            });

            child.on('error',(error)=>{
                resolve({success:false,error})
            });
        })
    }
}

export default new Executor();