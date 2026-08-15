import type { RequestHandler } from "express";
import { and, eq, or } from "drizzle-orm";
import { appUsersTable, db } from "@workspace/db";
import { logger } from "../lib/logger";
import { shouldRefreshLastSeen } from "../lib/auth-timing";

interface SupabaseUser {
  id: string;
  email?: string;
}

export interface UsstAuthUser {
  id: number;
  authUserId: string;
  email: string;
  role: "admin" | "user";
}

function getSupabaseConfig() {
  const url = process.env["SUPABASE_URL"]?.replace(/\/+$/, "");
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];

  if (!url || !publishableKey) {
    return null;
  }

  return { url, publishableKey };
}

async function fetchSupabaseUser(token: string): Promise<SupabaseUser | null> {
  const config = getSupabaseConfig();
  if (!config) {
    throw new Error("SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be configured");
  }

  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: {
      apikey: config.publishableKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as SupabaseUser;
}

export const requireAuth: RequestHandler = async (req, res, next) => {
  try {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const token = authorization.slice("Bearer ".length).trim();
    if (!token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const supabaseUser = await fetchSupabaseUser(token);
    const email = supabaseUser?.email?.trim().toLowerCase();

    if (!supabaseUser?.id || !email) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }

    const [allowedUser] = await db
      .select()
      .from(appUsersTable)
      .where(
        and(
          eq(appUsersTable.active, true),
          or(eq(appUsersTable.authUserId, supabaseUser.id), eq(appUsersTable.email, email)),
        ),
      )
      .limit(1);

    if (!allowedUser) {
      res.status(403).json({ error: "Your account is not authorized for USST" });
      return;
    }

    if (allowedUser.authUserId && allowedUser.authUserId !== supabaseUser.id) {
      logger.warn(
        { appUserId: allowedUser.id, email },
        "Rejected Supabase identity that does not match linked USST user",
      );
      res.status(403).json({ error: "Account identity mismatch" });
      return;
    }

    const now = new Date();
    const needsIdentityLink = !allowedUser.authUserId;
    let linkedUser = allowedUser;
    if (needsIdentityLink || shouldRefreshLastSeen(allowedUser.lastSeenAt, now)) {
      const [updatedUser] = await db
        .update(appUsersTable)
        .set({
          authUserId: allowedUser.authUserId ?? supabaseUser.id,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(eq(appUsersTable.id, allowedUser.id))
        .returning();
      if (updatedUser) linkedUser = updatedUser;
    }

    res.locals.usstUser = {
      id: linkedUser.id,
      authUserId: supabaseUser.id,
      email,
      role: linkedUser.role === "admin" ? "admin" : "user",
    } satisfies UsstAuthUser;

    next();
  } catch (err) {
    logger.error({ err }, "Supabase authentication failed");
    res.status(503).json({ error: "Authentication service unavailable" });
  }
};

export const requireAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.usstUser as UsstAuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (user.role !== "admin") {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
};
