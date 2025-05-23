import cron from 'node-cron';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Run cache warmer every 2 hours (matching our cache TTL)
cron.schedule('0 */2 * * *', () => {
  console.log('Running scheduled cache warm-up...');
  
  const cacheWarmer = spawn('node', ['scripts/cache-warmer.js'], {
    stdio: 'inherit'
  });

  cacheWarmer.on('close', (code) => {
    console.log(`Cache warm-up process exited with code ${code}`);
  });
});

console.log('Cache warmer scheduler started. Will run every 2 hours.'); 