import { PrismaClient } from "@/generated/prisma/client"
import { PrismaLibSql } from "@prisma/adapter-libsql"

// Local dev: file:dev.db (no token). Production: libsql://…turso.io + auth token.
const adapter = new PrismaLibSql({
  url: process.env.DATABASE_URL ?? "file:dev.db",
  authToken: process.env.DATABASE_AUTH_TOKEN,
})

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter })

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma
}
