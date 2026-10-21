-- AlterTable
ALTER TABLE "ClientMessage" ADD COLUMN "senderProfessionalId" TEXT;

-- CreateIndex
CREATE INDEX "ClientMessage_senderProfessionalId_createdAt_idx" ON "ClientMessage"("senderProfessionalId", "createdAt");

-- AddForeignKey
ALTER TABLE "ClientMessage" ADD CONSTRAINT "ClientMessage_senderProfessionalId_fkey" FOREIGN KEY ("senderProfessionalId") REFERENCES "ProfessionalProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
