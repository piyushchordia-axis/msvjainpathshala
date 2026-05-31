// Shared SLO threshold builders — keeps every k6 script consistent with
// SPEC.md §15.6. p95 is the contract; pX functions are convenience.

export const p95Under = (ms) => `p(95)<${ms}`;
export const p99Under = (ms) => `p(99)<${ms}`;
export const successRateAbove = (rate) => `rate<${1 - rate}`; // express as failure cap

export const baseHttpThresholds = ({ p95 = 500, failRate = 0.005 } = {}) => ({
  http_req_duration: [p95Under(p95)],
  http_req_failed: [`rate<${failRate}`],
});
