-- CreateTable
CREATE TABLE "DocInvariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "blockIds" TEXT NOT NULL DEFAULT '[]',
    "checkKind" TEXT NOT NULL DEFAULT 'deterministic',
    "status" TEXT NOT NULL DEFAULT 'active',
    "provenanceCommitHash" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "DocInvariant_documentId_createdAt_idx" ON "DocInvariant"("documentId", "createdAt");
