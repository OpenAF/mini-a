<script src="showdown.min.js?raw=true"></script>
<script>
    document.title = 'Chat Interface';
    var _isD
    /* ========== DARK MODE THEME SWITCHING ========== */
    /**
     * Switches all elements between dark and light mode themes
     * Updates body classes, code blocks, divs, and form elements
     */
    function __refreshDarkMode() {
        // Determine current dark mode state
        if (typeof __isDark === 'undefined') {
            _isD = document.body.classList.contains('markdown-body-dark');
        } else {
            _isD = __isDark;
        }

        if (_isD) {
            // Apply dark mode styles
            document.body.classList.add('markdown-body-dark', 'hljs_dark', 'njsmap_dark');
            document.body.bgColor = "#000000";

            // Update code blocks
            document.querySelectorAll('pre code').forEach((block) => {
                block.classList.add('hljs_dark');
            });

            // Update all divs to dark theme (except chat-container)
            document.querySelectorAll('div').forEach(div => {
                if (!div.classList.contains('chat-container')) {
                    div.style.backgroundColor = '#0f1115';
                    div.style.color = '#e6e6e6';
                    if (div.style.borderColor || getComputedStyle(div).borderColor !== 'rgba(0, 0, 0, 0)') {
                        div.style.borderColor = '#242629';
                    }
                }
            });

            // Update form elements for dark mode
            const promptInput = document.getElementById('promptInput');
            if (promptInput) {
                promptInput.style.background = '#1a1d23';
                promptInput.style.color = '#e6e6e6';
                promptInput.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
            }

            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) {
                submitBtn.style.background = 'linear-gradient(135deg, #3390ff 0%, #0056b3 100%)';
                submitBtn.style.color = '#e6e6e6';
            }

            const clearBtn = document.getElementById('clearBtn');
            if (clearBtn) {
                clearBtn.style.background = 'linear-gradient(135deg, #2d3238 0%, #1a1d23 100%)';
                clearBtn.style.color = '#e6e6e6';
                clearBtn.style.border = '1px solid rgba(255,255,255,0.1)';
                clearBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
            }
        } else {
            // Apply light mode styles
            document.body.classList.remove('markdown-body-dark', 'hljs_dark', 'njsmap_dark');
            document.body.bgColor = "#FFFFFF";

            // Update code blocks
            document.querySelectorAll('pre code').forEach((block) => {
                block.classList.remove('hljs_dark');
            });

            // Update all divs to light theme (except chat-container)
            document.querySelectorAll('div').forEach(div => {
                if (!div.classList.contains('chat-container')) {
                    div.style.backgroundColor = '#f8f9fa';
                    div.style.color = '#000000';
                    if (div.style.borderColor || getComputedStyle(div).borderColor !== 'rgba(0, 0, 0, 0)') {
                        div.style.borderColor = '#cccccc';
                    }
                }
            });

            // Reset form elements for light mode
            const promptInput = document.getElementById('promptInput');
            if (promptInput) {
                promptInput.style.background = '#ffffff';
                promptInput.style.color = '#000000';
                promptInput.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
            }

            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) {
                submitBtn.style.background = 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)';
                submitBtn.style.color = 'white';
            }

            const clearBtn = document.getElementById('clearBtn');
            if (clearBtn) {
                clearBtn.style.background = 'linear-gradient(135deg, #f3f3f3 0%, #e0e0e0 100%)';
                clearBtn.style.color = '#333';
                clearBtn.style.border = 'none';
                clearBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
            }
        }
    }
</script>
<style>
    /* ========== CSS VARIABLES ========== */
    :root {
        --bg: #ffffff;
        --panel-bg: #f8f9fa;
        --border: #cccccc;
        --accent: #007bff;
        --accent-disabled: #6c757d;
        --danger: #dc3545;
        --text: #000000;
        --preview-1: #e3e6ea;
        --preview-2: #f5f7f9;
        --preview-highlight: rgba(255,255,255,0.6);
    }

    /* ========== LAYOUT COMPONENTS ========== */
    .chat-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        /* background: var(--bg); */
        color: var(--text);
    }

    #resultsDiv {
        flex: 1;
        border: 0.1vmin solid var(--border);
        border-radius: 0.4vmin;
        padding: 2vmin;
        overflow-y: auto;
        background-color: var(--panel-bg);
        color: inherit;
        zoom: 0.9;
        position: relative;
    }

    /* ========== INPUT SECTION ========== */
    .input-section {
        display: flex;
        align-items: stretch;
        gap: 0.8vmin;
        margin-bottom: 2vmin;
        background: var(--panel-bg);
        border: 1px solid var(--border);
        border-radius: 1.2vmin;
        padding: 0.6vmin;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: box-shadow 0.2s ease;
    }

    #promptInput {
        flex: 1;
        padding: 1.2vmin;
        border: none;
        border-radius: 0.8vmin;
        background: #ffffff;
        color: inherit;
        font-size: 0.9rem;
        font-family: inherit;
        line-height: 1.2;
        resize: none;
        overflow: hidden;
        min-height: 2.4em;
        max-height: 20vh;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        outline: none;
        transition: box-shadow 0.2s ease;
        box-sizing: border-box;
    }

    #promptInput:focus {
        outline: none;
        box-shadow: 0 2px 6px rgba(0,123,255,0.15);
    }

    /* ========== BUTTONS ========== */

    #submitBtn,
    #clearBtn {
        padding: 1.2vmin 2vmin;
        border: none;
        border-radius: 0.8vmin;
        cursor: pointer;
        font-size: 1.4vmin;
        min-height: 2.4em;
        height: auto;
        min-width: 2.4em;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-sizing: border-box;
    }

    #submitBtn {
        background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
        color: white;
        box-shadow: 0 2px 6px rgba(0,123,255,0.25);
    }

    #clearBtn {
        background: linear-gradient(135deg, #f3f3f3 0%, #e0e0e0 100%);
        color: #333;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
    }

    /* Button hover states */
    #submitBtn:hover:not(:disabled) {
        background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
        box-shadow: 0 4px 12px rgba(0,123,255,0.35);
        transform: translateY(-1px);
    }

    #clearBtn:hover:not(:disabled) {
        background: linear-gradient(135deg, #cccccc 0%, #bdbdbd 100%);
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        transform: translateY(-1px);
    }

    /* Button disabled state */
    #submitBtn:disabled, #clearBtn:disabled {
        background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
        cursor: not-allowed;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    /* Submit button stop state */
    #submitBtn.stop {
        background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
        box-shadow: 0 2px 6px rgba(220,53,69,0.25);
    }

    #submitBtn.stop:hover {
        background: linear-gradient(135deg, #c82333 0%, #a02027 100%);
        box-shadow: 0 4px 12px rgba(220,53,69,0.35);
    }

    /* ========== SCROLL TO BOTTOM BUTTON ========== */
    #scrollToBottomBtn {
        position: sticky;
        bottom: 2vmin;
        left: 50%;
        transform: translateX(-50%);
        background: var(--panel-bg);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 50%;
        width: 36px;
        height: 36px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        transition: opacity 0.3s ease, box-shadow 0.2s ease;
        font-size: 16px;
        margin: 0 auto;
        opacity: 0;
        pointer-events: none;
    }

    #scrollToBottomBtn:hover {
        background: var(--border);
        box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }

    #scrollToBottomBtn.show {
        display: flex;
        opacity: 1;
        pointer-events: auto;
    }

    /* ========== LOADING PREVIEW ANIMATION ========== */
    .preview {
        margin-top: 1.5em;
        height: 4em;
        border-radius: 0.5em;
        position: relative;
        overflow: hidden;
        background: linear-gradient(100deg, var(--preview-1) 10%, var(--preview-2) 40%, var(--preview-1) 70%);
        background-size: 300% 100%;
        animation: shimmer 2s ease-in-out infinite;
    }

    .preview::before,
    .preview::after {
        content: '';
        position: absolute;
        left: 1em;
        right: 1em;
        height: 0.8em;
        background: var(--preview-highlight);
        border-radius: 0.3em;
    }

    .preview::before { 
        top: 0.8em; 
        width: 65%; 
    }
    
    .preview::after { 
        top: 2.2em; 
        width: 40%; 
    }

    @keyframes shimmer {
        0% { background-position: 0% 50%; }
        100% { background-position: -200% 50%; }
    }
</style>
<div class="chat-container">
    <div id="resultsDiv">
        <p></p>
        <!-- Scroll to bottom button -->
        <button id="scrollToBottomBtn" title="Scroll to bottom" aria-label="Scroll to bottom">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
            </svg>
        </button>
    </div>
    <small style="font-size:0.8rem;"><em>Uses AI. Verify results.</em></small>
    <br>
    <div class="input-section">
        <textarea id="promptInput" placeholder="Enter your prompt..." disabled rows="1"></textarea>
        <button id="submitBtn" title="Send" aria-label="Send" type="button"></button>
        <button id="clearBtn" title="Clear" aria-label="Clear" type="button"></button>
    </div>
</div>

<script>
    /* ========== CONSTANTS & INITIALIZATION ========== */
    const converter = new showdown.Converter({
        "customizedHeaderId"      : true,
        "parseImgDimensions"      : true,
        "simplifiedAutoLink"      : true,
        "strikethrough"           : true,
        "tables"                  : true,
        "tablesHeaderId"          : true,
        "tasklists"               : true,
        "backslashEscapesHTMLTags": true,
        "emoji"                   : true,
        "underline"               : true,
        "splitAdjacentBlockquotes": true,
        "simpleLineBreaks"        : true,
        "ghCompatibleHeaderId"    : true,
        "disableForced4SpacesIndentedSublists": true
    });

    const PREVIEW_ID = 'anticipationPreview';
    const PING_INTERVAL_MS = 60 * 1000; // 60 seconds

    /* ========== GLOBAL STATE VARIABLES ========== */
    let currentSessionUuid = null;
    let pollingInterval = null;
    let pingInterval = null;
    let isProcessing = false;
    let autoScrollEnabled = true;
    let isScrollingProgrammatically = false;
    let lastContentUpdateTime = 0;

    // Store session uuid in global in-memory variable (no localStorage persistence)
    if (typeof window !== 'undefined') {
        window.mini_a_session_uuid = window.mini_a_session_uuid || null;
    }

    /* ========== DOM ELEMENT REFERENCES ========== */
    const promptInput = document.getElementById('promptInput');
    const submitBtn = document.getElementById('submitBtn');
    const clearBtn = document.getElementById('clearBtn');
    const resultsDiv = document.getElementById('resultsDiv');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

    /* ========== UTILITY FUNCTIONS ========== */
    function isAtBottom() {
        if (!resultsDiv) return true;
        const threshold = 50; // Allow margin for rounding errors
        return resultsDiv.scrollTop + resultsDiv.clientHeight >= resultsDiv.scrollHeight - threshold;
    }

    function getOrCreateSessionUuid() {
        try {
            let uuid = (typeof window !== 'undefined') ? window.mini_a_session_uuid : null;
            if (uuid) return uuid;

            // Prefer crypto.randomUUID if available
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                uuid = crypto.randomUUID();
            } else {
                // Fallback to RFC4122 v4-like generator
                uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            if (typeof window !== 'undefined') window.mini_a_session_uuid = uuid;
            return uuid;
        } catch (e) {
            // Last resort: return non-persistent uuid
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') 
                return crypto.randomUUID();
            return 'tmp-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        }
    }

    function updateResultsContent(htmlContent) {
        if (!resultsDiv) return;
        
        const wasAtBottom = isAtBottom();
        const currentScrollBtn = document.getElementById('scrollToBottomBtn');
        const wasScrollBtnVisible = (currentScrollBtn && currentScrollBtn.classList.contains('show')) || !autoScrollEnabled;
        
        resultsDiv.innerHTML = htmlContent;
        
        // Re-add scroll button
        const scrollBtnHTML = `
            <button id="scrollToBottomBtn" title="Scroll to bottom" aria-label="Scroll to bottom">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
                </svg>
            </button>`;
        resultsDiv.insertAdjacentHTML('beforeend', scrollBtnHTML);
        
        // Reattach event listener and restore state
        const newScrollBtn = document.getElementById('scrollToBottomBtn');
        if (newScrollBtn) {
            newScrollBtn.addEventListener('click', () => {
                autoScrollEnabled = true;
                scrollResultsToBottom();
                hideScrollToBottomButton();
            });
            
            if (wasScrollBtnVisible && !wasAtBottom) {
                newScrollBtn.classList.add('show');
            }
        }
        
        lastContentUpdateTime = Date.now();
        
        if (wasAtBottom) {
            autoScrollEnabled = true;
            scrollResultsToBottom();
        }
    }

    /* ========== UI MANIPULATION FUNCTIONS ========== */
    function showScrollToBottomButton() {
        const btn = document.getElementById('scrollToBottomBtn');
        if (btn) btn.classList.add('show');
    }

    function hideScrollToBottomButton() {
        const btn = document.getElementById('scrollToBottomBtn');
        if (btn) btn.classList.remove('show');
    }

    function scrollResultsToBottom() {
        if (!autoScrollEnabled) return;
        
        try {
            isScrollingProgrammatically = true;
            resultsDiv.scrollTop = resultsDiv.scrollHeight;
            setTimeout(() => { isScrollingProgrammatically = false; }, 10);
        } catch (e) {
            console.error('Scroll error:', e);
            isScrollingProgrammatically = false;
        }
    }

    function setSubmitIcon(state) {
        if (!submitBtn) return;
        
        submitBtn.classList.toggle('stop', state === 'stop');
        
        if (state === 'stop') {
            submitBtn.title = 'Stop';
            submitBtn.setAttribute('aria-label', 'Stop');
            submitBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <rect x="5" y="5" width="14" height="14" rx="2"></rect>
                </svg>`;
        } else {
            submitBtn.title = 'Send';
            submitBtn.setAttribute('aria-label', 'Send');
            submitBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M12 19V5m-7 7l7-7 7 7" />
                </svg>`;
        }
    }

    function setClearIcon() {
        if (!clearBtn) return;
        
        clearBtn.title = 'Clear';
        clearBtn.setAttribute('aria-label', 'Clear');
        clearBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>`;
    }

    function autoResizeTextarea() {
        if (!promptInput) return;
        
        promptInput.style.height = 'auto';
        
        const minHeight = parseFloat(getComputedStyle(promptInput).minHeight);
        const maxHeight = parseFloat(getComputedStyle(promptInput).maxHeight);
        let newHeight = Math.max(minHeight, promptInput.scrollHeight);
        
        if (maxHeight && newHeight > maxHeight) {
            newHeight = maxHeight;
            promptInput.style.overflowY = 'auto';
        } else {
            promptInput.style.overflowY = 'hidden';
        }
        
        promptInput.style.height = newHeight + 'px';
    }

    function addPreview() {
        if (document.getElementById(PREVIEW_ID)) return;
        const el = document.createElement('div');
        el.id = PREVIEW_ID;
        el.className = 'preview';
        resultsDiv.appendChild(el);
        scrollResultsToBottom();
    }

    function removePreview() {
        const el = document.getElementById(PREVIEW_ID);
        if (el) el.remove();
    }

    /* ========== PROCESSING STATE MANAGEMENT ========== */
    function startProcessing() {
        isProcessing = true;
        autoScrollEnabled = true;
        promptInput.disabled = true;
        promptInput.value = '';
        promptInput.style.height = 'auto';
        promptInput.style.overflowY = 'hidden';
        setSubmitIcon('stop');
        submitBtn.classList.add('stop');
        clearBtn.disabled = true;
        scrollResultsToBottom();
        addPreview();
    }

    function stopProcessing() {
        isProcessing = false;
        promptInput.disabled = false;
        setSubmitIcon('send');
        submitBtn.classList.remove('stop');
        clearBtn.disabled = false;
        
        if (pollingInterval) {
            clearInterval(pollingInterval);
            pollingInterval = null;
        }
        
        if (currentSessionUuid) {
            fetch('/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: currentSessionUuid, request: 'stop' })
            }).catch(error => console.error('Error stopping request:', error));
        }
        
        currentSessionUuid = null;
        removePreview();
    }

    /* ========== API FUNCTIONS ========== */
    async function handleSubmit() {
        if (isProcessing) {
            await stopProcessing();
            return;
        }

        const prompt = promptInput.value.trim();
        if (!prompt) return;

        try {
            if (!currentSessionUuid) currentSessionUuid = getOrCreateSessionUuid();

            const response = await fetch('/prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: prompt, uuid: currentSessionUuid })
            });

            if (!response.ok) throw new Error('Failed to submit prompt');

            await response.json();
            startProcessing();
            startPolling();
            
        } catch (error) {
            console.error('Error submitting prompt:', error);
            updateResultsContent('<p style="color: red;">Error submitting prompt. Please try again.</p>');
        }
    }

    function startPolling() {
        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/result', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid: currentSessionUuid })
                });

                if (!response.ok) throw new Error('Failed to fetch results');

                const data = await response.json();
                const htmlContent = converter.makeHtml(data.content || '');
                updateResultsContent(htmlContent);
                
                hljs.highlightAll();
                if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
                __refreshDarkMode();

                if (data.status === 'finished') {
                    removePreview();
                    stopProcessing();
                } else {
                    addPreview();
                }
                
            } catch (error) {
                console.error('Error fetching results:', error);
                updateResultsContent('<p style="color: red;">Error fetching results. Please try again.</p>');
                stopProcessing();
            }
        }, 1500);
    }

    /* ========== PING MANAGEMENT ========== */
    function startPing() {
        try {
            if (pingInterval) return;

            let uuid = (typeof window !== 'undefined') ? window.mini_a_session_uuid : null;
            if (!uuid) uuid = getOrCreateSessionUuid();

            sendPing(uuid);
            pingInterval = setInterval(() => sendPing(uuid), PING_INTERVAL_MS);
        } catch (e) {
            console.error('startPing error:', e);
        }
    }

    function stopPing() {
        if (pingInterval) {
            clearInterval(pingInterval);
            pingInterval = null;
        }
    }

    async function sendPing(uuid) {
        if (!uuid) return;
        try {
            await fetch('/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid })
            });
        } catch (e) {
            console.debug('ping error for', uuid, e);
        }
    }

    /* ========== EVENT HANDLERS ========== */
    function handleClearClick() {
        const uuidToClear = currentSessionUuid || 
            (typeof window !== 'undefined' ? window.mini_a_session_uuid : null);

        if (isProcessing) {
            stopProcessing();
        }

        if (uuidToClear) {
            fetch('/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: uuidToClear })
            }).catch(err => console.error('Error sending clear request:', err));
        }

        updateResultsContent('<p></p>');
        removePreview();
        promptInput.value = '';

        try {
            if (typeof window !== 'undefined') window.mini_a_session_uuid = null;
        } catch (e) { /* ignore */ }

        try { stopPing(); } catch (e) { /* ignore */ }

        try {
            currentSessionUuid = getOrCreateSessionUuid();
        } catch (e) {
            currentSessionUuid = null;
        }

        autoScrollEnabled = true;
        promptInput.disabled = false;
        setSubmitIcon('send');
        submitBtn.classList.remove('stop');
        clearBtn.disabled = false;
        isProcessing = false;
        scrollResultsToBottom();
    }

    function handleScroll() {
        if (isScrollingProgrammatically) return;
        
        if (isAtBottom()) {
            autoScrollEnabled = true;
            hideScrollToBottomButton();
        } else {
            autoScrollEnabled = false;
            showScrollToBottomButton();
        }
    }

    function handleScrollToBottomClick() {
        autoScrollEnabled = true;
        scrollResultsToBottom();
        hideScrollToBottomButton();
    }

    /* ========== INITIALIZATION ========== */
    function initializeUI() {
        promptInput.disabled = false;
        setSubmitIcon('send');
        setClearIcon();
        
        // Add event listeners
        promptInput.addEventListener('input', autoResizeTextarea);
        promptInput.addEventListener('paste', () => setTimeout(autoResizeTextarea, 0));
        promptInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !promptInput.disabled) {
                e.preventDefault();
                handleSubmit();
            }
        });

        submitBtn.addEventListener('click', handleSubmit);
        clearBtn.addEventListener('click', handleClearClick);
        
        if (resultsDiv) {
            resultsDiv.addEventListener('scroll', handleScroll);
        }
        
        if (scrollToBottomBtn) {
            scrollToBottomBtn.addEventListener('click', handleScrollToBottomClick);
        }

        // Start ping system
        try { 
            startPing(); 
        } catch (e) { 
            console.error('Failed to start ping on load:', e); 
        }
    }

    // Initialize the application
    initializeUI();
</script>
<script src="/js/mdtablesort.js"></script>
<script>if (_isD) document.querySelectorAll('pre code').forEach((block) => { block.classList.add('hljs_dark') })</script>
<script src="/js/mdcodeclip.js"></script>
<script>
    /* ========== DARK MODE INTEGRATION ========== */
    function __applyDarkModeIfNeeded() {
        if (typeof _isD === 'undefined' || !_isD) return;

        const root = document.documentElement;
        const darkVars = {
            '--bg': '#0b0d11',
            '--panel-bg': '#0f1115',
            '--border': '#242629',
            '--accent': '#3390ff',
            '--accent-disabled': '#6b6f73',
            '--danger': '#d9534f',
            '--text': '#e6e6e6',
            '--preview-1': '#1a1c20',
            '--preview-2': '#111215',
            '--preview-highlight': 'rgba(255,255,255,0.06)'
        };

        Object.entries(darkVars).forEach(([k, v]) => root.style.setProperty(k, v));
    }

    // Initialize dark mode and listen for system preference changes
    document.addEventListener('DOMContentLoaded', function() {
        __refreshDarkMode();
        __applyDarkModeIfNeeded();
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        __refreshDarkMode();
        __applyDarkModeIfNeeded();
    });

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
        __refreshDarkMode();
        __applyDarkModeIfNeeded();
    });
</script>

