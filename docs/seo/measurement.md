# Search measurement for every supplied keyword

The report contains all **850 unique supplied keywords**, including terms with no Search Console observations. It reads assignments from the reproducible keyword ledger, so source duplicates do not inflate the report.

## Generate the baseline

```sh
node scripts/seo-report.mjs
```

This requires no credentials or network access. It creates three ignored local artifacts in `data/seo-review/`:

- `performance.md`: complete keyword table, country/device totals, observed page details and next actions.
- `keyword-performance.csv`: one row per keyword with target, observed URLs, clicks, impressions, CTR, impression-weighted average position, roadmap, priority and suggested action.
- `keyword-page-markets.csv`: returned query/page/country/device observations and market-specific review flags. With no source, this file contains headers only.

Without Search Console data, metrics are `unknown`; this is not a traffic, search-demand or ranking result.

## Import a local export

```sh
node scripts/seo-report.mjs path/to/search-console.json
node scripts/seo-report.mjs path/to/search-console.json --out data/seo-review/october
```

The JSON must contain a `rows` array in Search Analytics API shape, with dimensions in **query, page, country, device** order. The importer below produces this format directly. A Search Console UI CSV is not this JSON format; do not rename CSV files to `.json`.

```json
{
  "dimensions": ["query", "page", "country", "device"],
  "metadata": {"startDate": "2026-09-01", "endDate": "2026-09-28"},
  "rows": [
    {
      "keys": ["pumpfun api", "https://blixvip.com/pump-fun-api", "usa", "DESKTOP"],
      "clicks": 2,
      "impressions": 20,
      "ctr": 0.1,
      "position": 6.5
    }
  ]
}
```

The example is synthetic format documentation, not BLIX performance. Counts must be nonnegative integers, clicks cannot exceed impressions, and positive-impression rows require a finite position of at least 1. CTR is optional, but if present it must agree with the counts. Only exact `https://blixvip.com` origin rows enter this report; HTTP, subdomain and lookalike-domain rows are excluded and counted. Invalid URLs and duplicate dimension rows are rejected rather than silently changing totals.

Daily exports must be aggregated before reporting; concatenating daily rows would create duplicate dimension keys. Use the API importer to perform that aggregation correctly.

## Read-only Search Console API import

Provide `GSC_ACCESS_TOKEN` through the process environment using an OAuth access token whose account can read the property, with scope `https://www.googleapis.com/auth/webmasters.readonly`. The tool does not acquire tokens, discover credentials, read credential files, create properties, modify sitemaps, submit URLs or alter Search Console settings. It never logs or saves the supplied token. Configure OAuth/property access separately when available.

Optional `GSC_SITE_PROPERTY` defaults to `sc-domain:blixvip.com`. An existing HTTPS URL-prefix property can also be supplied. Domain properties can include other hosts; the reporting stage still filters to the canonical site origin.

```sh
node scripts/seo-search-console.mjs --out data/seo-review/search-console.json
node scripts/seo-report.mjs data/seo-review/search-console.json
```

The default period is the previous **28 completed Pacific calendar days**, ending yesterday in `America/Los_Angeles`. Requests explicitly select finalized `web` data. A completed calendar day may not yet have finalized observations, so the export records days with no returned rows without claiming zero traffic.

For a specific comparison period, supply both dates:

```sh
node scripts/seo-search-console.mjs --start 2026-09-01 --end 2026-09-28 --out data/seo-review/september.json
node scripts/seo-report.mjs data/seo-review/september.json --out data/seo-review/september
```

Ranges are inclusive and limited to 31 days per export. Larger reviews should use separate, non-overlapping periods. Each day is paginated with `startRow` and up to 25,000 rows per request, stopping at 50,000 rows. Reaching that cap is marked **possible truncation**, including an exactly full result. Requests use timeouts and bounded retries for rate limits/transient server errors. A failed import does not save partial results; it can be rerun explicitly.

Google describes Pacific date boundaries, pagination, finalized data and the fact that Search Analytics returns top rows rather than guaranteeing complete data in the [Search Analytics query reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query). Google also documents the [50,000-row daily per-type limit](https://support.google.com/webmasters/answer/12919192?hl=en). Metadata preserves the selected period, property, daily row counts, empty days and possible truncation.

## Interpret the report

- `unknown-no-source`: no export supplied.
- `unknown-not-returned`: an export exists, but no matching canonical-origin row was returned. Queries may be anonymized, omitted, filtered, outside the export window, or outside API limits; do not replace this with zero.
- `measured`: at least one returned row exists. Genuine zero counts stay zero; CTR and position remain unknown when the impression denominator is zero.
- CTR is total clicks divided by total returned impressions. Average position is `sum(position × impressions) / sum(impressions)`, never an unweighted mean or fixed rank.
- Summary metrics combine page-level rows and markets; they are not property-level site totals. Use country/device detail for decisions and compare identical filters and periods.
- A cannibalization candidate means multiple distinct paths had impressions for one normalized query within the same country/device. Different markets, query parameters and trailing slashes alone do not trigger it. This is a review signal, not proof that competing pages should be deleted or redirected.
- A target mismatch shows another path receiving observations. Investigate search intent and internal links before replacing the assigned page.
- Priority comes from the keyword plan; suggested next actions are transparent triage rules. They do not forecast ranking gains. Unsupported features and missing comparative evidence retain their roadmap requirements even if they receive impressions.

Search Console does not supply total keyword search volume here. These reports do not establish full indexation, conversions, revenue, rankings across all locations, or progress toward #1 without measured comparative evidence. Track qualified signups and product usage separately.

CSV output neutralizes formula-looking text for spreadsheet viewing. Query normalization lowercases and collapses whitespace for matching; spelling variants such as `pumpfun`, `pump fun` and `pump.fun` remain separate supplied keywords.

## Verify and review

```sh
node --test test/seo-report.test.mjs
```

Tests cover all-keyword unknown reporting, weighted aggregation, duplicate prevention, invalid inputs, exact-origin filtering, zero denominators, market-specific candidate flags, spreadsheet escaping, Pacific dates, daily pagination, capped exports, empty API responses, safe failures and bounded retries. API tests use injected synthetic responses and never require credentials.

Review weekly using comparable dates and the same country/device. Choose concrete actions from observed evidence, retain prior exports, and compare the next equal-length period. Keep raw exports and generated reports in ignored `data/seo-review/`; they can contain private search-performance data.
