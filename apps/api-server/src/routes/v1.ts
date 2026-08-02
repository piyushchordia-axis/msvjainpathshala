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
import sessionsRouter from "./v1/sessions";
import niyamSubmissionsRouter from "./v1/niyam-submissions";
import examsRouter from "./v1/exams";
import homeworkRouter from "./v1/homework";
import registrationRouter from "./v1/registration";
import serviceRequestsRouter from "./v1/service-requests";
import idCardsRouter from "./v1/id-cards";
import progressRouter from "./v1/progress";
import auditLogsRouter from "./v1/audit-logs";
import competitionsRouter from "./v1/competitions";
import quizzesRouter from "./v1/quizzes";
import donationsRouter from "./v1/donations";
import msvRouter from "./v1/msv";
import notificationsRouter from "./v1/notifications";
import shivirScannerRouter from "./v1/shivir-scanner";
import enquiriesRouter from "./v1/enquiries";
import curriculumRouter from "./v1/curriculum";
import libraryRouter from "./v1/library";
import enrolmentsRouter from "./v1/enrolments";
import clientSettingsRouter from "./v1/client-settings";
import syncRouter from "./v1/sync";
import studentsRouter from "./v1/students";
import centresRouter from "./v1/centres";

const router: IRouter = Router();

router.use("/public", publicRouter);
router.use("/sync", syncRouter);
router.use("/admin", adminRouter);
router.use("/settings/public", clientSettingsRouter);
router.use("/notices", noticesRouter);
router.use("/gallery", galleryRouter);
router.use("/me", meRouter);
router.use("/uploads", uploadsRouter);
// Frozen table only — no /v1/attendance aliases.
router.use("/sessions", sessionsRouter);
router.use("/centres", centresRouter);
router.use("/niyam-submissions", niyamSubmissionsRouter);
router.use("/exams", examsRouter);
router.use("/homework", homeworkRouter);
router.use("/registration", registrationRouter);
router.use("/service-requests", serviceRequestsRouter);
router.use("/id-cards", idCardsRouter);
router.use("/progress", progressRouter);
router.use("/audit-logs", auditLogsRouter);
router.use("/competitions", competitionsRouter);
router.use("/quizzes", quizzesRouter);
router.use("/donations", donationsRouter);
router.use("/msv", msvRouter);
router.use("/notifications", notificationsRouter);
router.use("/shivir-scanner", shivirScannerRouter);
router.use("/enquiries", enquiriesRouter);
router.use("/curriculum", curriculumRouter);
router.use("/library", libraryRouter);
router.use("/enrolments", enrolmentsRouter);
router.use("/students", studentsRouter);

export default router;
