-- Add lastIp column to User model
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastIp" TEXT;

-- Create index for IP lookup
CREATE INDEX IF NOT EXISTS "User_lastIp_idx" ON "User" ("lastIp");
