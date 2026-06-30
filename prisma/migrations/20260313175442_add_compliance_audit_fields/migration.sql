-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resolutionId" TEXT,
    "timestampUTC" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "modelName" TEXT NOT NULL DEFAULT '',
    "modelVersion" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "promptHash" TEXT NOT NULL,
    "queryClassification" TEXT NOT NULL DEFAULT '',
    "sourceDocuments" TEXT NOT NULL DEFAULT '[]',
    "confidenceScore" REAL,
    "responseId" TEXT NOT NULL DEFAULT '',
    "outputType" TEXT NOT NULL DEFAULT 'RESOLUTION',
    "regulatoryContext" TEXT NOT NULL DEFAULT 'EU_AI_ACT',
    "approvalStatus" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "dataRetentionDays" INTEGER NOT NULL DEFAULT 2555,
    "graphNodesUsed" TEXT NOT NULL DEFAULT '[]',
    "overrideOf" TEXT,
    "overrideReason" TEXT,
    CONSTRAINT "AuditLog_resolutionId_fkey" FOREIGN KEY ("resolutionId") REFERENCES "Resolution" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AuditLog" ("graphNodesUsed", "id", "modelVersion", "promptHash", "resolutionId", "timestampUTC", "userId") SELECT "graphNodesUsed", "id", "modelVersion", "promptHash", "resolutionId", "timestampUTC", "userId" FROM "AuditLog";
DROP TABLE "AuditLog";
ALTER TABLE "new_AuditLog" RENAME TO "AuditLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
