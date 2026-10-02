/* Advanced presentation adapter. Commands and screen actions share the server console dispatcher. */
window.MiniAAdvancedUI = function(bridge) {
  const storeKey = 'mini-a-advanced-session';
  let enabled = false, after = 0, snapshot = null, polling = false, dialogId = null, busy = false;
  let history = [], historyIndex = 0, activeScreen = 'activity';
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const button = (text, action) => { const n = el('button', text); n.type = 'button'; n.addEventListener('click', () => Promise.resolve().then(action).catch(showError)); return n; };
  const input = (placeholder, value = '') => { const n = el('input'); n.placeholder = placeholder; n.value = value; return n; };
  const quote = value => JSON.stringify(value);
  const asText = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  function activityText(value) {
    function strip(text) {
      return text
        // OSC titles/links and other terminal control strings (BEL or ST terminated).
        .replace(/(?:\x1b\]|\x9d|\\u001b\]|\\u009d)[\s\S]*?(?:\x07|\x1b\\|\x9c|\\u0007|\\u001b\\\\|\\u009c|$)/gi, '')
        .replace(/(?:\x1b[PX^_]|[\x90\x98\x9e\x9f]|\\u001b[PX^_])[\s\S]*?(?:\x1b\\|\x9c|\\u001b\\\\|\\u009c|$)/gi, '')
        // CSI includes colors, cursor movement, erase commands and private modes.
        .replace(/(?:\x1b\[|\x9b|\\u001b\[|\\u009b)[0-?]*[ -/]*[@-~]/gi, '')
        .replace(/(?:\x1b|\\u001b)[ -/]*[0-~]/gi, '');
    }
    if (typeof value === 'string') return strip(value);
    // Clean nested strings before JSON encoding; never change the stored event or settings.
    const text = JSON.stringify(value, (_key, item) => typeof item === 'string' ? strip(item) : item, 2);
    return typeof text === 'string' ? strip(text) : text;
  }
  const toolbar = el('div', undefined, 'advanced-toolbar');
  const toggle = button('Advanced', () => setEnabled(!enabled));
  toolbar.append(toggle);
  const status = el('span', ''); toolbar.append(status);
  document.querySelector('#promptInput').parentElement.prepend(toolbar);
  const shell = el('section', undefined, 'advanced-shell'); shell.hidden = true;
  const paneHeader = el('header', undefined, 'advanced-pane-header');
  const identity = el('div', undefined, 'advanced-identity');
  const logo = el('strong', undefined, 'advanced-logo');
  logo.setAttribute('role', 'img'); logo.setAttribute('aria-label', 'mini-a');
  const logoArt = el('span'); logoArt.setAttribute('aria-hidden', 'true');
  // Same two-line mark and green dots as miniaLogo in mini-a-session.js.
  logoArt.append(document.createTextNode(' ._ _ '), el('span', 'o', 'advanced-logo-dot'),
    document.createTextNode('._ '), el('span', 'o', 'advanced-logo-dot'),
    document.createTextNode('   _ \n | | ||| ||~~(_|'));
  logo.append(logoArt);
  identity.append(logo, el('span', 'Advanced console', 'advanced-subtitle'));
  const paneStatus = el('span', 'Ready', 'advanced-state'); paneStatus.setAttribute('role', 'status');
  paneHeader.append(identity, paneStatus);
  const nav = el('nav'); nav.setAttribute('aria-label', 'Advanced screens');
  const split = el('div', undefined, 'advanced-divider'); split.hidden = true;
  split.tabIndex = 0; split.setAttribute('role', 'separator');
  split.setAttribute('aria-label', 'Resize Advanced pane');
  split.setAttribute('aria-valuemin', '30'); split.setAttribute('aria-valuemax', '70');
  split.title = 'Drag to resize the Advanced pane';
  split.append(el('span', undefined, 'advanced-divider-grip'));
  document.body.append(split);
  const stacked = window.matchMedia('(max-width:900px)');
  let splitSize = 45, drag = null, dockPreference = null, dockButtons = [], dockTrigger = null;
  try { const saved = localStorage.getItem('mini-a-advanced-dock'); if (['right','bottom','top','left'].includes(saved)) dockPreference = saved; } catch (_) {}
  function dockPosition() { return dockPreference || (stacked.matches ? 'bottom' : 'right'); }
  function horizontalDivider() { return ['top','bottom'].includes(dockPosition()); }
  function setDock(position) {
    finishDrag(); dockPreference = position;
    try { localStorage.setItem('mini-a-advanced-dock', position); } catch (_) {}
    applySplit();
  }
  try { const saved = Number(localStorage.getItem('mini-a-advanced-split')); if (saved >= 30 && saved <= 70) splitSize = saved; } catch (_) {}
  function applySplit(size = splitSize, persist = true) {
    splitSize = Math.max(30, Math.min(70, size));
    document.body.style.setProperty('--advanced-size', String(splitSize));
    split.setAttribute('aria-valuenow', String(Math.round(splitSize)));
    split.setAttribute('aria-valuetext', `Advanced pane ${Math.round(splitSize)} percent`);
    split.setAttribute('aria-orientation', horizontalDivider() ? 'horizontal' : 'vertical');
    document.body.dataset.advancedDock = dockPosition();
    dockButtons.forEach(control => control.setAttribute('aria-pressed', String(control.dataset.dock === dockPosition())));
    if (dockTrigger) {
      dockTrigger.replaceChildren(tabIcon('dock' + dockPosition()), tabIcon('chevronDown'));
      dockTrigger.title = `Pane position: ${dockPosition()}. Click to change.`;
    }
    if (persist) { try { localStorage.setItem('mini-a-advanced-split', String(splitSize)); } catch (_) {} }
    followActivity();
  }
  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null;
    if (split.hasPointerCapture(id)) split.releasePointerCapture(id);
    document.body.classList.remove('advanced-resizing');
    applySplit();
  }
  split.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault(); split.focus();
    drag = {id:event.pointerId, coordinate:horizontalDivider() ? event.clientY : event.clientX, size:splitSize, stacked:horizontalDivider(), direction:['left','top'].includes(dockPosition()) ? 1 : -1};
    split.setPointerCapture(event.pointerId);
    document.body.classList.add('advanced-resizing');
  });
  split.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const coordinate = drag.stacked ? event.clientY : event.clientX;
    const extent = drag.stacked ? window.innerHeight : window.innerWidth;
    applySplit(drag.size + (coordinate - drag.coordinate) / extent * 100 * drag.direction, false);
  });
  ['pointerup','pointercancel','lostpointercapture'].forEach(type => split.addEventListener(type, finishDrag));
  split.addEventListener('keydown', event => {
    const increase = {right:'ArrowLeft',left:'ArrowRight',top:'ArrowDown',bottom:'ArrowUp'}[dockPosition()];
    const decrease = {right:'ArrowRight',left:'ArrowLeft',top:'ArrowUp',bottom:'ArrowDown'}[dockPosition()];
    if (![increase,decrease,'Home','End'].includes(event.key)) return;
    event.preventDefault();
    applySplit(event.key === 'Home' ? 30 : event.key === 'End' ? 70 : splitSize + (event.key === increase ? 2 : -2));
  });
  function updateSplitOrientation() { finishDrag(); applySplit(); }
  if (stacked.addEventListener) stacked.addEventListener('change', updateSplitOrientation);
  else stacked.addListener(updateSplitOrientation);
  const screen = el('section', undefined, 'advanced-screen');
  const activity = el('section', undefined, 'advanced-activity');
  const filter = input('Filter live activity'); filter.setAttribute('aria-label', 'Filter activity');
  const events = el('div', undefined, 'advanced-events'); events.setAttribute('role', 'log');
  const activityHeader = el('div', undefined, 'advanced-activity-header');
  const followLabel = el('label', 'Auto-follow ');
  const follow = el('input'); follow.type = 'checkbox'; follow.checked = true;
  follow.setAttribute('aria-label', 'Auto-follow live activity'); followLabel.append(follow);
  activityHeader.append(el('h3', 'Live activity'), followLabel);
  activity.append(activityHeader, filter, events);
  function followActivity() {
    if (follow.checked) requestAnimationFrame(() => { if (follow.checked) events.scrollTop = events.scrollHeight; });
  }
  follow.onchange = followActivity;
  applySplit();
  filter.oninput = () => { [...events.children].forEach(n => n.hidden = !n.textContent.toLowerCase().includes(filter.value.toLowerCase())); followActivity(); };
  shell.append(paneHeader, nav, screen, activity); document.body.append(shell);
  const suggestions = el('div', undefined, 'advanced-completions'); suggestions.hidden = true;
  suggestions.setAttribute('role', 'listbox'); toolbar.after(suggestions);
  const dialog = el('dialog', undefined, 'advanced-dialog'); dialog.setAttribute('aria-label', 'Console interaction'); document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); api({action:'stop'}).catch(showError); dialog.close(); });
  const screens = [
    ['activity', 'Live activity', 'Follow agent actions, tool calls, progress, and results in real time.'],
    ['settings', 'Settings', 'Adjust parameters for this session and manage saved presets.'],
    ['models', 'Models', 'Choose and configure the main, low-cost, and validation models.'],
    ['history', 'History', 'Open saved conversations, restore history, or rewind exchanges.'],
    ['context', 'Context', 'Inspect, compact, and summarize the agent conversation context.'],
    ['stats', 'Statistics', 'Inspect token usage, tools, memory, and wiki statistics.'],
    ['debug', 'Debug', 'Browse the previous goal detailed trace and inspect individual records.'],
    ['wiki', 'Wiki', 'Search, browse, edit, and maintain the knowledge base.'],
    ['graph', 'Graph', 'Explore wiki relationships, paths, and graph operations.'],
    ['ingest', 'Ingest', 'Import sources into the wiki and manage ingestion recovery.'],
    ['absorb', 'Absorb', 'Create, review, and apply knowledge absorption plans.'],
    ['dream', 'Dream', 'Run memory consolidation and wiki maintenance operations.'],
    ['skills', 'Skills', 'Discover skills and invoke custom commands.'],
    ['subtasks', 'Subtasks', 'Delegate goals and inspect or cancel child tasks.']
  ];
  // Match Simple view's small, rounded, currentColor SVG line icons.
  const tabIcons = {
    chevronDown: 'm8 10 4 4 4-4',
    dockright: 'M3 4h18v16H3ZM15 4v16',
    dockbottom: 'M3 4h18v16H3ZM3 14h18',
    docktop: 'M3 4h18v16H3ZM3 10h18',
    dockleft: 'M3 4h18v16H3ZM9 4v16',
    activity: 'M3 12h4l3-7 4 14 3-7h4',
    settings: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    models: 'M8 8h8v8H8zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3',
    history: 'M3 5v5h5M3 10a9 9 0 1 1 1 7M12 7v5l3 2',
    context: 'M8 4H5v16h3M16 4h3v16h-3M9 9h6m-6 6h6',
    stats: 'M5 20V10m7 10V4m7 16v-7',
    debug: 'M8 9h8v6a4 4 0 0 1-8 0V9Zm2-4h4l2 4M9 3l1 2m5-2-1 2M4 10h4m8 0h4M3 14h5m8 0h5M5 19l3-2m8 0 3 2M12 9v10',
    wiki: 'M12 5v16M12 5C9 3 5 3 3 4v15c3-1 6-1 9 2 3-3 6-3 9-2V4c-2-1-6-1-9 1Z',
    graph: 'M10 6a2 2 0 1 0 4 0 2 2 0 1 0-4 0M3 18a2 2 0 1 0 4 0 2 2 0 1 0-4 0m12 0a2 2 0 1 0 4 0 2 2 0 1 0-4 0M11 8l-5 8m7-8 5 8M7 18h10',
    ingest: 'M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5',
    absorb: 'M3 6h5v5M8 6l-5 5m18-5h-5v5m0-5 5 5M8 17h8m-6 3h4',
    dream: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z',
    skills: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',
    subtasks: 'M6 3v6a6 6 0 0 0 6 6h6M4 3a2 2 0 1 0 4 0 2 2 0 1 0-4 0m12 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M6 11v8m-2 2a2 2 0 1 0 4 0 2 2 0 1 0-4 0'
  };
  function tabIcon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const attributes = {viewBox:'0 0 24 24',width:'14',height:'14',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false',class:'advanced-tab-icon'};
    Object.entries(attributes).forEach(([key, value]) => svg.setAttribute(key, value));
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', tabIcons[name]); svg.append(path); return svg;
  }
  function positionOptions(container, options) {
    const anchor = container.getBoundingClientRect(), bounds = shell.getBoundingClientRect();
    options.style.maxHeight = Math.max(40, bounds.bottom - anchor.bottom - 14) + 'px';
    options.style.left = Math.max(bounds.left + 8 - anchor.left, Math.min(0, bounds.right - 8 - anchor.left - options.offsetWidth)) + 'px';
  }
  const screenPicker = el('div', undefined, 'advanced-docking advanced-screen-picker');
  const screenOptions = el('div', undefined, 'advanced-dock-options'); screenOptions.hidden = true;
  screenOptions.id = 'advanced-screen-options';
  screenOptions.setAttribute('role', 'group'); screenOptions.setAttribute('aria-label', 'Advanced views');
  function closeScreenOptions(restoreFocus = false) {
    screenOptions.hidden = true; screenTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) screenTrigger.focus();
  }
  const screenTrigger = button('', () => {
    const open = screenOptions.hidden;
    screenOptions.hidden = !open; screenTrigger.setAttribute('aria-expanded', String(open));
    if (open) positionOptions(screenPicker, screenOptions);
  });
  screenTrigger.className = 'advanced-dock-toggle';
  screenTrigger.setAttribute('aria-expanded', 'false'); screenTrigger.setAttribute('aria-controls', screenOptions.id);
  const screenButtons = screens.map(([name, label, description]) => {
    const option = button(label, () => { closeScreenOptions(true); activeScreen = name; renderScreen(); });
    option.prepend(tabIcon(name)); option.title = description;
    option.setAttribute('aria-description', description); option.dataset.screen = name;
    screenOptions.append(option); return option;
  });
  screenPicker.append(screenTrigger, screenOptions); nav.append(screenPicker);
  screenPicker.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !screenOptions.hidden) {
      event.preventDefault(); event.stopPropagation(); closeScreenOptions(true);
    }
  });
  screenPicker.addEventListener('focusout', event => { if (!screenPicker.contains(event.relatedTarget)) closeScreenOptions(); });
  document.addEventListener('pointerdown', event => { if (!screenPicker.contains(event.target)) closeScreenOptions(); });
  const docking = el('div', undefined, 'advanced-docking');
  const dockOptions = el('div', undefined, 'advanced-dock-options'); dockOptions.hidden = true;
  dockOptions.id = 'advanced-dock-options';
  dockOptions.setAttribute('role', 'group'); dockOptions.setAttribute('aria-label', 'Advanced pane position');
  function closeDockOptions(restoreFocus = false) {
    dockOptions.hidden = true; dockTrigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) dockTrigger.focus();
  }
  dockTrigger = button('', () => {
    const open = dockOptions.hidden;
    dockOptions.hidden = !open; dockTrigger.setAttribute('aria-expanded', String(open));
    if (open) positionOptions(docking, dockOptions);
  });
  dockTrigger.className = 'advanced-dock-toggle';
  dockTrigger.setAttribute('aria-label', 'Change Advanced pane position');
  dockTrigger.setAttribute('aria-expanded', 'false'); dockTrigger.setAttribute('aria-controls', dockOptions.id);
  dockButtons = ['right','bottom','top','left'].map(position => {
    const control = button(position[0].toUpperCase() + position.slice(1), () => { closeDockOptions(true); setDock(position); });
    control.dataset.dock = position;
    control.title = `Dock Advanced pane ${position}`;
    control.setAttribute('aria-label', control.title);
    control.prepend(tabIcon('dock' + position)); dockOptions.append(control); return control;
  });
  docking.append(dockTrigger, dockOptions);
  docking.addEventListener('keydown', event => { if (event.key === 'Escape' && !dockOptions.hidden) { event.preventDefault(); event.stopPropagation(); closeDockOptions(true); } });
  docking.addEventListener('focusout', event => { if (!docking.contains(event.relatedTarget)) closeDockOptions(); });
  document.addEventListener('pointerdown', event => { if (!docking.contains(event.target)) closeDockOptions(); });
  paneHeader.append(docking); applySplit();
  const controls = el('div', undefined, 'advanced-session-actions');
  function sessionAction(label, icon, action) {
    const control = button('', action);
    control.title = label; control.setAttribute('aria-label', label);
    // Match the Stop and Clear icons in the Simple view.
    control.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + icon + '</svg>';
    return control;
  }
  controls.append(sessionAction('Stop', '<rect x="5" y="5" width="14" height="14" rx="2"></rect>', () => api({action:'stop'})), sessionAction('New conversation', '<path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />', async () => {
    if (busy) throw new Error('Stop or finish the current operation before starting a new conversation.');
    await bridge.newConversation(); after = 0; events.replaceChildren(); dialogId = null;
    activeScreen = 'activity'; renderScreen();
    sessionStorage.removeItem(storeKey); await poll();
  }));
  paneHeader.append(controls);
  async function api(data) {
    const uuid = bridge.uuid();
    if (enabled) sessionStorage.setItem(storeKey, uuid);
    const response = await fetch(bridge.url('advanced'), {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uuid,...data})});
    if (!response.ok) throw new Error(`Advanced request failed (${response.status})`);
    const result = await response.json(); if (result.error) throw new Error(result.error); return result;
  }
  function showError(error) { status.textContent = String(error.message || error); paneStatus.textContent = 'Error'; paneStatus.dataset.state = 'error'; }
  async function mutate(data) {
    const result = await api({...data,requestId:bridge.newRequestId()});
    if (result.busy) throw new Error('This conversation is busy. Stop or finish the current operation first.');
    if (data.action === 'command') {
      activeScreen = 'activity';
      filter.value = ''; filter.oninput();
      renderScreen();
    }
    busy = true; await poll();
  }
  async function command(value) {
    history.push(value); historyIndex = history.length;
    await mutate({action:'command',command:value});
  }
  function setEnabled(value) {
    debugGeneration++;
    enabled = value; shell.hidden = split.hidden = !value; if (!value) finishDrag(); document.body.classList.toggle('mini-a-advanced', value);
    toggle.textContent = value ? 'Simple' : 'Advanced';
    if (value) { const uuid = sessionStorage.getItem(storeKey); if (uuid && !snapshot) bridge.resume(uuid); if (activeScreen === 'debug') renderScreen(); poll().catch(showError); }
  }
  function appendEvent(record, navigate = true) {
    if (record.type === 'view') {
      if (record.value === 'clear') { events.replaceChildren(); return; }
      else if (navigate) { activeScreen = record.value; renderScreen(); }
    }
    const details = el('details'); details.dataset.sequence = record.sequence;
    const summary = el('summary');
    summary.append(el('time', record.timestamp.slice(11,19), 'advanced-event-time'), el('span', record.type, 'advanced-event-type'), el('span', activityText(record.value)?.replace(/\s+/g,' ').slice(0,150) || '', 'advanced-event-text'));
    details.dataset.type = record.type;
    details.append(summary);
    const content = el('div', undefined, 'advanced-event-content');
    content.append(structuredOutput(record.value)); details.append(content);
    if(record.truncated) details.addEventListener('toggle',async()=>{
      if(!details.open || details.dataset.loaded)return;
      try {
        const full=await api({action:'event',sequence:record.sequence});
        content.replaceChildren(structuredOutput(full.value)); details.dataset.loaded='true';
      } catch(e){showError(e);}
    });
    events.append(details);
    details.hidden = !details.textContent.toLowerCase().includes(filter.value.toLowerCase());
    while (events.childElementCount > 1000) events.firstChild.remove();
  }
  async function poll() {
    if (!enabled || polling) return;
    polling = true;
    try {
      const current = bridge.uuid();
      if (snapshot && current !== snapshot.uuid) { after = 0; snapshot = null; events.replaceChildren(); }
      const data = await api({action:'snapshot',after});
      if (current !== bridge.uuid()) return;
      const first = !snapshot; snapshot = data; busy = data.busy; bridge.trackRun(data);
      paneStatus.dataset.state = data.closed ? 'closed' : busy ? 'working' : 'ready';
      status.textContent = paneStatus.textContent = data.closed ? 'Session ended' : busy ? 'Working' : 'Ready';
      for (const record of data.events) { if (record.sequence > after) { appendEvent(record, !first); after = record.sequence; } }
      if (data.events.length) followActivity();
      if (first || data.events.some(e => e.type === 'complete' && (['settings','preset'].includes(e.value?.action) || e.value?.settingsChanged))) renderScreen();
      if (first || data.events.some(e => e.type === 'history-clear')) bridge.refresh();
      if (data.pending && data.pending.id !== dialogId) showDialog(data.pending);
      if (!data.pending && dialog.open) dialog.close();
      if (busy || data.events.some(e => e.type === 'answer')) bridge.refresh();
    } finally { polling = false; }
  }
  function showDialog(pending) {
    dialogId = pending.id; dialog.replaceChildren(el('h3', pending.label));
    const reply = async answer => { await api({action:'reply',id:pending.id,answer}); dialog.close(); };
    if (pending.type === 'choice') pending.choices.forEach((choice,index) => dialog.append(button(asText(choice), () => reply(index))));
    else { const field = el('textarea'); field.value = pending.value || ''; dialog.append(field,button('Continue', () => reply(field.value))); window.MiniADataEditor.bind(field, {label: pending.label}); }
    dialog.append(button('Cancel operation', async () => { await api({action:'stop'}); dialog.close(); }));
    if (!dialog.open) dialog.showModal();
  }
  function commandForm(label, build, fields) {
    const form = el('form', undefined, 'advanced-form'); form.append(el('h4',label));
    const nodes = fields.map(spec => {
      const name = typeof spec === 'string' ? spec : spec.name;
      const field = name === 'Content' ? el('textarea') : input(name);
      field.setAttribute('aria-label', name);
      const lab=el('label',name); lab.append(field); form.append(lab);
      if (spec.dataEditor) window.MiniADataEditor.bind(field, {label: name, root: spec.dataEditor});
      return field;
    });
    const go = el('button','Run'); go.type='submit'; form.append(go);
    form.onsubmit = e => { e.preventDefault(); command(build(...nodes.map(n=>n.value))).catch(showError); };
    screen.append(form);
  }
  function actions(items) { const group=el('div',undefined,'advanced-actions'); items.forEach(([name,cmd])=>group.append(button(name,()=>command(cmd)))); screen.append(group); }
  let statsMode = 'summary', statsMetrics = null, statsDetails = null, statsCharts = [], statsGeneration = 0;
  function destroyStatsCharts() {
    statsCharts.forEach(chart => chart.destroy()); statsCharts = [];
  }
  function structuredOutput(value) {
    let payload = value && ['tree', 'table', 'markdown'].includes(value.type) ? value.value : value;
    if (typeof payload === 'string' && /^[\s]*[\[{]/.test(payload)) {
      try { payload = JSON.parse(activityText(payload)); } catch (_) { /* Keep ordinary text intact. */ }
    }
    return payload && typeof payload === 'object' ? structuredMap(payload) : el('pre', activityText(payload));
  }
  function structuredMap(value) {
    const view = el('div', undefined, 'advanced-stat-map');
    // nJSMap emits HTML directly, including map keys and link attributes.
    const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
    function prepare(value) {
      if (value === null || value === undefined) return '(not available)';
      if (typeof value === 'string') return escape(activityText(value));
      if (Array.isArray(value)) return value.map(prepare);
      if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [escape(activityText(key)), prepare(item)]));
      return value;
    }
    try {
      if (typeof window.nJSMap !== 'function') throw new Error('nJSMap unavailable');
      view.innerHTML = window.nJSMap(prepare(value), undefined, document.body.classList.contains('markdown-body-dark'));
    } catch (_) { view.append(el('pre', JSON.stringify(value, null, 2))); }
    return view;
  }
  function renderStats(container) {
    destroyStatsCharts(); container.replaceChildren();
    const metrics = statsMetrics;
    if (!metrics) { container.append(el('p', 'Run a goal first to collect statistics.')); return; }
    const css = getComputedStyle(shell);
    const color = name => css.getPropertyValue('--advanced-' + name).trim();
    const label = name => name.replace(/_/g, ' ');
    function chart(title, rows, unit = 'Count') {
      rows = rows.filter(([, value]) => typeof value === 'number' && Number.isFinite(value));
      if (!rows.length) return;
      const card = el('section', undefined, 'advanced-stat-card');
      card.append(el('h4', title)); container.append(card);
      const values = el('details');
      values.append(el('summary', 'View values'));
      values.append(structuredMap(rows.map(([name, value]) => ({Metric: label(name), Value: value}))));
      if (typeof window.Chart === 'function') {
        const frame = el('div', undefined, 'advanced-stat-chart'), canvas = el('canvas');
        frame.style.height = Math.max(150, rows.length * 28 + 55) + 'px';
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', title + '. Exact values in the table below.');
        frame.append(canvas); card.append(frame);
        try {
          statsCharts.push(new window.Chart(canvas, {
            type: 'bar',
            data: {labels: rows.map(([name]) => label(name)), datasets: [{label: unit, data: rows.map(([, value]) => value), backgroundColor: color('muted'), borderColor: color('muted'), borderWidth: 1, borderRadius: 3}]},
            options: {indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
              plugins: {legend: {display: false}, colors: {enabled: false}, tooltip: {backgroundColor: color('bg'), titleColor: color('text'), bodyColor: color('text'), borderColor: color('border'), borderWidth: 1}},
              scales: {x: {beginAtZero: true, ticks: {color: color('muted')}, grid: {color: color('line')}, title: {display: true, text: unit, color: color('muted')}}, y: {ticks: {color: color('text'), autoSkip: false}, grid: {display: false}}}}
          }));
        } catch (_) { frame.remove(); values.open = true; }
      } else { values.open = true; }
      card.append(values);
    }
    function group(title, object) {
      if (!object || typeof object !== 'object') return;
      // Separate time, token and count metrics so unlike units never share an axis.
      const rows = Object.entries(object);
      const unit = key => /(?:_ms|_ms_total|_ms_avg)$/.test(key) ? 'Milliseconds' : /tokens/.test(key) ? 'Tokens' : /(?:rate|ratio)$/.test(key) ? key : 'Count';
      const units = [...new Set(rows.filter(([, value]) => typeof value === 'number').map(([key]) => unit(key)))];
      units.forEach(u => chart(title + (units.length > 1 ? ' · ' + label(u) : ''), rows.filter(([key]) => unit(key) === u), label(u)));
      rows.filter(([, value]) => value && typeof value === 'object').forEach(([key, value]) => group(title + ' · ' + label(key), value));
    }
    if (statsMode === 'summary') {
      const p = metrics.performance || {};
      chart('Token usage by model', [['Main', p.llm_normal_tokens], ['Low cost', p.llm_lc_tokens], ['Validation', p.llm_val_tokens]], 'Tokens');
      chart('Token accounting', [['Actual', p.llm_actual_tokens], ['Estimated', p.llm_estimated_tokens]], 'Tokens');
      group('Goals', metrics.goals);
      chart('LLM calls', ['normal', 'low_cost', 'validation'].map(key => [key, metrics.llm_calls?.[key]]).concat([['Advisor', metrics.advisor?.calls]]));
      group('Actions', metrics.actions);
      chart('Time spent', ['step_prompt_build_ms_total', 'step_llm_wait_ms_total', 'step_tool_exec_ms_total', 'step_context_maintenance_ms_total'].map(key => [key.replace('step_', '').replace('_ms_total', ''), p[key]]), 'Milliseconds');
    } else if (statsMode === 'tools') {
      const tools = Object.entries(metrics.per_tool_usage || {});
      ['calls', 'successes', 'failures'].forEach(key => chart('Tool ' + key, tools.map(([name, value]) => [name, value[key]])));
    } else if (statsMode === 'detailed') {
      Object.entries(metrics).forEach(([key, value]) => group(label(key), value));
    } else group(label(statsMode), metrics[statsMode]);
    const details = statsMode === 'detailed' ? statsDetails : statsMode === 'tools' ? statsDetails?.per_tool_usage : ['memory', 'wiki'].includes(statsMode) ? statsDetails?.[statsMode] : null;
    if (details && Object.keys(details).length) {
      const card = el('section', undefined, 'advanced-stat-card');
      const disclosure = el('details'); disclosure.append(el('summary', 'Structured details'), structuredMap(details));
      card.append(disclosure); container.append(card);
    }
    if (!container.childElementCount) container.append(el('p', 'No ' + statsMode + ' statistics available yet.'));
  }
  let debugGeneration = 0;
  function debugScreen() {
    const generation = debugGeneration, uuid = bridge.uuid();
    let cursor = 0, pageRequest = 0, recordRequest = 0, selected = null, rows = [], filters = [];
    const current = () => generation === debugGeneration && uuid === bridge.uuid() && activeScreen === 'debug' && enabled;
    const controls = el('div', undefined, 'advanced-actions advanced-debug-controls');
    const category = el('select'); category.setAttribute('aria-label', 'Debug category');
    const initial = el('option', 'All events'); initial.value = 'all'; category.append(initial);
    const refresh = button('Refresh', () => load(true));
    const more = button('Load more', () => load(false)); more.hidden = true;
    const notice = el('p', '', 'advanced-screen-description'); notice.setAttribute('role', 'status');
    const frame = el('div', undefined, 'advanced-debug-table');
    const table = el('table'); table.setAttribute('aria-label', 'Chronological debug events');
    const head = el('thead'), headings = el('tr'), body = el('tbody');
    ['Sequence', 'Kind', 'Summary', 'Timestamp', 'Category'].forEach((label, index) => {
      const cell = el('th', label, index > 2 ? 'advanced-debug-secondary' : undefined);
      cell.setAttribute('scope', 'col'); headings.append(cell);
    });
    head.append(headings); table.append(head, body); frame.append(table);
    const details = el('section', undefined, 'advanced-debug-details');
    details.setAttribute('aria-label', 'Selected debug record');
    const detailStatus = el('p', 'Select an event to inspect.'); detailStatus.setAttribute('role', 'status');
    const content = el('div'); details.append(el('h4', 'Record details'), detailStatus, content);
    controls.append(el('label', 'Category ')); controls.lastChild.append(category);
    controls.append(refresh);
    screen.append(controls, notice, frame, more, details);
    function markSelection() {
      rows.forEach(row => {
        const chosen = row.item.sequence === selected;
        row.node.classList.toggle('is-selected', chosen);
        row.control.setAttribute('aria-pressed', String(chosen));
      });
    }
    async function select(item) {
      if (!current()) return;
      selected = item.sequence; const request = ++recordRequest;
      markSelection(); content.replaceChildren();
      detailStatus.textContent = `Loading record #${selected}…`;
      details.setAttribute('aria-busy', 'true');
      try {
        const record = await api({action: 'trace', sequence: selected});
        if (!current() || request !== recordRequest) return;
        if (!record || record.sequence !== item.sequence || !Object.prototype.hasOwnProperty.call(record, 'payload')) {
          detailStatus.textContent = 'This record is no longer available. Refresh the trace.';
          return;
        }
        detailStatus.textContent = `#${record.sequence} ${record.kind}`;
        content.replaceChildren(structuredMap(record));
      } catch (error) {
        if (current() && request === recordRequest) detailStatus.textContent = 'Unable to load record: ' + (error.message || String(error)) + '. Select it again to retry.';
      } finally {
        if (current() && request === recordRequest) details.setAttribute('aria-busy', 'false');
      }
    }
    async function load(reset) {
      if (!current()) return;
      const request = ++pageRequest, key = category.value;
      if (reset) {
        cursor = 0; selected = null; rows = []; recordRequest++;
        body.replaceChildren(); content.replaceChildren(); more.hidden = true;
        details.setAttribute('aria-busy', 'false'); detailStatus.textContent = 'Select an event to inspect.';
      }
      refresh.disabled = more.disabled = true; notice.textContent = 'Loading debug events…';
      table.setAttribute('aria-busy', 'true');
      try {
        const result = await api({action: 'trace', after: cursor, category: key});
        if (!current() || request !== pageRequest) return;
        if (result.filters) {
          filters = result.filters;
          category.replaceChildren(...filters.map(filter => { const option = el('option', filter.label); option.value = filter.category; return option; }));
          category.value = key;
        }
        for (const item of result.events || []) {
          const row = el('tr'), control = button('#' + item.sequence, () => select(item));
          control.setAttribute('aria-label', `Inspect #${item.sequence} ${item.kind} — ${activityText(item.summary) || item.kind}`);
          const sequence = el('td'); sequence.append(control);
          row.append(sequence, el('td', item.kind), el('td', activityText(item.summary) || item.kind),
            el('td', item.timestamp, 'advanced-debug-secondary'), el('td', filters.find(filter => filter.category === item.category)?.label || item.category, 'advanced-debug-secondary'));
          row.addEventListener('click', event => { if (!control.contains(event.target)) select(item); });
          rows.push({item, node: row, control}); body.append(row); cursor = item.sequence;
        }
        more.hidden = !result.hasMore;
        notice.textContent = rows.length ? `${rows.length} events loaded in chronological order.` : result.total ? 'No events in this category.' : 'No debug trace events are available. Run a goal with debugtrace=true to collect a trace.';
        if (selected === null && rows.length) select(rows[0].item);
        else markSelection();
        if (!rows.length) detailStatus.textContent = 'No record selected.';
      } catch (error) {
        if (current() && request === pageRequest) notice.textContent = 'Unable to load debug events: ' + (error.message || String(error)) + '. ' + (reset ? 'Use Refresh to retry.' : 'Use Load more to retry.');
      } finally {
        if (current() && request === pageRequest) { refresh.disabled = more.disabled = false; table.setAttribute('aria-busy', 'false'); }
      }
    }
    category.onchange = () => load(true);
    load(true);
  }
  function statisticsScreen() {
    const generation = statsGeneration, uuid = bridge.uuid();
    statsMetrics = null; statsDetails = null;
    const controls = el('div', undefined, 'advanced-actions'), content = el('div', undefined, 'advanced-statistics');
    const notice = el('p', 'Loading statistics…', 'advanced-screen-description'); notice.setAttribute('role', 'status');
    const modes = ['summary', 'detailed', 'tools', 'memory', 'wiki'];
    const modeButtons = modes.map(mode => {
      const control = button(labelMode(mode), () => { statsMode = mode; draw(); });
      controls.append(control); return control;
    });
    function labelMode(mode) { return mode[0].toUpperCase() + mode.slice(1); }
    function draw() { modeButtons.forEach((control, index) => control.setAttribute('aria-pressed', String(modes[index] === statsMode))); renderStats(content); }
    const refresh = button('Refresh', load); controls.append(refresh);
    async function load() {
      refresh.disabled = true;
      try {
        const result = await api({action: 'stats'});
        if (generation !== statsGeneration || uuid !== bridge.uuid()) return;
        statsMetrics = result.metrics; statsDetails = result.details;
        notice.textContent = 'Updated ' + new Date().toLocaleTimeString() + ' · Same metrics as /stats; some counters are shared across server sessions.';
        draw();
      } catch (error) { if (generation === statsGeneration) notice.textContent = error.message || String(error); }
      finally { refresh.disabled = false; }
    }
    screen.append(controls, notice, content); load();
  }
  document.addEventListener('chartjs:ready', () => { if (activeScreen === 'stats') renderScreen(); });
  new MutationObserver(() => {
    if (activeScreen === 'stats') {
      const content = screen.querySelector('.advanced-statistics');
      if (content) renderStats(content);
    }
  }).observe(document.body, {attributes: true, attributeFilter: ['class']});
  function renderScreen() {
    debugGeneration++;
    statsGeneration++; destroyStatsCharts();
    const selected = screens.find(([name]) => name === activeScreen) || screens[0];
    activeScreen = selected[0];
    screenTrigger.replaceChildren(tabIcon(activeScreen), el('span', selected[1]), tabIcon('chevronDown'));
    screenTrigger.title = selected[2]; screenTrigger.setAttribute('aria-label', 'Advanced view: ' + selected[1]);
    screenTrigger.setAttribute('aria-description', selected[2]);
    screenButtons.forEach(option => option.setAttribute('aria-pressed', String(option.dataset.screen === activeScreen)));
    activity.hidden = activeScreen !== 'activity'; screen.hidden = !activity.hidden;
    if (activeScreen === 'activity') { followActivity(); return; }
    screen.replaceChildren(el('h3', selected[1]), el('p', selected[2], 'advanced-screen-description'));
    if (!snapshot) return;
    if (activeScreen === 'settings' || activeScreen === 'models') {
      const search=input('Search settings'); screen.append(search);
      const list=el('div',undefined,'advanced-settings'); screen.append(list);
      const render=()=>{
        list.replaceChildren();
        snapshot.settings.filter(s=>(activeScreen!=='models'||['model','modellc','modelval'].includes(s.name)) && `${s.name} ${s.description}`.toLowerCase().includes(search.value.toLowerCase())).forEach(s=>{
          const row=el('div'); const label=el('label', s.name); const description=el('small',`${s.description || ''} · ${s.source === 'session' ? 'Session override' : 'Server default'} · Default: ${asText(s.defaultValue) ?? '(unset)'}${s.readOnly?' · Server-controlled':''}`);
          const field=input('',s.value === undefined ? '' : asText(s.value)); field.disabled=s.readOnly; field.setAttribute('aria-label',s.name);
          if (s.type==='boolean') {field.type='checkbox';field.checked=s.value===true;label.className='advanced-boolean-setting';}
          label.append(field); row.append(label,description);
          if (!s.readOnly && ['map', 'array'].includes(s.dataEditor)) window.MiniADataEditor.bind(field, {label: s.name, root: s.dataEditor});
          if (!s.readOnly) row.append(button('Apply',async()=>{await mutate({action:'settings',values:{[s.name]:s.type==='boolean'?field.checked:field.value}}); snapshot=await api({action:'snapshot',after});}));
          list.append(row);
        });
      }; search.oninput=render; render();
      const presets=el('div',undefined,'advanced-actions'); const name=input('Preset name'); const names=el('select'); snapshot.presets.forEach(p=>{const o=el('option',p);o.value=p;names.append(o);});
      presets.append(name,button('Save preset',()=>mutate({action:'preset',op:'save',name:name.value})),names);
      ['apply','default','delete'].forEach(op=>presets.append(button(op,()=>mutate({action:'preset',op,name:names.value})))); screen.append(presets);
    } else if (activeScreen==='debug') {
      debugScreen();
    } else if(activeScreen==='wiki') {
      actions([['List','/wiki list --meta'],['Tree','/wiki tree'],['Lint','/wiki lint'],['Statistics','/stats wiki']]);
      commandForm('Browse / read', (op,path)=>`/wiki ${op||'browse'} ${quote(path)}`,['Operation','Path']);
      commandForm('Search',q=>`/wiki search ${q}`,['Query']);
      commandForm('Write page',(path,content)=>`/wiki write ${quote(path)} ${content}`,['Path','Content']);
      commandForm('Move page',(from,to)=>`/wiki move ${quote(from)} ${quote(to)}`,['From','To']);
      commandForm('Maintenance',args=>`/wiki ${args}`,['Subcommand and arguments']);
    } else if(activeScreen==='graph') {
      actions([['Statistics','/graph stats'],['Build','/graph build']]);
      commandForm('Inspect graph',(op,path)=>`/graph ${op||'neighbors'} ${quote(path)}`,['Operation','Path']);
      commandForm('Find path',(from,to)=>`/graph path ${quote(from)} ${quote(to)}`,['From','To']);
      commandForm('Graph operation',args=>`/graph ${args}`,['Subcommand and arguments']);
    } else if(activeScreen==='ingest') {
      commandForm('Ingest source',(source,section,flags)=>`/ingest ${quote(source)} ${quote(section)} ${flags}`,['Source','Section','Options (dryrun / force)']);
      actions([['Recovery','/ingest recovery']]);commandForm('Recover',args=>`/ingest recovery ${args}`,['resume / discard and ID']);
    } else if(activeScreen==='absorb') {
      actions([['Status','/absorb status']]);commandForm('Create plan',spec=>`/absorb plan ${quote(spec)}`,[{name:'Spec file or inline JSON/SLON',dataEditor:'map'}]);
      commandForm('Manage plan',(op,id)=>`/absorb ${op} ${quote(id)}`,['show / apply / resume / delete / cancel','Plan ID']);
    } else if(activeScreen==='dream') {
      commandForm('Dream operation',op=>`/dream ${op}`,['memory / wiki / plan / apply / reorg / repair / reindex / graph / indexes']);
    } else if(activeScreen==='subtasks') {
      actions([['List subtasks','/subtasks']]); commandForm('Delegate',goal=>`/delegate ${goal}`,['Goal']);commandForm('Inspect / cancel',args=>`/subtask ${args}`,['ID / result ID / cancel ID']);
    } else if(activeScreen==='skills') {
      actions([['List skills','/skills'],['Help','/help']]); commandForm('Inspect skills',args=>`/skills ${args}`,['Filter or subcommand']);commandForm('Run skill or custom command',cmd=>cmd,['$skill or /command with arguments']);
    } else if(activeScreen==='history') {
      const notice=el('p','Loading saved conversations…','advanced-screen-description');
      notice.setAttribute('role','status');
      const saved=el('ul',undefined,'advanced-history-list');
      saved.setAttribute('aria-label','Saved conversations');
      screen.append(button('Refresh list',()=>renderScreen()),notice,saved);
      api({action:'sessions'}).then(data=>{
        const sessions=data.sessions||[];
        notice.textContent=sessions.length ? 'Select a conversation to open it.' : 'No saved conversations yet.';
        sessions.forEach(session=>{
          const current=session.uuid===bridge.uuid();
          const row=el('li');
          const open=button('',async()=>{
            if(busy)throw new Error('Finish the current operation first.');
            bridge.resume(session.uuid);snapshot=null;after=0;dialogId=null;events.replaceChildren();
            filter.value='';filter.oninput();
            activeScreen='activity';renderScreen();
            bridge.refresh();await poll();
          });
          open.className='advanced-history-open';
          open.title='Open conversation '+session.uuid;
          if(current)open.setAttribute('aria-current','true');
          open.append(el('span','Conversation '+session.uuid.slice(0,8),'advanced-history-title'),
            el('time',new Date(session.updated).toLocaleString(),'advanced-history-date'));
          if(current)open.append(el('span','Current','advanced-history-current'));
          row.append(open);saved.append(row);
        });
      }).catch(error=>{notice.textContent='Could not load saved conversations. Use Refresh list to try again.';showError(error);});
      actions([['History','/history'],['Previous answer','/last'],['Restore','/restore'],['Clear','/clear']]);commandForm('Rewind',count=>`/rewind ${count}`,['Exchanges']);commandForm('Save answer',file=>`/save ${quote(file)}`,['Server path']);
    } else if(activeScreen==='context') {
      actions([['Summary','/context'],['Analyze','/context analyze'],['Virtual memory','/context vm']]);commandForm('Compact / summarize',(op,keep)=>`/${op} ${keep}`,['compact / summarize','Messages to keep']);
    } else if(activeScreen==='stats') { statisticsScreen(); return; }
    screen.append(el('p','Command output appears in Live activity.'));
  }
  renderScreen();
  const composer=document.querySelector('#promptInput');
  composer.addEventListener('input',()=>{
    suggestions.replaceChildren(); const value=composer.value; const head=/^\/(\w+)\s+(\S*)$/.exec(value);
    const pool = head && snapshot ? (snapshot.completions?.[head[1]] || []).map(c=>head[1]+' '+c) : (snapshot?.commands || []);
    const matches=enabled && snapshot && /^\/[\w -]*$/.test(value) ? pool.filter(c=>c.startsWith(value.slice(1))).slice(0,12):[];
    suggestions.hidden=!matches.length; matches.forEach(c=>suggestions.append(button('/'+c,()=>{composer.value='/'+c+' ';suggestions.hidden=true;composer.focus();})));
  });
  composer.addEventListener('keydown',e=>{
    if(!enabled)return;
    if(e.key==='Tab'&&!suggestions.hidden&&suggestions.firstChild){e.preventDefault();suggestions.firstChild.click();}
    if(e.key==='ArrowUp'&&!composer.value.includes('\n')&&history.length){e.preventDefault();composer.value=history[Math.max(0,--historyIndex)]||'';}
    if(e.key==='ArrowDown'&&!composer.value.includes('\n')&&history.length){e.preventDefault();composer.value=history[Math.min(history.length,++historyIndex)]||'';}
    if(e.key==='Escape'){ suggestions.hidden=true; if(busy)api({action:'stop'}).catch(showError); }
  });
  setInterval(()=>poll().catch(showError),1000);
  if(sessionStorage.getItem(storeKey))setEnabled(true);
  return { enabled:()=>enabled, stop:()=>api({action:'stop'}), submit:async value=>{
    const requestId=bridge.newRequestId();
    history.push(value);historyIndex=history.length;
    const result=await api({action:'command',command:value,requestId});
    if(result.busy){throw new Error('Conversation is busy');}
    composer.value=''; suggestions.hidden=true; await poll();
  }};
};
