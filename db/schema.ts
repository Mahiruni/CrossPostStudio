import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const videos = sqliteTable("videos", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  r2Key: text("r2_key"),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  caption: text("caption").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  plannedAt: text("planned_at"),
  status: text("status").notNull().default("draft"),
  facebookVideoId: text("facebook_video_id"),
  publishState: text("publish_state"),
  createdAt: text("created_at").notNull(),
  publishedAt: text("published_at"),
});

export const facebookConnections = sqliteTable("facebook_connections", {
  userId: text("user_id").primaryKey(),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  tokenCiphertext: text("token_ciphertext").notNull(),
  tokenIv: text("token_iv").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const metaAppConfigs = sqliteTable("meta_app_configs", {
  userId: text("user_id").primaryKey(),
  appId: text("app_id").notNull(),
  appSecretCiphertext: text("app_secret_ciphertext").notNull(),
  appSecretIv: text("app_secret_iv").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const facebookPageChoices = sqliteTable(
  "facebook_page_choices",
  {
    userId: text("user_id").notNull(),
    pageId: text("page_id").notNull(),
    pageName: text("page_name").notNull(),
    tokenCiphertext: text("token_ciphertext").notNull(),
    tokenIv: text("token_iv").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.pageId] }),
  }),
);

