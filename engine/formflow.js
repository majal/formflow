/**
 * formflow — a small, dependency-free, one-question-at-a-time survey engine.
 *
 * Knows nothing about where answers come from or go to. The host page
 * supplies a schema and two callbacks (onAnswer, onComplete); this file
 * only renders steps, handles transitions/back/skip, and tracks in-memory
 * state for the current session. Resuming across page loads is achieved
 * by the host passing `initialValue`/`initialNote` per step from whatever
 * it already knows (e.g. existing spreadsheet data) — the engine itself
 * keeps no persistent storage.
 *
 * Choice follow-ups: a schema can attach a `followUp` to an individual
 * OPTION (richer, per-option config — text / date / a small fields form)
 * or, for backward compatibility with older schemas, to the STEP itself
 * with a `showWhen` list of option values that share one plain-text note.
 * `resolveFollowUp()` below picks whichever applies.
 */
(function (global) {
  'use strict';

  function interpolate(template, tokens) {
    if (!template) return '';
    return template.replace(/\{\{(\w+)\}\}/g, function (_, key) {
      return Object.prototype.hasOwnProperty.call(tokens || {}, key) ? tokens[key] : '';
    });
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  function findOptionMeta(step, value) {
    return (step.options || []).find(function (o) { return o.value === value; }) || null;
  }

  // A per-option `followUp` wins; otherwise fall back to the older
  // step-level `followUp: { showWhen, question }` shape (plain text only).
  function resolveFollowUp(step, opt) {
    if (!opt) return null;
    if (opt.followUp) return opt.followUp;
    if (step.followUp && (step.followUp.showWhen || []).indexOf(opt.value) !== -1) {
      var fu = {};
      Object.keys(step.followUp).forEach(function (k) { fu[k] = step.followUp[k]; });
      if (!fu.type) fu.type = 'text';
      return fu;
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Date rules: declarative (a name or array of names in the schema, not
  // a function) since schemas cross a JSON network boundary and can't
  // carry real functions. 'saturday' — PSS classes conclude on Saturdays.
  // 'first-of-month' — pioneer service always starts on the 1st.
  // 'not-future' — the date can't be after today (e.g. a class that
  // already happened).
  // ---------------------------------------------------------------------
  function checkDateRule(isoDate, rule) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    if (rule === 'saturday') return d.getDay() === 6;
    if (rule === 'first-of-month') return d.getDate() === 1;
    if (rule === 'not-future') {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      return d.getTime() <= today.getTime();
    }
    return true;
  }
  function checkDateRules(isoDate, rules) {
    if (!rules) return true;
    var list = Array.isArray(rules) ? rules : [rules];
    return list.every(function (r) { return checkDateRule(isoDate, r); });
  }
  function dateRuleMessages(rules) {
    var list = Array.isArray(rules) ? rules : (rules ? [rules] : []);
    var msgs = [];
    list.forEach(function (r) {
      if (r === 'saturday') msgs.push('PSS classes conclude on a Saturday');
      else if (r === 'first-of-month') msgs.push('pioneer service always starts on the 1st of a month');
      else if (r === 'not-future') msgs.push("this date can't be in the future");
    });
    return (msgs.length ? msgs.join(' and ') + ' — ' : '') + 'please double-check this date.';
  }

  // ---------------------------------------------------------------------
  // Flexible date entry: a typed value is parsed permissively (several
  // common formats), then re-displayed in one unambiguous canonical
  // format ("Nov 14, 2026") so the user can instantly confirm what was
  // understood — the same "type it, we'll reformat it" pattern
  // spreadsheets use, instead of forcing everyone through a native
  // picker (mobile date pickers are slow to scroll through for a birth-
  // year-scale range, and typing is faster once you know the format).
  // A native <input type="date"> stays available alongside it as a real,
  // fully-accessible "or pick a date" option — not hidden or faked.
  // ---------------------------------------------------------------------
  var MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

  function monthIndexFromName(token) {
    var t = (token || '').toLowerCase().replace(/\.$/, '');
    for (var i = 0; i < MONTH_NAMES.length; i++) {
      if (MONTH_NAMES[i] === t || MONTH_NAMES[i].slice(0, 3) === t) return i;
    }
    return -1;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function toIso(y, monthIndex, d) {
    if (y < 100) y += 2000;
    var date = new Date(y, monthIndex, d);
    // Date() silently rolls over invalid values (e.g. Feb 30 -> Mar 2) --
    // reject anything that didn't round-trip instead of accepting a
    // guess the user didn't type.
    if (date.getFullYear() !== y || date.getMonth() !== monthIndex || date.getDate() !== d) return null;
    return y + '-' + pad2(monthIndex + 1) + '-' + pad2(d);
  }
  // Accepts: ISO (2026-11-14), numeric M/D/Y or M-D-Y with 2- or 4-digit
  // year (11/14/2026, 11-14-26), numeric Y-M-D (2026-11-14 already
  // covered, or 2026/11/14), and month-name forms in either order
  // ("Nov 14, 2026", "14 November 2026") -- unambiguous whenever a month
  // NAME is present, which is most of what people actually type.
  function parseFlexibleDate(raw) {
    var s = (raw || '').trim();
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return toIso(+m[1], +m[2] - 1, +m[3]);
    m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/.exec(s);
    if (m) {
      var mi1 = monthIndexFromName(m[1]);
      if (mi1 !== -1) return toIso(+m[3], mi1, +m[2]);
    }
    m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?,?\s+(\d{2,4})$/.exec(s);
    if (m) {
      var mi2 = monthIndexFromName(m[2]);
      if (mi2 !== -1) return toIso(+m[3], mi2, +m[1]);
    }
    m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
    if (m) return toIso(+m[3], +m[1] - 1, +m[2]);
    m = /^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/.exec(s);
    if (m) return toIso(+m[1], +m[2] - 1, +m[3]);
    return null;
  }
  function formatFriendlyDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return '';
    var name = MONTH_NAMES[+m[2] - 1];
    return name.slice(0, 1).toUpperCase() + name.slice(1, 3) + ' ' + (+m[3]) + ', ' + m[1];
  }

  var dateFieldSeq = 0;
  /** A hybrid date field: type-and-reformat text input + a real native
   * <input type="date"> alongside it. opts: { initialIso, placeholder }.
   * Returns { node, getIso(), isTextUnparseable(), textInput, nativeInput }. */
  function buildDateField(opts) {
    opts = opts || {};
    var id = 'ff-date-' + (dateFieldSeq++);
    var currentIso = /^\d{4}-\d{2}-\d{2}$/.test(opts.initialIso || '') ? opts.initialIso : '';
    var textInput = el('input', {
      class: 'ff-input', type: 'text', inputmode: 'text', autocomplete: 'off',
      placeholder: opts.placeholder || 'e.g. Nov 14, 2026',
    });
    var nativeInput = el('input', { class: 'ff-input ff-date-native', type: 'date', id: id });
    if (currentIso) {
      textInput.value = formatFriendlyDate(currentIso);
      nativeInput.value = currentIso;
    }
    textInput.addEventListener('blur', function () {
      var v = textInput.value.trim();
      if (!v) { currentIso = ''; nativeInput.value = ''; return; }
      var parsed = parseFlexibleDate(v);
      if (parsed) {
        currentIso = parsed;
        textInput.value = formatFriendlyDate(parsed); // reformat so the user can confirm what was understood
        nativeInput.value = parsed;
      }
    });
    nativeInput.addEventListener('input', function () {
      currentIso = nativeInput.value || '';
      if (currentIso) textInput.value = formatFriendlyDate(currentIso);
    });
    var wrap = el('div', { class: 'ff-date-field' }, [
      el('div', { class: 'ff-date-row' }, [
        textInput,
        el('label', { class: 'ff-date-native-wrap', for: id }, [
          el('span', { class: 'ff-date-native-label', text: 'or pick:' }),
          nativeInput,
        ]),
      ]),
    ]);
    return {
      node: wrap,
      getIso: function () {
        var typed = textInput.value.trim();
        if (!typed) return '';
        var parsedNow = parseFlexibleDate(typed);
        return parsedNow || currentIso;
      },
      isTextUnparseable: function () {
        var typed = textInput.value.trim();
        return !!typed && !parseFlexibleDate(typed);
      },
      textInput: textInput,
      nativeInput: nativeInput,
    };
  }

  function isValidEmailDomain(value, domain) {
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!re.test(value)) return false;
    if (!domain) return true;
    return value.toLowerCase().slice(-(domain.length + 1)) === ('@' + domain.toLowerCase());
  }

  // ---------------------------------------------------------------------
  // Follow-up panel builder — shared by the linear engine and the
  // checklist engine. Renders whatever the follow-up needs (a plain note,
  // a validated date, or a small multi-field form) and hands back an
  // `evaluate()` you call once, when the user tries to save/continue,
  // that returns { ok, note } — `note` is always a flattened string,
  // since the backend only ever stores one notes column per answer.
  // ---------------------------------------------------------------------
  function serializeFields(fields, values) {
    var lines = [];
    (fields || []).forEach(function (f) {
      var v = (values[f.id] || '').trim();
      if (v) lines.push(f.label + ': ' + v);
    });
    return lines.join('\n');
  }
  function parseFields(fields, note) {
    var values = {};
    if (!note) return values;
    var lines = note.split('\n');
    (fields || []).forEach(function (f) {
      var prefix = f.label + ': ';
      var line = lines.find(function (l) { return l.indexOf(prefix) === 0; });
      if (line) values[f.id] = line.slice(prefix.length);
    });
    return values;
  }

  function subtext(text) {
    return el('div', { class: 'ff-subtext', style: 'margin:4px 0 0;font-size:13px;' }, [text]);
  }
  function errorLine(text) {
    return el('div', { class: 'ff-date-error', style: (text ? '' : 'display:none;') + 'color:var(--ff-status-attention-text);font-size:13px;margin-top:4px;' }, [text || '']);
  }

  function buildFollowUpPanel(followUp, initialNote) {
    var kind = followUp.type || 'text';
    var wrap = el('div', { class: 'ff-followup' });
    var evaluators = [];

    if (kind === 'date') {
      // A date follow-up always carries an optional notes field alongside
      // the date itself -- the note is never required, but there's always
      // somewhere to put context. Serialized as "<date>\nNotes: <text>" so
      // it round-trips back into the same two fields on reopen.
      var dateMatch = /^(\d{4}-\d{2}-\d{2})(?:\nNotes: ([\s\S]*))?$/.exec(initialNote || '');
      var isoInitial = dateMatch ? dateMatch[1] : '';
      var notesInitial = dateMatch ? (dateMatch[2] || '') : '';
      var rawFallback = (!dateMatch && initialNote) ? initialNote : '';

      wrap.appendChild(el('label', { class: 'ff-label', text: followUp.question || 'Date' }));
      var dateField = buildDateField({ initialIso: isoInitial });
      wrap.appendChild(dateField.node);
      var unparsedErr = errorLine("Hmm, we couldn't quite read that date — try something like \"Nov 14, 2026\" or use the picker.");
      unparsedErr.style.display = 'none';
      var ruleErr = errorLine(dateRuleMessages(followUp.dateRule));
      ruleErr.style.display = 'none';
      var warnEl = errorLine('');
      warnEl.style.display = 'none';
      function refreshDateChecks() {
        var v = dateField.getIso();
        unparsedErr.style.display = dateField.isTextUnparseable() ? 'block' : 'none';
        var ruleOk = !v || checkDateRules(v, followUp.dateRule);
        ruleErr.style.display = (v && !ruleOk) ? 'block' : 'none';
        if (followUp.warnIfOnOrBefore && v && v <= followUp.warnIfOnOrBefore) {
          warnEl.textContent = followUp.warnMessage || 'Heads up — that date might actually make them qualified. Worth double-checking before saving.';
          warnEl.style.display = 'block';
        } else {
          warnEl.style.display = 'none';
        }
      }
      dateField.textInput.addEventListener('blur', refreshDateChecks);
      dateField.nativeInput.addEventListener('input', refreshDateChecks);
      wrap.appendChild(unparsedErr);
      wrap.appendChild(ruleErr);
      wrap.appendChild(warnEl);
      if (rawFallback) wrap.appendChild(subtext('Previously noted: ' + rawFallback));
      if (followUp.helpText) wrap.appendChild(subtext(followUp.helpText));

      var notesLabel = el('label', { class: 'ff-label', text: 'Additional notes (optional)', style: 'margin-top:12px;' });
      var notesInput = el('textarea', { class: 'ff-textarea', rows: '2', placeholder: 'optional' });
      notesInput.value = notesInitial;
      wrap.appendChild(notesLabel);
      wrap.appendChild(notesInput);

      evaluators.push(function () {
        var v = dateField.getIso();
        var notesVal = notesInput.value.trim();
        if (dateField.isTextUnparseable()) { refreshDateChecks(); return { ok: false, note: notesVal }; }
        if (!v) return { ok: !followUp.required, note: notesVal };
        var ok = checkDateRules(v, followUp.dateRule);
        refreshDateChecks();
        return { ok: ok, note: v + (notesVal ? '\nNotes: ' + notesVal : '') };
      });
    } else if (kind === 'fields') {
      if (followUp.helpText) wrap.appendChild(subtext(followUp.helpText));
      var parsed = parseFields(followUp.fields, initialNote || '');
      var hasRawFallback = !!initialNote && Object.keys(parsed).length === 0;
      var fieldGetters = [];
      (followUp.fields || []).forEach(function (f) {
        var fWrap = el('div', { class: 'ff-field' });
        fWrap.appendChild(el('label', { class: 'ff-label', text: f.label + (f.required ? ' *' : '') }));
        var input = f.type === 'textarea'
          ? el('textarea', { class: 'ff-textarea', rows: '2', placeholder: f.placeholder || '' })
          : el('input', { class: 'ff-input', type: f.type === 'email' ? 'email' : 'text', placeholder: f.placeholder || '' });
        if (parsed[f.id]) input.value = parsed[f.id];
        var fErr = errorLine('');
        input.addEventListener('input', function () { fErr.style.display = 'none'; });
        fWrap.appendChild(input);
        fWrap.appendChild(fErr);
        if (f.helpText) fWrap.appendChild(subtext(f.helpText));
        wrap.appendChild(fWrap);
        fieldGetters.push(function () {
          var v = input.value.trim();
          var ok = true;
          if (f.required && !v) ok = false;
          if (ok && v && f.type === 'email' && f.emailDomain) ok = isValidEmailDomain(v, f.emailDomain);
          if (!ok) {
            fErr.textContent = f.errorText || ('Please check ' + f.label.toLowerCase() + '.');
            fErr.style.display = 'block';
          }
          return { ok: ok, label: f.label, value: v };
        });
      });
      if (hasRawFallback) wrap.appendChild(subtext('Previously noted: ' + initialNote));
      evaluators.push(function () {
        var results = fieldGetters.map(function (g) { return g(); });
        var ok = results.every(function (r) { return r.ok; });
        var note = results.filter(function (r) { return r.value; }).map(function (r) { return r.label + ': ' + r.value; }).join('\n');
        return { ok: ok, note: note };
      });
    } else {
      // Plain text note (default / legacy shape).
      wrap.appendChild(el('label', { class: 'ff-label', text: followUp.question || 'Add a note' }));
      var ta = el('textarea', { class: 'ff-textarea', rows: '3', placeholder: followUp.placeholder || '' });
      ta.value = initialNote || '';
      wrap.appendChild(ta);
      if (followUp.helpText) wrap.appendChild(subtext(followUp.helpText));
      evaluators.push(function () {
        var v = ta.value.trim();
        return { ok: !followUp.required || !!v, note: v };
      });
    }

    return {
      node: wrap,
      evaluate: function () {
        var r = evaluators[0]();
        return { ok: r.ok, note: r.note };
      },
    };
  }

  // ---------------------------------------------------------------------
  // Repeat-group ("add one or more of these") — shared list/form builder
  // used by both the linear engine and the checklist engine.
  // ---------------------------------------------------------------------
  function buildRepeatList(entries, onRemove, iconRemove) {
    var list = el('div', { class: 'ff-repeat-list' });
    entries.forEach(function (entry, i) {
      var row = el('div', { class: 'ff-repeat-entry' });
      row.appendChild(el('div', { class: 'ff-repeat-summary', text: (entry.name || '(unnamed)') }));
      row.appendChild(iconRemove
        ? el('button', { class: 'ff-btn-icon', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: function () { onRemove(i); } }, ['🗑️'])
        : el('button', { class: 'ff-btn ff-btn-ghost ff-btn-small', type: 'button', onclick: function () { onRemove(i); } }, ['Remove']));
      list.appendChild(row);
    });
    return list;
  }

  // Builds the "add an entry" form for a repeat-group step. Supports a
  // `type: 'toggle'` field (a checkbox) that other fields can depend on
  // via `showWhen: { field: <toggle id>, equals: true|false }` — used for
  // e.g. "coming from another circuit?" revealing CO contact fields only
  // when checked. The Add button's enabled/disabled state is always kept
  // in sync with validity, so it's never a mystery why tapping it does
  // nothing.
  function buildRepeatForm(step, onAdd) {
    var formFields = {};
    var fieldWraps = {};
    var formWrap = el('div', { class: 'ff-repeat-form' });

    function isVisible(f) {
      if (!f.showWhen) return true;
      var dep = formFields[f.showWhen.field];
      if (!dep) return true;
      var depVal = dep.type === 'checkbox' ? dep.checked : dep.value;
      return depVal === f.showWhen.equals;
    }
    // Date fields store a buildDateField() handle (getIso()), not a plain
    // input -- everything else reads .value directly.
    function fieldValue(f) {
      var handle = formFields[f.id];
      return f.type === 'date' ? handle.getIso() : handle.value;
    }
    function isEntryValid() {
      return (step.fields || []).every(function (f) {
        if (f.type === 'toggle') return true;
        if (!isVisible(f)) return true;
        if (f.type === 'date' && formFields[f.id].isTextUnparseable()) return false;
        var v = fieldValue(f);
        if (f.required && !v.trim()) return false;
        if (f.type === 'date' && f.dateRule && v && !checkDateRules(v, f.dateRule)) return false;
        return true;
      });
    }
    var addBtn = el('button', { class: 'ff-btn ff-btn-secondary', type: 'button' }, [step.addLabel || '+ Add']);
    function refreshAddButtonState() { addBtn.disabled = !isEntryValid(); }
    function refreshVisibility() {
      (step.fields || []).forEach(function (f) {
        if (f.showWhen) fieldWraps[f.id].style.display = isVisible(f) ? '' : 'none';
      });
      refreshAddButtonState();
    }

    (step.fields || []).forEach(function (f) {
      var fieldWrap;
      if (f.type === 'toggle') {
        var checkbox = el('input', { type: 'checkbox' });
        checkbox.addEventListener('change', refreshVisibility);
        formFields[f.id] = checkbox;
        fieldWrap = el('label', { class: 'ff-field ff-field-toggle' }, [checkbox, el('span', {}, [f.label])]);
      } else if (f.type === 'date') {
        var dateField = buildDateField({ placeholder: f.placeholder });
        formFields[f.id] = dateField;
        fieldWrap = el('div', { class: 'ff-field' }, [
          el('label', { class: 'ff-label', text: f.label + (f.required ? ' *' : '') }),
          dateField.node,
        ]);
        var unparsedErr = errorLine("Hmm, we couldn't quite read that date — try something like \"Nov 14, 2026\" or use the picker.");
        unparsedErr.style.display = 'none';
        fieldWrap.appendChild(unparsedErr);
        if (f.dateRule) {
          var dateErrEl = errorLine(dateRuleMessages(f.dateRule));
          dateErrEl.style.display = 'none';
          fieldWrap.appendChild(dateErrEl);
        }
        function refreshDateField() {
          unparsedErr.style.display = dateField.isTextUnparseable() ? 'block' : 'none';
          if (f.dateRule) {
            var v = dateField.getIso();
            dateErrEl.style.display = (v && !checkDateRules(v, f.dateRule)) ? 'block' : 'none';
          }
          refreshAddButtonState();
        }
        dateField.textInput.addEventListener('blur', refreshDateField);
        dateField.nativeInput.addEventListener('input', refreshDateField);
        if (f.helpText) fieldWrap.appendChild(subtext(f.helpText));
      } else {
        var input;
        if (f.type === 'textarea') input = el('textarea', { class: 'ff-textarea', rows: '2', placeholder: f.placeholder || '' });
        else input = el('input', { class: 'ff-input', type: (f.type === 'email' ? 'email' : (f.inputType || 'text')), placeholder: f.placeholder || '' });
        formFields[f.id] = input;
        fieldWrap = el('div', { class: 'ff-field' }, [
          el('label', { class: 'ff-label', text: f.label + (f.required ? ' *' : '') }),
          input,
        ]);
        if (f.helpText) fieldWrap.appendChild(subtext(f.helpText));
        input.addEventListener('input', refreshAddButtonState);
      }
      fieldWraps[f.id] = fieldWrap;
      formWrap.appendChild(fieldWrap);
    });

    refreshVisibility();

    addBtn.addEventListener('click', function () {
      if (!isEntryValid()) return;
      var entry = {};
      (step.fields || []).forEach(function (f) {
        if (f.type === 'toggle') { entry[f.id] = formFields[f.id].checked; return; }
        entry[f.id] = isVisible(f) ? fieldValue(f) : '';
      });
      onAdd(entry);
    });
    formWrap.appendChild(addBtn);
    return formWrap;
  }

  // ---------------------------------------------------------------------
  // Linear engine: one step at a time, Back/Continue/Skip.
  // ---------------------------------------------------------------------
  function Engine(root, schema, opts) {
    this.root = root;
    this.schema = schema;
    this.opts = opts || {};
    this.tokens = this.opts.tokens || {};
    this.index = 0;
    this.answers = {}; // stepId -> { value, note } | { entries }
    (schema.steps || []).forEach(function (step) {
      if (step.type === 'choice') {
        this.answers[step.id] = { value: step.initialValue || null, note: step.initialNote || '' };
      } else if (step.type === 'repeat-group') {
        this.answers[step.id] = { entries: (step.initialEntries || []).slice() };
      }
    }, this);
    this.render();
  }

  Engine.prototype.currentStep = function () {
    return this.schema.steps[this.index];
  };

  Engine.prototype.goTo = function (i) {
    this.index = Math.max(0, Math.min(i, this.schema.steps.length - 1));
    this.render();
  };

  Engine.prototype.next = function () {
    if (this.index >= this.schema.steps.length - 1) {
      if (this.opts.onComplete) this.opts.onComplete(this.answers);
      this.render();
      return;
    }
    this.goTo(this.index + 1);
  };

  Engine.prototype.back = function () {
    this.goTo(this.index - 1);
  };

  Engine.prototype.recordAnswer = function (stepId, value, note) {
    this.answers[stepId] = { value: value, note: note || '' };
    if (this.opts.onAnswer) this.opts.onAnswer(stepId, value, note || '');
  };

  Engine.prototype.progressFraction = function () {
    var total = this.schema.steps.length;
    return total <= 1 ? 1 : this.index / (total - 1);
  };

  Engine.prototype.render = function () {
    var root = this.root;
    root.innerHTML = '';
    root.className = 'ff-root';

    var done = this.index >= this.schema.steps.length;
    var bar = el('div', { class: 'ff-progress' }, [
      el('div', { class: 'ff-progress-fill', style: 'width:' + Math.round(this.progressFraction() * 100) + '%' }),
    ]);
    root.appendChild(bar);

    if (done) {
      root.appendChild(el('div', { class: 'ff-card ff-done' }, [
        el('h2', { text: this.schema.completeTitle || 'Done — thank you!' }),
      ]));
      return;
    }

    var step = this.currentStep();
    var card = el('div', { class: 'ff-card' });
    card.appendChild(el('h2', { class: 'ff-question' }, [interpolate(step.question, this.tokens)]));
    if (step.subtext) card.appendChild(el('p', { class: 'ff-subtext', text: interpolate(step.subtext, this.tokens) }));

    if (step.type === 'info') {
      card.appendChild(this.buildNavRow(step, true));
    } else if (step.type === 'choice') {
      card.appendChild(this.buildChoice(step));
    } else if (step.type === 'text') {
      card.appendChild(this.buildText(step));
    } else if (step.type === 'repeat-group') {
      card.appendChild(this.buildRepeatGroup(step));
    }

    root.appendChild(card);
  };

  Engine.prototype.buildNavRow = function (step, primaryOnly) {
    var self = this;
    var row = el('div', { class: 'ff-nav' });
    if (this.index > 0) {
      row.appendChild(el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.back(); } }, ['Back']));
    }
    if (!primaryOnly && step.skippable) {
      row.appendChild(el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.next(); } }, ['Skip for now']));
    }
    row.appendChild(el('button', { class: 'ff-btn ff-btn-primary', type: 'button', onclick: function () { self.next(); } }, [this.index >= this.schema.steps.length - 1 ? 'Finish' : 'Continue']));
    return row;
  };

  Engine.prototype.buildChoice = function (step) {
    var self = this;
    var current = this.answers[step.id] || {};
    var wrap = el('div', { class: 'ff-choice-wrap' });
    var optionsRow = el('div', { class: 'ff-options' });

    (step.options || []).forEach(function (opt) {
      var selected = current.value === opt.value;
      var attrs = {
        class: 'ff-option' + (selected ? ' ff-option-selected' : ''),
        type: 'button',
        onclick: function () {
          self.answers[step.id] = { value: opt.value, note: '' };
          self.render();
        },
      };
      if (opt.colorKey) attrs['data-color'] = opt.colorKey;
      var children = [];
      if (opt.emoji) children.push(el('span', { class: 'ff-option-emoji' }, [opt.emoji]));
      children.push(el('span', {}, [opt.label]));
      optionsRow.appendChild(el('button', attrs, children));
    });
    wrap.appendChild(optionsRow);

    var fu = resolveFollowUp(step, findOptionMeta(step, current.value));
    var panel = null;
    if (fu && current.value) {
      panel = buildFollowUpPanel(fu, current.note || '');
      wrap.appendChild(panel.node);
    }

    var continueBtn = el('button', {
      class: 'ff-btn ff-btn-primary',
      type: 'button',
      onclick: function () {
        if (!current.value) return;
        var note = '';
        if (panel) {
          var result = panel.evaluate();
          if (!result.ok) return;
          note = result.note;
        }
        self.recordAnswer(step.id, current.value, note);
        self.next();
      },
    }, [this.index >= this.schema.steps.length - 1 ? 'Finish' : 'Continue']);
    if (!current.value) continueBtn.disabled = true;

    wrap.appendChild(el('div', { class: 'ff-nav' }, [
      this.index > 0 ? el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.back(); } }, ['Back']) : null,
      step.skippable ? el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.next(); } }, ['Skip for now']) : null,
      continueBtn,
    ]));

    return wrap;
  };

  Engine.prototype.buildText = function (step) {
    var self = this;
    var current = this.answers[step.id] || {};
    var input = el('textarea', {
      class: 'ff-textarea',
      rows: '4',
      placeholder: step.placeholder || '',
    });
    input.value = current.value || '';
    var wrap = el('div', { class: 'ff-text-wrap' }, [input]);
    wrap.appendChild(el('div', { class: 'ff-nav' }, [
      this.index > 0 ? el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.back(); } }) : null,
      step.skippable ? el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.next(); } }, ['Skip for now']) : null,
      el('button', {
        class: 'ff-btn ff-btn-primary',
        type: 'button',
        onclick: function () {
          if (step.required && !input.value.trim()) return;
          self.recordAnswer(step.id, input.value, '');
          self.next();
        },
      }, [this.index >= this.schema.steps.length - 1 ? 'Finish' : 'Continue']),
    ]));
    return wrap;
  };

  Engine.prototype.buildRepeatGroup = function (step) {
    var self = this;
    var state = this.answers[step.id] || { entries: [] };
    var wrap = el('div', { class: 'ff-repeat-wrap' });
    wrap.appendChild(buildRepeatList(state.entries, function (i) { state.entries.splice(i, 1); self.render(); }, false));
    wrap.appendChild(buildRepeatForm(step, function (entry) {
      state.entries.push(entry);
      self.answers[step.id] = state;
      if (self.opts.onAnswer) self.opts.onAnswer(step.id, entry, '');
      self.render();
    }));
    wrap.appendChild(this.buildNavRow(step, false));
    return wrap;
  };

  // ---------------------------------------------------------------------
  // Checklist / overview mode: an alternative to the pure linear flow for
  // schemas with many independent "choice" items (e.g. one per person in
  // a list) where jumping directly to any item, seeing everyone's status
  // at a glance, and a completion count matter more than a single guided
  // path. Reuses the same schema shape as mount() -- a schema written for
  // one mode works in the other. Non-"choice" steps (info, repeat-group)
  // render as fixed cards above/below the list rather than being part of
  // the jump target set.
  // ---------------------------------------------------------------------
  function ChecklistEngine(root, schema, opts) {
    this.root = root;
    this.schema = schema;
    this.opts = opts || {};
    this.tokens = this.opts.tokens || {};
    this.answers = {};
    this.entries = {}; // repeat-group state, keyed by step id
    this.detailStepId = null;

    this.itemSteps = (schema.steps || []).filter(function (s) { return s.type === 'choice'; });
    this.leadingInfo = (schema.steps || []).find(function (s) { return s.type === 'info'; });
    this.repeatSteps = (schema.steps || []).filter(function (s) { return s.type === 'repeat-group'; });

    this.itemSteps.forEach(function (step) {
      this.answers[step.id] = { value: step.initialValue || null, note: step.initialNote || '' };
    }, this);
    this.repeatSteps.forEach(function (step) {
      this.entries[step.id] = (step.initialEntries || []).slice();
    }, this);

    this.render();
  }

  ChecklistEngine.prototype.answeredCount = function () {
    return this.itemSteps.filter(function (s) { return !!this.answers[s.id].value; }, this).length;
  };

  ChecklistEngine.prototype.openDetail = function (stepId) {
    this.detailStepId = stepId;
    this.render();
  };

  ChecklistEngine.prototype.closeDetail = function () {
    this.detailStepId = null;
    this.render();
  };

  ChecklistEngine.prototype.render = function () {
    this.root.innerHTML = '';
    this.root.className = 'ff-root';
    if (this.detailStepId) {
      this.root.appendChild(this.renderDetail(this.detailStepId));
    } else {
      this.root.appendChild(this.renderList());
    }
  };

  ChecklistEngine.prototype.renderList = function () {
    var self = this;
    var wrap = el('div', {});

    var total = this.itemSteps.length;
    var done = this.answeredCount();
    var fraction = total ? done / total : 0;

    var header = el('div', { class: 'ff-checklist-header' });
    if (this.leadingInfo) {
      header.appendChild(el('h1', { class: 'ff-checklist-title', text: interpolate(this.leadingInfo.question, this.tokens) }));
      if (this.leadingInfo.subtext) header.appendChild(el('p', { class: 'ff-checklist-subtext', text: interpolate(this.leadingInfo.subtext, this.tokens) }));
    }
    wrap.appendChild(header);

    wrap.appendChild(el('div', { class: 'ff-progress' }, [
      el('div', { class: 'ff-progress-fill', style: 'width:' + Math.round(fraction * 100) + '%' }),
    ]));
    wrap.appendChild(el('div', { class: 'ff-progress-label', text: done + ' of ' + total + ' answered' }));

    var rows = el('div', { class: 'ff-checklist-rows' });
    this.itemSteps.forEach(function (step) {
      var current = self.answers[step.id];
      var optMeta = current.value ? findOptionMeta(step, current.value) : null;
      var rowAttrs = { class: 'ff-checklist-row', type: 'button', onclick: function () { self.openDetail(step.id); } };
      if (optMeta && optMeta.colorKey) rowAttrs['data-color'] = optMeta.colorKey;
      var row = el('button', rowAttrs, [
        el('span', { class: 'ff-checklist-status-dot' }),
        el('span', { class: 'ff-checklist-name' }, [interpolate(step.question, Object.assign({}, self.tokens, step.tokens || {}))]),
        optMeta ? el('span', { class: 'ff-checklist-emoji' }, [optMeta.emoji || '']) : null,
        el('span', { class: 'ff-checklist-answer', text: optMeta ? optMeta.label : 'Tap to answer' }),
        el('span', { class: 'ff-checklist-chevron', text: '›' }),
      ]);
      rows.appendChild(row);
    });
    wrap.appendChild(rows);

    this.repeatSteps.forEach(function (step) {
      wrap.appendChild(self.renderRepeatCard(step));
    });

    return wrap;
  };

  ChecklistEngine.prototype.renderDetail = function (stepId) {
    var self = this;
    var step = this.itemSteps.find(function (s) { return s.id === stepId; });
    var current = this.answers[stepId];
    var card = el('div', { class: 'ff-card' });

    card.appendChild(el('button', {
      class: 'ff-checklist-detail-back', type: 'button', onclick: function () { self.closeDetail(); },
    }, ['‹ Back to list']));
    card.appendChild(el('h2', { class: 'ff-question' }, [interpolate(step.question, Object.assign({}, this.tokens, step.tokens || {}))]));
    if (step.subtext) card.appendChild(el('p', { class: 'ff-subtext', text: interpolate(step.subtext, this.tokens) }));

    var optionsRow = el('div', { class: 'ff-options' });
    (step.options || []).forEach(function (opt) {
      var selected = current.value === opt.value;
      var attrs = {
        class: 'ff-option' + (selected ? ' ff-option-selected' : ''),
        type: 'button',
        onclick: function () {
          var fuForOpt = resolveFollowUp(step, opt);
          if (!fuForOpt) {
            self.answers[stepId] = { value: opt.value, note: '' };
            self.recordAndMaybeReturn(step, opt.value, '');
          } else {
            self.answers[stepId] = { value: opt.value, note: (self.answers[stepId] || {}).note || '' };
            self.render();
          }
        },
      };
      if (opt.colorKey) attrs['data-color'] = opt.colorKey;
      var children = [];
      if (opt.emoji) children.push(el('span', { class: 'ff-option-emoji' }, [opt.emoji]));
      children.push(el('span', {}, [opt.label]));
      optionsRow.appendChild(el('button', attrs, children));
    });
    card.appendChild(optionsRow);

    var fu = resolveFollowUp(step, findOptionMeta(step, current.value));
    if (fu && current.value) {
      var panel = buildFollowUpPanel(fu, current.note || '');
      card.appendChild(panel.node);
      var saveBtn = el('button', {
        class: 'ff-btn ff-btn-primary', type: 'button',
        onclick: function () {
          var result = panel.evaluate();
          if (!result.ok) return;
          self.answers[stepId] = { value: current.value, note: result.note };
          self.recordAndMaybeReturn(step, current.value, result.note, { immediate: true });
        },
      }, ['Save & back to list']);
      var cancelBtn = el('button', {
        class: 'ff-btn ff-btn-ghost', type: 'button',
        onclick: function () { self.closeDetail(); },
      }, ['Cancel']);
      card.appendChild(el('div', { class: 'ff-nav' }, [cancelBtn, saveBtn]));
    }

    return card;
  };

  ChecklistEngine.prototype.recordAndMaybeReturn = function (step, value, note, opts) {
    if (this.opts.onAnswer) this.opts.onAnswer(step.id, value, note);
    if (opts && opts.immediate) {
      this.closeDetail();
      return;
    }
    this.render();
    var self = this;
    setTimeout(function () { self.closeDetail(); }, 220);
  };

  ChecklistEngine.prototype.renderRepeatCard = function (step) {
    var self = this;
    var entries = this.entries[step.id];
    var card = el('div', { class: 'ff-card' });
    card.appendChild(el('h2', { class: 'ff-question' }, [interpolate(step.question, this.tokens)]));
    if (step.subtext) card.appendChild(el('p', { class: 'ff-subtext', text: interpolate(step.subtext, this.tokens) }));
    card.appendChild(buildRepeatList(entries, function (i) { entries.splice(i, 1); self.render(); }, true));
    card.appendChild(buildRepeatForm(step, function (entry) {
      entries.push(entry);
      if (self.opts.onAnswer) self.opts.onAnswer(step.id, entry, '');
      self.render();
    }));
    return card;
  };

  global.Formflow = {
    mount: function (root, schema, opts) {
      return new Engine(root, schema, opts);
    },
    mountChecklist: function (root, schema, opts) {
      return new ChecklistEngine(root, schema, opts);
    },
  };
})(typeof window !== 'undefined' ? window : this);
