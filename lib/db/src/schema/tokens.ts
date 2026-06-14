import { pgTable, text, serial, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const accessTokensTable = pgTable("access_tokens", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  label: text("label"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revoked: boolean("revoked").notNull().default(false),
});

export const insertAccessTokenSchema = createInsertSchema(accessTokensTable).omit({
  id: true,
  createdAt: true,
});
export type InsertAccessToken = z.infer<typeof insertAccessTokenSchema>;
export type AccessToken = typeof accessTokensTable.$inferSelect;
