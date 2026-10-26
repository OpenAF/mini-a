/* Advanced presentation adapter. Commands and screen actions share the server console dispatcher. */
window.MiniAAdvancedUI = function(bridge) {
  const storeKey = 'mini-a-advanced-session';
  let enabled = false, after = 0, snapshot = null, polling = false, dialogId = null, busy = false;
  let history = [], historyIndex = 0, activeScreen = 'activity';
  let viewParams = {}, resultGeneration = 0, resultRefresh = null, submittedView = null, liveFloor = 0, liveClearRun = null;
  const previousSelections = {};
  const promptFields = [
    ['youare', 'Agent persona', 'Define the agent role and opening instruction.'],
    ['chatyouare', 'Chatbot persona', 'Define the role used when chatbot mode is enabled.'],
    ['rules', 'Rules / instructions', 'Behaviour, constraints, style, and response requirements. Plain text, bullets, or a JSON/SLON array.'],
    ['knowledge', 'Knowledge / context', 'Background information, domain facts, examples, and reference material.'],
    ['goalprefix', 'Goal prefix', 'Reusable wording prepended to every submitted goal.']
  ];
  const promptDrafts = {};
  const workflowDrafts = {};
  const promptExpanded = {};
  let draftDialog = null;
  let promptPending = null, promptRefresh = null, promptPopup = null, settingsRefresh = null;
  let promptFeedback = '';
  let subtaskRefresh = null, subtaskTick = 0;
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
  const storageChoiceKey = 'mini-a-advanced-storage';
  const browserPresetsKey = 'mini-a-advanced-presets';
  let storageMode = 'current';
  try { if (localStorage.getItem(storageChoiceKey) === 'browser') storageMode = 'browser'; } catch (_) {}
  function browserPresets() {
    const raw = localStorage.getItem(browserPresetsKey);
    if (!raw) return {presets:{}};
    const library = JSON.parse(raw);
    if (!library || !library.presets || typeof library.presets !== 'object' || Array.isArray(library.presets)) throw new Error('Browser presets are invalid. Restore or remove the saved browser preset data.');
    return library;
  }
  function usePresetLibrary(data) {
    if (storageMode === 'browser') {
      const library = browserPresets();
      data.presets = Object.keys(library.presets); data.defaultPreset = library.defaultPreset;
    }
    return data;
  }
  async function presetRequest(data) {
    if (storageMode !== 'browser' || data.action !== 'preset') return api(data);
    if (!/^[a-zA-Z0-9 _-]{1,80}$/.test(data.name || '')) throw new Error('Invalid preset name');
    const library = browserPresets();
    if (data.op === 'apply') {
      if (!Object.prototype.hasOwnProperty.call(library.presets, data.name)) throw new Error('Preset not found');
      return api({...data,values:library.presets[data.name]});
    }
    if (data.op === 'save') Object.defineProperty(library.presets, data.name, {value:(await api({action:'preset-export'})).values,enumerable:true,writable:true,configurable:true});
    else if (data.op === 'default') {
      if (!Object.prototype.hasOwnProperty.call(library.presets, data.name)) throw new Error('Preset not found');
      library.defaultPreset = data.name;
    } else if (data.op === 'delete') {
      delete library.presets[data.name]; if (library.defaultPreset === data.name) delete library.defaultPreset;
    } else throw new Error('Unknown preset operation');
    localStorage.setItem(browserPresetsKey, JSON.stringify(library));
    if (snapshot) usePresetLibrary(snapshot);
    return {local:true};
  }
  const toolbar = el('div', undefined, 'advanced-toolbar');
  const toggle = button('Advanced', () => setEnabled(!enabled));
  toolbar.append(toggle);
  const storageToggle = button('', async () => {
    if (busy || promptPending) throw new Error('Finish the current operation before switching storage.');
    const next = storageMode === 'browser' ? 'current' : 'browser';
    if (next === 'browser') browserPresets();
    localStorage.setItem(storageChoiceKey, next);
    storageMode = next; updateStorageToggle();
    if (snapshot) { await poll(); renderScreen(); }
  });
  function updateStorageToggle() {
    storageToggle.textContent = storageMode === 'browser' ? '🌐 Browser storage' : '🗄️ Current storage';
    storageToggle.setAttribute('aria-label', 'Storage for presets and saved conversations');
    storageToggle.setAttribute('aria-pressed', String(storageMode === 'browser'));
    storageToggle.title = 'Switch storage for presets and saved conversations. Selection is remembered in this browser. Active agent state remains on the server.';
  }
  updateStorageToggle();
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
  let splitSize = 45, drag = null, dockPreference = null, dockButtons = [], dockTrigger = null, paneFocused = false;
  try { const saved = localStorage.getItem('mini-a-advanced-dock'); if (['right','bottom','top','left'].includes(saved)) dockPreference = saved; } catch (_) {}
  function dockPosition() { return dockPreference || (stacked.matches ? 'bottom' : 'right'); }
  function horizontalDivider() { return ['top','bottom'].includes(dockPosition()); }
  function setDock(position) {
    finishDrag(); dockPreference = position;
    try { localStorage.setItem('mini-a-advanced-dock', position); } catch (_) {}
    applySplit();
  }
  function setPaneFocused(value) {
    finishDrag(); paneFocused = value;
    document.body.classList.toggle('advanced-pane-focused', value);
    split.hidden = !enabled || value;
    focusControl.textContent = value ? 'Restore split' : 'Focus pane';
    focusControl.setAttribute('aria-pressed', String(value));
    applySplit(splitSize, false);
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
  const screen = el('section', undefined, 'advanced-screen'); screen.tabIndex = -1;
  const activity = el('section', undefined, 'advanced-activity');
  const filter = input('Filter live activity'); filter.setAttribute('aria-label', 'Filter activity');
  const events = el('div', undefined, 'advanced-events'); events.setAttribute('role', 'log');
  const activityHeader = el('div', undefined, 'advanced-activity-header');
  const followLabel = el('label', 'Auto-follow ');
  const follow = el('input'); follow.type = 'checkbox'; follow.checked = true;
  follow.setAttribute('aria-label', 'Auto-follow live activity'); followLabel.append(follow);
  activityHeader.append(el('h3', 'Live activity'), followLabel);
  const eventTypeFilter = el('select'); eventTypeFilter.setAttribute('aria-label', 'Activity event type');
  const allEvents = el('option', 'All event types'); allEvents.value = ''; eventTypeFilter.append(allEvents);
  const activityFilters = el('div', undefined, 'advanced-activity-filters'); activityFilters.append(filter, eventTypeFilter);
  let unseenEvents = 0;
  const newEvents = button('', () => { follow.checked = true; followActivity(); follow.focus(); }); newEvents.hidden = true;
  newEvents.className = 'advanced-new-events';
  newEvents.title = 'Events received while auto-follow was paused, including events hidden by filters. Resume at the latest matching event.';
  activity.append(activityHeader, activityFilters, newEvents, events);
  function updateNewEvents() {
    newEvents.textContent = unseenEvents + ' new event' + (unseenEvents === 1 ? '' : 's') + ' · Resume';
    newEvents.hidden = !unseenEvents || follow.checked;
  }
  function resetActivity() {
    events.replaceChildren(); unseenEvents = 0;
    eventTypeFilter.replaceChildren(allEvents); eventTypeFilter.value = '';
    updateNewEvents();
  }
  function eventMatches(node) {
    return (!eventTypeFilter.value || node.dataset.type === eventTypeFilter.value) && node.textContent.toLowerCase().includes(filter.value.toLowerCase());
  }
  function followActivity() {
    if (follow.checked) {
      unseenEvents = 0; updateNewEvents();
      requestAnimationFrame(() => { if (follow.checked) events.scrollTop = events.scrollHeight; });
    }
  }
  follow.onchange = followActivity;
  applySplit();
  filter.oninput = eventTypeFilter.onchange = () => { [...events.children].forEach(n => n.hidden = !eventMatches(n)); followActivity(); };
  shell.append(paneHeader, nav, screen, activity); document.body.append(shell);
  const suggestions = el('div', undefined, 'advanced-completions'); suggestions.hidden = true;
  suggestions.setAttribute('role', 'listbox'); toolbar.after(suggestions);
  const dialog = el('dialog', undefined, 'advanced-dialog'); dialog.setAttribute('aria-label', 'Console interaction'); document.body.append(dialog);
  dialog.addEventListener('cancel', e => { e.preventDefault(); api({action:'stop'}).catch(showError); dialog.close(); });
  const screens = [
    ['help', 'Help', 'Search command syntax, prerequisites, aliases and custom commands. Insert a command to edit it before running.'],
    ['answer', 'Answer', 'Read the previous answer, copy it or download it to your browser.'],
    ['activity', 'Live activity', 'Follow agent actions, tool calls, progress, and results in real time.'],
    ['settings', 'Settings', 'Adjust parameters for this session and manage saved presets.'],
    ['prompts', 'Prompt workspace', 'Edit personas, instructions, knowledge, and the goal prefix for this session.'],
    ['decide', 'Decisions', 'Ask the configured decision model using shared evidence and typed questions.'],
    ['models', 'Models', 'Choose and configure the main, low-cost, validation, and decision models.'],
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
    help: 'M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 4M12 18v1M3 3h18v18H3Z',
    answer: 'M5 3h14v18H5ZM8 7h8m-8 4h8m-8 4h6',
    editor: 'm4 16 12-12 4 4-12 12H4ZM13 7l4 4',
    chevronDown: 'm8 10 4 4 4-4',
    dockright: 'M3 4h18v16H3ZM15 4v16',
    dockbottom: 'M3 4h18v16H3ZM3 14h18',
    docktop: 'M3 4h18v16H3ZM3 10h18',
    dockleft: 'M3 4h18v16H3ZM9 4v16',
    activity: 'M3 12h4l3-7 4 14 3-7h4',
    settings: 'M4 7h7m4 0h5M4 17h3m4 0h9M11 4v6M7 14v6',
    prompts: 'M5 3h14v18H5ZM8 7h8m-8 4h8m-8 4h6',
    apply: 'm5 12 4 4L19 6',
    discard: 'm6 6 12 12M18 6 6 18',
    newconversation: 'M4 4h16v12H9l-5 4V4ZM8 10h8m-4-4v8',
    reset: 'M3 5v5h5M3 10a9 9 0 1 1 1 7',
    save: 'M4 3h13l3 3v15H4V3ZM8 3v6h8V3M8 21v-8h8v8',
    load: 'M12 3v12m-4-4 4 4 4-4M4 15v6h16v-6',
    decide: 'M9 3h6v6H9ZM3 15h6v6H3Zm12 0h6v6h-6ZM12 9v3m-6 0h12M6 12v3m12-3v3',
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
    const option = button(label, () => { closeScreenOptions(true); activeScreen = name; viewParams = {}; renderScreen(); });
    option.prepend(tabIcon(name)); option.title = description;
    option.setAttribute('aria-description', description); option.dataset.screen = name;
    screenOptions.append(option); return option;
  });
  screenPicker.append(screenTrigger, screenOptions); nav.append(screenPicker, storageToggle);
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
  const focusControl = button('Focus pane', () => setPaneFocused(!paneFocused));
  focusControl.setAttribute('aria-pressed', 'false'); focusControl.title = 'Expand the Advanced pane. Restore split returns to the previous size and position.';
  paneHeader.append(focusControl);
  const controls = el('div', undefined, 'advanced-session-actions');
  function sessionAction(label, icon, action) {
    const control = button('', action);
    control.title = label; control.setAttribute('aria-label', label);
    // Match the Stop and Clear icons in the Simple view.
    control.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' + icon + '</svg>';
    return control;
  }
  async function newConversation() {
    if (busy) throw new Error('Stop or finish the current operation before starting a new conversation.');
    if (!await resolvePendingChanges()) return;
    await bridge.newConversation(); resetSessionView();
    activeScreen = 'activity'; renderScreen();
    sessionStorage.removeItem(storeKey); await poll();
    if (storageMode === 'browser') {
      const library = browserPresets();
      if (library.defaultPreset) await submitPromptSettings({action:'preset',op:'apply',name:library.defaultPreset});
    }
  }
  controls.append(sessionAction('Stop', '<rect x="5" y="5" width="14" height="14" rx="2"></rect>', () => api({action:'stop'})), sessionAction('New conversation', '<path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />', newConversation));
  paneHeader.append(controls);
  async function api(data) {
    const uuid = bridge.uuid();
    if (enabled) sessionStorage.setItem(storeKey, uuid);
    const response = await fetch(bridge.url('advanced'), {method:'POST',headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({uuid,...data})});
    if (!response.ok) throw new Error(`Advanced request failed (${response.status})`);
    const result = await response.json(); if (result.error) throw new Error(result.error); return result;
  }
  function showError(error) { status.textContent = String(error.message || error); paneStatus.textContent = 'Error'; paneStatus.dataset.state = 'error'; }
  function resetSessionView() {
    if (dialog.open) dialog.close();
    if (promptPopup) promptPopup.close();
    if (draftDialog) draftDialog.close();
    Object.keys(promptDrafts).forEach(key => delete promptDrafts[key]);
    Object.keys(workflowDrafts).forEach(key => delete workflowDrafts[key]);
    promptPending = promptRefresh = settingsRefresh = null;
    promptFeedback = '';
    after = 0; snapshot = null; dialogId = null; liveFloor = 0; liveClearRun = null; submittedView = null; viewParams = {};
    Object.keys(previousSelections).forEach(key => delete previousSelections[key]);
    resultGeneration++; resultRefresh = subtaskRefresh = null; resetActivity();
  }
  async function mutate(data) {
    const uuid = bridge.uuid(), requestId = bridge.newRequestId();
    const result = await api({...data,requestId});
    if (uuid !== bridge.uuid()) return;
    if (result.busy) throw new Error('This conversation is busy. Stop or finish the current operation first.');
    if (data.action === 'command') {
      const destination = result.view || {name:'activity',params:{}};
      activeScreen = destination.name === 'editor' ? 'activity' : destination.name; viewParams = destination.params || {};
      submittedView = {requestId, name: activeScreen};
      delete previousSelections[activeScreen];
      if (viewParams.command === 'cls') { liveFloor = after; resetActivity(); }
      if (activeScreen === 'stats') statsMode = viewParams.mode || 'summary';
      filter.value = ''; filter.oninput(); renderScreen(requestId);
      if (activeScreen !== 'activity') screen.focus({preventScroll:true});
    }
    busy = true; await poll();
  }
  async function command(value, attachments) {
    if (/^\/(?:clear|reset|restore|rewind|exit|quit)(?:\s|$)/.test(value) && !await resolvePendingChanges()) return false;
    history.push(value); historyIndex = history.length;
    await mutate({action:'command',command:value,attachments});
  }
  function setEnabled(value) {
    debugGeneration++;
    enabled = value; shell.hidden = !value; split.hidden = !value || paneFocused;
    if (!value) setPaneFocused(false);
    document.body.classList.toggle('mini-a-advanced', value);
    toggle.textContent = value ? 'Simple' : 'Advanced';
    if (value) { const uuid = sessionStorage.getItem(storeKey); if (uuid && !snapshot) bridge.resume(uuid); if (activeScreen === 'debug') renderScreen(); poll().catch(showError); }
  }
  // Keep agent event emojis aligned with MiniA.fnI's console mapping.
  const activityEventEmojis = {
    user: '👤', exec: '⚙️', shell: '🖥️', think: '💡', final: '🏁',
    input: '➡️', output: '⬅️', thought: '💭', size: '📏', rate: '⏳',
    mcp: '🤖', plan: '🗺️', deepresearch: '🔍', done: '✅', error: '❌',
    libs: '📚', info: 'ℹ️', skill: '🧩', load: '📂', warn: '⚠️',
    stop: '🛑', summarize: '🌀', progcall: '📟', subagent: '🤝',
    compress: '🗜️', planner_stream: '💡'
  };
  function appendEvent(record, navigate = true) {
    if (record.type === 'view') {
      // Navigation happens once, from the submission receipt. Replays never move focus.
      if (record.value === 'clear') { liveFloor = record.sequence; liveClearRun = record.runId; resetActivity(); }
      return;
    }
    if (record.sequence <= liveFloor || (liveClearRun && record.runId === liveClearRun)) return;
    const details = el('details'); details.dataset.sequence = record.sequence; details.dataset.runId = record.runId || '';
    const summary = el('summary');
    const eventType = el('span', undefined, 'advanced-event-type');
    if (Object.prototype.hasOwnProperty.call(activityEventEmojis, record.type)) {
      const emoji = el('span', activityEventEmojis[record.type]);
      emoji.setAttribute('aria-hidden', 'true');
      eventType.append(emoji, document.createTextNode(' '));
    }
    eventType.append(document.createTextNode(record.type));
    summary.append(el('time', record.timestamp.slice(11,19), 'advanced-event-time'), eventType, el('span', activityText(record.value)?.replace(/\s+/g,' ').slice(0,150) || '', 'advanced-event-text'));
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
    if (![...eventTypeFilter.children].some(option => option.value === record.type)) {
      const option = el('option', record.type); option.value = record.type; eventTypeFilter.append(option);
    }
    details.hidden = !eventMatches(details);
    if (!follow.checked && navigate) { unseenEvents++; updateNewEvents(); }
    while (events.childElementCount > 1000) events.firstChild.remove();
  }
  async function poll() {
    // Sessions already attached to Advanced can still ask after switching panes.
    if ((!enabled && !snapshot) || polling) return;
    polling = true;
    try {
      const current = bridge.uuid();
      if (snapshot && current !== snapshot.uuid) resetSessionView();
      const data = await api({action:'snapshot',after});
      if (current !== bridge.uuid()) return;
      const first = !snapshot; usePresetLibrary(data); snapshot = data; busy = data.busy; bridge.trackRun(data);
      syncPromptDrafts(data);
      if (data.busy && data.operationView) submittedView = {requestId:data.operation,name:data.operationView.name};
      paneStatus.dataset.state = data.closed ? 'closed' : busy ? 'working' : 'ready';
      status.textContent = paneStatus.textContent = data.closed ? 'Session ended' : data.pending ? 'Waiting for your input' : busy ? 'Working' : 'Ready';
      for (const record of data.events) { if (record.sequence > after) { appendEvent(record, !first); after = record.sequence; } }
      if (data.events.length) followActivity();
      if (first || (['settings','models'].includes(activeScreen) && !screen.contains(document.activeElement) && data.events.some(e => e.type === 'complete' && (['settings','preset'].includes(e.value?.action) || e.value?.settingsChanged)))) renderScreen();
      if (promptRefresh) promptRefresh();
      if (settingsRefresh) settingsRefresh();
      if (first || data.events.some(e => ['history-clear','history-replace'].includes(e.type))) bridge.refresh();
      if (resultRefresh && data.events.some(e => ['command-result','complete','result-part','output','error','interaction'].includes(e.type))) resultRefresh();
      if (activeScreen === 'subtasks' && subtaskRefresh && Date.now() - subtaskTick > 3000) { subtaskTick = Date.now(); subtaskRefresh(); }
      if (data.pending && data.pending.id !== dialogId) showDialog(data.pending);
      if (!data.pending && dialog.open) dialog.close();
      if (busy || data.events.some(e => e.type === 'answer')) bridge.refresh();
    } finally { polling = false; }
  }
  function showDialog(pending) {
    dialogId = pending.id; dialog.replaceChildren(el('h3', pending.label));
    const dialogSession = bridge.uuid();
    const reply = async answer => {
      const session = dialogSession;
      if (session !== bridge.uuid() || dialogId !== pending.id) return;
      try {
        await api({action:'reply',id:pending.id,answer});
        if (session === bridge.uuid() && dialogId === pending.id) dialog.close();
      } catch (error) {
        if (session === bridge.uuid() && dialogId === pending.id) {
          let message = dialog.querySelector('.advanced-input-error');
          if (!message) { message = el('p', undefined, 'advanced-input-error'); message.setAttribute('role', 'alert'); dialog.append(message); }
          message.textContent = error.message || String(error);
        }
      }
    };
    if (pending.type === 'input') {
      const form = el('form', undefined, 'advanced-input-form');
      const readers = pending.choices.map((field, fieldIndex) => {
        const group = el('fieldset');
        const prompt = el('div', undefined, 'advanced-input-prompt');
        prompt.id = 'advanced-input-prompt-' + fieldIndex;
        prompt.append(markdown(field.label)); group.append(prompt);
        group.setAttribute('aria-labelledby', prompt.id);
        if (field.help) group.append(markdown(field.help));
        let read;
        if (['choose','char','multiple'].includes(field.type)) {
          const choices = el('div', undefined, 'advanced-input-choices');
          if (Number.isFinite(field.max) && field.max > 0) choices.style.maxHeight = Math.min(field.max, 12) * 3.5 + 'em';
          const controls = field.choices.map((choice, index) => {
            const row = el('label');
            const control = el('input'); control.type = field.type === 'multiple' ? 'checkbox' : 'radio';
            control.name = 'input-' + fieldIndex; control.value = String(index);
            const text = el('div', asText(choice));
            if (field.descriptions?.[index]) {
              const description = el('div', undefined, 'advanced-input-description');
              description.append(markdown(field.descriptions[index])); text.append(description);
            }
            row.append(control, text); choices.append(row); return control;
          });
          group.append(choices);
          read = () => {
            const indexes = controls.flatMap((control, index) => control.checked ? [index] : []);
            if (field.type !== 'multiple' && !indexes.length) throw Error('Choose an option for ' + field.label);
            return field.type === 'multiple' ? indexes : indexes[0];
          };
        } else {
          const control = el(field.type === 'password' ? 'input' : 'textarea');
          if (field.type === 'password') { control.type = 'password'; control.autocomplete = 'off'; }
          control.setAttribute('aria-labelledby', prompt.id); group.append(control);
          read = () => control.value || '';
        }
        form.append(group); return read;
      });
      const error = el('p', undefined, 'advanced-input-error'); error.setAttribute('role', 'alert');
      const submit = button('Continue', () => form.requestSubmit()); submit.type = 'button';
      form.onsubmit = async event => {
        event.preventDefault();
        try { const answers = readers.map(read => read()); error.textContent = ''; submit.disabled = true; await reply(answers); }
        catch (failure) { error.textContent = failure.message || String(failure); }
        finally { submit.disabled = false; }
      };
      form.append(error, submit); dialog.append(form);
    } else if (pending.type === 'choice') pending.choices.forEach((choice,index) => dialog.append(button(asText(choice), () => reply(index))));
    else {
      const field = el('textarea'); field.value = pending.value || ''; field.setAttribute('aria-label', pending.label);
      const preview = el('div');
      dialog.append(field, button(pending.type === 'editor' ? 'Submit goal' : pending.type === 'wiki-editor' ? 'Write page' : 'Continue', () => reply(field.value)));
      if (pending.type === 'wiki-editor') dialog.append(button('Preview', () => { preview.replaceChildren(markdown(field.value)); }), preview);
      if (!['editor','wiki-editor'].includes(pending.type)) window.MiniADataEditor.bind(field, {label: pending.label});
    }
    dialog.append(button('Cancel operation', async () => { if (dialogSession !== bridge.uuid() || dialogId !== pending.id) return; try { await api({action:'stop'}); dialog.close(); } catch(error) { showError(error); } }));
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('textarea,input,button')?.focus();
  }
  function promptText(value) { return value === undefined || value === null ? '' : asText(value); }
  function promptDirty(draft) { return draft.reset || draft.value !== draft.baseline; }
  function syncPromptDrafts(data) {
    const pending = promptPending;
    if (pending && pending.uuid === data.uuid) {
      const error = data.events.find(e => e.runId === pending.requestId && e.type === 'error');
      if (error) pending.failed = activityText(error.value) || 'The operation failed.';
      if (data.events.some(e => e.type === 'complete' && e.value?.requestId === pending.requestId)) {
        if (!pending.failed) Object.entries(pending.entries).forEach(([name, submitted]) => {
          const draft = promptDrafts[name];
          const setting = data.settings.find(s => s.name === name);
          if (draft && setting) {
            if (draft.value === submitted.value && draft.reset === submitted.reset) { draft.value = promptText(setting.value); draft.reset = false; }
            draft.baseline = promptText(setting.value); draft.conflict = false;
          }
        });
        const presetMessage = {save:'saved.',apply:'applied.',default:'set as default.',delete:'deleted.'};
        promptFeedback = pending.failed ? 'Changes could not be applied: ' + pending.failed : pending.action === 'preset' ? 'Preset ' + presetMessage[pending.op] : 'Changes applied. They take effect on the next goal.';
        promptPending = null;
      }
    }
    data.settings.forEach(setting => {
      const draft = promptDrafts[setting.name];
      if (!draft) return;
      const dirty = promptDirty(draft), value = promptText(setting.value);
      if (!dirty) draft.value = value;
      if (dirty && draft.baseline !== value && !promptPending?.entries[setting.name]) draft.conflict = true;
      if (!dirty) { draft.baseline = value; draft.conflict = false; }
    });
  }
  async function submitPromptSettings(data, entries = {}) {
    if (busy || promptPending) throw new Error('Stop or finish the current operation before applying prompt settings.');
    const pending = {uuid:bridge.uuid(), requestId:bridge.newRequestId(), entries, action:data.action, op:data.op};
    promptPending = pending; promptFeedback = ''; if (promptRefresh) promptRefresh(); if (settingsRefresh) settingsRefresh();
    try {
      const receipt = await presetRequest({...data,requestId:pending.requestId});
      if (receipt.local) {
        promptPending = null; promptFeedback = 'Preset ' + ({save:'saved.',default:'set as default.',delete:'deleted.'}[data.op]);
        return;
      }
      if (pending.uuid !== bridge.uuid()) return;
      if (receipt.busy) throw new Error('This conversation is busy. Stop or finish the current operation first.');
      busy = true; await poll();
    } catch (error) {
      if (promptPending === pending) promptPending = null;
      if (pending.uuid === bridge.uuid()) promptFeedback = 'Changes could not be applied: ' + (error.message || String(error));
      throw error;
    } finally { if (promptRefresh) promptRefresh(); if (settingsRefresh) settingsRefresh(); }
  }
  function draftFor(setting) {
    return promptDrafts[setting.name] || (promptDrafts[setting.name] = {value:promptText(setting.value),baseline:promptText(setting.value),reset:false,conflict:false});
  }
  function dirtyNames() { return Object.keys(promptDrafts).filter(name => promptDirty(promptDrafts[name])); }
  function refreshDraftViews() { if (promptRefresh) promptRefresh(); if (settingsRefresh) settingsRefresh(); }
  function discardDrafts() {
    dirtyNames().forEach(name => {
      const draft = promptDrafts[name];
      draft.value = promptText(snapshot.settings.find(s => s.name === name)?.value);
      draft.baseline = draft.value; draft.reset = false; draft.conflict = false;
    });
    refreshDraftViews();
  }
  function applyDrafts() {
    const values = {}, reset = [], entries = {};
    dirtyNames().forEach(name => {
      const draft = promptDrafts[name], setting = snapshot.settings.find(s => s.name === name);
      if (!setting || setting.readOnly) return;
      if (draft.conflict) throw new Error('Review changed server values before applying your draft.');
      entries[name] = {...draft};
      if (draft.reset) reset.push(name);
      else values[name] = setting.type === 'boolean' ? draft.value === 'true' : draft.value;
    });
    return submitPromptSettings({action:'settings',values,reset}, entries);
  }
  function reviewDrafts() {
    const popup = el('dialog', undefined, 'advanced-dialog advanced-draft-review');
    popup.setAttribute('aria-label', 'Review pending changes');
    popup.append(el('h3', 'Pending session changes'), el('p', 'Settings and Prompt workspace apply together.'));
    dirtyNames().forEach(name => {
      const draft = promptDrafts[name], setting = snapshot.settings.find(s => s.name === name);
      const row = el('section'); row.append(el('h4', name));
      // Values are text nodes, including model JSON and user-authored prompt text.
      row.append(el('small', 'Current value'), el('pre', promptText(setting?.value) || '(unset)'));
      row.append(el('small', draft.reset ? 'Reset to inherited value' : 'Draft value'), el('pre', draft.value || '(unset)'));
      if (draft.conflict) row.append(el('p', 'The applied value changed while you were editing.', 'advanced-input-error'), button('Keep my draft', () => {
        draft.baseline = promptText(snapshot.settings.find(s => s.name === name)?.value); draft.conflict = false; popup.close(); refreshDraftViews(); reviewDrafts();
      }));
      popup.append(row);
    });
    popup.append(button('Close', () => popup.close()));
    const previous = document.activeElement;
    popup.addEventListener('close', () => { popup.remove(); if (draftDialog === popup) draftDialog = null; previous?.focus(); });
    draftDialog = popup; document.body.append(popup); popup.showModal();
  }
  function pendingBar() {
    const bar = el('div', undefined, 'advanced-pending-bar'), count = el('span'); count.setAttribute('role', 'status');
    const review = button('Review', reviewDrafts), apply = promptAction('Apply changes', 'apply', applyDrafts);
    const discard = promptAction('Discard edits', 'discard', discardDrafts);
    bar.append(count, review, apply, discard); screen.append(bar);
    return () => {
      const names = dirtyNames(), locked = busy || !!promptPending || !!snapshot.closed;
      count.textContent = names.length + ' pending · Settings + Prompt workspace';
      review.disabled = !names.length; apply.disabled = locked || !names.length || names.some(name => promptDrafts[name].conflict);
      discard.disabled = !!promptPending || !names.length;
    };
  }
  async function resolvePendingChanges() {
    if (promptPending) throw new Error('Wait for the pending changes to finish applying.');
    if (!dirtyNames().length) return true;
    if (draftDialog) return false;
    return new Promise(resolve => {
      const popup = el('dialog', undefined, 'advanced-dialog'); let proceed = false;
      const previous = document.activeElement;
      popup.setAttribute('aria-label', 'Resolve pending changes');
      popup.append(el('h3', 'You have pending session changes'), el('p', 'Review and apply them before switching, discard them, or stay in this conversation.'),
        button('Review changes', () => { popup.close(); setEnabled(true); activeScreen = 'prompts'; renderScreen(); reviewDrafts(); }),
        button('Discard and continue', () => { discardDrafts(); proceed = true; popup.close(); }), button('Cancel', () => popup.close()));
      popup.addEventListener('close', () => { popup.remove(); if (draftDialog === popup) draftDialog = null; previous?.focus(); resolve(proceed); });
      draftDialog = popup; document.body.append(popup); popup.showModal();
    });
  }
  function sessionPresets() {
    const panel = el('details', undefined, 'advanced-session-presets'); panel.append(el('summary', 'Session presets · ' + (storageMode === 'browser' ? 'Browser storage' : 'Server storage')));
    const controls = el('div', undefined, 'advanced-actions'), name = input('Preset name'), names = el('select');
    name.setAttribute('aria-label', 'Preset name'); names.setAttribute('aria-label', 'Saved preset');
    const buttons = [button('Save preset', () => submitPromptSettings({action:'preset',op:'save',name:name.value}))];
    controls.append(name, buttons[0], names);
    ['apply','default','delete'].forEach(op => { const control = button(({apply:'Apply preset',default:'Set default',delete:'Delete preset'})[op], () => submitPromptSettings({action:'preset',op,name:names.value})); buttons.push(control); controls.append(control); });
    panel.append(el('p', 'Presets contain all applied session settings. Apply or discard pending changes first.', 'advanced-prompt-help'), controls); screen.append(panel);
    let last = '';
    return () => {
      const serialized = JSON.stringify(snapshot.presets);
      if (serialized !== last) { const selected = names.value; names.replaceChildren(); snapshot.presets.forEach(p => { const option = el('option', p); option.value = p; names.append(option); }); if (snapshot.presets.includes(selected)) names.value = selected; last = serialized; }
      buttons.forEach((control, index) => { control.disabled = busy || !!promptPending || !!snapshot.closed || !!dirtyNames().length || (index > 0 && !snapshot.presets.length); });
    };
  }
  function updatePromptExpandIcon(control, expanded, label, field) {
    const action = (expanded ? 'Collapse ' : 'Expand ') + label + ' editor';
    control.title = action; control.setAttribute('aria-label', action);
    control.setAttribute('aria-expanded', String(expanded)); control.setAttribute('aria-controls', field.id);
    control.dataset.expanded = String(expanded);
    control.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' +
      (expanded ? 'M20 9h-5V4M4 15h5v5' : 'M15 4h5v5M9 20H4v-5') + '"/></svg>';
  }
  function expandPromptEditor(holder, field, label) {
    if (promptPopup) promptPopup.close();
    const parent = holder.parentElement, next = holder.nextSibling;
    const popup = el('dialog', undefined, 'advanced-dialog advanced-prompt-popup');
    popup.setAttribute('aria-label', label + ' editor');
    const trigger = holder.querySelector('[data-prompt-expand]');
    if (trigger) updatePromptExpandIcon(trigger, true, label, field);
    popup.append(el('h3', label), el('p', 'Edits stay in your draft. Apply changes in Prompt workspace.'), holder);
    popup.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); popup.close(); });
    popup.addEventListener('close', () => {
      parent.insertBefore(holder, next); popup.remove();
      if (promptPopup === popup) promptPopup = null;
      if (trigger) updatePromptExpandIcon(trigger, false, label, field);
      if (trigger && parent.isConnected) trigger.focus();
    });
    promptPopup = popup; document.body.append(popup); popup.showModal(); field.focus();
  }
  function promptAction(label, icon, action) {
    const control = button(label, action);
    control.className = 'advanced-prompt-action'; control.prepend(tabIcon(icon));
    return control;
  }
  function promptWorkspace() {
    const refreshers = [];
    const relatedNames = ['chatbotmode','promptprofile','systempromptbudget','noagentsmd','format'];
    const find = name => snapshot.settings.find(s => s.name === name);
    const locked = () => busy || !!promptPending || !!snapshot.closed;
    const refreshPresets = sessionPresets(), refreshPending = pendingBar();
    const feedback = el('p', undefined, 'advanced-prompt-help'); feedback.setAttribute('role', 'status');
    screen.append(el('p', 'Applied changes take effect on the next goal. Existing conversation history still influences answers.', 'advanced-prompt-help'), feedback);
    const list = el('div', undefined, 'advanced-prompt-fields'); screen.append(list);
    promptFields.forEach(([name, label, help]) => {
      const setting = find(name); if (!setting) return;
      const draft = draftFor(setting), row = el('details', undefined, 'advanced-prompt-card');
      row.open = promptExpanded[name] !== undefined ? promptExpanded[name] : name === 'youare';
      row.addEventListener('toggle', () => { promptExpanded[name] = row.open; });
      const summary = el('summary'), preview = el('span', undefined, 'advanced-prompt-preview');
      const title = el('span', label + ' (' + name + ')');
      const field = el('textarea'); field.value = draft.value; field.rows = 6; field.spellcheck = false;
      field.id = 'advanced-prompt-' + name; field.setAttribute('aria-label', label + ' (' + name + ')');
      const description = el('p', help + ' @file references remain references; this editor does not write to the referenced file.', 'advanced-prompt-help');
      description.id = field.id + '-help'; field.setAttribute('aria-describedby', description.id);
      const state = el('small'); state.setAttribute('role', 'status');
      const holder = el('div', undefined, 'advanced-prompt-entry'); holder.append(field);
      const actions = el('div', undefined, 'advanced-actions');
      const expand = button('', () => {
        if (expand.dataset.expanded === 'true' && promptPopup) promptPopup.close();
        else expandPromptEditor(holder, field, label);
      });
      expand.className = 'advanced-prompt-expand'; expand.dataset.promptExpand = name;
      updatePromptExpandIcon(expand, false, label, field); holder.append(expand);
      const reset = promptAction('Reset to inherited value', 'reset', () => { draft.value = promptText(find(name).inheritedValue); draft.reset = true; promptRefresh(); });
      actions.append(reset); summary.append(title, state, preview); row.append(summary, description, holder, actions); list.append(row);
      if (!setting.readOnly && setting.dataEditor === 'array') window.MiniADataEditor.bind(field, {label:name,root:'array'});
      field.addEventListener('input', () => { draft.value = field.value; draft.reset = false; promptRefresh(); });
      // Structured rules editing writes the source textarea through input/change events.
      field.addEventListener('change', () => { draft.value = field.value; draft.reset = false; promptRefresh(); });
      refreshers.push(() => {
        const current = find(name);
        preview.textContent = draft.value.replace(/\s+/g, ' ').slice(0, 100) || '(unset)';
        if (field.value !== draft.value) field.value = draft.value;
        field.disabled = !!current.readOnly || !!snapshot.closed;
        reset.disabled = locked() || current.readOnly;
        const inactive = name === 'chatyouare' && find('chatbotmode')?.value !== true;
        state.textContent = `${promptPending?.entries[name] ? 'Applying…' : draft.reset ? 'Draft reset' : promptDirty(draft) ? 'Draft' : 'Applied'}${draft.conflict ? ' · Conflict: review required' : ''} · ${current.source === 'session' ? 'Session override' : 'Inherited setting'}${inactive ? ' · Inactive: chatbot mode is off' : ''}${current.readOnly ? ' · Server-controlled' : ''}`;
      });
    });
    const related = el('details', undefined, 'advanced-prompt-related'); related.append(el('summary', 'Related settings'));
    relatedNames.forEach(name => {
      const setting = find(name); if (!setting) return;
      const draft = draftFor(setting), label = el('label', name), field = input('', draft.value);
      field.setAttribute('aria-label', name); field.title = setting.description || '';
      if (setting.type === 'boolean') { field.type = 'checkbox'; field.checked = draft.value === 'true'; }
      else if (setting.type === 'number') field.type = 'number';
      field.oninput = () => { draft.value = setting.type === 'boolean' ? String(field.checked) : field.value; draft.reset = false; promptRefresh(); };
      label.append(field); related.append(label);
      refreshers.push(() => { field.disabled = setting.readOnly || !!snapshot.closed; if (setting.type === 'boolean') field.checked = draft.value === 'true'; else if (field.value !== draft.value) field.value = draft.value; });
    });
    screen.append(related);
    promptRefresh = () => {
      refreshers.forEach(refresh => refresh()); refreshPending(); refreshPresets();
      feedback.textContent = promptPending ? 'Applying…' : promptFeedback;
      feedback.hidden = !feedback.textContent;
    };
    promptRefresh();
  }
  function settingCategory(name) {
    if (/^(model|llm|lc|advisor|emergencyreserve)/.test(name)) return 'Models';
    if (/^(mcp|shell|useshell|tool|usetool|useutils|utils|fileallow|policy|checkall|readwrite|browser|usebrowser|web|onport|worker)/.test(name)) return 'Tools & access';
    if (/^(wiki|usewiki|knowledge|memory|usememory|ingest|absorb|dream|skills|useskills|extraskills|rag|userag)/.test(name)) return 'Knowledge';
    if (/^(format|output|outfile|debug|audit|metrics|log|stream|verbose|color|markdown|show|answer)/.test(name)) return 'Output';
    return 'Execution';
  }
  function settingsWorkspace() {
    const refreshPresets = sessionPresets(), refreshPending = pendingBar();
    const search = input('Search categories, parameters, descriptions', viewParams.filter || ''); search.setAttribute('aria-label', 'Search settings');
    const category = el('select'), scope = el('select'); category.setAttribute('aria-label', 'Settings category'); scope.setAttribute('aria-label', 'Settings filter');
    ['All categories','Models','Tools & access','Knowledge','Execution','Output'].forEach(value => { const option = el('option', value); option.value = value; category.append(option); });
    ['All','Overrides','Pending changes'].forEach(value => { const option = el('option', value); option.value = value; scope.append(option); });
    if (activeScreen === 'models') category.value = 'Models';
    const filters = el('div', undefined, 'advanced-settings-filters'); filters.append(search, category, scope); screen.append(filters);
    const count = el('p', undefined, 'advanced-prompt-help'); count.setAttribute('role', 'status');
    const list = el('div', undefined, 'advanced-settings'); screen.append(count, list);
    const feedback = el('p', undefined, 'advanced-prompt-help'); feedback.setAttribute('role', 'status'); screen.append(feedback);
    let refreshers = [], commandFilter = viewParams.command, membership = '';
    const filterMembership = () => scope.value === 'Pending changes' ? dirtyNames().join('|') : scope.value === 'Overrides' ? snapshot.settings.filter(s => s.source === 'session').map(s => s.name).join('|') : '';
    function render() {
      membership = filterMembership();
      list.replaceChildren(); refreshers = [];
      const matches = snapshot.settings.filter(setting => {
        const group = settingCategory(setting.name), query = search.value.toLowerCase();
        if (activeScreen === 'models' && viewParams.slot && setting.name !== viewParams.slot) return false;
        if (category.value !== 'All categories' && category.value !== group) return false;
        if (scope.value === 'Overrides' && setting.source !== 'session') return false;
        if (scope.value === 'Pending changes' && !promptDirty(draftFor(setting))) return false;
        return commandFilter === 'show' ? setting.name.startsWith(query) : ['set','toggle','unset'].includes(commandFilter) ? setting.name === query : `${group} ${setting.name} ${setting.description}`.toLowerCase().includes(query);
      });
      count.textContent = matches.length ? matches.length + ' parameters' : 'No matching parameters.';
      ['Models','Tools & access','Knowledge','Execution','Output'].forEach(group => {
        const settings = matches.filter(setting => settingCategory(setting.name) === group); if (!settings.length) return;
        list.append(el('h4', group));
        settings.forEach(setting => {
          const draft = draftFor(setting), row = el('div', undefined, 'advanced-setting-row');
          const labelText = (setting.description || setting.name).split(/[.;]/)[0].slice(0, 90);
          const label = el('label', labelText);
          const exact = el('code', setting.name), state = el('small'), provenance = el('small');
          const field = input('', draft.value); field.setAttribute('aria-label', setting.name); field.id = 'advanced-setting-' + setting.name; label.htmlFor = field.id;
          if (setting.type === 'boolean') { field.type = 'checkbox'; field.checked = draft.value === 'true'; }
          else if (setting.type === 'number') field.type = 'number';
          const controls = el('div', undefined, 'advanced-setting-control'); controls.append(field);
          if (settingCategory(setting.name) === 'Models' && setting.dataEditor) {
            const details = el('details'); details.append(el('summary', 'Configuration'), controls); row.append(label, exact, details);
          } else row.append(label, exact, controls);
          if (!setting.readOnly && ['map','array'].includes(setting.dataEditor)) window.MiniADataEditor.bind(field, {label:setting.name,root:setting.dataEditor});
          const change = () => { draft.value = setting.type === 'boolean' ? String(field.checked) : field.value; draft.reset = false; refreshDraftViews(); };
          field.addEventListener('input', change); field.addEventListener('change', change);
          if ((setting.description || '').replace(/[.;]$/, '') !== labelText) row.append(el('small', setting.description || ''));
          row.append(provenance, state);
          if (!setting.readOnly) row.append(button('Reset to inherited value', () => { draft.value = promptText(snapshot.settings.find(s => s.name === setting.name).inheritedValue); draft.reset = true; refreshDraftViews(); }));
          list.append(row);
          refreshers.push(() => {
            const current = snapshot.settings.find(s => s.name === setting.name);
            field.disabled = current.readOnly || !!snapshot.closed;
            if (setting.type === 'boolean') field.checked = draft.value === 'true'; else field.value = draft.value;
            provenance.textContent = `${current.source === 'session' ? 'Session override' : current.source === 'server' ? 'Server default' : current.source} · Default: ${promptText(current.defaultValue) || '(unset)'}${current.readOnly ? ' · Server-controlled' : ''}`;
            state.textContent = draft.conflict ? 'Conflict · Review required' : promptPending?.entries[setting.name] ? 'Applying…' : draft.reset ? 'Pending reset' : promptDirty(draft) ? 'Pending change' : '';
            state.className = 'advanced-draft-state';
          });
        });
      });
      refreshers.forEach(refresh => refresh());
    }
    search.oninput = () => { commandFilter = null; render(); };
    category.onchange = scope.onchange = render;
    settingsRefresh = () => { if (membership !== filterMembership()) render(); else refreshers.forEach(refresh => refresh()); refreshPending(); refreshPresets(); feedback.textContent = promptPending ? 'Applying…' : promptFeedback; feedback.hidden = !feedback.textContent; };
    render(); settingsRefresh();
  }
  function historyWorkspace() {
    const search = input('Search conversation titles or IDs'); search.setAttribute('aria-label', 'Search conversations');
    const notice = el('p', 'Loading saved conversations…', 'advanced-screen-description'); notice.setAttribute('role','status');
    const saved = el('ul', undefined, 'advanced-history-list'); saved.setAttribute('aria-label','Saved conversations');
    const preview = el('section', undefined, 'advanced-history-preview'); preview.setAttribute('aria-label','Conversation preview'); preview.tabIndex = -1; preview.hidden = true;
    const generation = resultGeneration, uuid = bridge.uuid(); let serial = 0, previewSerial = 0, offset = 0, lastGroup = '', queryTimer;
    const current = () => generation === resultGeneration && uuid === bridge.uuid();
    const more = button('Load more', () => load(false)); more.hidden = true;
    const refresh = button('Refresh list', () => load(true));
    screen.append(search, refresh, notice, saved, more, preview);
    function showPreview() {
      preview.focus({preventScroll:true});
      preview.scrollIntoView({block:'start', behavior:'instant'});
    }
    async function select(session, origin) {
      const request = ++previewSerial;
      const back = button('Back to conversations', () => {
        previewSerial++; preview.hidden = true;
        origin.focus({preventScroll:true}); origin.scrollIntoView({block:'center', behavior:'instant'});
      });
      preview.hidden = false; preview.replaceChildren(back, el('p', 'Loading preview…'));
      showPreview();
      try {
        const data = session.entry ? { messages: [], content:session.entry.content || session.entry.prompt || '', title:session.title } : await api({action:'session-preview',session:session.uuid});
        if (!current() || request !== previewSerial) return;
        preview.replaceChildren(back, el('h4', data.title || session.title || 'Conversation ' + session.uuid.slice(0,8)), el('p', 'Read-only preview · Your current conversation and drafts are unchanged.', 'advanced-prompt-help'));
        if (session.entry) preview.append(el('pre', data.content.slice(0,20000), 'advanced-preview-text'));
        else (data.messages || []).forEach(message => preview.append(el('strong',message.role === 'user' ? 'You' : 'Assistant'),el('pre',message.content,'advanced-preview-text')));
        if (data.unavailable || !(data.messages || []).length && !data.content) preview.append(el('p', data.reason || 'No preview is available for this saved conversation.'));
        if (data.truncated || data.content?.length > 20000) preview.append(el('p', 'Preview shortened. Open the conversation to view more.'));
        preview.append(button('Open conversation', async () => {
          if (busy) throw new Error('Finish the current operation first.');
          if (!await resolvePendingChanges()) return;
          if (!current() || request !== previewSerial) return;
          if (session.entry) await bridge.openBrowserHistory(session.entry); else bridge.resume(session.uuid);
          resetSessionView(); filter.value = ''; filter.oninput(); activeScreen = 'activity'; renderScreen(); bridge.refresh(); await poll();
        }));
        showPreview();
      } catch(error) {
        if (current() && request === previewSerial) {
          preview.replaceChildren(back, el('p', 'Could not load preview: ' + error.message),button('Retry preview', () => select(session, origin)));
          showPreview();
        }
      }
    }
    async function load(reset) {
      const request = ++serial;
      if (reset) { offset = 0; lastGroup = ''; saved.replaceChildren(); preview.hidden = true; previewSerial++; }
      const start = offset; more.disabled = true; notice.textContent = 'Loading saved conversations…';
      try {
        const query = search.value.toLowerCase();
        const data = storageMode === 'browser' ? {sessions:(bridge.browserHistory ? bridge.browserHistory() : []).map(entry => ({uuid:entry.uuid,updated:entry.updatedAt || entry.timestamp,title:entry.title || entry.prompt,entry})).sort((a,b) => new Date(b.updated) - new Date(a.updated)).filter(item => `${item.title || ''} ${item.uuid}`.toLowerCase().includes(query)).slice(start,start + 51)} : await api({action:'sessions',query,offset:start,limit:50});
        if (!current() || request !== serial) return;
        const sessions = data.sessions || [], page = sessions.slice(0,50); more.hidden = storageMode === 'browser' ? sessions.length <= 50 : data.nextOffset == null;
        page.forEach(session => {
          const date = new Date(session.updated), group = isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleDateString();
          if (group !== lastGroup) { const heading = el('li',group,'advanced-history-group'); saved.append(heading); lastGroup = group; }
          const row = el('li'), control = button('', () => select(session, control)); control.className = 'advanced-history-open'; control.title = 'Preview conversation ' + session.uuid;
          if (session.uuid === bridge.uuid()) control.setAttribute('aria-current','true');
          control.append(el('span',session.title || 'Conversation ' + session.uuid.slice(0,8),'advanced-history-title'), el('time',isNaN(date.getTime()) ? '' : date.toLocaleTimeString(),'advanced-history-date'));
          if (session.uuid === bridge.uuid()) control.append(el('span','Current','advanced-history-current'));
          row.append(control); saved.append(row);
        });
        offset = start + page.length;
        notice.textContent = offset ? offset + ' conversations · Select one to preview.' : query ? 'No matching conversations.' : 'No saved conversations yet.';
      } catch(error) { if (current() && request === serial) { notice.textContent = 'Could not load saved conversations. Use Refresh list to try again.'; showError(error); } }
      finally { if (current() && request === serial) more.disabled = false; }
    }
    search.oninput = () => { clearTimeout(queryTimer); serial++; previewSerial++; queryTimer = setTimeout(() => { if (current()) load(true); },200); };
    const maintenance = el('details', undefined, 'advanced-history-maintenance'); maintenance.append(el('summary','Current conversation operations')); screen.append(maintenance);
    // Existing command builders continue to own command semantics.
    const before = screen.childElementCount;
    actions([['History','/history'],['Previous answer','/last'],['Restore','/restore'],['Clear','/clear']]);
    commandForm('Rewind',count => `/rewind ${count}`,['Exchanges']); commandForm('Save answer',file => file ? `/save ${quote(file)}` : '/save',['Server path']);
    Array.from(screen.children).slice(before).forEach(node => maintenance.append(node));
    load(true);
  }
  function secondarySection(title, build) {
    const section = el('details', undefined, 'advanced-secondary-results');
    section.append(el('summary', title)); screen.append(section);
    const before = screen.childElementCount; build();
    Array.from(screen.children).slice(before).forEach(node => section.append(node));
    return section;
  }
  function workflowStatus(memory = false) {
    const value = name => snapshot?.settings?.find(setting => setting.name === name)?.value;
    const status = el('p', undefined, 'advanced-workflow-status'); status.setAttribute('role', 'status');
    status.textContent = 'Wiki: ' + (value('usewiki') === true ? 'enabled' : 'disabled') + ' · Access: ' + (value('wikiaccess') || 'read-only');
    if (memory) status.textContent += ' · Memory: ' + (value('memorych') ? 'configured' : 'not configured');
    screen.append(status);
  }
  function workflowForm(key, title, specs, build, primary, alternate) {
    const draft = workflowDrafts[key] ||= {};
    const form = el('form', undefined, 'advanced-form advanced-workflow-form'); form.append(el('h4', title));
    const fields = {};
    for (const spec of specs) {
      const field = spec.options ? el('select') : spec.multiline ? el('textarea') : input(spec.placeholder || spec.label);
      if (spec.options) for (const [value, label] of spec.options) { const option = el('option', label); option.value = value; field.append(option); }
      if (spec.check) field.type = 'checkbox';
      if (draft[spec.name] === undefined) draft[spec.name] = spec.default ?? (spec.check ? false : field.value);
      if (spec.check) field.checked = draft[spec.name]; else field.value = draft[spec.name];
      field.setAttribute('aria-label', spec.label);
      const label = el('label', spec.label); label.append(field); if (spec.check) label.className = 'advanced-workflow-check';
      form.append(label); fields[spec.name] = field;
      field.oninput = field.onchange = () => { draft[spec.name] = spec.check ? field.checked : field.value; feedback.textContent = ''; };
      if (spec.dataEditor && window.MiniADataEditor) window.MiniADataEditor.bind(field, {label:spec.label,root:spec.dataEditor});
      if (spec.help) form.append(el('p', spec.help, 'advanced-prompt-help'));
    }
    const feedback = el('p'); feedback.setAttribute('role', 'status');
    const generation = resultGeneration, uuid = bridge.uuid();
    const current = () => generation === resultGeneration && uuid === bridge.uuid();
    let pending = false;
    async function run(preview) {
      if (!current() || pending || busy || snapshot?.closed) return;
      try {
        const value = build(draft, preview); pending = true; refresh();
        await command(value);
      } catch (error) { if (current()) feedback.textContent = error.message || String(error); }
      finally { pending = false; if (current()) refresh(); }
    }
    const controls = el('div', undefined, 'advanced-actions');
    const submit = el('button', primary); submit.type = 'submit'; controls.append(submit);
    const preview = alternate ? button(alternate, () => run(true)) : null;
    if (preview) controls.prepend(preview);
    form.onsubmit = event => { event.preventDefault(); return run(false); };
    form.append(controls, feedback); screen.append(form);
    const previous = settingsRefresh;
    function refresh() {
      const disabled = !current() || pending || busy || snapshot?.closed;
      for (const field of [...Object.values(fields), submit, preview].filter(Boolean)) field.disabled = !!disabled;
    }
    settingsRefresh = () => { if (previous) previous(); refresh(); }; refresh();
    return form;
  }
  function ingestWorkspace() {
    workflowStatus();
    screen.append(el('p', 'Choose a source and destination section, preview the work, then ingest. Progress and recovery use the same operation history below.', 'advanced-screen-description'));
    workflowForm('ingest', 'Source and options', [
      {name:'source',label:'Source',help:'Server folder, repository URL, or page URL.'}, {name:'section',label:'Destination section'},
      {name:'sourceid',label:'Source ID (optional)'},
      {name:'layout',label:'Layout',options:[['','Configured default'],['flat','Flat'],['source','Group by source']]},
      {name:'force',label:'Force reprocessing',check:true}, {name:'prune',label:'Prune removed source pages',check:true},
      {name:'allowemptyprune',label:'Allow pruning from an empty source',check:true},
      {name:'independent',label:'Run independently of pending recovery',check:true}
    ], (draft, preview) => {
      if (!draft.source.trim()) throw new Error('Enter a source to ingest.');
      if (draft.allowemptyprune && !draft.prune) throw new Error('Enable pruning before allowing an empty source to prune pages.');
      const flags = ['force','prune','allowemptyprune','independent'].filter(key => draft[key]);
      if (preview) flags.push('dryrun');
      if (draft.sourceid.trim()) flags.push(quote('sourceid=' + draft.sourceid.trim()));
      if (draft.layout) flags.push('layout=' + draft.layout);
      return '/ingest ' + quote(draft.source.trim()) + (draft.section.trim() ? ' ' + quote(draft.section.trim()) : '') + (flags.length ? ' ' + flags.join(' ') : '');
    }, 'Ingest source', 'Preview ingestion');
    actions([['Check recovery','/ingest recovery']]); resultPanel();
    secondarySection('Recovery by ID', () => {
      screen.append(el('p', 'Resume pending work, or archive its recovery journal. Discard keeps pages already written; the server asks for confirmation.'));
      workflowForm('ingest-recovery', 'Recovery', [{name:'id',label:'Recovery ID'},{name:'op',label:'Recovery action',options:[['resume','Resume'],['discard','Discard journal']]}], draft => {
        if (!draft.id.trim()) throw new Error('Enter a recovery ID.');
        return '/ingest recovery ' + draft.op + ' ' + quote(draft.id.trim());
      }, 'Run recovery action');
    });
  }
  function planningWorkspace(kind) {
    workflowStatus(kind === 'dream');
    if (kind === 'absorb') {
      screen.append(el('p', 'Check saved plans and pending recovery, create a plan from a specification, then review it before applying.', 'advanced-screen-description'));
      actions([['Refresh plans and recovery','/absorb status']]); resultPanel();
      workflowForm('absorb-plan', 'Create a plan', [{name:'spec',label:'Spec file or inline JSON/SLON',multiline:true,dataEditor:'map'}], draft => {
        if (!draft.spec.trim()) throw new Error('Enter a specification or file path.');
        return '/absorb plan ' + quote(draft.spec.trim());
      }, 'Create plan');
      secondarySection('Manage a plan by ID', () => workflowForm('absorb-manage', 'Plan action', [
        {name:'id',label:'Plan ID'}, {name:'op',label:'Plan action',options:[['show','Review'],['apply','Apply'],['resume','Resume'],['delete','Delete'],['cancel','Cancel']]}
      ], draft => { if (!draft.id.trim()) throw new Error('Enter a plan ID.'); return '/absorb ' + draft.op + ' ' + quote(draft.id.trim()); }, 'Run plan action'));
    } else {
      screen.append(el('p', 'Preview wiki maintenance before applying it. Results below describe the last run; the configuration above describes this session.', 'advanced-screen-description'));
      actions([['Preview wiki maintenance','/dream wiki auto dryrun']]); resultPanel();
      workflowForm('dream', 'Plan or run maintenance', [
        {name:'target',label:'Target',options:[['wiki','Wiki'],['memory','Memory']]},
        {name:'mode',label:'Wiki mode',options:[['plan','Plan'],['auto','Auto'],['apply','Apply'],['reorg','Reorganize'],['repair','Repair'],['reindex','Reindex'],['graph','Graph'],['indexes','Indexes']]},
        {name:'dryrun',label:'Dry run',check:true,default:true,help:'Memory uses its own maintenance behavior; Wiki mode only applies to the Wiki target.'}
      ], draft => '/dream ' + draft.target + (draft.target === 'wiki' ? ' ' + draft.mode : '') + (draft.dryrun ? ' dryrun' : ''), 'Run maintenance');
    }
  }
  function commandForm(label, build, fields) {
    const form = el('form', undefined, 'advanced-form'); form.append(el('h4',label));
    const nodes = fields.map(spec => {
      const name = typeof spec === 'string' ? spec : spec.name;
      const field = spec.options ? el('select') : name === 'Content' || name === 'Goal' ? el('textarea') : input(name);
      if (spec.options) spec.options.forEach(value => {const option=el('option',value || '(default)');option.value=value;field.append(option);});
      field.setAttribute('aria-label', name);
      const lab=el('label',name); lab.append(field); form.append(lab);
      if (name === 'Content') { const preview=el('div');form.append(button('Preview',()=>preview.replaceChildren(markdown(field.value))),preview); }
      if (spec.dataEditor) window.MiniADataEditor.bind(field, {label: name, root: spec.dataEditor});
      return field;
    });
    const go = el('button','Run'); go.type='submit'; form.append(go);
    form.onsubmit = e => { e.preventDefault(); command(build(...nodes.map(n=>n.value))).catch(showError); };
    screen.append(form);
  }
  function decisionScreen() {
    const uuid = bridge.uuid(), generation = resultGeneration;
    const current = () => uuid === bridge.uuid() && generation === resultGeneration && activeScreen === 'decide';
    const locked = () => !current() || busy || snapshot?.closed;
    const form = el('form', undefined, 'advanced-form advanced-decision-form');
    const feedback = el('p'); feedback.setAttribute('role', 'status');
    const field = (label, node, parent = form) => { const wrap = el('label', label); node.setAttribute('aria-label', label); wrap.append(node); parent.append(wrap); return node; };
    const scope = field('Shared scope / instructions', el('textarea'));
    const evidence = field('Evidence', el('textarea'));
    const questions = el('div'); form.append(questions);
    let reviewed = null;
    const review = el('pre'); review.hidden = true;
    const invalidate = () => { reviewed = null; review.hidden = true; submit.hidden = true; };
    const rows = [];
    function addQuestion() {
      if (locked() || rows.length >= 32) return;
      invalidate();
      const row = el('fieldset'), model = {row}; row.append(el('legend', 'Question'));
      model.name = field('Question name', input('e.g. urgent'), row);
      model.type = field('Question type', el('select'), row);
      for (const type of ['boolean','choice','score']) { const option = el('option', type); option.value = type; model.type.append(option); }
      model.instructions = field('Question instructions', el('textarea'), row);
      model.criteria = field('Criteria: choice uses key = description per line; score uses one level per line', el('textarea'), row);
      model.criteria.parentNode.hidden = true;
      model.type.onchange = () => { model.criteria.parentNode.hidden = model.type.value === 'boolean'; invalidate(); };
      row.append(button('Remove question', () => { if (locked()) return; rows.splice(rows.indexOf(model), 1); row.remove(); invalidate(); }));
      rows.push(model); questions.append(row);
    }
    const add = button('Add question', addQuestion);
    const prepare = el('button', 'Review request'); prepare.type = 'submit';
    const submit = button('Submit decision', async () => {
      if (locked() || !reviewed) return;
      try { await command('/decide ' + reviewed); } catch (error) { if (current()) feedback.textContent = error.message || String(error); }
    }); submit.hidden = true;
    const cancel = button('Cancel', () => { if (!current()) return; form.reset(); questions.replaceChildren(); rows.length = 0; invalidate(); feedback.textContent = 'Decision cancelled.'; if (!locked()) addQuestion(); });
    form.append(add, prepare, cancel, review, submit, feedback);
    form.oninput = invalidate;
    form.onsubmit = event => {
      event.preventDefault(); if (locked()) return;
      try {
        if (!rows.length) throw new Error('Add at least one question.');
        const request = {state: {scope: scope.value, evidence: evidence.value}, questions: Object.create(null)};
        for (const item of rows) {
          const name = item.name.value.trim(), type = item.type.value;
          if (!name || Object.hasOwn(request.questions, name) || ['__proto__','constructor','prototype'].includes(name)) throw new Error('Question names must be nonempty and unique.');
          if (!item.instructions.value.trim()) throw new Error('Each question needs instructions.');
          const question = {type, instructions: item.instructions.value};
          if (type !== 'boolean') {
            const lines = item.criteria.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
            if (lines.length < 2) throw new Error('Provide at least two criteria.');
            if (type === 'score') question.criteria = lines;
            else {
              question.criteria = Object.create(null);
              for (const line of lines) {
                const at = line.indexOf('='), key = line.slice(0, at).trim(), description = line.slice(at + 1).trim();
                if (at < 1 || !description || Object.hasOwn(question.criteria, key)) throw new Error('Choice criteria need unique key = description lines.');
                question.criteria[key] = description;
              }
            }
          }
          request.questions[name] = question;
        }
        reviewed = JSON.stringify(request);
        if (new TextEncoder().encode(reviewed).length > 48 * 1024) throw new Error('Request exceeds 48 KiB.');
        review.textContent = JSON.stringify(request, null, 2); review.hidden = false; submit.hidden = false; feedback.textContent = '';
      } catch (error) { invalidate(); feedback.textContent = error.message || String(error); }
    };
    const wizard = button('Ask inputs step by step', () => { if (!locked()) return command('/decide interactive'); });
    screen.append(wizard, el('h4', 'Guided request'), form); addQuestion();
    const structured = el('form', undefined, 'advanced-form advanced-decision-form'); structured.append(el('h4', 'JSON / SLON request'));
    const raw = field('Request containing state and questions', el('textarea'), structured);
    raw.placeholder = '{"state":"Evidence","questions":{"urgent":{"type":"boolean","instructions":"Is this urgent?"}}}';
    const run = el('button', 'Submit structured request'); run.type = 'submit'; structured.append(run);
    const rawFeedback = el('p'); rawFeedback.setAttribute('role', 'status'); structured.append(rawFeedback);
    structured.onsubmit = async event => {
      event.preventDefault(); if (locked()) return;
      if (!raw.value.trim()) { rawFeedback.textContent = 'Enter a JSON or SLON request.'; return; }
      try { await command('/decide ' + raw.value); } catch (error) { if (current()) rawFeedback.textContent = error.message || String(error); }
    };
    screen.append(structured);
    settingsRefresh = () => { for (const node of [...form.querySelectorAll('input,textarea,select,button'), ...structured.querySelectorAll('textarea,button')]) node.disabled = !!locked(); wizard.disabled = !!locked(); add.disabled = locked() || rows.length >= 32; };
    settingsRefresh();
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
  function insertCommand(value) {
    const composer = document.querySelector('#promptInput'); composer.value = value; composer.focus();
    composer.dispatchEvent(new Event('input', {bubbles:true}));
  }
  function download(text, name = 'result.md') {
    const url = URL.createObjectURL(new Blob([text], {type:'text/plain;charset=utf-8'}));
    const link = el('a'); link.href = url; link.download = name.split(/[\\/]/).pop(); link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function markdown(text) {
    const node = el('div', undefined, 'advanced-reader markdown-body');
    // Reuse the application's Markdown conversion, then allow only passive markup.
    // Sanitization is also applied to custom commands, wiki bodies and model reports.
    if (!bridge.renderMarkdown) { node.append(el('pre', text)); return node; }
    const template = document.createElement('template'); template.innerHTML = bridge.renderMarkdown(String(text || ''));
    const tags = new Set('P BR HR H1 H2 H3 H4 H5 H6 UL OL LI BLOCKQUOTE PRE CODE EM STRONG DEL S TABLE THEAD TBODY TR TH TD A DETAILS SUMMARY SPAN DIV'.split(' '));
    for (const child of [...template.content.querySelectorAll('*')]) {
      if (!tags.has(child.tagName)) { child.replaceWith(document.createTextNode(child.textContent)); continue; }
      for (const attribute of [...child.attributes]) {
        const safeLink = child.tagName === 'A' && attribute.name === 'href' && /^(https?:\/\/|mailto:|#)/i.test(attribute.value);
        const safeClass = child.tagName === 'CODE' && attribute.name === 'class' && /^language-[\w-]+$/.test(attribute.value);
        if (!safeLink && !safeClass) child.removeAttribute(attribute.name);
      }
      if (child.tagName === 'A') child.setAttribute('rel','noopener noreferrer');
    }
    node.append(template.content);
    for (const code of node.querySelectorAll('code.language-mermaid')) {
      if (!window.mermaid) continue;
      const source = code.textContent;
      Promise.resolve().then(async () => {
        window.mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:document.body.classList.contains('markdown-body-dark')?'dark':'default'});
        const rendered = await window.mermaid.render('advanced-diagram-' + bridge.newRequestId(), source);
        if (!node.isConnected) return;
        const frame = el('iframe'); frame.title = 'Mermaid preview'; frame.setAttribute('sandbox','');
        frame.srcdoc = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">' + rendered.svg;
        code.parentElement.after(frame);
      }).catch(() => { /* Keep the original diagram source readable. */ });
    }
    return node;
  }
  function reader(text, raw = false, name = 'result.md') {
    const container = el('section', undefined, 'advanced-reader-container'), content = el('div');
    const controls = el('div', undefined, 'advanced-actions');
    const draw = () => content.replaceChildren(raw ? el('pre', text) : markdown(text));
    controls.append(button('Rendered / Raw', () => { raw = !raw; draw(); }), button('Copy', () => navigator.clipboard.writeText(text)), button('Download', () => download(text, name)));
    container.append(controls, content); draw(); return container;
  }
  function helpScreen(skillsOnly = false) {
    const search = input(skillsOnly ? 'Search local skills' : 'Search Help', skillsOnly && !/^(search|remote|recommend|open|read|related|context)( |$)/.test(viewParams.args || '') ? viewParams.args || '' : ''); search.setAttribute('aria-label', search.placeholder);
    const list = el('div'); screen.append(search, list);
    function draw() {
      list.replaceChildren();
      for (const item of snapshot.commandMetadata || []) {
        if (skillsOnly && item.kind !== 'skill') continue;
        if (!JSON.stringify(item).toLowerCase().includes(search.value.toLowerCase())) continue;
        const card = el('details',undefined,'advanced-help-entry');
        const summary = el('summary'); summary.append(el('strong',item.syntax), el('span',item.description,'advanced-help-description')); card.append(summary);
        if (item.aliases?.length) card.append(el('p','Aliases: '+item.aliases.join(', ')));
        if (item.subcommands?.length) card.append(el('p','Subcommands / options: '+item.subcommands.join(', ')));
        if (item.prerequisite) card.append(el('p',item.prerequisite));
        if (item.source) card.append(el('small',item.source));
        if (item.examples?.length) card.append(el('pre', item.examples.join('\n')));
        const args = input(item.arguments || 'Arguments'); args.setAttribute('aria-label', item.command + ' arguments');
        card.append(args,button('Insert command',()=>insertCommand(item.command + (args.value ? ' '+args.value : ' ')))); list.append(card);
      }
      if (!list.childElementCount) list.append(el('p','No matching commands or skills.'));
    }
    search.oninput = draw; draw();
  }
  function pageList(items, operation = 'read', family = 'wiki') {
    const list = el('ul',undefined,'advanced-result-list');
    for (const item of items || []) {
      const path = typeof item === 'string' ? item : item.path || item.ref || item.page || item.id;
      const row = el('li');
      if (path) row.append(button(path,()=>command(`/${family} ${operation} ${quote(path)}`)));
      if (typeof item === 'object') { if (item.title) row.append(el('strong',item.title)); if (item.snippet || item.summary || item.description) row.append(el('p',item.snippet || item.summary || item.description)); }
      list.append(row);
    }
    if (!list.childElementCount) list.append(el('li','No entries.'));
    return list;
  }
  function resultDetails(value, title = 'Full result data') {
    const details = el('details', undefined, 'advanced-result-details');
    details.append(el('summary', title), structuredOutput(value));
    const raw = typeof value === 'string' ? value : asText(value);
    if (raw !== undefined) details.append(button('Copy data', () => navigator.clipboard.writeText(raw)), button('Download data', () => download(raw, 'result.json')));
    return details;
  }
  function contextResult(value) {
    const container = el('section');
    if (!Array.isArray(value.sections)) { container.append(structuredOutput(value)); return container; }
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : 'Unavailable';
    const metrics = el('dl', undefined, 'advanced-context-summary');
    for (const [label, count] of [['Messages',value.messageCount],['Tokens',value.totalTokens],['Characters',value.totalChars]]) metrics.append(el('dt',label),el('dd',number(count)));
    container.append(metrics, el('p', 'Token accounting: ' + ({actual:'provider usage where available, estimates elsewhere',model:'model tokenizer estimates',approx:'approximate estimates',llm:'LLM analysis'}[value.estimateMethod] || 'unspecified') + '. This is context composition, not a model capacity limit.', 'advanced-prompt-help'));
    const table = el('table', undefined, 'advanced-workflow-table'); table.append(el('caption','Context composition'));
    const head = el('tr'); ['Role','Messages','Tokens','Share of tokens'].forEach(label => { const th = el('th',label); th.setAttribute('scope','col'); head.append(th); });
    const thead = el('thead'), body = el('tbody'); thead.append(head); table.append(thead,body);
    for (const section of value.sections) {
      const row = el('tr'); const share = value.totalTokens > 0 && Number.isFinite(section.tokens) ? (section.tokens / value.totalTokens * 100).toFixed(1) + '%' : '—';
      row.append(el('td',section.section),el('td',number(section.messages)),el('td',number(section.tokens)),el('td',share)); body.append(row);
    }
    container.append(table,resultDetails(value)); return container;
  }
  function graphResult(value, meta) {
    const container = el('section'), edges = [], nodes = new Set(), paths = new Set();
    const visit = item => {
      if (Array.isArray(item)) { item.forEach(visit); return; }
      if (!item || typeof item !== 'object') return;
      if (typeof item.from === 'string' && typeof item.to === 'string') edges.push(item);
      for (const [key, entry] of Object.entries(item)) {
        if (typeof entry === 'string') {
          if (['path','page','ref'].includes(key)) paths.add(entry);
          if (['id','from','to'].includes(key)) nodes.add(entry);
        } else if (entry && typeof entry === 'object') visit(entry);
      }
    };
    visit(value);
    if (meta.operation === 'path' && Array.isArray(value)) value.filter(item => typeof item === 'string').forEach(id => nodes.add(id));
    for (const id of nodes) if (id.startsWith('doc:')) paths.add(id.slice(4));
    if (meta.retrievalAlias) container.append(el('p','answer is a retrieval alias; no answer synthesis is performed.'));
    if (value?.error) container.append(el('p',String(value.error),'advanced-warning'));
    if (edges.length) {
      const table = el('table', undefined, 'advanced-workflow-table'); table.append(el('caption','Relationships (' + edges.length + ')'));
      const thead = el('thead'), head = el('tr'), body = el('tbody');
      for (const label of ['From','Relationship','To','Evidence']) { const th = el('th',label); th.setAttribute('scope','col'); head.append(th); }
      thead.append(head); table.append(thead,body);
      for (const edge of edges.slice(0,200)) {
        const row = el('tr'), from = el('td'), to = el('td');
        from.append(button(edge.from, () => command('/graph neighbors ' + quote(edge.from))));
        to.append(button(edge.to, () => command('/graph neighbors ' + quote(edge.to))));
        row.append(from,el('td',edge.type || edge.relation || 'linked'),to,el('td',typeof edge.provenance === 'string' ? edge.provenance : asText(edge.provenance) || 'Not reported')); body.append(row);
      }
      const frame = el('div', undefined, 'advanced-table-frame'); frame.append(table); container.append(frame);
      if (edges.length > 200) container.append(el('p','Showing the first 200 relationships. Full data is available below.'));
    } else if (nodes.size) {
      const list = el(meta.operation === 'path' ? 'ol' : 'ul', undefined, 'advanced-result-list');
      list.setAttribute('aria-label',meta.operation === 'path' ? 'Graph path' : 'Graph nodes');
      for (const id of [...nodes].slice(0,200)) { const row = el('li'); row.append(button('Neighbors: ' + id, () => command('/graph neighbors ' + quote(id)))); list.append(row); }
      container.append(list);
    } else if (Array.isArray(value) && !value.length) container.append(el('p','No relationships or nodes were returned.'));
    else container.append(structuredOutput(value));
    if (paths.size) { const pages = el('details'); pages.append(el('summary','Related pages'),pageList([...paths].slice(0,200))); container.append(pages); }
    container.append(resultDetails(value)); return container;
  }
  function recoveryResult(value) {
    const container = el('section');
    if (value.error) container.append(el('p',String(value.error),'advanced-warning'));
    if (!value.recoveries?.length) container.append(el('p',value.ok === false ? 'Recovery could not be listed.' : 'No pending ingestion recovery.'));
    for (const entry of value.recoveries || []) {
      const card = el('section', undefined, 'advanced-workflow-card');
      card.append(el('h4',entry.scope?.source || entry.id),el('p','Phase: ' + (entry.phase || 'unknown') + ' · ID: ' + entry.id));
      if (entry.scope?.section) card.append(el('p','Section: ' + entry.scope.section));
      if (Array.isArray(entry.pages)) card.append(el('p',entry.pages.length + ' affected pages'));
      card.append(button('Resume',()=>command('/ingest recovery resume '+quote(entry.id))),button('Discard',()=>command('/ingest recovery discard '+quote(entry.id))));
      container.append(card);
    }
    container.append(el('p','Discard archives recovery and keeps pages already written. It does not roll them back.','advanced-prompt-help'),resultDetails(value));
    return container;
  }
  function absorbResult(value) {
    const container = el('section');
    container.append(el('p','Recorded status: ' + (value.status || value.plan?.status || (value.ok === false ? 'failed' : 'available'))));
    if (value.error) container.append(el('p',String(value.error),'advanced-warning'));
    if (value.recovery) container.append(el('p','Pending recovery: ' + (value.recovery.id || 'unknown') + ' · ' + (value.recovery.phase || 'unknown'),'advanced-warning'));
    const plans = value.plans || (value.id || value.planId ? [value] : []);
    if (Array.isArray(value.plans) && !plans.length) container.append(el('p','No saved plans. Create a plan from a specification below.'));
    for (const plan of plans) {
      const id = typeof plan === 'string' ? plan : plan.id || plan.planId; if (!id) continue;
      const card = el('section', undefined, 'advanced-workflow-card'); card.append(el('h4',id),button('Review plan',()=>command('/absorb show '+quote(id))));
      const actions = el('details'); actions.append(el('summary','Apply and manage'));
      for (const [op,label] of [['apply','Apply plan'],['resume','Resume plan'],['delete','Delete plan'],['cancel','Cancel plan']]) actions.append(button(label,()=>command('/absorb '+op+' '+quote(id))));
      card.append(actions); container.append(card);
    }
    if (Array.isArray(value.plan?.operations)) container.append(el('p',value.plan.operations.length + ' planned operations'));
    container.append(resultDetails(value)); return container;
  }
  function renderBlock(block) {
    const value = block.value, meta = block.meta || {}, container = el('section',undefined,'advanced-result-block');
    if (block.type === 'markdown') { if (meta.ref) container.append(el('h4',meta.ref)); if (meta.path) container.append(el('h4',meta.path),breadcrumbs(meta.path)); if (meta.page) container.append(structuredMap(meta.page)); container.append(reader(String(value || ''))); }
    else if (block.type === 'answer') { container.append(reader(String(value.answer || ''),meta.raw === true)); const goal = el('details'); goal.append(el('summary','Previous goal'),el('pre',value.goal || '')); container.append(goal); }
    else if (block.type === 'context') container.append(contextResult(value));
    else if (block.type === 'graph') container.append(graphResult(value,meta));
    else if (block.type === 'recoveries') container.append(recoveryResult(value));
    else if (block.type === 'absorb') container.append(absorbResult(value));
    else if (block.type === 'dream') {
      container.append(el('p','Recorded status: ' + (value.status || (value.ok === false ? 'failed' : 'completed')) + (value.dryrun ? ' · Dry run' : '')));
      if (value.error) container.append(el('p',String(value.error),'advanced-warning'));
      if (value.verification?.ok === false) container.append(el('p','Verification reported unresolved issues. Review the details before applying further maintenance.','advanced-warning'));
      for (const [key,label] of [['diagnosed_issues','Diagnosed issues'],['attempted_actions','Attempted actions'],['verified_fixes','Verified fixes'],['unresolved_issues','Unresolved issues']]) {
        if (!Array.isArray(value[key])) continue;
        const details = el('details'); details.append(el('summary',label + ': ' + value[key].length));
        if (value[key].length) details.append(structuredOutput(value[key]));
        container.append(details);
      }
      container.append(resultDetails(value));
    }
    else if (block.type === 'decision-compose') container.append(el('p','Compose a decision using the form below.'));
    else if (block.type === 'decision') {
      if (value.error) container.append(el('p', value.error, 'advanced-warning'));
      else { container.append(el('h4','Answers'),structuredMap(value.response?.answers || {}),el('h4','Usage'),structuredMap(value.stats || {})); const raw = el('details'); raw.append(el('summary','Full response'),reader(JSON.stringify(value, null, 2),true,'decision.json')); container.append(raw); }
    } else if (block.type === 'saved') { container.append(el('p','Saved on server: '+value.destination),reader(String(value.content || ''),true,value.destination)); }
    else if (block.type === 'export') { const raw = typeof value === 'string' ? value : asText(value); container.append(reader(raw,true,'graph.'+(meta.format || 'txt'))); if (meta.format === 'mermaid') container.append(markdown('```mermaid\n'+raw+'\n```')); }
    else if (block.type === 'history') {
      if (value.picker) container.append(el('p','Choose a saved conversation below, or Cancel to keep this conversation.'),button('Cancel',()=>{activeScreen='activity';renderScreen();}));
      for (const goal of value.goals || []) { const row = el('section'); row.append(el('pre',goal),button('Insert',()=>insertCommand(goal)),button('Edit',()=>bridge.openComposer(goal))); container.append(row); }
    } else if (block.type === 'pages') container.append(pageList(value));
    else if (block.type === 'wiki-search') { if (value.partial) container.append(el('p','Partial search coverage: absence is not established.','advanced-warning')); container.append(pageList(value.hits),structuredMap({sources:value.sources,stopReasons:value.stopReasons,budget:value.budget})); }
    else if (block.type === 'wiki-tree' || block.type === 'wiki-browse') { container.append(breadcrumbs(value.path || ''),pageList(value.sections || value.child_sections,'browse'),pageList(value.pages || value.direct_pages),structuredMap(value)); }
    else if (block.type === 'wiki-backlinks') container.append(pageList(value.backlinks));
    else if (block.type === 'skill-results') container.append(pageList(value,'open','skills'));
    else if (block.type === 'skill-detail') {
      container.append(structuredMap(value)); const ref=value.ref || meta.ref;
      if(ref) { container.append(button('Read skill',()=>command('/skills read '+quote(ref))),button('Related skills',()=>command('/skills related '+quote(ref))));for(const heading of value.headings || [])container.append(button(heading,()=>command('/skills read '+quote(ref)+' '+quote(heading)))); }
    } else if (block.type === 'skill-related') container.append(pageList([...(value.backlinks || []),...(value.graph || []),...(value.cross || [])],'open','skills'),structuredMap(value));
    else if (block.type === 'lint') {
      container.append(structuredMap(value.summary)); const filter = el('select'), issues = el('div');
      for (const level of ['all','error','warning','info']) { const option = el('option',level); option.value=level;filter.append(option); }
      filter.setAttribute('aria-label','Lint severity');
      const draw = () => { issues.replaceChildren(); const table = el('table'); for (const issue of value.issues || []) { if(filter.value !== 'all' && issue.severity !== filter.value)continue; const row = el('tr'), page = el('td'); page.append(button(issue.page || '(page)',()=>command('/wiki read '+quote(issue.page))));row.append(el('td',issue.severity),page,el('td',issue.type),el('td',issue.detail || issue.target || ''));table.append(row); } issues.append(table); };
      filter.onchange=draw;container.append(filter,issues);draw();
    } else if (block.type === 'help') container.append(el('p','Use the searchable command list below.'));
    else {
      if (meta.retrievalAlias) container.append(el('p','answer is a retrieval alias; no answer synthesis is performed.'));
      container.append(structuredOutput(value));
      const raw = typeof value === 'string' ? value : asText(value);
      if (raw !== undefined) container.append(button('Copy data',()=>navigator.clipboard.writeText(raw)),button('Download data',()=>download(raw,typeof value === 'string'?'result.txt':'result.json')));
      if (block.type === 'subtask' && value.id) container.append(button('Details',()=>command('/subtask '+value.id)),button('Result',()=>command('/subtask result '+value.id)),button('Cancel task',()=>command('/subtask cancel '+value.id)));
      if (block.type === 'subtask' && typeof value.answer === 'string') container.append(reader(value.answer));

    }
    return container;
  }
  function breadcrumbs(path) {
    const nav = el('nav'); nav.setAttribute('aria-label','Wiki path'); nav.append(button('/',()=>command('/wiki browse')));
    const parts = path.split('/').filter(Boolean); parts.forEach((part,index)=>nav.append(button(part,()=>command('/wiki browse '+quote(parts.slice(0,index+1).join('/'))))));return nav;
  }
  function resultPanel(host = screen) {
    const generation = resultGeneration, uuid = bridge.uuid(), view = activeScreen;
    const panel = el('section',undefined,'advanced-result-panel'); panel.setAttribute('aria-label','Command results'); panel.tabIndex = -1;
    let focusRequest = screen.dataset.focusResult;
    const select = el('select'); select.setAttribute('aria-label','Previous results');
    const notice = el('p','Loading results…'); notice.setAttribute('role','status');
    const content = el('div'), progress = el('details'); progress.append(el('summary','Operation progress'));
    const progressContent = el('div'); progress.append(progressContent);
    let cursor = 0, loading = false, refreshAgain = false, selected = null, selectionRequest = 0;
    const current = () => generation === resultGeneration && uuid === bridge.uuid() && view === activeScreen;
    const more = button('Older results',()=>load(false)); more.hidden=true;
    panel.append(notice,select,more,content,progress);host.append(panel);
    async function choose(sequence) {
      const request = ++selectionRequest;
      const record = await api({action:'result',sequence});
      if(!current() || request !== selectionRequest)return;
      selected=sequence; const result=record.value || {}; content.replaceChildren();
      notice.textContent=(result.status || 'previous')+' · '+(result.command || '')+' · '+record.timestamp+' · Previous result';
      for(const block of result.blocks || [])content.append(renderBlock(block));
      if(result.messages?.length) {
        const messages = el('details'); messages.open = !result.blocks?.length || result.status !== 'completed'; messages.append(el('summary', result.legacy ? 'Legacy command output' : 'Messages'));
        for(const message of result.messages)messages.append(structuredOutput(message.value));content.append(messages);
      }
      if (focusRequest && record.runId === focusRequest && result.status !== 'running') {
        focusRequest = null;
        if (document.activeElement === screen) { panel.focus({preventScroll:true}); panel.scrollIntoView({block:'start',behavior:'instant'}); }
      }
    }
    async function load(reset = true) {
      if(!current())return;
      if(loading){refreshAgain=true;return;}loading=true;
      try {
        const page=await api({action:'results',view,before:reset?0:cursor}); if(!current())return;
        if(reset){select.replaceChildren();cursor=0;}
        for(const result of page.results || []){const option=el('option',result.timestamp+' · '+result.command+' · '+result.status);option.value=String(result.sequence);select.append(option);}
        cursor=page.before;more.hidden=!page.hasMore;
        const preferred=previousSelections[view];
        if(preferred && [...select.children].some(n=>Number(n.value)===preferred))select.value=String(preferred);
        else if(preferred) {const option=el('option','Selected previous result #'+preferred);option.value=String(preferred);select.append(option);select.value=String(preferred);}
        const next=Number(select.value);
        if(next && next!==selected)await choose(next);
        if(!next)notice.textContent='No previous results. Run a command to see its result here.';
        progress.hidden=!(snapshot?.busy && submittedView?.name===view);
        if(!progress.hidden) {
          progress.open=true;progressContent.replaceChildren();
          const records=[...events.children].filter(n=>n.dataset.runId===submittedView.requestId).slice(-30);
          records.forEach(n=>progressContent.append(el('pre',n.textContent)));
        }
      } catch(error){if(current())notice.textContent=error.message || String(error);}
      finally{loading=false;if(refreshAgain && current()){refreshAgain=false;load();}}
    }
    select.onchange=()=>{previousSelections[view]=Number(select.value);choose(Number(select.value)).catch(showError);};
    resultRefresh=()=>load();load();
  }
  function subtaskScreen() {
    const generation = resultGeneration, uuid = bridge.uuid(), cards = new Map();
    const current = () => generation === resultGeneration && uuid === bridge.uuid();
    const summary = el('p', 'Loading subtasks…', 'advanced-subtask-summary');
    summary.setAttribute('role', 'status');
    const notice = el('p', '', 'advanced-screen-description');
    const filter = el('select'); filter.setAttribute('aria-label', 'Filter subtasks');
    for (const [value, label] of [['all','All tasks'],['active','Running / queued'],['completed','Completed'],['issues','Failed / cancelled']]) {
      const option = el('option', label); option.value = value; filter.append(option);
    }
    const list = el('div', undefined, 'advanced-subtask-list');
    const empty = el('p');
    let loading = false, tasks = [];
    const isActive = task => ['running', 'pending'].includes(task.status);
    const refresh = button('Refresh', () => subtaskRefresh());
    const controls = el('div', undefined, 'advanced-actions'); controls.append(filter, refresh);
    screen.append(summary, controls, notice, empty, list);
    function draw() {
      const counts = {};
      tasks.forEach(task => { counts[task.status] = (counts[task.status] || 0) + 1; });
      summary.textContent = tasks.length + ' tasks · ' + (counts.running || 0) + ' running · ' + (counts.pending || 0) + ' queued · ' + (counts.completed || 0) + ' completed · ' + (tasks.length - (counts.running || 0) - (counts.pending || 0) - (counts.completed || 0)) + ' failed / cancelled';
      const ids = new Set(tasks.map(task => task.id));
      for (const [id, card] of cards) if (!ids.has(id)) { card.root.remove(); cards.delete(id); }
      let visible = 0;
      for (const task of tasks) {
        let card = cards.get(task.id);
        if (!card) {
          const root = el('section', undefined, 'advanced-subtask-card');
          const heading = el('div', undefined, 'advanced-subtask-heading');
          const badge = el('span', '', 'advanced-subtask-badge'), goal = el('strong');
          heading.append(badge, goal);
          const meta = el('p', '', 'advanced-screen-description');
          const details = el('details'), detail = el('div'); details.append(el('summary', 'Details'), detail);
          const output = el('details'), answer = el('div'); output.append(el('summary', 'Result'), answer);
          const cancel = button('Cancel task', () => command('/subtask cancel ' + task.id));
          root.append(heading, meta, details, output, cancel); list.append(root);
          card = {root, badge, goal, meta, details, detail, output, answer, cancel}; cards.set(task.id, card);
        }
        card.root.hidden = !(filter.value === 'all' || (filter.value === 'active' ? isActive(task) : filter.value === 'issues' ? !isActive(task) && (task.status !== 'completed' || (task.acceptance && task.acceptance !== 'accepted')) : task.status === filter.value));
        if (!card.root.hidden) visible++;
        card.badge.textContent = (task.status === 'pending' ? 'Queued' : task.status) + (task.acceptance ? ' · ' + task.acceptance : '');
        card.badge.dataset.state = task.status;
        card.goal.textContent = task.goal || task.id;
        const elapsed = task.startedAt ? Math.max(0, Math.round(((task.completedAt || Date.now()) - task.startedAt) / 1000)) + 's' : 'Not started';
        card.meta.textContent = task.id + ' · ' + elapsed + (task.attempt !== undefined ? ' · Attempt ' + task.attempt + (task.maxAttempts ? '/' + task.maxAttempts : '') : '');
        card.cancel.hidden = !isActive(task);
        card.cancel.disabled = !!snapshot?.busy;
        card.cancel.title = snapshot?.busy ? 'Cancel is available when the parent operation finishes. Stop in the pane header stops the current operation.' : 'Cancel this task';
        // Preserve the card, focus, and open sections across status refreshes.
        const detailData = JSON.stringify({status:task.status, goal:task.goal, startedAt:task.startedAt, completedAt:task.completedAt, lastActivityReason:task.lastActivityReason, outcome:task.outcome, acceptance:task.acceptance, blocker:task.reason, error:task.error});
        if (detailData !== card.detailData) {
          card.detailData = detailData;
          card.detail.replaceChildren(structuredMap(JSON.parse(detailData)));
        }
        const answer = task.result?.answer;
        const resultData = JSON.stringify([task.status, answer, task.error]);
        if (resultData !== card.resultData) {
          card.resultData = resultData;
          card.answer.replaceChildren();
          if (task.error) card.answer.append(el('p', String(task.error), 'advanced-warning'));
          if (typeof answer === 'string') card.answer.append(reader(answer));
          else card.answer.append(el('p', isActive(task) ? 'Result will appear here when the task finishes.' : 'No answer was returned.'));
        }
      }
      empty.hidden = visible > 0;
      empty.textContent = tasks.length ? 'No tasks match this filter.' : 'No subtasks in this conversation. Enable usedelegation=true and submit a child goal below.';
    }
    filter.onchange = draw;
    subtaskRefresh = async () => {
      if (loading || !current()) return;
      loading = true; refresh.disabled = true;
      try {
        const result = await api({action:'subtasks'}); if (!current()) return;
        tasks = result.tasks || []; draw();
        notice.textContent = 'Live · Updated ' + new Date().toLocaleTimeString() + ' · Refreshes every 3 seconds while this view is open.' + (snapshot?.busy ? ' Inspection remains available while the parent is working; delegate and cancel commands are available after it finishes.' : '');
      } catch (error) {
        if (current()) { summary.textContent = 'Subtask refresh failed'; notice.textContent = 'Showing the last received state. ' + (error.message || String(error)); }
      } finally { loading = false; refresh.disabled = false; }
    };
    subtaskRefresh();
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
      const decision = metrics.decisions;
      const hasDecisionUsage = decision?.usage_reports > 0;
      chart('Token usage by model', [['Main', p.llm_normal_tokens], ['Low cost', p.llm_lc_tokens], ['Validation', p.llm_val_tokens], ['Decision', hasDecisionUsage ? decision.total_tokens : undefined]], 'Tokens');
      chart('Token accounting', [['Actual', p.llm_actual_tokens], ['Estimated', p.llm_estimated_tokens]], 'Tokens');
      group('Goals', metrics.goals);
      chart('LLM calls', ['normal', 'low_cost', 'validation', 'decision'].map(key => [key, metrics.llm_calls?.[key]]).concat([['Advisor', metrics.advisor?.calls]]));
      if (decision && typeof decision === 'object') {
        const card = el('section', undefined, 'advanced-stat-card');
        card.append(el('h4', 'Decision model'), structuredMap({
          Model: decision.model || 'Not configured',
          Provider: decision.provider || 'Unavailable',
          'Configuration source': decision.source || 'Unavailable',
          Calls: decision.calls || 0,
          'Input tokens': hasDecisionUsage ? decision.input_tokens || 0 : 'Unavailable',
          'Output tokens': hasDecisionUsage ? decision.output_tokens || 0 : 'Unavailable',
          'Total tokens': hasDecisionUsage ? decision.total_tokens || 0 : 'Unavailable',
          'Usage reports': decision.usage_reports || 0,
          'Elapsed (ms)': decision.duration_ms || 0,
          Failures: decision.failures || 0,
          Fallbacks: decision.fallbacks || 0
        }));
        container.append(card);
      }
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
    let cursor = 0, pageRequest = 0, recordRequest = 0, selected = null, selectedRecord = null, rows = [], filters = [];
    const current = () => generation === debugGeneration && uuid === bridge.uuid() && activeScreen === 'debug' && enabled;
    const controls = el('div', undefined, 'advanced-actions advanced-debug-controls');
    const category = el('select'); category.setAttribute('aria-label', 'Debug category');
    const initial = el('option', 'All events'); initial.value = 'all'; category.append(initial);
    const requestedFilter = typeof viewParams !== 'undefined' ? viewParams.filter : null;
    if (requestedFilter && requestedFilter !== 'all') { const option = el('option', requestedFilter); option.value = requestedFilter; category.append(option); category.value = requestedFilter; }
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
    details.setAttribute('aria-label', 'Selected debug record'); details.tabIndex = -1;
    const detailStatus = el('p', 'Select an event to inspect.'); detailStatus.setAttribute('role', 'status');
    const content = el('div'); details.append(el('h4', 'Record details'), detailStatus, content);
    const copy = button('Copy payload', async () => {
      if (!current() || !selectedRecord) return;
      const record = selectedRecord;
      try {
        await navigator.clipboard.writeText(JSON.stringify(record.payload, null, 2));
        if (current() && selectedRecord === record) detailStatus.textContent = `#${record.sequence} ${record.kind} · Payload copied`;
      } catch (error) { if (current() && selectedRecord === record) detailStatus.textContent = 'Could not copy payload: ' + (error.message || String(error)); }
    });
    const save = button('Download record', () => { if (current() && selectedRecord) download(JSON.stringify(selectedRecord, null, 2), 'debug-' + selectedRecord.sequence + '.json'); });
    copy.disabled = save.disabled = true;
    details.append(copy, save, button('Back to events', () => {
      const control = rows.find(row => row.item.sequence === selected)?.control;
      if (control) { control.focus({preventScroll:true}); control.scrollIntoView({block:'center',behavior:'instant'}); }
    }));
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
    async function select(item, reveal = false) {
      if (!current()) return;
      selected = item.sequence; const request = ++recordRequest;
      markSelection(); content.replaceChildren(); selectedRecord = null; copy.disabled = save.disabled = true;
      detailStatus.textContent = `Loading record #${selected}…`;
      details.setAttribute('aria-busy', 'true');
      if (reveal) { details.focus({preventScroll:true}); details.scrollIntoView({block:'start',behavior:'instant'}); }
      try {
        const record = await api({action: 'trace', sequence: selected});
        if (!current() || request !== recordRequest) return;
        if (!record || record.sequence !== item.sequence || !Object.prototype.hasOwnProperty.call(record, 'payload')) {
          detailStatus.textContent = 'This record is no longer available. Refresh the trace.';
          return;
        }
        detailStatus.textContent = `#${record.sequence} ${record.kind}`;
        selectedRecord = record; copy.disabled = save.disabled = false;
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
        cursor = 0; selected = null; selectedRecord = null; copy.disabled = save.disabled = true; rows = []; recordRequest++;
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
          const row = el('tr'), control = button('#' + item.sequence, () => select(item, true));
          control.setAttribute('aria-label', `Inspect #${item.sequence} ${item.kind} — ${activityText(item.summary) || item.kind}`);
          const sequence = el('td'); sequence.append(control);
          row.append(sequence, el('td', item.kind), el('td', activityText(item.summary) || item.kind),
            el('td', item.timestamp, 'advanced-debug-secondary'), el('td', filters.find(filter => filter.category === item.category)?.label || item.category, 'advanced-debug-secondary'));
          row.addEventListener('click', event => { if (!control.contains(event.target)) select(item, true); });
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
  function renderScreen(focusRequest = '') {
    screen.dataset.focusResult = focusRequest;
    promptRefresh = null;
    settingsRefresh = null;
    debugGeneration++;
    resultGeneration++; resultRefresh = subtaskRefresh = null;
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
    if (!['subtasks','prompts','settings','models','history','wiki','graph','ingest','absorb','dream','context','debug','help','skills','decide'].includes(activeScreen)) resultPanel();
    if (activeScreen === 'help') { helpScreen(); secondarySection('Previous command results', () => resultPanel()); }
    else if (activeScreen === 'decide') { screen.append(el('p','1. Add evidence and questions → 2. Review the request → 3. Submit and inspect the result','advanced-workflow-status')); decisionScreen(); resultPanel(); }
    else if (activeScreen === 'prompts') { promptWorkspace(); }
    else if (activeScreen === 'answer') { actions([['Refresh answer','/last'],['Raw answer','/last md']]); secondarySection('Save a copy on the server', () => commandForm('Save on server', file => file ? `/save ${quote(file)}` : '/save', ['Server path (default response.md)'])); }
    else if (activeScreen === 'settings' || activeScreen === 'models') {
      settingsWorkspace();
    } else if (activeScreen==='debug') {
      debugScreen();
    } else if(activeScreen==='wiki') {
      commandForm('Search',q=>`/wiki search ${q}`,['Query']);
      actions([['Browse root','/wiki browse'],['List pages','/wiki list --meta'],['Tree','/wiki tree']]);
      commandForm('Browse / read', (op,path)=>`/wiki ${op||'browse'} ${quote(path)}`,[{name:'Operation',options:['browse','read']},'Path']);
      resultPanel();
      const secondary = el('details', undefined, 'advanced-secondary-results');
      secondary.append(el('summary', 'Connections, editing and maintenance')); screen.append(secondary);
      const before = screen.childElementCount;
      actions([['Context','/wiki context'],['Mounts','/wiki mounts'],['Lint','/wiki lint'],['Statistics','/stats wiki']]);
      commandForm('Attach wiki', (name,backend,root) => `/wiki attach ${quote(name)} backend=${backend || 'fs'} root=${quote(root || '.')}`, ['Name','Backend','Root']);
      commandForm('Detach wiki', name => `/wiki detach ${name}`, ['Name']);
      commandForm('Write page',(path,content)=>`/wiki write ${quote(path)} ${content}`,['Path','Content']);
      commandForm('Move page',(from,to)=>`/wiki move ${quote(from)} ${quote(to)}`,['From','To']);
      commandForm('Maintenance',(op,path,mode)=>`/wiki ${op} ${path ? quote(path) : ''} ${mode}`,[{name:'Operation',options:['delete','init','reindex','compact']},'Path (delete / init)',{name:'Compaction mode',options:['','dryrun','offline=true']}]);
      commandForm('Wiki command',args=>`/wiki ${args}`,['Subcommand and arguments']);
      Array.from(screen.children).slice(before).forEach(node => secondary.append(node));
    } else if(activeScreen==='graph') {
      workflowStatus();
      screen.append(el('p','Explore neighbors or find a path. Relationship results include a keyboard-accessible table; Mermaid export provides a diagram.','advanced-screen-description'));
      workflowForm('graph-neighbors', 'Explore relationships', [{name:'operation',label:'Operation',options:[['neighbors','Neighbors'],['cross','Cross-wiki links']]},{name:'path',label:'Path or node ID'}], draft => {
        if (!draft.path.trim()) throw new Error('Enter a path or node ID.');
        return '/graph ' + draft.operation + ' ' + quote(draft.path.trim());
      }, 'Explore');
      resultPanel();
      secondarySection('Find a path or search', () => {
        commandForm('Find path',(from,to)=>`/graph path ${quote(from)} ${quote(to)}`,['From','To']);
        commandForm('Search graph',query=>`/graph query ${query}`,['Query']);
      });
      secondarySection('Reports, export and maintenance', () => {
        actions([['Statistics','/graph stats'],['Report','/graph report'],['Communities','/graph communities'],['Surprise links','/graph surprise'],['Build','/graph build']]);
        commandForm('Retrieve', (op,query)=>`/graph ${op} ${query}`,[{name:'Operation',options:['retrieve','answer']},'Query']);
        commandForm('Export', format=>`/graph export ${format}`,[{name:'Format',options:['mermaid','graphml','neo4j','html','svg']}]);
        commandForm('Graph operation',args=>`/graph ${args}`,['Subcommand and arguments']);
      });
    } else if(activeScreen==='ingest') {
      ingestWorkspace();
    } else if(activeScreen==='absorb' || activeScreen==='dream') {
      planningWorkspace(activeScreen);
    } else if(activeScreen==='subtasks') {
      subtaskScreen();
      commandForm('Delegate',goal=>`/delegate ${goal}`,['Goal']);
      const history = el('details', undefined, 'advanced-subtask-history');
      history.append(el('summary', 'Command history (saved snapshots)')); screen.append(history);
      history.open = submittedView?.name === 'subtasks';
      resultPanel(history);
    } else if(activeScreen==='skills') {
      helpScreen(true);
      resultPanel();
      secondarySection('Discover or run skills', () => { actions([['List skills','/skills'],['Help','/help']]); commandForm('Inspect skills',args=>`/skills ${args}`,['Filter or subcommand']);commandForm('Run skill or custom command',cmd=>cmd,['$skill or /command with arguments']); });
    } else if(activeScreen==='history') {
      historyWorkspace();
    } else if(activeScreen==='context') {
      actions([['Refresh context summary','/context'],['Virtual memory','/context vm']]); resultPanel();
      secondarySection('Analysis and maintenance', () => { actions([['Analyze with model','/context analyze']]);commandForm('Compact / summarize',(op,keep)=>`/${op} ${keep}`,[{name:'Operation',options:['compact','summarize']},'Messages to keep']); });
    } else if(activeScreen==='stats') { statisticsScreen(); return; }
    if (['settings','models','history'].includes(activeScreen)) {
      const previous = el('details', undefined, 'advanced-secondary-results');
      previous.open = submittedView?.name === activeScreen;
      previous.append(el('summary', 'Previous command results')); screen.append(previous); resultPanel(previous);
    }
  }
  renderScreen();
  const composer=document.querySelector('#promptInput');
  composer.addEventListener('input',()=>{
    suggestions.replaceChildren(); const value=composer.value; const head=/^\/(\w+)\s+(\S*)$/.exec(value);
    const metadata=snapshot?.commandMetadata || [];
    const commandMeta=head && metadata.find(item=>item.name===head[1]);
    const pool = head && snapshot ? [...new Set([...(snapshot.completions?.[head[1]] || []),...(commandMeta?.subcommands || [])])].map(c=>'/'+head[1]+' '+c) : metadata.length ? metadata.map(item=>item.command) : (snapshot?.commands || []).map(c=>'/'+c);
    const matches=enabled && snapshot && /^[/$][\w -]*$/.test(value) ? pool.filter(c=>c.startsWith(value)).slice(0,12):[];
    suggestions.hidden=!matches.length; matches.forEach(c=>suggestions.append(button(c,()=>{composer.value=c+' ';suggestions.hidden=true;composer.focus();})));
  });
  composer.addEventListener('keydown',e=>{
    if(!enabled || e.isComposing || bridge.composerExpanded())return;
    if(e.key==='Tab'&&!suggestions.hidden&&suggestions.firstChild){e.preventDefault();suggestions.firstChild.click();}
    if(e.key==='ArrowUp'&&!composer.value.includes('\n')&&history.length){e.preventDefault();composer.value=history[Math.max(0,--historyIndex)]||'';}
    if(e.key==='ArrowDown'&&!composer.value.includes('\n')&&history.length){e.preventDefault();composer.value=history[Math.min(history.length,++historyIndex)]||'';}
    if(e.key==='Escape'){ suggestions.hidden=true; if(busy)api({action:'stop'}).catch(showError); }
  });
  setInterval(()=>poll().catch(showError),1000);
  if(sessionStorage.getItem(storeKey))setEnabled(true);
  return { beforeSessionChange:resolvePendingChanges, enabled:()=>enabled, stop:()=>api({action:'stop'}), submit:async (value, attachments)=>{
    if (await command(value, attachments) === false) return false;
    composer.value=''; suggestions.hidden=true;
  }};
};
