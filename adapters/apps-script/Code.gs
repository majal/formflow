/**
 * formflow adapter for the PSS Bethel List / Add to Class survey.
 *
 * Reads/writes DIRECTLY against the live "Final Survey" spreadsheet's
 * "Bethel List" and "Add to Class" tabs -- the sheet is both the source of
 * truth and the resumable-progress store. No separate database. Every
 * write is scoped to exactly one row (never a bulk range write), guarded
 * by LockService, and re-validates the row's Name+Congregation still
 * matches what the client last saw before writing -- if a human edited
 * that row concurrently, the write fails loudly instead of silently
 * clobbering it.
 *
 * SPREADSHEET_ID below points at a TEST COPY by default. Switch it to the
 * real live sheet's ID only after verifying end-to-end against the copy.
 */

// TEST COPY -- verify end-to-end here before switching to the real live sheet.
// Live sheet ID (do not point here until verified): 1_1-aHtEZ7F1mTArLJLNoR5-7t6okQoKCrtCwvFrNS0M
var SPREADSHEET_ID = '1XNMnCnRrkj4ZhRxJZGGatPVdMu2ZYBt7aydQgQ4jdc0';

var BETHEL_LIST_TAB = 'Bethel List';
var ADD_TO_CLASS_TAB = 'Add to Class';

// Exact strings, must match the live sheet's Lists!A1:A84 dropdown values
// character-for-character (including the "WIll" typo in one option -- it's
// the real validated dropdown value, not a mistake to silently fix here).
var STATUS_OPTIONS = [
  { value: 'Will attend Nov 2026', label: 'Will attend (Nov 2026)', notePrompt: null },
  { value: 'Attend another circuit', label: 'Attending in another circuit', notePrompt: 'Which circuit? (optional)' },
  { value: 'Attend another branch', label: 'Attending in another branch', notePrompt: 'Which branch? (optional)' },
  { value: 'Other reasons for not attending:', label: 'Not attending — other reason', notePrompt: 'Please explain', required: true },
  { value: 'WIll attend 2027', label: 'Will attend the March/May 2027 class instead', notePrompt: null },
  { value: 'Not qualified, last PSS was:', label: 'Not qualified — already had PSS', notePrompt: 'What year was their last PSS?', required: true },
  { value: 'Not qualified, other reasons:', label: 'Not qualified — other reason', notePrompt: 'Please explain', required: true },
  { value: 'Moved out to other congregation', label: 'Moved to another congregation', notePrompt: 'Which congregation? (optional)' },
];

function doGet(e) {
  var congToken = (e && e.parameter && e.parameter.cong) || '';
  var template = HtmlService.createTemplateFromFile('index');
  template.congToken = congToken;
  return template.evaluate()
    .setTitle('PSS Bethel List — Verify Your Pioneers')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function slugify(text) {
  return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function openSheet_(tabName) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) throw new Error('Tab not found: ' + tabName);
  return sheet;
}

/**
 * These tabs have a title row above the real header (row 1 is a single
 * "Bethel List"-style label, row 2 is "Congregation | Name | Status /
 * Response | Notes"). Find the header by content, not by assuming row 1 --
 * a hardcoded row index would silently misread every column if a row is
 * ever inserted/removed above it.
 */
function findHeaderRow_(sheet) {
  var maxScan = Math.min(sheet.getLastRow(), 5);
  var values = sheet.getRange(1, 1, maxScan, sheet.getLastColumn()).getValues();
  for (var i = 0; i < values.length; i++) {
    if (values[i].indexOf('Congregation') >= 0 || values[i].indexOf('Name') >= 0) {
      return { rowNumber: i + 1, header: values[i] };
    }
  }
  throw new Error('Could not find a header row (looked for "Congregation"/"Name") in the first ' + maxScan + ' rows of ' + sheet.getName());
}

/**
 * Build the schema for one congregation: one choice-step per matching
 * Bethel List row (carrying the real sheet row number so writes go back
 * to exactly the right place), plus a repeat-group step for additions.
 * Called fresh on every page load, so it's always resumable: a row
 * already answered comes back with initialValue/initialNote already set.
 */
function getCongregationForm(congToken) {
  var bethelSheet = openSheet_(BETHEL_LIST_TAB);
  var headerInfo = findHeaderRow_(bethelSheet);
  var header = headerInfo.header;
  var congIdx = header.indexOf('Congregation');
  var nameIdx = header.indexOf('Name');
  var statusIdx = header.indexOf('Status / Response');
  var notesIdx = header.indexOf('Notes');
  if (congIdx < 0 || nameIdx < 0 || statusIdx < 0) {
    throw new Error('Bethel List header shape unexpected -- check column names before trusting this form.');
  }

  var lastRow = bethelSheet.getLastRow();
  var firstDataRow = headerInfo.rowNumber + 1;
  var data = firstDataRow <= lastRow
    ? bethelSheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, bethelSheet.getLastColumn()).getValues()
    : [];

  var matchedCongregation = null;
  var steps = [];
  for (var r = 0; r < data.length; r++) {
    var cong = data[r][congIdx];
    var name = data[r][nameIdx];
    if (!cong || !name) continue;
    if (slugify(cong) !== congToken) continue;
    matchedCongregation = cong;

    var currentStatus = data[r][statusIdx] || '';
    var currentNotes = notesIdx >= 0 ? (data[r][notesIdx] || '') : '';
    var sheetRow = firstDataRow + r;

    steps.push({
      id: 'row-' + sheetRow,
      type: 'choice',
      question: 'Is ' + name + ' attending PSS?',
      options: STATUS_OPTIONS.map(function (o) { return { value: o.value, label: o.label }; }),
      followUp: buildFollowUp_(),
      initialValue: currentStatus,
      initialNote: currentNotes,
      skippable: true,
      meta: { name: name, congregation: cong, sheetRow: sheetRow },
    });
  }

  if (!matchedCongregation) {
    return { error: 'No pioneers found for this congregation link. Contact the circuit overseer.' };
  }

  steps.unshift({
    id: 'intro',
    type: 'info',
    question: 'Verify ' + matchedCongregation + '’s pioneers',
    subtext: 'One question per pioneer. Answers are saved immediately as you go -- ' +
      'it is safe to close this and come back later; anything already answered will show your ' +
      'previous answer. Use "Skip for now" for anyone you need to check with someone else about first.',
  });

  steps.push({
    id: 'additions',
    type: 'repeat-group',
    question: 'Any qualified pioneers we missed?',
    subtext: 'Their last PSS was 2021 or earlier, or they re/started pioneering on or before September 2025.',
    addLabel: '+ Add a pioneer',
    fields: [
      { id: 'name', label: 'Name', required: true },
      { id: 'contact', label: 'Contact info (phone or email)' },
      { id: 'notes', label: 'Notes (or group/CO contact info, if this is a group)', type: 'textarea' },
    ],
  });

  steps.push({
    id: 'done',
    type: 'info',
    question: 'Thank you!',
    subtext: 'Your answers have been recorded. You can revisit this link any time to review or change them.',
  });

  return {
    title: 'PSS Bethel List — ' + matchedCongregation,
    congregation: matchedCongregation,
    steps: steps,
  };
}

function buildFollowUp_() {
  var requiredValues = STATUS_OPTIONS.filter(function (o) { return o.notePrompt; }).map(function (o) { return o.value; });
  return { showWhen: requiredValues, question: 'Add a note' };
}

/**
 * Persist one answer. Row is identified by its captured sheet row number
 * (from getCongregationForm), but we re-check Name+Congregation still
 * match before writing -- if a human inserted/deleted/reordered rows in
 * between, this fails loudly instead of writing to the wrong pioneer.
 */
function submitAnswer(stepId, value, note, meta) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = openSheet_(BETHEL_LIST_TAB);
    var headerInfo = findHeaderRow_(sheet);
    var header = headerInfo.header;
    var congIdx = header.indexOf('Congregation');
    var nameIdx = header.indexOf('Name');
    var statusIdx = header.indexOf('Status / Response');
    var notesIdx = header.indexOf('Notes');

    var row = meta.sheetRow;
    var rowValues = sheet.getRange(row, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (rowValues[nameIdx] !== meta.name || rowValues[congIdx] !== meta.congregation) {
      throw new Error('Row moved since this form was loaded -- please reload the page before continuing (found "' +
        rowValues[nameIdx] + '" / "' + rowValues[congIdx] + '" at row ' + row + ', expected "' + meta.name + '" / "' + meta.congregation + '").');
    }
    sheet.getRange(row, statusIdx + 1).setValue(value);
    if (notesIdx >= 0) sheet.getRange(row, notesIdx + 1).setValue(note || '');
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Append one new pioneer to the "Add to Class" tab (never touches Bethel List). */
function submitAddition(entry, congregation) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = openSheet_(ADD_TO_CLASS_TAB);
    var headerInfo = findHeaderRow_(sheet);
    var header = headerInfo.header;
    var congIdx = header.indexOf('Congregation or Host Congregation of the Group');
    var nameIdx = header.indexOf('Name');
    var notesIdx = header.indexOf('Notes');

    var lastRow = sheet.getLastRow() + 1;
    var notes = entry.notes || '';
    if (entry.contact) notes = (notes ? notes + ' — ' : '') + 'Contact: ' + entry.contact;

    if (congIdx >= 0) sheet.getRange(lastRow, congIdx + 1).setValue(congregation);
    if (nameIdx >= 0) sheet.getRange(lastRow, nameIdx + 1).setValue(entry.name || '');
    if (notesIdx >= 0) sheet.getRange(lastRow, notesIdx + 1).setValue(notes);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** Operator-only utility: list every congregation link to distribute. Run from the Apps Script editor, not exposed to doGet. */
function listCongregationLinks() {
  var sheet = openSheet_(BETHEL_LIST_TAB);
  var headerInfo = findHeaderRow_(sheet);
  var congIdx = headerInfo.header.indexOf('Congregation');
  var firstDataRow = headerInfo.rowNumber + 1;
  var lastRow = sheet.getLastRow();
  var data = firstDataRow <= lastRow
    ? sheet.getRange(firstDataRow, 1, lastRow - firstDataRow + 1, sheet.getLastColumn()).getValues()
    : [];
  var seen = {};
  var deployUrl = ScriptApp.getService().getUrl();
  var lines = [];
  for (var r = 0; r < data.length; r++) {
    var cong = data[r][congIdx];
    if (!cong || seen[cong]) continue;
    seen[cong] = true;
    lines.push(cong + '\t' + deployUrl + '?cong=' + slugify(cong));
  }
  Logger.log(lines.join('\n'));
  return lines;
}
