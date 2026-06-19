const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({ connectionString: 'postgresql://postgres@localhost:5432/ecomate_web' });

async function main() {
  const res = await pool.query('SELECT password FROM "User" WHERE email = \'admin@ecomate.com\';');
  const user = res.rows[0];
  if (!user) {
    console.log("User not found!");
    return;
  }
  const hash = user.password;
  console.log("Hash from DB:", hash);
  const isMatch = await bcrypt.compare('Admin@123', hash);
  console.log("Does Admin@123 match?", isMatch);
}
main().catch(e => console.error(e)).finally(() => pool.end());
