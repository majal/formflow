# Cloudflare Worker adapter — template

The recommended way to host any formflow survey publicly. No Google
account dependency (see `adapters/apps-script/README.md` for why that
route is a dead end) — a static page (Cloudflare Pages, or any static
host) serves the engine, and a small Worker owns the actual data via D1
(or KV, or any other store a Worker can reach).

This directory is a **template**, not a plug-and-play library: copy
`worker.ts` and `page.html` into your own project, then fill in your own
schema-building logic (`buildSchema()`) and D1 table shape — the shape
will differ per use case (a PSS Bethel List row looks nothing like, say,
an RSVP form or a feedback survey). A real, filled-in example lives in
the `pss-student-download` / `website-pss-02` repos
(`src/worker.v2.ts` + `survey.html`) if you want to see the pattern
applied to something real.

## Pattern

- `GET /survey/:token` → `{ title, steps: [...] }` (a formflow schema,
  built server-side from whatever's in your store for that token)
- `POST /survey/:token/answer` → persist one answer
- `POST /survey/:token/addition` → persist one repeat-group entry (if
  your schema has one)

Tokens should be random and opaque (`crypto.randomUUID()` or similar),
never derived from anything guessable (a name, a sequential id) — a
predictable token lets anyone reconstruct every other respondent's link
from seeing just one.

See `worker.ts` and `page.html` for the actual code shape.
