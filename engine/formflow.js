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

  function Engine(root, schema, opts) {
    this.root = root;
    this.schema = schema;
    this.opts = opts || {};
    this.tokens = this.opts.tokens || {};
    this.index = 0;
    this.answers = {}; // stepId -> { value, note, entries }
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
    var self = this;
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
          self.answers[step.id] = { value: opt.value, note: (self.answers[step.id] || {}).note || '' };
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

    var showFollowUp = step.followUp && current.value && (step.followUp.showWhen || []).indexOf(current.value) !== -1;
    if (showFollowUp) {
      var noteBox = el('textarea', {
        class: 'ff-textarea',
        placeholder: step.followUp.question || 'Add a note',
        rows: '3',
        oninput: function (e) {
          self.answers[step.id] = { value: current.value, note: e.target.value };
        },
      });
      noteBox.value = current.note || '';
      wrap.appendChild(el('div', { class: 'ff-followup' }, [
        el('label', { class: 'ff-label', text: step.followUp.question || 'Add a note' }),
        noteBox,
      ]));
    }

    var continueBtn = el('button', {
      class: 'ff-btn ff-btn-primary',
      type: 'button',
      onclick: function () {
        if (!current.value) return;
        self.recordAnswer(step.id, current.value, (self.answers[step.id] || {}).note || '');
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
      this.index > 0 ? el('button', { class: 'ff-btn ff-btn-ghost', type: 'button', onclick: function () { self.back(); } }, ['Back']) : null,
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
    var list = el('div', { class: 'ff-repeat-list' });

    state.entries.forEach(function (entry, i) {
      var row = el('div', { class: 'ff-repeat-entry' });
      row.appendChild(el('div', { class: 'ff-repeat-summary', text: (entry.name || '(unnamed)') }));
      row.appendChild(el('button', {
        class: 'ff-btn ff-btn-ghost ff-btn-small', type: 'button',
        onclick: function () { state.entries.splice(i, 1); self.render(); },
      }, ['Remove']));
      list.appendChild(row);
    });
    wrap.appendChild(list);

    var formFields = {};
    var formWrap = el('div', { class: 'ff-repeat-form' });
    (step.fields || []).forEach(function (f) {
      var input = f.type === 'textarea' ? el('textarea', { class: 'ff-textarea', rows: '2', placeholder: f.label }) : el('input', { class: 'ff-input', type: 'text', placeholder: f.label });
      formFields[f.id] = input;
      formWrap.appendChild(el('div', { class: 'ff-field' }, [
        el('label', { class: 'ff-label', text: f.label }),
        input,
      ]));
    });
    formWrap.appendChild(el('button', {
      class: 'ff-btn ff-btn-secondary', type: 'button',
      onclick: function () {
        var entry = {};
        var missingRequired = false;
        (step.fields || []).forEach(function (f) {
          entry[f.id] = formFields[f.id].value;
          if (f.required && !entry[f.id].trim()) missingRequired = true;
        });
        if (missingRequired) return;
        state.entries.push(entry);
        self.answers[step.id] = state;
        if (self.opts.onAnswer) self.opts.onAnswer(step.id, entry, '');
        self.render();
      },
    }, [step.addLabel || '+ Add']));
    wrap.appendChild(formWrap);

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

  function findOptionMeta(step, value) {
    return (step.options || []).find(function (o) { return o.value === value; }) || null;
  }

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
    var wrap = document.createDocumentFragment ? el('div', {}) : el('div', {});

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
          var note = (self.answers[stepId] || {}).note || '';
          self.answers[stepId] = { value: opt.value, note: note };
          self.recordAndMaybeReturn(step, opt.value, note);
        },
      };
      if (opt.colorKey) attrs['data-color'] = opt.colorKey;
      var children = [];
      if (opt.emoji) children.push(el('span', { class: 'ff-option-emoji' }, [opt.emoji]));
      children.push(el('span', {}, [opt.label]));
      optionsRow.appendChild(el('button', attrs, children));
    });
    card.appendChild(optionsRow);

    var showFollowUp = step.followUp && current.value && (step.followUp.showWhen || []).indexOf(current.value) !== -1;
    if (showFollowUp) {
      var noteBox = el('textarea', {
        class: 'ff-textarea', placeholder: step.followUp.question || 'Add a note', rows: '3',
        oninput: function (e) { self.answers[stepId] = { value: current.value, note: e.target.value }; },
      });
      noteBox.value = current.note || '';
      card.appendChild(el('div', { class: 'ff-followup' }, [
        el('label', { class: 'ff-label', text: step.followUp.question || 'Add a note' }),
        noteBox,
      ]));
      card.appendChild(el('div', { class: 'ff-nav' }, [
        el('button', {
          class: 'ff-btn ff-btn-primary', type: 'button',
          onclick: function () { self.recordAndMaybeReturn(step, current.value, self.answers[stepId].note || ''); },
        }, ['Save & back to list']),
      ]));
    }

    return card;
  };

  ChecklistEngine.prototype.recordAndMaybeReturn = function (step, value, note) {
    if (this.opts.onAnswer) this.opts.onAnswer(step.id, value, note);
    // If this option has a required/expected follow-up note and it's still
    // empty, stay on the detail view so the note box is visible instead of
    // bouncing back to the list -- render() will show it since answers[]
    // was already updated by the caller.
    this.render();
    var self = this;
    var showsFollowUp = step.followUp && (step.followUp.showWhen || []).indexOf(value) !== -1;
    if (!showsFollowUp) {
      setTimeout(function () { self.closeDetail(); }, 220);
    }
  };

  ChecklistEngine.prototype.renderRepeatCard = function (step) {
    var self = this;
    var entries = this.entries[step.id];
    var card = el('div', { class: 'ff-card' });
    card.appendChild(el('h2', { class: 'ff-question' }, [interpolate(step.question, this.tokens)]));
    if (step.subtext) card.appendChild(el('p', { class: 'ff-subtext', text: interpolate(step.subtext, this.tokens) }));

    var list = el('div', { class: 'ff-repeat-list' });
    entries.forEach(function (entry, i) {
      var row = el('div', { class: 'ff-repeat-entry' });
      row.appendChild(el('div', { class: 'ff-repeat-summary', text: (entry.name || '(unnamed)') }));
      row.appendChild(el('button', {
        class: 'ff-btn-icon', type: 'button', title: 'Remove', 'aria-label': 'Remove',
        onclick: function () { entries.splice(i, 1); self.render(); },
      }, ['🗑️']));
      list.appendChild(row);
    });
    card.appendChild(list);

    var formFields = {};
    var formWrap = el('div', { class: 'ff-repeat-form' });
    (step.fields || []).forEach(function (f) {
      var input;
      if (f.type === 'textarea') {
        input = el('textarea', { class: 'ff-textarea', rows: '2', placeholder: f.label });
      } else if (f.type === 'date') {
        input = el('input', { class: 'ff-input', type: 'date' });
      } else {
        input = el('input', { class: 'ff-input', type: f.inputType || 'text', placeholder: f.label });
      }
      formFields[f.id] = input;
      var fieldWrap = el('div', { class: 'ff-field' }, [
        el('label', { class: 'ff-label', text: f.label }),
        input,
      ]);
      if (f.type === 'date' && f.dateRule) {
        var errEl = el('div', { class: 'ff-date-error', style: 'display:none;color:var(--ff-status-attention-text);font-size:13px;margin-top:4px;' }, [dateRuleMessage(f.dateRule)]);
        fieldWrap.appendChild(errEl);
        input.addEventListener('input', function () {
          errEl.style.display = (input.value && !checkDateRule(input.value, f.dateRule)) ? 'block' : 'none';
        });
      }
      if (f.helpText) {
        fieldWrap.appendChild(el('div', { class: 'ff-subtext', style: 'margin:4px 0 0;font-size:13px;' }, [f.helpText]));
      }
      formWrap.appendChild(fieldWrap);
    });
    formWrap.appendChild(el('button', {
      class: 'ff-btn ff-btn-secondary', type: 'button',
      onclick: function () {
        var entry = {};
        var missingRequired = false;
        (step.fields || []).forEach(function (f) {
          entry[f.id] = formFields[f.id].value;
          if (f.required && !entry[f.id].trim()) missingRequired = true;
          if (f.type === 'date' && f.dateRule && entry[f.id] && !checkDateRule(entry[f.id], f.dateRule)) missingRequired = true;
        });
        if (missingRequired) return;
        entries.push(entry);
        if (self.opts.onAnswer) self.opts.onAnswer(step.id, entry, '');
        self.render();
      },
    }, [step.addLabel || '+ Add']));
    card.appendChild(formWrap);
    return card;
  };

  // Built-in date rules: 'saturday' (PSS classes conclude on Saturdays,
  // so a "last PSS date" should land on one) and 'first-of-month' (a
  // pioneer's service always starts on the 1st). Declarative (a rule
  // name in the schema, not a function) since schemas cross a JSON
  // network boundary and can't carry real functions.
  function checkDateRule(isoDate, rule) {
    var d = new Date(isoDate + 'T00:00:00');
    if (isNaN(d.getTime())) return false;
    if (rule === 'saturday') return d.getDay() === 6;
    if (rule === 'first-of-month') return d.getDate() === 1;
    return true;
  }
  function dateRuleMessage(rule) {
    if (rule === 'saturday') return 'PSS classes conclude on a Saturday — double-check this date.';
    if (rule === 'first-of-month') return 'Pioneer service always starts on the 1st of a month — double-check this date.';
    return 'Please double-check this date.';
  }

  global.Formflow = {
    mount: function (root, schema, opts) {
      return new Engine(root, schema, opts);
    },
    mountChecklist: function (root, schema, opts) {
      return new ChecklistEngine(root, schema, opts);
    },
  };
})(typeof window !== 'undefined' ? window : this);
