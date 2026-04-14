import { Router, type IRouter } from "express";
import healthRouter from "./health";
import interviewsRouter from "./interviews";
import botRouter from "./bot";
import pdfRouter from "./pdf";
import livekitRouter from "./livekit";


const router: IRouter = Router();

router.use(healthRouter);
router.use(interviewsRouter);
router.use(botRouter);
router.use(pdfRouter);
router.use(livekitRouter); 


export default router;
