// Ensure DB env exists before @workspace/db / app are imported by any test
// (@workspace/db throws at import time when DATABASE_URL is unset).
process.env.DATABASE_URL ??= "postgres://jp:jp_dev_pwd@localhost:5434/jainpathshala";
process.env.NODE_ENV ??= "test";
process.env.JP_AUTH_SECRET ??= "jp-dev-secret-do-not-use-in-production";
process.env.LOG_LEVEL ??= "silent"; // quiet pino-http request logs during tests
// PORT is not needed (the app is never listened on in tests).
