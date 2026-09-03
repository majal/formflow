# Apps Script adapter — abandoned, kept for reference only

**Do not use this adapter for a new deployment.** It's a real, working
example of formflow's engine being embedded in Google Apps Script's
HtmlService, but the hosting model it depends on doesn't hold up for
public-facing forms: an Apps Script Web App with `executeAs:
USER_DEPLOYING` runs every anonymous visitor's request under the
deploying Google account's own authority, which is exactly the kind of
thing Google's Advanced Protection Program and general unverified-app
policy exist to block. In practice (2026-09-03) this hit both walls in
sequence — Advanced Protection first, then a hard "This app is blocked"
even after that was worked around — with no fix available short of
Google's formal app-verification review or interactive account changes
only the account owner can make. Neither is something an agent (or
really anyone shipping a small internal tool) should have to route
around per deployment.

**Use `adapters/cloudflare-worker` (or write an equivalent thin
static-page + Worker-API adapter) for any new deployment instead.** A
real example lives in the `pss-student-download` / `website-pss-02` repos
(`worker.v2.ts` + `survey.html`) — no Google account dependency at all,
since the data store (D1 in that example) is owned outright rather than
being a personal Google Sheet a script writes to on someone's behalf.

The engine itself (`engine/formflow.js`/`formflow.css`) is unaffected by
any of this — it's plain client-side JS with no knowledge of its host.
Only this specific hosting adapter is the dead end.
