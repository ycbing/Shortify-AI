import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import * as modelConfigSchema from "./model-config-schema";
export { modelConfigs, userModelConfigs } from "./model-config-schema";
export type { ModelConfig, NewModelConfig, UserModelConfig, NewUserModelConfig } from "./model-config-schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });
