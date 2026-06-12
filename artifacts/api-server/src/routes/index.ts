import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import scansRouter from "./scans";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(scansRouter);

export default router;
