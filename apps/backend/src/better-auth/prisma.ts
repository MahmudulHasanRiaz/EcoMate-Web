import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

function createBaPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL || "postgresql://postgres@localhost:5432/ecomate_web";
  const pool = new Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

let _baPrisma: PrismaClient | undefined;

export const baPrisma = new Proxy({} as PrismaClient, {
  get(_, prop: string | symbol) {
    if (!_baPrisma) _baPrisma = createBaPrisma();
    return Reflect.get(_baPrisma, prop);
  },
});
