import { Router, type IRouter } from "express";
import type { UsstAuthUser } from "../middlewares/supabase-auth";

const router: IRouter = Router();

router.get("/auth/me", (_req, res): void => {
  const user = res.locals.usstUser as UsstAuthUser | undefined;
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  res.json({
    id: user.id,
    email: user.email,
    role: user.role,
  });
});

export default router;
