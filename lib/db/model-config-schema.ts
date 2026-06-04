// ============================================
// 模型配置 Drizzle Schema
// model_configs (全局默认) + user_model_configs (用户自定义)
// ============================================

import {
  pgTable,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// 全局模型配置（管理员设置）
export const modelConfigs = pgTable(
  "model_configs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    serviceType: varchar("service_type", { length: 50 }).notNull(), // llm | image | tts | video
    provider: varchar("provider", { length: 50 }).notNull(),        // glm | deepseek | openai | xunfei | edge ...
    modelName: varchar("model_name", { length: 100 }).notNull(),    // glm-4-flash | cogview-3-plus ...
    apiKey: text("api_key"),                                         // AES-256-GCM 加密
    baseUrl: varchar("base_url", { length: 500 }),
    isDefault: boolean("is_default").default(false),
    config: jsonb("config").default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_model_configs_service").on(table.serviceType),
    uniqueIndex("model_configs_service_type_provider_model_name_key").on(
      table.serviceType,
      table.provider,
      table.modelName
    ),
  ]
);

// 用户模型配置（用户自带 Key）
export const userModelConfigs = pgTable(
  "user_model_configs",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: varchar("user_id", { length: 100 }).notNull(),
    serviceType: varchar("service_type", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    modelName: varchar("model_name", { length: 100 }).notNull(),
    apiKey: text("api_key"),                                         // AES-256-GCM 加密
    baseUrl: varchar("base_url", { length: 500 }),
    config: jsonb("config").default({}),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [
    index("idx_user_model_configs_user").on(table.userId),
    index("idx_user_model_configs_service").on(table.userId, table.serviceType),
    uniqueIndex("user_model_configs_user_id_service_type_key").on(
      table.userId,
      table.serviceType
    ),
  ]
);

// Types
export type ModelConfig = typeof modelConfigs.$inferSelect;
export type NewModelConfig = typeof modelConfigs.$inferInsert;
export type UserModelConfig = typeof userModelConfigs.$inferSelect;
export type NewUserModelConfig = typeof userModelConfigs.$inferInsert;
