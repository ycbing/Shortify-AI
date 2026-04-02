import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "@/lib/db/schema";

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

async function initDb() {
  console.log("Initializing database...");

  // Check if tables exist by trying a simple query
  try {
    await sql`SELECT 1`;
    console.log("Database connection successful");

    // The actual table creation should be done via drizzle-kit push
    console.log("Please run 'npm run db:push' to create tables");
  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
}

initDb();
