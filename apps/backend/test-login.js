const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres@localhost:5432/ecomate_web' } }
});

async function main() {
  const email = 'admin@ecomate.com';
  const password = 'Admin@123';
  
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return console.log("401: User not found");
  if (user.status !== 'active') return console.log("401: Not active");
  if (user.lockoutUntil && user.lockoutUntil > new Date()) return console.log("401: Locked out");
  
  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) return console.log("401: Wrong password");
  
  console.log("200 OK: Login successful!");
}
main().catch(console.error).finally(() => prisma.$disconnect());
