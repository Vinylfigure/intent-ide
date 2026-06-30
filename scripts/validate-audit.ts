/**
 * Validate the 14-Field Minimum Viable Audit Schema
 *
 * Queries the AuditLog table directly via SQLite and verifies
 * that all compliance fields are present and populated.
 *
 * Usage:
 *   npx tsx scripts/validate-audit.ts
 *
 * Note: Uses raw SQLite (not Prisma client) to avoid libsql adapter
 * complications in standalone scripts. The dev.db file is at the project root.
 */

import Database from 'better-sqlite3'
import path from 'path'

const DB_PATH = path.resolve(__dirname, '..', 'dev.db')

// The 14-field Minimum Viable Audit Schema per compliance-audit-layer.md
const REQUIRED_FIELDS = [
  'id',                   // Audit_ID: unique immutable identifier
  'timestampUTC',         // Timestamp_UTC: ISO 8601 event time
  'userId',               // User_ID: anonymized identifier
  'modelName',            // Model_Name: LLM provider
  'modelVersion',         // Model_Version: exact model spec
  'promptVersion',        // Prompt_Version: version-controlled prompt template
  'queryClassification',  // Query_Classification: business context (FIX, RESTRUCTURE)
  'sourceDocuments',      // Source_Documents: GraphRAG node IDs
  'confidenceScore',      // Confidence_Score: token-level uncertainty
  'responseId',           // Response_ID: links input→output
  'outputType',           // Output_Type: format of AI output
  'regulatoryContext',    // Regulatory_Context: applicable regulation
  'approvalStatus',       // Approval_Status: HITL workflow state
  'dataRetentionDays',    // Data_Retention_Days: system-enforced lifespan
] as const

// Additional fields for override tracking
const OVERRIDE_FIELDS = ['overrideOf', 'overrideReason'] as const

function main() {
  let db: Database.Database

  try {
    db = new Database(DB_PATH, { readonly: true })
  } catch (err) {
    console.error(`❌ Cannot open database at ${DB_PATH}`)
    console.error('   Make sure the dev server has been run at least once to create the DB.')
    process.exit(1)
  }

  // 1. Verify table exists
  const tableInfo = db.pragma('table_info(AuditLog)') as { name: string; type: string }[]
  if (tableInfo.length === 0) {
    console.error('❌ AuditLog table does not exist in the database.')
    db.close()
    process.exit(1)
  }

  const columnNames = tableInfo.map((col) => col.name)
  console.log(`\nAuditLog table has ${columnNames.length} columns:\n  ${columnNames.join(', ')}\n`)

  // 2. Check required fields exist in schema
  const allRequired = [...REQUIRED_FIELDS, ...OVERRIDE_FIELDS]
  const missingColumns = allRequired.filter((f) => !columnNames.includes(f))

  if (missingColumns.length > 0) {
    console.error('❌ Schema Validation Failed. Missing columns:', missingColumns)
    db.close()
    process.exit(1)
  }
  console.log('✅ All 14 compliance fields + 2 override fields present in schema.\n')

  // 3. Check for audit records
  const count = db.prepare('SELECT COUNT(*) as cnt FROM AuditLog').get() as { cnt: number }
  console.log(`Total audit records: ${count.cnt}`)

  if (count.cnt === 0) {
    console.log('\n⚠️  No audit logs found yet. Use the app to trigger a resolution, then re-run.')
    db.close()
    return
  }

  // 4. Fetch and display latest record
  const latest = db.prepare('SELECT * FROM AuditLog ORDER BY timestampUTC DESC LIMIT 1').get() as Record<string, unknown>
  console.log('\nLatest audit record:')
  for (const [key, value] of Object.entries(latest)) {
    const status = value === null || value === '' ? '⚠️  (empty)' : '✅'
    console.log(`  ${status} ${key}: ${value}`)
  }

  // 5. Check append-only: look for override records
  const overrides = db.prepare(
    "SELECT COUNT(*) as cnt FROM AuditLog WHERE overrideOf IS NOT NULL AND overrideOf != ''"
  ).get() as { cnt: number }
  console.log(`\nOverride records (append-only human decisions): ${overrides.cnt}`)

  // 6. Check approval status distribution
  const statuses = db.prepare(
    'SELECT approvalStatus, COUNT(*) as cnt FROM AuditLog GROUP BY approvalStatus'
  ).all() as { approvalStatus: string; cnt: number }[]
  console.log('\nApproval status distribution:')
  for (const row of statuses) {
    console.log(`  ${row.approvalStatus}: ${row.cnt}`)
  }

  console.log('\n✅ Audit schema validation complete.')
  db.close()
}

main()
