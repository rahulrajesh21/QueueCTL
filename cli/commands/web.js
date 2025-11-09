import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function webCommand(program) {
  program
    .command('web')
    .description('Start the web dashboard')
    .option('-p, --port <port>', 'Port to run the web server on', '3000')
    .action((options) => {
      const port = options.port;
      const webServerPath = join(__dirname, '../../web/server.js');
      
      console.log(`Starting QueueCTL Dashboard on port ${port}...`);
      console.log(`Open http://localhost:${port} in your browser`);
      console.log('Press Ctrl+C to stop\n');
      
      const webServer = spawn('node', [webServerPath], {
        stdio: 'inherit',
        env: { ...process.env, PORT: port }
      });
      
      webServer.on('error', (error) => {
        console.error('Failed to start web server:', error.message);
        process.exit(1);
      });
      
      webServer.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Web server exited with code ${code}`);
          process.exit(code);
        }
      });
      
      // Handle graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nStopping web server...');
        webServer.kill('SIGTERM');
        process.exit(0);
      });
      
      process.on('SIGTERM', () => {
        webServer.kill('SIGTERM');
        process.exit(0);
      });
    });
}
