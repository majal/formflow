# formflow

A small, reusable, one-question-at-a-time survey engine — the parts of
Typeform's UX (single question per screen, smooth progress, conditional
follow-ups) without the subscription, built to be embedded anywhere that
can serve static HTML/CSS/JS: a Google Apps Script Web App, a Cloudflare
Pages site, a plain static file. No build step, no framework, no
dependencies.

Not tied to any one project — the engine (`engine/`) knows nothing about
Google Sheets, PSS, or any other specific use. A *host* page defines a
schema (steps, question types, conditional follow-ups) and wires up two
callbacks: `onAnswer` (called immediately after every answer, so the host
can persist it right away) and `onComplete`. Everything else — rendering,
transitions, progress, back/skip, resuming from pre-filled answers — is
the engine's job.

## Layout

- `engine/formflow.js` — the engine. One file, no dependencies.
- `engine/formflow.css` — default styling (big tap targets, mobile-first).
- `examples/demo.html` — a standalone runnable example (open directly in a
  browser, no server needed) — the fastest way to see the engine and try a
  new schema shape before wiring it into a real host.
- `adapters/apps-script/` — a Google Apps Script Web App host: serves the
  engine + a schema built from live Spreadsheet data, and persists answers
  straight back to the same Spreadsheet as they're given (no separate
  database — the sheet itself is both the source of truth and the
  resumable-progress store: an already-answered row shows its existing
  answer pre-selected on reload).

## Schema shape

```js
{
  title: "Form title",
  intro: "Optional intro text/markdown shown before the first step.",
  steps: [
    {
      id: "unique-step-id",
      type: "choice",              // "choice" | "text" | "info" | "repeat-group"
      question: "The question text. Supports {{token}} interpolation.",
      subtext: "Optional smaller text under the question.",
      options: [                   // required for type "choice"
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
      followUp: {                  // optional, "choice" steps only
        showWhen: ["no"],          // option values that reveal this follow-up
        type: "text",
        question: "Add a note (optional)",
        required: false,
      },
      initialValue: "yes",         // pre-fill (resumable) — from your own data
      initialNote: "",
      skippable: true,             // shows a "Skip for now" control
    },
    {
      id: "add-more",
      type: "repeat-group",        // "add another entry" flows (e.g. Add to Class)
      question: "Anyone we missed?",
      addLabel: "+ Add a pioneer",
      fields: [
        { id: "name", label: "Name", type: "text", required: true },
        { id: "contact", label: "Contact info", type: "text" },
        { id: "notes", label: "Notes", type: "textarea" },
      ],
    },
    {
      id: "summary",
      type: "info",                // a plain read-only screen (e.g. a summary)
      question: "Thank you!",
      subtext: "Your answers have been recorded.",
    },
  ],
}
```

## Usage

```html
<link rel="stylesheet" href="formflow.css">
<div id="app"></div>
<script src="formflow.js"></script>
<script>
  Formflow.mount(document.getElementById('app'), schema, {
    onAnswer: (stepId, value, note) => { /* persist immediately */ },
    onComplete: (allAnswers) => { /* e.g. show a summary */ },
  });
</script>
```

See `examples/demo.html` for a complete working page.
