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
import meRouter from "./v1/me";
import uploadsRouter from "./v1/uploads";

const router: IRouter = Router();

router.use("/public", publicRouter);
router.use("/admin", adminRouter);
router.use("/notices", noticesRouter);
router.use("/gallery", galleryRouter);
router.use("/me", meRouter);
router.use("/uploads", uploadsRouter);

export default router;
