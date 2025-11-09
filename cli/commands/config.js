
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
            // Normalize key: convert hyphens to underscores for storage
            const normalizedKey = key.replace(/-/g, '_');
            
            // Validate configuration keys
            const validKeys = ['max_retries', 'backoff_base', 'default_timeout'];
            if (!validKeys.includes(normalizedKey)) {
                console.error(`Error: Invalid config key '${key}'`);
                console.log(`Valid keys: ${validKeys.map(k => k.replace(/_/g, '-')).join(', ')}`);
                process.exit(1);
            }
            
            // Validate value is a positive number
            const numValue = parseInt(value);
            if (isNaN(numValue) || numValue <= 0) {
                console.error(`Error: Value must be a positive number`);
                process.exit(1);
            }
            
            storage.setConfig(normalizedKey, value);
            console.log(`Successfully set ${key} = ${value}`)
        }catch(error){
            console.error('Error:',error.message);
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
          // Display with hyphens for consistency
          const displayKey = key.replace(/_/g, '-');
          console.log(`  ${displayKey} = ${value}`);
        });
        console.log('');
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

    config
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      try {
        storage.setConfig('max_retries', '3');
        storage.setConfig('backoff_base', '2');
        storage.setConfig('default_timeout', '60');
        console.log('Configuration reset to defaults:');
        console.log('  max-retries = 3');
        console.log('  backoff-base = 2');
        console.log('  default-timeout = 60');
      } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
      }
    });

}