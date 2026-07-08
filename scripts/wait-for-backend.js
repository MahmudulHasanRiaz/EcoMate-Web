const http = require('http');
const MAX_RETRIES = 30;
const RETRY_DELAY = 1000;

const url = process.argv[2] || 'http://localhost:4000/api/health';

function check() {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Status ${res.statusCode}: ${body}`));
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

(async () => {
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      await check();
      process.exit(0);
    } catch {
      if (i < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY));
      }
    }
  }
  process.exit(1);
})();
