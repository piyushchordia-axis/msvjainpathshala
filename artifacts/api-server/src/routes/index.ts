import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import v1Router from "./v1";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);

export default router;

export { v1Router };
