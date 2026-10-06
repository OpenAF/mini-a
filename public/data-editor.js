/* Local JSON-data editor. No evaluation, network requests, or automatic persistence. */
(function() {
  'use strict';
  var types = ['map', 'array', 'string', 'number', 'boolean', 'null'];
  function kind(value) { return value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value === 'object' ? 'map' : typeof value; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function validate(value) {
    var count = 0;
    function visit(item, depth) {
      if (++count > 2000 || depth > 30) throw new Error('Use at most 2,000 values and 30 nesting levels.');
      var type = kind(item);
      if (!types.includes(type) || (type === 'number' && !Number.isFinite(item)) || (type === 'map' && Object.prototype.toString.call(item) !== '[object Object]')) throw new Error('Only JSON-compatible values are supported.');
      if (type === 'map' || type === 'array') Object.keys(item).forEach(function(key) { visit(item[key], depth + 1); });
    }
    visit(value, 0);
    if (!['map', 'array'].includes(kind(value))) throw new Error('The root must be a map or array.');
    return value;
  }
  // Quote strings conservatively, including apostrophes (SLON treats both quotes specially).
  function slon(value) {
    function quote(text) { return JSON.stringify(text).replace(/'/g, '\\u0027'); }
    if (Array.isArray(value)) return '[' + value.map(slon).join(' | ') + ']';
    if (value && typeof value === 'object') return '(' + Object.keys(value).map(function(key) { return quote(key) + ': ' + slon(value[key]); }).join(', ') + ')';
    return typeof value === 'string' ? quote(value) : JSON.stringify(value);
  }
  function node(tag, text) { var result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; }
  var controlSequence = 0;
  var icons = {
    add:'M12 5v14M5 12h14', remove:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    undo:'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12', redo:'m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12',
    up:'m6 11 6-6 6 6M12 5v14', down:'m6 13 6 6 6-6M12 5v14',
    copy:'M9 9h12v12H9zM15 9V3H3v12h6', disclosure:'m9 5 7 7-7 7'
  };
  class MiniADataEditor extends HTMLElement {
    constructor() {
      super();
      this._value = {}; this._undo = []; this._redo = []; this._collapsed = new Set(); this._errors = new Set();
    }
    connectedCallback() {
      if (!this._tree) this._build();
      var self = this;
      if (typeof ResizeObserver !== 'undefined' && !this._resizeObserver) {
        this._resizeObserver = new ResizeObserver(function(entries) {
          var width = entries[0].contentRect.width;
          if (width !== self._width) { self._width = width; self._resizeStrings(); }
        });
        this._resizeObserver.observe(this);
      }
    }
    disconnectedCallback() {
      if (this._resizeObserver) { this._resizeObserver.disconnect(); this._resizeObserver = null; }
    }
    get valid() { return this._errors.size === 0; }
    get format() { return this._format ? this._format.value : 'json'; }
    set format(value) { if (this._format) { this._format.value = value === 'slon' ? 'slon' : 'json'; this._sync(); } }
    get value() { return clone(this._value); }
    set value(value) {
      validate(value);
      this._value = clone(value); this._undo = []; this._redo = []; this._collapsed.clear();
      if (this._tree) this._render();
    }
    serialize(format) {
      if (this._errors.size) throw new Error('Correct invalid fields before exporting.');
      return format === 'slon' ? slon(this._value) : JSON.stringify(this._value, null, 2); }
    _button(text, action) {
      var self = this, control = node('button', text); control.type = 'button';
      control.addEventListener('click', function() { try { action(); } catch (error) { self._notice.textContent = error.message; } });
      return control;
    }
    _iconButton(label, icon, action) {
      var control = this._button(undefined, action); control.className = 'data-editor-icon';
      control.setAttribute('aria-label', label); control.title = label;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      var attributes = {viewBox:'0 0 24 24', width:'16', height:'16', fill:'none', stroke:'currentColor', 'stroke-width':'1.8', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false'};
      Object.keys(attributes).forEach(function(key) { svg.setAttribute(key, attributes[key]); });
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', icons[icon]);
      svg.append(path); control.append(svg); return control;
    }
    _panel(label, toolbar) {
      var panel = node('div'); panel.className = 'data-editor-panel'; panel.hidden = true;
      panel.id = 'data-editor-panel-' + (++controlSequence);
      var self = this, toggle = this._button(label, function() {
        panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden));
        self._resizeStrings();
      });
      toggle.setAttribute('aria-expanded', 'false'); toggle.setAttribute('aria-controls', panel.id);
      toolbar.append(toggle); panel.toggle = toggle; return panel;
    }
    _grow(field) {
      if (field._manualSize || !field.isConnected || !field.getClientRects().length) return;
      var style = getComputedStyle(field), padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      var border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth), line = parseFloat(style.lineHeight);
      field.style.height = 'auto';
      field.style.height = Math.min(field.scrollHeight + border, line * 6 + padding + border) + 'px';
      field._autoHeight = field.offsetHeight;
    }
    _resizeStrings() {
      var self = this;
      requestAnimationFrame(function() { self.querySelectorAll('.data-editor-string').forEach(function(field) { self._grow(field); }); });
    }
    _label(text, control) { var label = node('label', text); label.append(control); return label; }
    _build() {
      var self = this;
      this.classList.add('advanced-data-editor');
      var toolbar = node('div'); toolbar.className = 'data-editor-actions data-editor-toolbar';
      toolbar.setAttribute('role', 'group'); toolbar.setAttribute('aria-label', 'Data editor tools');
      this._undoButton = this._iconButton('Undo', 'undo', function() { self._travel('_undo', '_redo'); });
      this._redoButton = this._iconButton('Redo', 'redo', function() { self._travel('_redo', '_undo'); });
      toolbar.append(this._undoButton, this._redoButton);
      this._notice = node('p'); this._notice.setAttribute('role', 'status'); this._notice.setAttribute('aria-live', 'polite');
      this._tree = node('div');
      this._format = node('select'); ['json', 'slon'].forEach(function(format) { var option = node('option', format.toUpperCase()); option.value = format; self._format.append(option); });
      this._format.setAttribute('aria-label', 'Output format'); this._format.title = 'Output format';
      this._format.onchange = function() { self._sync(); }; toolbar.append(this._format);
      var output = this._panel('Preview', toolbar), importer = this._importer = this._panel('Import', toolbar), help = this._panel('Help', toolbar);
      help.append(node('p', 'Edit keys and values directly in the table. Choose a type to nest a map or array, then use + to add entries. Expand containers with the arrow. Preview or copy output in JSON or SLON, or import a replacement document.'));
      this._source = node('textarea'); this._source.rows = 5; this._source.spellcheck = false;
      importer.append(this._label('JSON/SLON source', this._source), this._button('Replace with JSON/SLON', function() {
        if (self._source.value.length > 200000) throw new Error('Import is limited to 200,000 characters.');
        var parsed = parse(self._source.value), value = parsed.value;
        self._change(function() { self._value = value; }, null, true);
        self.format = parsed.format;
        self._notice.textContent = 'Data imported. Undo restores the previous document.';
      }));
      this._output = node('textarea'); this._output.readOnly = true; this._output.rows = 7; this._output.spellcheck = false;
      this._copy = this._iconButton('Copy output', 'copy', async function() {
        try { await navigator.clipboard.writeText(self._output.value); self._notice.textContent = 'Output copied.'; }
        catch (_) { self._output.focus(); self._output.select(); self._notice.textContent = 'Copy unavailable. Output selected; press Ctrl+C or Command+C.'; }
      });
      output.append(this._label('Output', this._output), this._copy);
      this.append(toolbar, output, importer, help, this._notice, this._tree);
      this._render();
    }
    _at(path) { return path.reduce(function(value, key) { return value[key]; }, this._value); }
    _set(path, value) {
      if (!path.length) this._value = value;
      else Object.defineProperty(this._at(path.slice(0, -1)), path[path.length - 1], {value:value, writable:true, enumerable:true, configurable:true});
    }
    _invalid(control, message) {
      control.setCustomValidity(message); control.setAttribute('aria-invalid', String(!!message));
      if (message) this._errors.add(control); else this._errors.delete(control);
      this._notice.textContent = message || (this._errors.size ? 'Correct the remaining invalid fields to generate output.' : '');
      this._sync();
    }
    _sync() {
      var invalid = this._errors.size > 0;
      this._undoButton.disabled = !this._undo.length; this._redoButton.disabled = !this._redo.length;
      this.dispatchEvent(new CustomEvent('validation', {detail:{valid:!invalid}}));
      this._copy.disabled = invalid; this._output.value = invalid ? '' : this.serialize(this._format.value);
      this._output.placeholder = invalid ? 'Correct the invalid field to generate output.' : '';
    }
    _change(action, focusKey, replace) {
      if (this._errors.size && !replace) throw new Error('Correct the invalid field before changing structure.');
      var previous = clone(this._value);
      try { action(); validate(this._value); } catch (error) { this._value = previous; this._render(); throw error; }
      this._undo.push(previous); if (this._undo.length > 100) this._undo.shift(); this._redo = [];
      this._render(focusKey); this.dispatchEvent(new CustomEvent('change', {bubbles:true, detail:{value:this.value}}));
    }
    _travel(from, to) {
      if (!this[from].length) return;
      this[to].push(clone(this._value)); this._value = this[from].pop(); this._render();
      this._notice.textContent = from === '_undo' ? 'Change undone.' : 'Change restored.';
      this.dispatchEvent(new CustomEvent('change', {bubbles:true, detail:{value:this.value}}));
    }
    _render(focusKey) {
      var self = this;
      this._errors.clear(); this._tree.replaceChildren();
      function draw(path, parent) {
        var value = self._at(path), type = kind(value), id = JSON.stringify(path), title = path.length ? String(path[path.length - 1]) : 'Root';
        var group = node(path.length ? 'tr' : 'div'), keyCell = node('th'), valueCell = node('td');
        var row = node('div'); row.className = 'data-editor-row';
        if (path.length) { keyCell.scope = 'row'; group.append(keyCell, valueCell); valueCell.append(row); }
        else { valueCell = group; group.append(row); }
        function focus(control, suffix) { control.dataset.editorFocus = id + suffix; return control; }
        if (path.length && !Array.isArray(self._at(path.slice(0, -1)))) {
          var key = focus(node('input'), 'key'); key.value = title;
          key.onchange = function() {
            var owner = self._at(path.slice(0, -1)), name = key.value;
            if (name !== title && Object.prototype.hasOwnProperty.call(owner, name)) { self._invalid(key, 'This map already has that key.'); return; }
            self._invalid(key, '');
            if (self._errors.size) { self._invalid(key, 'Correct the other invalid field, then retry this key.'); return; }
            self._change(function() {
              var replacement = {};
              Object.keys(owner).forEach(function(k) { Object.defineProperty(replacement, k === title ? name : k, {value:owner[k], enumerable:true, writable:true, configurable:true}); });
              self._set(path.slice(0, -1), replacement);
            }, JSON.stringify(path.slice(0, -1).concat(name)) + 'key');
          };
          key.setAttribute('aria-label', 'Key ' + title); key.className = 'data-editor-key'; keyCell.append(key);
        }
        if (path.length && Array.isArray(self._at(path.slice(0, -1)))) keyCell.append(node('span', '[' + title + ']'));
        var select = focus(node('select'), 'type');
        (path.length ? types : ['map', 'array']).forEach(function(t) { var option = node('option', t); option.value = t; select.append(option); }); select.value = type;
        select.onchange = function() {
          try { self._change(function() { self._set(path, {map:{}, array:[], string:'', number:0, boolean:false, null:null}[select.value]); }, id + 'type'); }
          catch (error) { select.value = type; self._notice.textContent = error.message; }
        };
        select.setAttribute('aria-label', title + ' type'); select.title = 'Change value type'; row.append(select);
        if (type === 'map' || type === 'array') {
          var details = node('div'); details.className = 'data-editor-children'; details.hidden = self._collapsed.has(id);
          details.id = 'data-editor-container-' + (++controlSequence);
          var disclosure = focus(self._iconButton('Toggle ' + title, 'disclosure', function() {
            details.hidden = !details.hidden;
            if (details.hidden) self._collapsed.add(id); else self._collapsed.delete(id);
            disclosure.setAttribute('aria-expanded', String(!details.hidden)); self._resizeStrings();
          }), 'disclosure');
          disclosure.className += ' data-editor-disclosure';
          disclosure.setAttribute('aria-expanded', String(!details.hidden)); disclosure.setAttribute('aria-controls', details.id);
          var count = node('span', Object.keys(value).length + (type === 'map' ? ' properties' : ' items')); count.className = 'data-editor-count';
          row.prepend(disclosure, count);
          var table = node('table'); table.className = 'data-editor-table'; table.setAttribute('aria-label', title + ' ' + type);
          var body = node('tbody'); table.append(body); details.append(table);
          Object.keys(value).forEach(function(key) { draw(path.concat(type === 'array' ? Number(key) : key), body); });
          if (!Object.keys(value).length) details.append(node('p', type === 'array' ? 'Empty array' : 'Empty map'));
          var add = focus(self._iconButton(type === 'array' ? 'Add item' : 'Add property', 'add', function() {
            var key = value.length;
            if (type === 'map') { key = 'key'; var n = 1; while (Object.prototype.hasOwnProperty.call(value, key)) key = 'key' + n++; }
            self._change(function() { self._set(path.concat(key), ''); self._collapsed.delete(id); }, JSON.stringify(path.concat(key)) + (type === 'map' ? 'key' : 'value'));
          }), 'add'); row.append(add); valueCell.append(details);
        } else if (type !== 'null') {
          var field = focus(node(type === 'string' ? 'textarea' : 'input'), 'value');
          if (type === 'boolean') { field.type = 'checkbox'; field.checked = value; }
          else { field.value = String(value); if (type === 'string') field.rows = 1; else field.inputMode = 'decimal'; }
          if (type === 'string') field.onpointerup = function() {
            if (field._autoHeight !== undefined && Math.abs(field.offsetHeight - field._autoHeight) > 1) field._manualSize = true;
          };
          field.oninput = function() {
            if (type === 'string') self._grow(field);
            var next = type === 'boolean' ? field.checked : field.value;
            if (type === 'number') {
              if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(next) || !Number.isFinite(Number(next))) { self._invalid(field, 'Enter a finite JSON number, for example -1.5 or 2e3.'); return; }
              next = Number(next);
            }
            self._invalid(field, '');
            // Keep this input and its focus/caret in place while editing scalar values.
            var previous = clone(self._value); self._set(path, next); self._undo.push(previous); if (self._undo.length > 100) self._undo.shift(); self._redo = [];
            self._sync(); self.dispatchEvent(new CustomEvent('change', {bubbles:true, detail:{value:self.value}}));
          };
          field.setAttribute('aria-label', title + ' value'); field.className = 'data-editor-value data-editor-' + type;
          row.prepend(field);
        } else row.append(node('span', 'null'));
        if (path.length) {
          var owner = self._at(path.slice(0, -1)), index = path[path.length - 1];
          var actions = node('div'); actions.className = 'data-editor-row-actions'; row.append(actions);
          actions.append(self._iconButton('Remove', 'remove', function() { self._change(function() { if (Array.isArray(owner)) owner.splice(index, 1); else delete owner[index]; }, JSON.stringify(path.slice(0, -1)) + 'add'); }));
          if (Array.isArray(owner)) [-1, 1].forEach(function(delta) {
            var move = self._iconButton(delta < 0 ? 'Move up' : 'Move down', delta < 0 ? 'up' : 'down', function() { self._change(function() { var item = owner.splice(index, 1)[0]; owner.splice(index + delta, 0, item); }, JSON.stringify(path.slice(0, -1).concat(index + delta)) + 'type'); });
            move.disabled = index + delta < 0 || index + delta >= owner.length; actions.append(move);
          });
        }
        parent.append(group);
      }
      draw([], this._tree); this._sync(); this._resizeStrings();
      if (focusKey) { this._notice.textContent = 'Document updated. Undo is available.'; var target = Array.from(this.querySelectorAll('[data-editor-focus]')).find(function(control) { return control.dataset.editorFocus === focusKey; }); if (target) target.focus(); }
    }
  }
  // Parse the JSON-compatible SLON data model locally; never evaluate input text.
  // Delimiters and escaping follow ../slon/grammar/slon.pegjs.
  function parse(text) {
    text = String(text).trim();
    if (text.length > 200000) throw new Error('Input is limited to 200,000 characters.');
    try { return {value:validate(JSON.parse(text)), format:'json'}; } catch (_) {}
    var pos = 0, count = 0;
    function fail(message) { throw new Error(message + ' at character ' + (pos + 1) + '.'); }
    function ws() { while (/\s/.test(text[pos] || '') && pos < text.length) pos++; }
    function quoted() {
      var quote = text[pos++], result = '';
      while (pos < text.length) {
        var ch = text[pos++];
        if (ch === quote) return result;
        if (ch === '\\') {
          var esc = text[pos++], escapes = {'"':'"', "'":"'", '\\':'\\', '/':'/', b:'\b', f:'\f', n:'\n', r:'\r', t:'\t'};
          if (esc === 'u') {
            var hex = text.slice(pos, pos + 4);
            if (!/^[\da-f]{4}$/i.test(hex)) fail('Invalid Unicode escape');
            result += String.fromCharCode(parseInt(hex, 16)); pos += 4;
          } else if (Object.prototype.hasOwnProperty.call(escapes, esc)) result += escapes[esc];
          else fail('Invalid escape');
        } else { if (ch.charCodeAt(0) < 32) fail('Escape control characters in strings'); result += ch; }
      }
      fail('Unterminated string');
    }
    function bare() {
      var start = pos;
      while (pos < text.length && !/[:(),\[\]|]/.test(text[pos])) pos++;
      var result = text.slice(start, pos).trim();
      if (!result || /['"]/.test(result)) fail('Expected a quoted string or bare value');
      return result;
    }
    function value(depth) {
      ws();
      if (++count > 2000 || depth > 30) fail('Use at most 2,000 values and 30 nesting levels');
      var ch = text[pos];
      if (ch === '(' || ch === '[') {
        var map = ch === '(', result = map ? {} : [], end = map ? ')' : ']', separator = map ? ',' : '|'; pos++; ws();
        if (text[pos] === end) { pos++; return result; }
        while (pos < text.length) {
          var key;
          if (map) {
            ws(); key = /['"]/.test(text[pos] || '') ? quoted() : bare(); ws();
            if (text[pos++] !== ':') fail('Expected a colon');
            if (Object.prototype.hasOwnProperty.call(result, key)) fail('Duplicate map key');
          }
          var item = value(depth + 1);
          if (map) Object.defineProperty(result, key, {value:item, writable:true, configurable:true, enumerable:true});
          else result.push(item);
          ws();
          if (text[pos] === end) { pos++; return result; }
          if (text[pos++] !== separator) fail('Expected ' + separator + ' or ' + end);
        }
        fail('Unclosed container');
      }
      if (ch === '"' || ch === "'") return quoted();
      if (/^\d{4}-\d{2}-\d{2}\//.test(text.slice(pos))) fail('Quote datetime literals to edit them as JSON strings');
      var token = bare();
      if (token === 'true') return true;
      if (token === 'false') return false;
      if (token === 'null') return null;
      if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return Number(token);
      if (/^-?\d/.test(token)) fail('Quote strings that start with a number');
      return token;
    }
    var result = value(0); ws();
    if (pos !== text.length) fail('Unexpected trailing input');
    return {value:validate(result), format:'slon'};
  }
  function openEditor(field, options) {
    options = options || {};
    if (field.disabled || field.readOnly) return;
    var original = field.value, label = options.label || field.getAttribute('aria-label') || 'value';
    var popup = node('dialog'); popup.className = 'advanced-dialog advanced-data-popup';
    popup.setAttribute('aria-label', 'Edit ' + label + ' as JSON or SLON');
    var editor = node('mini-a-data-editor'), notice = node('p'), ready = false;
    notice.setAttribute('role', 'status');
    var heading = node('h3', 'Edit ' + label), actions = node('div'); actions.className = 'data-editor-actions';
    var apply = node('button', 'Use value'), cancel = node('button', 'Cancel'); apply.type = cancel.type = 'button';
    actions.append(apply, cancel);
    var footer = node('div'); footer.className = 'data-editor-footer';
    footer.append(node('p', 'Use value updates this field. Apply or Run in the original form submits it.'), actions);
    popup.append(heading, notice, editor, footer);
    document.body.append(popup);
    try {
      var parsed = original.trim() ? parse(original) : {value:options.root === 'array' ? [] : {}, format:'json'};
      editor.value = parsed.value; editor.format = parsed.format; ready = true;
    } catch (error) {
      notice.textContent = 'Cannot load this field: ' + error.message + ' Correct the source and select Replace with JSON/SLON, or Cancel to leave the field unchanged.';
      editor._source.value = original; editor._importer.toggle.click();
    }
    apply.disabled = !ready;
    editor.addEventListener('change', function(event) {
      // Native field/format/source changes also bubble; only a committed document enables write-back.
      if (!event.detail || !Object.prototype.hasOwnProperty.call(event.detail, 'value')) return;
      ready = true; apply.disabled = !editor.valid; notice.textContent = '';
    });
    editor.addEventListener('validation', function() { apply.disabled = !ready || !editor.valid; });
    apply.addEventListener('click', function() {
      try {
        if (!ready) throw new Error('Load valid JSON or SLON first.');
        if (!field.isConnected || field.disabled || field.readOnly || field.value !== original) throw new Error('The original field changed or is no longer available. Cancel and reopen its editor.');
        // Text inputs strip newlines: JSON must be compact when writing to them.
        var output = editor.format === 'json' ? JSON.stringify(editor.value) : editor.serialize('slon');
        if (!editor.valid) throw new Error('Correct the invalid fields first.');
        field.value = output;
        field.dispatchEvent(new Event('input', {bubbles:true})); field.dispatchEvent(new Event('change', {bubbles:true}));
        popup.close();
      } catch (error) { notice.textContent = error.message; }
    });
    cancel.addEventListener('click', function() { popup.close(); });
    popup.addEventListener('cancel', function(event) { event.preventDefault(); event.stopPropagation(); popup.close(); });
    popup.addEventListener('close', function() { popup.remove(); if (field.isConnected) field.focus(); });
    popup.showModal(); cancel.focus();
    return popup;
  }
  var fieldSequence = 0;
  function bind(field, options) {
    if (field.disabled || field.readOnly || field.dataset.dataEditorBound) return;
    field.dataset.dataEditorBound = 'true';
    var button = node('button'); button.type = 'button'; button.className = 'advanced-data-trigger';
    button.setAttribute('aria-label', 'Edit ' + ((options && options.label) || field.getAttribute('aria-label') || 'value') + ' as JSON or SLON');
    button.setAttribute('aria-haspopup', 'dialog'); button.title = 'Edit data (JSON/SLON)';
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var attributes = {viewBox:'0 0 24 24', width:'14', height:'14', fill:'none', stroke:'currentColor', 'stroke-width':'1.8', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true', focusable:'false'};
    Object.keys(attributes).forEach(function(key) { svg.setAttribute(key, attributes[key]); });
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M8 4H4v16h4M16 4h4v16h-4M9 9h6m-6 6h6'); svg.append(path); button.append(svg);
    button.addEventListener('click', function() { openEditor(field, options); });
    var wrapper = node('span'); wrapper.className = 'advanced-data-field';
    if (field.tagName === 'TEXTAREA') wrapper.className += ' advanced-data-multiline';
    // Keep the icon outside the label and retain the original field and its listeners.
    var label = field.closest('label');
    if (label) {
      if (!field.id) {
        var id; do { id = 'advanced-data-input-' + (++fieldSequence); } while (document.getElementById(id));
        field.id = id;
      }
      label.htmlFor = field.id; label.after(wrapper);
    } else field.after(wrapper);
    wrapper.append(field, button);
    return button;
  }
  window.MiniADataEditor = {parse:parse, open:openEditor, bind:bind};
  if (!customElements.get('mini-a-data-editor')) customElements.define('mini-a-data-editor', MiniADataEditor);
})();
