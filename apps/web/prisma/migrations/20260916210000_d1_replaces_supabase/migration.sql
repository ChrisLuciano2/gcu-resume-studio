-- Drops SUPABASE from the Provider enum. Safe to run now: the only
-- SUPABASE-provider Connection row (the polish-check@gcu.edu test account)
-- was already deleted as an explicit pre-migration step — see the approved
-- migration plan's step 1 and the backup at
-- C:\Users\17143\Desktop\backups\central-db-2026-09-16-pre-d1-migration.json.
BEGIN;
CREATE TYPE "Provider_new" AS ENUM ('CLOUDFLARE');
ALTER TABLE "Connection" ALTER COLUMN "provider" TYPE "Provider_new" USING ("provider"::text::"Provider_new");
ALTER TYPE "Provider" RENAME TO "Provider_old";
ALTER TYPE "Provider_new" RENAME TO "Provider";
DROP TYPE "Provider_old";
COMMIT;
