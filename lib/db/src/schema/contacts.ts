import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const pvhContactsTable = pgTable("pvh_contacts", {
  id: serial("id").primaryKey(),
  firstName: text("first_name"),
  middleName: text("middle_name"),
  lastName: text("last_name"),
  organizationName: text("organization_name"),
  organizationTitle: text("organization_title"),
  email1: text("email1"),
  email2: text("email2"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PvhContact = typeof pvhContactsTable.$inferSelect;
