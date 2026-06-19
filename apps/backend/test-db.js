const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres@localhost:5432/ecomate_web' });
async function main() {
  const res = await pool.query('SELECT id, email, status, "failedLoginAttempts", "lockoutUntil" FROM "User" WHERE email = \'admin@ecomate.com\';');
  console.log("Admin:", res.rows[0]);
}
main().catch(e => console.error(e)).finally(() => pool.end());
