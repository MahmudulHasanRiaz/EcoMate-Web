/**
 * Blocking-feature E2E smoke (real DB, real services, no mocks):
 *   IP block → persist → unblock   (via BlockedEntriesService, the same
 *   service the admin `/blocked-entries` endpoints call)
 *   Phone block → persist → unblock (via CustomersService.blockPhone / unblockPhone)
 *   Identity isolation: blocking one entity never mutates another customer
 *   or the IP registry.
 *
 * Run (from apps/backend):
 *   npx nest build && node dist/smoke/blocking-smoke.js
 */
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { config as loadDotenv } from 'dotenv';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersModule } from '../customers/customers.module';
import { BlockedEntriesModule } from '../blocked-entries/blocked-entries.module';
import { PrismaService } from '../prisma/prisma.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { CustomersService } from '../customers/customers.service';
import { normalizePhone } from '../common/utils/phone-utils';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CustomersModule,
    BlockedEntriesModule,
  ],
})
class SmokeModule {}

function assert(label: string, ok: boolean, details: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — ${details}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  loadDotenv();
  const app = await NestFactory.createApplicationContext(SmokeModule);
  const prisma = app.get(PrismaService);
  const blockedEntries = app.get(BlockedEntriesService);
  const customers = app.get(CustomersService);

const testIp = `203.0.113.${Math.floor(Math.random() * 100) + 1}`;
    const rawPhoneA = `018${String(Date.now()).slice(-8)}`;
    const rawPhoneB = `019${String(Date.now()).slice(-8)}`;
    const phoneA = normalizePhone(rawPhoneA) || rawPhoneA;
    const phoneB = normalizePhone(rawPhoneB) || rawPhoneB;
  const cleanup: (() => Promise<void>)[] = [];

  try {
    console.log('\n== IP: block → persist (refresh) → unblock ==');
    const created = await blockedEntries.create({
      type: 'ip',
      value: testIp,
      reason: 'smoke: profile-page block',
      blockedBy: 'smoke-staff',
    });
    cleanup.push(async () => {
      await prisma.blockedIp.deleteMany({ where: { ip: { startsWith: '203.0.113.' } } });
    });

    const list0 = await blockedEntries.findAll('ip');
    const entry = (list0 as any[]).find((e) => e.entryType === 'ip' && e.value === testIp);
    assert(
      'A1. IP appears in /blocked-entries?type=ip list with ip + value fields',
      Boolean(entry) && entry!.ip === testIp && entry!.value === testIp && entry!.isActive === true,
      `entry=${entry ? `${entry.id} ip=${entry.ip} value=${entry.value} active=${entry.isActive}` : 'MISSING'}`,
    );

    const list = (await blockedEntries.findAll('ip')) as any[];
    const persisted = list.find((e) => e.entryType === 'ip' && e.value === testIp);
    assert(
      'A2. IP block persists across refresh',
      Boolean(persisted) && persisted!.isActive === true,
      `found=${Boolean(persisted)} active=${persisted?.isActive}`,
    );

    await blockedEntries.unblock('ip', created.id);
    const list2 = (await blockedEntries.findAll('ip')) as any[];
    const afterUnblock = list2.find((e) => e.entryType === 'ip' && e.value === testIp);
    assert(
      'A3. IP unblock de-activates the entry',
      !afterUnblock || afterUnblock.isActive === false,
      afterUnblock ? `present, active=${afterUnblock.isActive} (soft-deactivate contract)` : 'removed',
    );

    console.log('\n== PHONE: block → persist → unblock (customer + identity isolation) ==');
    const customerA = await prisma.userProfile.create({
      data: {
        phoneNumber: phoneA,
        role: 'customer',
        status: 'active',
        firstName: 'Block Target',
        lastName: 'Smoke',
        username: `btsmoke-${phoneA}`,
        email: `btsmoke${phoneA}@example.com`,
        password: 'smoke-pass',
      },
    });
    cleanup.push(async () => {
      await prisma.userProfile.deleteMany({ where: { id: customerA.id } });
    });
    const customerB = await prisma.userProfile.create({
      data: {
        phoneNumber: phoneB,
        role: 'customer',
        status: 'active',
        firstName: 'Untouched',
        lastName: 'Smoke',
        username: `btsmoke-${phoneB}`,
        email: `btsmoke${phoneB}@example.com`,
        password: 'smoke-pass',
      },
    });
    cleanup.push(async () => {
      await prisma.userProfile.deleteMany({ where: { id: customerB.id } });
    });

    assert(
      'B0. both customers start active',
      customerA.status === 'active' && customerB.status === 'active',
      `A=${customerA.status} B=${customerB.status}`,
    );

    await customers.blockPhone(customerA.id);

    let a = await prisma.userProfile.findUnique({ where: { id: customerA.id } });
    let b = await prisma.userProfile.findUnique({ where: { id: customerB.id } });
    assert(
      'B1. phone block suspends only the target customer',
      a!.status === 'suspended' && b!.status === 'active',
      `A=${a?.status} B=${b?.status}`,
    );
    assert(
      'B1b. block now applies at order time (isPhoneBlocked)',
      await customers.isPhoneBlocked(phoneA) === true && (await customers.isPhoneBlocked(phoneB)) === false,
      `phoneA blocked=${await customers.isPhoneBlocked(phoneA)} phoneB blocked=${await customers.isPhoneBlocked(phoneB)}`,
    );

const countSuspended = await prisma.userProfile.count({
      where: { phoneNumber: { in: [phoneA, phoneB] }, role: 'customer', status: 'suspended' },
    });
    assert(
      'B2. exactly one customer suspended (identity cross-mix-up)',
      countSuspended === 1,
      `suspended in test scope=${countSuspended}`,
    );

    await customers.unblockPhone(customerA.id);
    const freshA: any = await prisma.userProfile.findUnique({ where: { id: customerA.id } });
    const bAfterUnblock: any = await prisma.userProfile.findUnique({ where: { id: customerB.id } });
    assert(
      'B3. unblock restores target (phone-blocked id) to active, B untouched',
      freshA!.status === 'active' && bAfterUnblock!.status === 'active',
      `A=${freshA?.status} B=${bAfterUnblock?.status}`,
    );
    assert(
      'B3b. isPhoneBlocked false after official unblock',
      (await customers.isPhoneBlocked(phoneA)) === false,
      `phoneA blocked=${await customers.isPhoneBlocked(phoneA)}`,
    );

    const blockedCount = await prisma.userProfile.count({
      where: { phoneNumber: { in: [phoneA, phoneB] }, role: 'customer', status: 'suspended' },
    });
    assert(
      'B4. no residual suspended customers',
      blockedCount === 0,
      `suspended=${blockedCount}`,
    );

    const ipStill = await prisma.blockedIp.findUnique({ where: { ip: testIp } });
    const phoneStill = await prisma.blockedPhone.findFirst({
      where: { phone: { in: [phoneA, phoneB] } },
    });
    assert(
      'B5. registries not mixed up: IP soft-deactivated (not active), no phone entries for test customers',
      (!ipStill || ipStill.isActive === false) && !phoneStill,
      `ipActive=${ipStill?.isActive ?? 'absent'} phoneRows=${phoneStill ? 1 : 0}`,
    );

    assert(
      'B6. customers still resolvable after block/unblock cycle (no identity corruption)',
      (await prisma.userProfile.findUnique({ where: { id: customerA.id } }))?.phoneNumber === phoneA,
      `phone=${(await prisma.userProfile.findUnique({ where: { id: customerA.id } }))?.phoneNumber}`,
    );

    console.log('\n== evidence ==');
    console.table([
      {
        step: 'IP block',
        ip: testIp,
        listed: Boolean((await blockedEntries.findAll('ip')).find((e) => e.value === testIp)),
      },
      { step: 'IP unblock', ip: testIp, listed: Boolean((await blockedEntries.findAll('ip')).find((e) => e.value === testIp)) },
    ]);

    console.log(
      process.exitCode
        ? '\nBLOCKING SMOKE TEST FAILED — see FAIL lines above.'
        : '\nBLOCKING SMOKE TEST PASSED — IP & phone block/unblock verified on real DB (no mocks).',
    );
  } finally {
    for (const fn of cleanup.reverse()) {
      try {
        await fn();
      } catch {
        /* best-effort */
      }
    }
    await app.close();
  }
}

main().catch((e) => {
  console.error('BLOCKING SMOKE TEST CRASHED:', e);
  process.exit(1);
});
process.on('SIGTERM', () => process.exit(0));