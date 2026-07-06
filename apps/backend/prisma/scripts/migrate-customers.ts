import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ecomate_web';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('[Migration] Starting customer migration...');

  // UserProfile no longer has orders relation (moved to CustomerProfile)
  // addresses relation still exists on UserProfile
  const customers = await prisma.userProfile.findMany({
    where: { role: 'customer' },
    include: { addresses: true },
  });

  console.log(`[Migration] Found ${customers.length} customer profiles to migrate.`);

  let migrated = 0;
  let failed = 0;

  for (const customer of customers) {
    try {
      const profile = await prisma.customerProfile.create({
        data: {
          betterAuthUserId: customer.betterAuthUserId || undefined,
          phone: customer.phoneNumber,
          email: customer.email === customer.username ? null : customer.email,
          name: `${customer.firstName} ${customer.lastName}`.trim() || customer.username,
        },
      });

      // Orders: query separately since relation moved to CustomerProfile
      const orderCount = await prisma.order.count({
        where: { customerId: customer.id },
      });
      if (orderCount > 0) {
        await prisma.order.updateMany({
          where: { customerId: customer.id },
          data: { customerId: profile.id },
        });
      }

      // Addresses: still on UserProfile, included above
      if (customer.addresses.length > 0) {
        await prisma.address.updateMany({
          where: { userId: customer.id },
          data: { customerProfileId: profile.id, userId: null },
        });
      }

      migrated++;
      if (migrated % 100 === 0) {
        console.log(`[Migration] Progress: ${migrated}/${customers.length}`);
      }
    } catch (error) {
      console.error(`[Migration] Failed for customer ${customer.id} (${customer.email}):`, error);
      failed++;
    }
  }

  console.log(`[Migration] Complete. Migrated: ${migrated}, Failed: ${failed}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
