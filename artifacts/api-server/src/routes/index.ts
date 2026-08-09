import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountRouter from "./account";
import authRouter from "./auth";
import projectsRouter from "./projects";
import scansRouter from "./scans";
import epbcRouter from "./epbc";
import { requireAuth } from "../middlewares/supabase-auth";

const router: IRouter = Router();

// Health remains public for Railway health checks.
router.use(healthRouter);

// All application data and administrative endpoints require a valid Supabase
// session plus an active row in the USST app_users allowlist.
router.use(requireAuth);
router.use(accountRouter);
router.use(authRouter);
router.use(projectsRouter);
router.use(scansRouter);
router.use(epbcRouter);

export default router;
