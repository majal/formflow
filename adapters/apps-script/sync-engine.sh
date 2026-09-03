#!/usr/bin/env bash
# Regenerates formflow_js.html / formflow_css.html from the canonical
# engine/ source. Apps Script's HtmlService can only include .html files
# (no separate .js/.css MIME types), so these are the engine wrapped in
# <script>/<style> tags. Run this after any edit to engine/formflow.{js,css}
# before pushing to Apps Script (clasp push / theo-google script-update).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
{ echo "<script>"; cat "$ROOT/engine/formflow.js"; echo "</script>"; } > "$DIR/formflow_js.html"
{ echo "<style>"; cat "$ROOT/engine/formflow.css"; echo "</style>"; } > "$DIR/formflow_css.html"
echo "synced formflow_js.html / formflow_css.html from engine/"
