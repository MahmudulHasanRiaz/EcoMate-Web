const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres@localhost:5432/ecomate_web' });
async function main() {
  const res = await pool.query('SELECT id, email, status FROM "User" LIMIT 10;');
  console.log("Users in DB:", res.rows);
}
main().catch(e => console.error(e)).finally(() => pool.end());
