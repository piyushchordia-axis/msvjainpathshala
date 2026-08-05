-- Reviewable cleanup (AT32.2): null out fabricated (0,0) check-in GPS from the
-- pre-nullable soft-create path that used lat:0 / lng:0 / accuracy_m:9999 when
-- no fix was captured. Those sentinels place the Guruji in the Gulf of Guinea
-- (~6,000 km from any Indian centre), set gps_flagged, and poison distance analytics.
-- Columns were already NULLABLE — this does NOT alter schema, only data.
-- Do not auto-run without ops review of affected centres.
UPDATE sessions
SET
  check_in_lat = NULL,
  check_in_lng = NULL,
  check_in_distance_m = NULL,
  check_in_accuracy_m = NULL,
  gps_flagged = false,
  gps_unverified = true
WHERE check_in_lat = '0'
  AND check_in_lng = '0';
