/**
 * /v1 router — real public and admin API surface backed by Postgres.
 *
 * Express 5 / path-to-regexp v8: use explicit named params, no glob wildcards.
 */
import { Router, type IRouter } from "express";
import publicRouter from "./v1/public";
import adminRouter from "./v1/admin";
import noticesRouter from "./v1/notices";
import galleryRouter from "./v1/gallery";

const router: IRouter = Router();

router.use("/public", publicRouter);
router.use("/admin", adminRouter);
router.use("/notices", noticesRouter);
router.use("/gallery", galleryRouter);

export default router;
