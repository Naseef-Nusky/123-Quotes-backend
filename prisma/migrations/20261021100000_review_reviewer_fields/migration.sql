-- AlterTable
ALTER TABLE "Review" ADD COLUMN "reviewerName" TEXT;
ALTER TABLE "Review" ADD COLUMN "reviewerProfessionalId" TEXT;

-- CreateIndex
CREATE INDEX "Review_professionalId_reviewerProfessionalId_idx" ON "Review"("professionalId", "reviewerProfessionalId");
