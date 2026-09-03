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
      var btn = el('button', {
        class: 'ff-option' + (selected ? ' ff-option-selected' : ''),
        type: 'button',
        onclick: function () {
          self.answers[step.id] = { value: opt.value, note: (self.answers[step.id] || {}).note || '' };
          self.render();
        },
      }, [opt.label]);
      optionsRow.appendChild(btn);
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

  global.Formflow = {
    mount: function (root, schema, opts) {
      return new Engine(root, schema, opts);
    },
  };
})(typeof window !== 'undefined' ? window : this);
