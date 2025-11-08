
import storage from '../../storage/sqlite.js'

export function configCommand(program){
 const config = program.command('config').description('Configuration management');

 config
    .command('get <key>')
    .description('Get configuration value')
    .action((key)=>{
        try{
            const value = storage.getConfig(key)
            if(value == null){
                console.log(`Config key ${key} not found`)
                process.exit(1);
            }else{
                console.log(`${key} = ${value}`)
            }
        }catch(error){
            console.error('Error:', error.message);
            process.exit(1);
        }
    });


    config
    .command('set <key> <value>')
    .description("Set configuration value")
    .action((key,value)=>{
        try{
            storage.setConfig(key,value);
            console.log(`Successfully set ${key} = ${value}`)
        }catch(error){
            console.log('Error',error.message);
            process.exit(1);
        }
    })


     config
    .command('list')
    .description('List all configuration')
    .action(() => {
      try {
        const allConfig = storage.getAllConfig();
        console.log('\nConfiguration:\n');
        Object.entries(allConfig).forEach(([key, value]) => {
          console.log(`  ${key} = ${value}`);
        });
        console.log('');
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

}