-- Fix HeldCart: add updatedAt, add FK constraints

-- Add updatedAt column (safe)
ALTER TABLE "HeldCart" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Add FK constraint: HeldCart.sessionId → PosSession.id (safe)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HeldCart_sessionId_fkey') THEN
        ALTER TABLE "HeldCart" ADD CONSTRAINT "HeldCart_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PosSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- Add FK constraint: HeldCart.cashierId → User.id (safe)
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'HeldCart_cashierId_fkey') THEN
        ALTER TABLE "HeldCart" ADD CONSTRAINT "HeldCart_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
