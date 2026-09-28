-- Allow same email for customer and business as separate User rows (separate passwords).
DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_role_key" ON "User"("email", "role");
CREATE INDEX IF NOT EXISTS "User_email_idx" ON "User"("email");
