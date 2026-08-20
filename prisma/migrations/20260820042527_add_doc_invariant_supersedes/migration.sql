-- AlterTable
ALTER TABLE "DocInvariant" ADD COLUMN "supersedesId" TEXT;

-- CreateIndex
-- Unique (not just indexed): at most one row may point supersedesId at any
-- given target, so two concurrent resolve/dismiss requests for the same
-- invariant can never both succeed (SQLite unique indexes allow unlimited
-- NULLs, so ordinary capture rows with supersedesId = NULL are unaffected).
CREATE UNIQUE INDEX "DocInvariant_supersedesId_key" ON "DocInvariant"("supersedesId");
