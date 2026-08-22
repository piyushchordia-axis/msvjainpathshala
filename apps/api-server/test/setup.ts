// Ensure DB env exists before @workspace/db / app are imported by any test
// (@workspace/db throws at import time when DATABASE_URL is unset).
process.env.DATABASE_URL ??= "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala";
process.env.NODE_ENV ??= "test";
process.env.JP_AUTH_SECRET ??= "jp-dev-secret-do-not-use-in-production";
process.env.LOG_LEVEL ??= "silent"; // quiet pino-http request logs during tests
// PORT is not needed (the app is never listened on in tests).

// X-8 (review 2026-08) — quiz-notify's push-quiz/quiz-event fan-outs are
// enqueued on QUEUE_NAMES.PARENT_NOTIFY (matching shivir-notify's existing
// pattern) instead of running inline in the authoring request. Without
// REDIS_URL, lib/queues.ts's enqueueJob runs the registered handler inline —
// but only if something has registered it. Production does this via
// registerAllJobs() in src/index.ts / src/worker.ts, neither of which tests
// import. registerCron (also called by registerDerivedDataJobs) only pushes
// to an in-memory array; no timer fires without startScheduler(), which
// tests never call — so registering here is safe and does not start any
// cron. Dynamic import so this still runs AFTER the DATABASE_URL default
// above (a static import would hoist above it).
const { registerDerivedDataJobs } = await import("../src/jobs/derived-data-jobs");
registerDerivedDataJobs();
