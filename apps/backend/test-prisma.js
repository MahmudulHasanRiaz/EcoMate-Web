const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');

async function main() {
  const connectionString = 'postgresql://postgres@localhost:5432/ecomate_web';
  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  
  const prisma = new PrismaClient({ adapter });
  const user = await prisma.user.findUnique({
    where: { email: 'admin@ecomate.com' }
  });
  console.log("Prisma User:", user);
}
main().catch(console.error).finally(() => process.exit());
