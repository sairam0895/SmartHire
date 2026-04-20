import { Router, type IRouter } from "express";
import healthRouter from "./health";
import interviewsRouter from "./interviews";
import botRouter from "./bot";
import pdfRouter from "./pdf";
import livekitRouter from "./livekit";
import authRouter from "./auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(interviewsRouter);
router.use(botRouter);
router.use(pdfRouter);
router.use(livekitRouter);

export default router;
