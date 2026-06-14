import { Router, type IRouter } from "express";
import { db, accessTokensTable } from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ADMIN_SECRET = process.env["ADMIN_SECRET"] || "solar2025";

// Generate a random token string
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// POST /auth/token — create a new access token (admin only)
router.post("/auth/token", async (req, res): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { label, expiresAt } = req.body;
  if (!expiresAt) {
    res.status(400).json({ error: "expiresAt is required" });
    return;
  }

  const token = generateToken();
  const [row] = await db
    .insert(accessTokensTable)
    .values({
      token,
      label: label || null,
      expiresAt: new Date(expiresAt),
    })
    .returning();

  res.status(201).json({
    id: row.id,
    token: row.token,
    label: row.label,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    revoked: row.revoked,
  });
});

// GET /auth/tokens — list active tokens (admin only)
router.get("/auth/tokens", async (req, res): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const tokens = await db
    .select()
    .from(accessTokensTable)
    .orderBy(accessTokensTable.createdAt);

  res.json(
    tokens.map((t) => ({
      id: t.id,
      token: t.token,
      label: t.label,
      expiresAt: t.expiresAt.toISOString(),
      createdAt: t.createdAt.toISOString(),
      revoked: t.revoked,
    }))
  );
});

// DELETE /auth/tokens/:id — revoke a token
router.delete("/auth/tokens/:id", async (req, res): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  await db
    .update(accessTokensTable)
    .set({ revoked: true })
    .where(eq(accessTokensTable.id, id));

  res.status(204).send();
});

// POST /auth/validate — validate a token
router.post("/auth/validate", async (req, res): Promise<void> => {
  const { token } = req.body;
  if (!token) {
    res.status(400).json({ error: "Token is required" });
    return;
  }

  // Admin key always grants access
  if (token === ADMIN_SECRET) {
    res.json({ valid: true, id: 0, label: "Admin", expiresAt: null });
    return;
  }

  const [row] = await db
    .select()
    .from(accessTokensTable)
    .where(
      and(
        eq(accessTokensTable.token, token),
        eq(accessTokensTable.revoked, false),
        gt(accessTokensTable.expiresAt, new Date())
      )
    );

  if (!row) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  res.json({
    valid: true,
    id: row.id,
    label: row.label,
    expiresAt: row.expiresAt.toISOString(),
  });
});

export default router;
