import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('[Migration] Starting customer migration...');

  const customers = await prisma.userProfile.findMany({
    where: { role: 'customer' },
    include: {
      orders: true,
      addresses: true,
    },
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

      if (customer.orders.length > 0) {
        await prisma.order.updateMany({
          where: { customerId: customer.id },
          data: { customerId: profile.id },
        });
      }

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
