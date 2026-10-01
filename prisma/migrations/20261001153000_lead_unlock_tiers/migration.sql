-- AlterTable
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "unlockTiers" JSONB;
