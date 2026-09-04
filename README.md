# formflow

A small, reusable, one-question-at-a-time survey engine — the parts of
Typeform's UX (single question per screen, smooth progress, conditional
follow-ups, keyboard shortcuts) without the subscription, built to be
embedded anywhere that can serve static HTML/CSS/JS: a Google Apps Script
Web App, a Cloudflare Pages site, a plain static file. No build step, no
framework, no dependencies. MIT licensed — see `LICENSE`.

In production use for a real-world registration/survey system (checklist
mode, structured conditional follow-ups, repeat-entry forms) since 2026.

Not tied to any one project — the engine (`engine/`) knows nothing about
Google Sheets, PSS, or any other specific use. A *host* page defines a
schema (steps, question types, conditional follow-ups) and wires up two
callbacks: `onAnswer` (called immediately after every answer, so the host
can persist it right away) and `onComplete`. Everything else — rendering,
transitions, progress, back/skip, resuming from pre-filled answers,
validation — is the engine's job.

## Layout

- `engine/formflow.js` — the engine. One file, no dependencies.
- `engine/formflow.css` — default styling (big tap targets, mobile-first,
  light/dark/auto theming via CSS custom properties).
- `examples/demo.html` — linear mode, standalone runnable (open directly
  in a browser, no server needed).
- `examples/checklist-demo.html` — checklist mode: jump to any item,
  color-coded status, progress count — better fit than linear mode for a
  schema with many independent choice items (e.g. one per person in a
  list) rather than a single guided sequence.
- `adapters/apps-script/` — a Google Apps Script Web App host (kept as a
  documented reference; see its own README for why it's not the
  recommended path for a new deployment — Apps Script Web Apps run under
  the deploying user's own Google account authority, which trips
  Advanced Protection / unverified-app blocks for real visitors).
- `adapters/cloudflare-worker/` — a generic Cloudflare Worker + Pages
  host template: static page served by Pages, schema + persistence via
  one Worker route. The recommended path for a new deployment.

## Two rendering modes

- **`Formflow.mount`** — linear, one step at a time with Back/Continue/
  Skip. Typeform's original shape.
- **`Formflow.mountChecklist`** — an overview list of every `"choice"`
  step at once (status dot, emoji, current answer), tap any row to open
  its detail view and answer/change it, jump straight back to the list.
  Non-`"choice"` steps (`"info"`, `"repeat-group"`) render as fixed cards
  above/below the list. Both modes read the exact same schema — pick
  whichever fits the shape of your form, or let the host switch between
  them.

## Schema shape

```js
{
  title: "Form title",
  steps: [
    {
      id: "unique-step-id",
      type: "choice",              // "choice" | "text" | "info" | "repeat-group"
      question: "The question text. Supports {{token}} interpolation.",
      subtext: "Optional smaller text under the question.",
      options: [                   // required for type "choice"
        {
          value: "yes", label: "Yes", emoji: "✅",
          colorKey: "positive",     // "positive"|"info"|"neutral"|"attention" — see below
          followUp: {                // optional, PER OPTION (richer than step-level)
            type: "text",            // "text" | "date" | "fields"
            question: "Add a note",
            required: false,
          },
        },
        { value: "no", label: "No", colorKey: "attention" },
      ],
      initialValue: "yes",         // pre-fill (resumable) — from your own data
      initialNote: "",
      skippable: true,             // shows a "Skip for now" control
    },
    {
      id: "add-more",
      type: "repeat-group",        // "add another entry" flows
      question: "Anyone we missed?",
      addLabel: "+ Add a pioneer",
      fields: [
        { id: "name", label: "Name", required: true },
        { id: "startDate", label: "Start date", type: "date", dateRule: "first-of-month" },
        {
          id: "fromElsewhere", label: "Coming from elsewhere?", type: "toggle",
        },
        {
          id: "detail", label: "Where from?", required: true,
          showWhen: { field: "fromElsewhere", equals: true },  // conditional on a toggle field
        },
        { id: "notes", label: "Notes", type: "textarea", placeholder: "optional" },
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

### Color-coded choices

Give an option a `colorKey` (`positive` / `info` / `neutral` /
`attention`) to group semantically related answers by color — e.g. "still
coming, just differently" options in one color family, "not coming"
options in another. Unselected options carry a soft "whisper" tint of
their color (so grouping reads at a glance before tapping anything);
selecting steps up to the full color. Swap the underlying hex values via
CSS custom properties (`--ff-status-positive-bg`, etc.) to match your own
palette — the engine has no opinion on what the colors mean.

### Per-option follow-ups

An option's `followUp` can be:
- `type: "text"` — a plain note (optionally `required`).
- `type: "date"` — a hybrid date field: type-and-reformat text input
  ("Nov 14, 2026") with a calendar icon that opens a real native date
  picker, consistent on desktop and mobile. Validated against a
  `dateRule` (`"saturday"`, `"first-of-month"`, `"not-future"`, or an
  array of those — declarative, not a function, since schemas cross a
  JSON boundary). Shows exactly one error at a time (an unparseable
  typed value, or the first rule that actually fails — never a combined
  message listing every rule the field could enforce).
- `type: "fields"` — a small sub-form (e.g. "which circuit, and their
  CO's contact info") serialized into one flattened, human-readable note
  string. Supports `type: "email"` + `emailDomain` for a validated
  address field.

### Repeat-group fields

Beyond plain text/textarea/date, a field can be `type: "toggle"` (a
checkbox) with other fields conditionally shown via
`showWhen: { field: <toggle id>, equals: true }`. The Add button's
enabled/disabled state always tracks current validity.

### Keyboard shortcuts (desktop)

Press **1–9** to pick that numbered option in the currently-visible
choice step — no reaching for a mouse. Shown as a small badge next to
each option on pointer+keyboard devices only (hidden on touchscreens,
where there's no keyboard to press). Tab/Enter/Space already work via
native `<button>` semantics. Ignored while typing in any text field.

## Usage

```html
<link rel="stylesheet" href="formflow.css">
<div id="app"></div>
<script src="formflow.js"></script>
<script>
  Formflow.mountChecklist(document.getElementById('app'), schema, {
    onAnswer: (stepId, value, note) => { /* persist immediately */ },
    onComplete: (allAnswers) => { /* e.g. show a summary */ },
  });
</script>
```

See `examples/demo.html` (linear) and `examples/checklist-demo.html`
(checklist) for complete working pages.

## License

MIT — see `LICENSE`. Use it, fork it, ship it.
