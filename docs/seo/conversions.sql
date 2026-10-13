-- Read-only aggregate report. Existing D1 events table; no schema change.
-- Attribute each signup to the most recent recorded search landing within 7 days.
-- Approximation: visitor IDs can change with IP/browser; analytics rate limits
-- and missing referrers omit visits. No attribution claim across devices.
WITH candidates AS (
  SELECT s.id AS signup_id, v.path, v.country, v.device,
         row_number() OVER (PARTITION BY s.id ORDER BY v.t DESC, v.id DESC) AS choice
  FROM events s JOIN events v ON v.visitor = s.visitor
  WHERE s.kind = 'signup' AND v.kind = 'view'
    AND v.device != 'bot' AND v.visitor IS NOT NULL
    AND v.t <= s.t AND v.t >= s.t - 604800000
    AND s.t >= (unixepoch('now') - 28 * 86400) * 1000
    AND (v.referrer GLOB 'www.google.*/search*'
      OR v.referrer GLOB 'www.google.*/'
      OR v.referrer GLOB 'www.bing.com/*'
      OR v.referrer GLOB 'duckduckgo.com/*')
)
SELECT path, country, device, count(*) AS attributed_signups
FROM candidates WHERE choice = 1
GROUP BY path, country, device ORDER BY attributed_signups DESC;
