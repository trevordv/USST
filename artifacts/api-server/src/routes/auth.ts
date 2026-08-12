import { Router, type IRouter } from "express";
import { db, accessTokensTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ADMIN_SECRET = process.env["ADMIN_SECRET"] || "solar2025";
const GMAIL_USER = process.env["GMAIL_USER"];
const GMAIL_APP_PASSWORD = process.env["GMAIL_APP_PASSWORD"];

function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 24; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function getAppUrl(): string {
  const configuredUrl = process.env["APP_URL"]?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/+$/, "");
  }

  const port = process.env["PORT"] || "5000";
  return `http://localhost:${port}`;
}

async function sendInviteEmail(
  recipientEmail: string,
  label: string | null,
  token: string,
  expiresAt: Date
): Promise<boolean> {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    logger.warn("GMAIL_USER or GMAIL_APP_PASSWORD not set — invite email not sent");
    return false;
  }

  const inviteUrl = `${getAppUrl()}/?token=${token}`;
  const expiryStr = expiresAt.toLocaleDateString("en-AU", {
    day: "numeric", month: "long", year: "numeric",
  });

  const { default: nodemailer } = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const greeting = label ? `Hi ${label},` : "Hi there,";

  const html = `
<!DOCTYPE html>
<html>
<body style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a2e;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="color: #1a3a6e; font-size: 22px; margin: 0;">Utility Scale Solar Tracker</h1>
    <p style="color: #666; margin: 4px 0 0;">USST — AU/NZ Project Intelligence</p>
  </div>

  <p>${greeting}</p>
  <p>You've been invited to access the <strong>Utility Scale Solar Tracker</strong> — a real-time directory of utility-scale solar and BESS projects across Australia and New Zealand.</p>

  <div style="text-align: center; margin: 32px 0;">
    <a href="${inviteUrl}"
       style="background-color: #f59e0b; color: #1a1a2e; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 16px; display: inline-block;">
      Access the App
    </a>
  </div>

  <p style="color: #555; font-size: 14px;">Or copy and paste this link into your browser:</p>
  <p style="background: #f4f4f4; padding: 10px 14px; border-radius: 4px; font-size: 13px; word-break: break-all; color: #333;">
    ${inviteUrl}
  </p>

  <p style="color: #888; font-size: 13px; margin-top: 32px;">
    This link expires on <strong>${expiryStr}</strong>. After that date you'll need a new invite.
  </p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
  <p style="color: #aaa; font-size: 11px; text-align: center;">
    Sent by Utility Scale Solar Tracker &mdash; do not reply to this email.
  </p>
</body>
</html>`;

  try {
    await transporter.sendMail({
      from: `"USST" <${GMAIL_USER}>`,
      to: recipientEmail,
      subject: "Your USST Access Invite",
      html,
    });
    logger.info({ recipientEmail }, "Invite email sent");
    return true;
  } catch (err) {
    logger.error({ err, recipientEmail }, "Failed to send invite email");
    return false;
  }
}

// POST /auth/token — create a new access token and optionally email it (admin only)
router.post("/auth/token", async (req, res): Promise<void> => {
  const adminKey = req.headers["x-admin-key"];
  if (adminKey !== ADMIN_SECRET) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { label, recipientEmail, expiresAt: expiresAtRaw } = req.body;

  // Default to 7 days from now if no expiry provided
  const expiresAt = expiresAtRaw
    ? new Date(expiresAtRaw)
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const token = generateToken();
  const [row] = await db
    .insert(accessTokensTable)
    .values({
      token,
      label: label || null,
      recipientEmail: recipientEmail || null,
      expiresAt,
    })
    .returning();

  let emailSent = false;
  if (recipientEmail) {
    emailSent = await sendInviteEmail(recipientEmail, label || null, token, expiresAt);
  }

  res.status(201).json({
    id: row.id,
    token: row.token,
    label: row.label,
    recipientEmail: row.recipientEmail,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    revoked: row.revoked,
    emailSent,
  });
});

// GET /auth/tokens — list tokens (admin only)
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
      recipientEmail: t.recipientEmail,
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
