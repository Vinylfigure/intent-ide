/*
  Warnings:

  - You are about to drop the `DocumentSource` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `sourceId` on the `Annotation` table. All the data in the column will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "DocumentSource";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "DocCommit" (
    "hash" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "parentHash" TEXT,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "docJson" TEXT NOT NULL,
    "blockIdsTouched" TEXT NOT NULL DEFAULT '[]',
    "annotationId" TEXT,
    "auditIds" TEXT NOT NULL DEFAULT '[]',
    "actor" TEXT NOT NULL DEFAULT 'human',
    "modelVersion" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Annotation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transcript" TEXT NOT NULL,
    "intentType" TEXT NOT NULL,
    "scopeStart" INTEGER NOT NULL,
    "scopeEnd" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Annotation" ("createdAt", "id", "intentType", "scopeEnd", "scopeStart", "transcript") SELECT "createdAt", "id", "intentType", "scopeEnd", "scopeStart", "transcript" FROM "Annotation";
DROP TABLE "Annotation";
ALTER TABLE "new_Annotation" RENAME TO "Annotation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DocCommit_documentId_createdAt_idx" ON "DocCommit"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DocCommit_documentId_parentHash_idx" ON "DocCommit"("documentId", "parentHash");
