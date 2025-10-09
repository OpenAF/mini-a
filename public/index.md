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
                const isChatContainer = div.classList.contains('chat-container');
                const isHistoryElement = div.id === 'historyPanel' || div.id === 'historyOverlay' || (typeof div.closest === 'function' && div.closest('#historyPanel'));
                if (!isChatContainer && !isHistoryElement) {
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

            const historyBtn = document.getElementById('historyBtn');
            if (historyBtn) {
                historyBtn.style.background = 'linear-gradient(135deg, #274472 0%, #1a2f4a 100%)';
                historyBtn.style.color = '#e6f2ff';
                historyBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
                historyBtn.style.border = '1px solid rgba(255,255,255,0.08)';
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
                const isChatContainer = div.classList.contains('chat-container');
                const isHistoryElement = div.id === 'historyPanel' || div.id === 'historyOverlay' || (typeof div.closest === 'function' && div.closest('#historyPanel'));
                if (!isChatContainer && !isHistoryElement) {
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

            const historyBtn = document.getElementById('historyBtn');
            if (historyBtn) {
                historyBtn.style.background = 'linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%)';
                historyBtn.style.color = '#0d47a1';
                historyBtn.style.border = 'none';
                historyBtn.style.boxShadow = '0 2px 6px rgba(13,71,161,0.15)';
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
        align-items: flex-end;
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
    #clearBtn,
    #historyBtn {
        padding: 1.2px 2px;
        border: none;
        border-radius: 0.8vmin;
        cursor: pointer;
        font-size: 0.9rem;
        height: 35px;
        width: 40px;
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

    #historyBtn {
        background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%);
        color: #0d47a1;
        box-shadow: 0 2px 6px rgba(13,71,161,0.15);
    }

    /* Submit button stop state */
    #submitBtn.stop {
        background: linear-gradient(135deg, #dc3545 0%, #c82333 100%) !important;
        box-shadow: 0 2px 6px rgba(220,53,69,0.25) !important;
    }

    #submitBtn.stop:hover {
        background: linear-gradient(135deg, #c82333 0%, #a02027 100%) !important;
        box-shadow: 0 4px 12px rgba(220,53,69,0.35) !important;
        transform: translateY(-1px);
    }

    /* Button hover states */
    #submitBtn:hover:not(:disabled):not(.stop) {
        background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
        box-shadow: 0 4px 12px rgba(0,123,255,0.35);
        transform: translateY(-1px);
    }

    #clearBtn:hover:not(:disabled) {
        background: linear-gradient(135deg, #cccccc 0%, #bdbdbd 100%);
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        transform: translateY(-1px);
    }

    #historyBtn:hover:not(:disabled) {
        background: linear-gradient(135deg, #bbdefb 0%, #90caf9 100%);
        box-shadow: 0 4px 12px rgba(13,71,161,0.2);
        transform: translateY(-1px);
    }

    /* Button disabled state */
    #submitBtn:disabled, #clearBtn:disabled, #historyBtn:disabled {
        background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
        cursor: not-allowed;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    /* ========== HISTORY PANEL ========== */
    #historyOverlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.35);
        backdrop-filter: blur(2px);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
        z-index: 999;
    }

    #historyOverlay.show {
        opacity: 1;
        pointer-events: auto;
    }

    #historyPanel {
        position: fixed;
        top: 0;
        left: 0;
        height: 100vh;
        width: min(360px, 85vw);
        background: var(--panel-bg);
        color: var(--text);
        border-right: 1px solid var(--border);
        box-shadow: 6px 0 18px rgba(0,0,0,0.15);
        transform: translateX(-100%);
        transition: transform 0.3s ease;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        padding: 1.5rem 1rem;
        box-sizing: border-box;
        gap: 1rem;
    }

    #historyPanel.open {
        transform: translateX(0);
    }

    .history-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
    }

    .history-header h2 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 600;
    }

    .history-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .history-actions button {
        flex: 1 1 45%;
        padding: 0.6rem 0.8rem;
        border: 1px solid var(--border);
        border-radius: 0.6rem;
        background: var(--panel-bg);
        color: inherit;
        cursor: pointer;
        transition: background 0.2s ease, color 0.2s ease;
        font-size: 0.85rem;
    }

    .history-actions button:hover {
        background: var(--accent);
        color: #fff;
    }

    #closeHistoryBtn {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        padding: 0.2rem;
        border-radius: 0.4rem;
        transition: background 0.2s ease, color 0.2s ease;
    }

    #closeHistoryBtn:hover {
        background: rgba(51,144,255,0.1);
        color: var(--accent);
    }

    .history-list {
        flex: 1;
        overflow-y: auto;
        border: 1px solid var(--border);
        border-radius: 0.8rem;
        padding: 0.5rem;
        background: var(--panel-bg);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .history-item {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
        align-items: flex-start;
        padding: 0.6rem 0.8rem;
        padding-right: 2.6rem;
        border-radius: 0.7rem;
        border: 1px solid transparent;
        background: rgba(255,255,255,0.6);
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: border 0.2s ease, background 0.2s ease, transform 0.2s ease;
    }

    .history-item:hover {
        border-color: var(--accent);
        background: rgba(51,144,255,0.08);
        transform: translateX(4px);
    }

    .history-item.active {
        border-color: var(--accent);
        background: rgba(51,144,255,0.15);
    }

    .history-item-title {
        font-weight: 600;
        font-size: 0.95rem;
        line-height: 1.2;
    }

    .history-item-time {
        font-size: 0.75rem;
        opacity: 0.7;
    }

    .history-item-delete {
        position: absolute;
        top: 0.35rem;
        right: 0.35rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.9rem;
        height: 1.9rem;
        border-radius: 999px;
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        opacity: 0.65;
        transition: background 0.2s ease, opacity 0.2s ease, color 0.2s ease;
    }

    .history-item-delete:hover,
    .history-item-delete:focus-visible {
        opacity: 1;
        color: var(--danger);
        background: rgba(0,0,0,0.05);
    }

    .history-item-delete svg {
        width: 1rem;
        height: 1rem;
    }

    .history-empty {
        text-align: center;
        opacity: 0.7;
        padding: 1rem 0;
    }

    body.markdown-body-dark #historyPanel {
        background: #0f1115;
        color: #e6e6e6;
        border-color: #242629;
    }

    body.markdown-body-dark #historyOverlay {
        background: rgba(0, 0, 0, 0.6);
    }

    body.markdown-body-dark .history-list {
        background: #0f1115;
        border-color: #242629;
    }

    body.markdown-body-dark .history-item {
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.05);
    }

    body.markdown-body-dark .history-item-delete:hover,
    body.markdown-body-dark .history-item-delete:focus-visible {
        background: rgba(255,255,255,0.08);
    }

    body.markdown-body-dark .history-item:hover {
        background: rgba(51,144,255,0.2);
    }

    body.markdown-body-dark .history-item.active {
        background: rgba(51,144,255,0.25);
        border-color: var(--accent);
    }

    body.markdown-body-dark .history-actions button {
        background: rgba(255,255,255,0.05);
        border-color: #242629;
    }

    body.markdown-body-dark #closeHistoryBtn:hover {
        background: rgba(51,144,255,0.25);
        color: var(--accent);
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
        <button id="historyBtn" title="History" aria-label="History" type="button"></button>
    </div>
</div>

<div id="historyOverlay" aria-hidden="true"></div>
<div id="historyPanel" aria-hidden="true">
    <div class="history-header">
        <h2>Conversation History</h2>
        <button id="closeHistoryBtn" type="button" title="Close history" aria-label="Close history">✕</button>
    </div>
    <div class="history-actions">
        <button id="resumeHistoryBtn" type="button">Return to Current</button>
        <button id="clearHistoryBtn" type="button">Clear History</button>
    </div>
    <div id="historyList" class="history-list" role="list"></div>
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
    const HISTORY_STORAGE_KEY = 'mini_a_history';
    const HISTORY_TITLE_MAX_LENGTH = 80;

    /* ========== GLOBAL STATE VARIABLES ========== */
    let currentSessionUuid = null;
    let pollingInterval = null;
    let pingInterval = null;
    let isProcessing = false;
    let autoScrollEnabled = true;
    let isScrollingProgrammatically = false;
    let lastContentUpdateTime = 0;
    let lastSubmittedPrompt = '';
    let activeHistoryId = null;
    let historyEnabled = true;

    // Store session uuid in global in-memory variable (no localStorage persistence)
    if (typeof window !== 'undefined') {
        window.mini_a_session_uuid = window.mini_a_session_uuid || null;
    }

    /* ========== DOM ELEMENT REFERENCES ========== */
    const promptInput = document.getElementById('promptInput');
    const submitBtn = document.getElementById('submitBtn');
    const clearBtn = document.getElementById('clearBtn');
    const historyBtn = document.getElementById('historyBtn');
    const resultsDiv = document.getElementById('resultsDiv');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');
    const historyPanel = document.getElementById('historyPanel');
    const historyOverlay = document.getElementById('historyOverlay');
    const historyList = document.getElementById('historyList');
    const closeHistoryBtn = document.getElementById('closeHistoryBtn');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const resumeHistoryBtn = document.getElementById('resumeHistoryBtn');

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

    function escapeHtml(str) {
        if (typeof str !== 'string') {
            if (str === undefined || str === null) return '';
            str = String(str);
        }
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function loadStoredHistory() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return [];
        try {
            const stored = window.localStorage.getItem(HISTORY_STORAGE_KEY);
            if (!stored) return [];
            const parsed = JSON.parse(stored);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.error('Failed to load stored history:', error);
            return [];
        }
    }

    function persistHistory(entries) {
    if (typeof window === 'undefined' || typeof window.localStorage === 'undefined' || historyEnabled === false) return;
        try {
            window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(entries));
        } catch (error) {
            console.error('Failed to persist history:', error);
        }
    }

    function formatHistoryTitle(prompt, fallback = 'Conversation') {
        const base = (prompt || '').split('\n').map(line => line.trim()).find(Boolean) || fallback;
        if (base.length > HISTORY_TITLE_MAX_LENGTH) {
            return base.slice(0, HISTORY_TITLE_MAX_LENGTH - 3) + '...';
        }
        return base || fallback;
    }

    function formatHistoryTime(timestamp) {
        try {
            return new Date(timestamp).toLocaleString();
        } catch (e) {
            return '';
        }
    }

    function refreshHistoryPanel() {
        if (!historyList || historyEnabled === false) return;

        const entries = loadStoredHistory().slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        const activeUuid = currentSessionUuid || (typeof window !== 'undefined' ? window.mini_a_session_uuid : null);
        if (!activeHistoryId && activeUuid) {
            const activeEntry = entries.find(entry => entry.uuid === activeUuid);
            if (activeEntry) activeHistoryId = activeEntry.id;
        }

        if (entries.length === 0) {
            historyList.innerHTML = '<div class="history-empty">No saved conversations yet.</div>';
            return;
        }

        const rendered = entries.map(entry => {
            const isActive = entry.id === activeHistoryId;
            const entryId = escapeHtml(entry.id || '');
            const titleSource = entry.title || formatHistoryTitle(entry.prompt);
            const title = escapeHtml(titleSource);
            const timestamp = escapeHtml(formatHistoryTime(entry.timestamp));
            return `
                <div class="history-item${isActive ? ' active' : ''}" role="listitem" data-history-id="${entryId}" tabindex="0">
                    <span class="history-item-title">${title}</span>
                    <span class="history-item-time">${timestamp}</span>
                    <button class="history-item-delete" type="button" title="Delete conversation" aria-label="Delete ${title}" data-history-delete="${entryId}">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M3 6h18M10 11v7m4-7v7M5 6l1 14h12l1-14M9 6l1-2h4l1 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>`;
        }).join('');

        historyList.innerHTML = rendered;
    }

    function openHistoryPanel() {
        if (historyPanel) {
            historyPanel.classList.add('open');
            historyPanel.setAttribute('aria-hidden', 'false');
        }
        if (historyOverlay) {
            historyOverlay.classList.add('show');
            historyOverlay.setAttribute('aria-hidden', 'false');
        }
    }

    function closeHistoryPanel() {
        if (historyPanel) {
            historyPanel.classList.remove('open');
            historyPanel.setAttribute('aria-hidden', 'true');
        }
        if (historyOverlay) {
            historyOverlay.classList.remove('show');
            historyOverlay.setAttribute('aria-hidden', 'true');
        }
    }

    function applyHistoryAvailability(enabled) {
        historyEnabled = !!enabled;

        if (historyBtn) {
            historyBtn.style.display = historyEnabled ? '' : 'none';
            historyBtn.disabled = !historyEnabled;
        }

        if (historyPanel) {
            historyPanel.style.display = historyEnabled ? '' : 'none';
        }

        if (historyOverlay) {
            historyOverlay.style.display = historyEnabled ? '' : 'none';
        }

        if (!historyEnabled) {
            closeHistoryPanel();
        }
    }

    async function configureHistoryAvailability() {
        let shouldEnable = true;

        try {
            const response = await fetch('/info', {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error('Failed to load server info');
            }

            const data = await response.json();
            if (typeof data.usehistory === 'boolean') {
                shouldEnable = data.usehistory;
            }
        } catch (error) {
            console.error('Unable to determine history availability:', error);
        }

        applyHistoryAvailability(shouldEnable);

        if (historyEnabled) {
            refreshHistoryPanel();
        } else if (historyList) {
            historyList.innerHTML = '';
        }
    }

    function handleHistoryButtonClick() {
        if (historyEnabled === false) return;
        if (!historyPanel) return;
        if (historyPanel.classList.contains('open')) {
            closeHistoryPanel();
        } else {
            refreshHistoryPanel();
            openHistoryPanel();
        }
    }

    async function handleClearHistoryStorage() {
        if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') return;
        if (typeof window.confirm === 'function') {
            const shouldClear = window.confirm('Clear all stored conversations?');
            if (!shouldClear) return;
        }

        const entries = loadStoredHistory();

        window.localStorage.removeItem(HISTORY_STORAGE_KEY);
        activeHistoryId = null;
        refreshHistoryPanel();

        const uuidsToClear = entries
            .map(entry => entry && entry.uuid)
            .filter(uuid => typeof uuid === 'string' && uuid.length > 0);

        await Promise.allSettled(uuidsToClear.map(uuid => {
            return fetch('/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ uuid, force: true })
            }).catch(error => {
                console.error('Failed to clear conversation on server:', uuid, error);
            });
        }));
    }

    function handleHistoryEntryClick(entryId) {
        if (!entryId) return;
        const entries = loadStoredHistory();
        const entry = entries.find(item => item.id === entryId);
        if (!entry) return;
        loadConversationEntry(entry);
    }

    async function handleHistoryEntryDelete(entryId) {
        if (!entryId) return;

        const entries = loadStoredHistory();
        const index = entries.findIndex(item => item.id === entryId);
        if (index < 0) return;

        const entry = entries[index];
        if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
            const shouldDelete = window.confirm('Delete this conversation from history?');
            if (!shouldDelete) return;
        }

        entries.splice(index, 1);
        persistHistory(entries);

        if (activeHistoryId === entryId) {
            activeHistoryId = null;
        }

        refreshHistoryPanel();

        if (entry && entry.uuid) {
            try {
                await fetch('/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
                    body: JSON.stringify({ uuid: entry.uuid, force: true })
                });
            } catch (error) {
                console.error('Failed to clear conversation on server:', error);
            }
        }
    }

    function addConversationToHistory(sessionUuid, prompt, data) {
    if (typeof window === 'undefined' || !sessionUuid || historyEnabled === false) return null;

        const entries = loadStoredHistory();
        const existingIndex = entries.findIndex(item => item.uuid === sessionUuid);
        const existing = existingIndex >= 0 ? entries[existingIndex] : {};

        const id = existing.id || (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : 'hist-' + Date.now() + '-' + Math.floor(Math.random() * 1000));

        const hasHistoryArray = data && Array.isArray(data.history);
        const sourceEvents = hasHistoryArray
            ? data.history
            : (Array.isArray(existing.events) ? existing.events : []);

        const sanitizedEvents = sourceEvents
            .map(ev => {
                if (!ev || !ev.event) return null;
                const sanitized = { event: ev.event };
                if (typeof ev.message !== 'undefined' && ev.message !== null) {
                    sanitized.message = typeof ev.message === 'string' ? ev.message : JSON.stringify(ev.message);
                }
                return sanitized;
            })
            .filter(Boolean);

        const promptValue = prompt || existing.prompt || '';
        const titleSource = prompt || existing.title || existing.prompt || '';
        const contentValue = (data && typeof data.content === 'string') ? data.content : (existing.content || '');
        const statusValue = (data && typeof data.status !== 'undefined') ? data.status : (existing.status || 'finished');

        const entry = {
            id,
            uuid: sessionUuid,
            prompt: promptValue,
            title: formatHistoryTitle(titleSource),
            content: contentValue,
            events: sanitizedEvents,
            status: statusValue,
            timestamp: Date.now()
        };

        if ((!entry.events || entry.events.length === 0) && entry.prompt) {
            entry.events = [{ event: '👤', message: entry.prompt }];
        }

        if (entry.content && (!entry.events || !entry.events.some(ev => ev.event === 'final'))) {
            entry.events = entry.events || [];
            entry.events.push({ event: 'final', message: entry.content });
        }

        if (existingIndex >= 0) {
            entries[existingIndex] = entry;
        } else {
            entries.push(entry);
        }

        persistHistory(entries);
        activeHistoryId = entry.id;
        refreshHistoryPanel();
        return entry;
    }

    async function sendHistoryToServer(entry) {
        if (!entry || !entry.uuid) return;
        const payload = {
            uuid: entry.uuid,
            history: Array.isArray(entry.events) ? entry.events.map(ev => {
                const sanitized = { event: ev.event };
                if (typeof ev.message !== 'undefined' && ev.message !== null) {
                    sanitized.message = typeof ev.message === 'string' ? ev.message : JSON.stringify(ev.message);
                }
                return sanitized;
            }) : []
        };

        if (payload.history.length === 0) {
            if (entry.prompt) payload.history.push({ event: '👤', message: entry.prompt });
            if (entry.content) payload.history.push({ event: 'final', message: entry.content });
        }

        try {
            const response = await fetch('/load-history', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error('Failed to communicate with history endpoint');
            }

            await response.json().catch(() => ({}));
        } catch (error) {
            console.error('Error sending history to server:', error);
        }
    }

    async function loadConversationEntry(entry) {
        if (!entry) return;

        if (isProcessing) {
            stopProcessing();
        }

        activeHistoryId = entry.id;
        await sendHistoryToServer(entry);

        if (typeof window !== 'undefined') {
            window.mini_a_session_uuid = entry.uuid;
        }

        currentSessionUuid = entry.uuid;

        const htmlContent = converter.makeHtml(entry.content || '');
        updateResultsContent(htmlContent);
        try { hljs.highlightAll(); } catch (e) { /* ignore */ }
        if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
        __refreshDarkMode();
        refreshHistoryPanel();
        closeHistoryPanel();
    }

    async function refreshCurrentConversationView() {
        const uuid = currentSessionUuid || (typeof window !== 'undefined' ? window.mini_a_session_uuid : null);
        if (!uuid) {
            closeHistoryPanel();
            return;
        }

        if (typeof window !== 'undefined' && !activeHistoryId) {
            const entries = loadStoredHistory();
            const entry = entries.find(item => item.uuid === uuid);
            if (entry) activeHistoryId = entry.id;
        }

        try {
            const response = await fetch('/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ uuid })
            });

            if (!response.ok) throw new Error('Failed to load current conversation');

            const data = await response.json();
            const htmlContent = converter.makeHtml(data.content || '');
            updateResultsContent(htmlContent);
            try { hljs.highlightAll(); } catch (e) { /* ignore */ }
            if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
            __refreshDarkMode();
            refreshHistoryPanel();
        } catch (error) {
            console.error('Error refreshing conversation view:', error);
        } finally {
            closeHistoryPanel();
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

    function setHistoryIcon() {
        if (!historyBtn) return;

        historyBtn.title = 'History';
        historyBtn.setAttribute('aria-label', 'History');
        historyBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M3 12a9 9 0 1 1 9 9" />
                <polyline points="3 12 3 7 8 7" />
                <line x1="12" y1="12" x2="16" y2="14" />
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
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
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

        lastSubmittedPrompt = prompt;
        activeHistoryId = null;

        try {
            if (!currentSessionUuid) currentSessionUuid = getOrCreateSessionUuid();

            const response = await fetch('/prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
                    headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
                    if (currentSessionUuid && historyEnabled !== false) {
                        const savedEntry = addConversationToHistory(currentSessionUuid, lastSubmittedPrompt, data);
                        if (savedEntry) {
                            activeHistoryId = savedEntry.id;
                        }
                    }
                    lastSubmittedPrompt = '';
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
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
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
        activeHistoryId = null;
        refreshHistoryPanel();
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
        setHistoryIcon();

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

        if (historyBtn) {
            historyBtn.addEventListener('click', handleHistoryButtonClick);
        }

        if (historyOverlay) {
            historyOverlay.addEventListener('click', closeHistoryPanel);
        }

        if (closeHistoryBtn) {
            closeHistoryBtn.addEventListener('click', closeHistoryPanel);
        }

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', handleClearHistoryStorage);
        }

        if (resumeHistoryBtn) {
            resumeHistoryBtn.addEventListener('click', refreshCurrentConversationView);
        }

        if (historyList) {
            historyList.addEventListener('click', (event) => {
                const deleteBtn = event.target.closest('[data-history-delete]');
                if (deleteBtn) {
                    event.stopPropagation();
                    event.preventDefault();
                    const entryId = deleteBtn.getAttribute('data-history-delete');
                    handleHistoryEntryDelete(entryId);
                    return;
                }

                const item = event.target.closest('[data-history-id]');
                if (!item) return;
                const entryId = item.getAttribute('data-history-id');
                handleHistoryEntryClick(entryId);
            });

            historyList.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;

                if (event.target.closest('[data-history-delete]')) {
                    return;
                }

                const item = event.target.closest('[data-history-id]');
                if (!item) return;
                event.preventDefault();
                const entryId = item.getAttribute('data-history-id');
                handleHistoryEntryClick(entryId);
            });
        }

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

        configureHistoryAvailability();
        refreshHistoryPanel();
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
