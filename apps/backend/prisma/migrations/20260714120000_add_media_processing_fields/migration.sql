-- Create MediaProcessingStatus enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MediaProcessingStatus') THEN
    CREATE TYPE "MediaProcessingStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'FAILED');
  END IF;
END
$$;

-- Add processing fields to Media table
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "processingStatus" "MediaProcessingStatus" NOT NULL DEFAULT 'UPLOADED';
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "processingError" TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "derivativeManifest" JSONB;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "blurUrl" TEXT;
ALTER TABLE "Media" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Create index on processingStatus
CREATE INDEX IF NOT EXISTS "Media_processingStatus_idx" ON "Media"("processingStatus");
