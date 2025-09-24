<script src="showdown.min.js?raw=true"></script>
<script>
    document.title = 'Chat Interface';

    function __refreshDarkMode() {
        if (__isDark) {
            document.body.classList.add('markdown-body-dark')
            document.body.classList.add('hljs_dark')
            document.body.classList.add('njsmap_dark')
            document.body.bgColor = "#000000"

            document.querySelectorAll('pre code').forEach((block) => {
                block.classList.add('hljs_dark')
            })
        } else {
            document.body.classList.remove('markdown-body-dark')
            document.body.classList.remove('hljs_dark')
            document.body.classList.remove('njsmap_dark')
            document.body.bgColor = "#FFFFFF"

            document.querySelectorAll('pre code').forEach((block) => {
                block.classList.remove('hljs_dark')
            })
        }
    }
    var __isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    __refreshDarkMode()
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => {
        __isDark = event.matches
        __refreshDarkMode()
    })
</script>
<style>
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

    .chat-container {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg);
        color: var(--text);
    }

    .input-section {
        display: flex;
        gap: 1vmin; /* was 10px */
        margin-bottom: 2vmin; /* was 20px */
    }

    #promptInput {
        flex: 1;
        padding: 1vmin; /* was 10px */
        border: 0.1vmin solid var(--border); /* was 1px */
        border-radius: 0.4vmin; /* was 4px */
        background: transparent;
        color: inherit;
        font-size: 0.9rem;
    }

    #submitBtn {
        padding: 1vmin 2vmin; /* was 10px 20px */
        background-color: var(--accent);
        color: white;
        border: none;
        border-radius: 0.4vmin; /* was 4px */
        cursor: pointer;
        font-size: 1.4vmin; /* was 14px */
    }

    #submitBtn:disabled {
        background-color: var(--accent-disabled);
        cursor: not-allowed;
    }

    #submitBtn.stop {
        background-color: var(--danger);
    }

    #clearBtn {
        padding: 1vmin 2vmin; /* was 10px 20px */
        background-color: var(--border);
        color: var(--text);
        border: none;
        border-radius: 0.4vmin; /* was 4px */
        cursor: pointer;
        font-size: 1.4vmin; /* was 14px */
    }

    #clearBtn:disabled {
        background-color: var(--accent-disabled);
        cursor: not-allowed;
    }

    #resultsDiv {
        flex: 1;
        border: 0.1vmin solid var(--border); /* was 1px */
        border-radius: 0.4vmin; /* was 4px */
        padding: 2vmin; /* was 20px */
        overflow-y: auto;
        background-color: var(--panel-bg);
        color: inherit;
        zoom: 0.9;
    }

    /* Anticipation preview styles */
    .preview {
        margin-top: 1.6vmin; /* was 16px */
        height: 4.8vmin; /* was 48px */
        border-radius: 0.6vmin; /* was 6px */
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
        left: 1.2vmin; /* was 12px */
        right: 1.2vmin; /* was 12px */
        height: 1vmin; /* was 10px */
        background: var(--preview-highlight);
        border-radius: 0.4vmin; /* was 4px */
    }

    .preview::before { top: 1vmin; /* was 10px */ width: 65%; }
    .preview::after { top: 2.6vmin; /* was 26px */ width: 40%; }
    @keyframes shimmer {
        0% { background-position: 0% 50%; }
        100% { background-position: -200% 50%; }
    }
</style>
<div class="chat-container">
    <div id="resultsDiv">
        <p></p>
    </div>
    <small style="font-size:0.8rem;"><em>Uses AI. Verify results.</em></small>
    <br>
    <div class="input-section">
        <input type="text" id="promptInput" placeholder="Enter your prompt..." disabled>
        <button id="submitBtn" title="Send" aria-label="Send" type="button"></button>
        <button id="clearBtn" title="Clear" aria-label="Clear" type="button"></button>
    </div>
</div>

<script>
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
    let currentSessionUuid = null;
    // Store the session uuid in a global, in-memory variable (no localStorage persistence)
    if (typeof window !== 'undefined') window.mini_a_session_uuid = window.mini_a_session_uuid || null;
    let pollingInterval = null;
    let isProcessing = false;
    
    // Auto-scroll management variables
    let autoScrollEnabled = true;
    let isScrollingProgrammatically = false;
    let lastContentUpdateTime = 0;

    const promptInput = document.getElementById('promptInput');
    const submitBtn = document.getElementById('submitBtn');
    const clearBtn = document.getElementById('clearBtn');
    const resultsDiv = document.getElementById('resultsDiv');
    const PREVIEW_ID = 'anticipationPreview';

    // Helper function to check if user is at the bottom of the scroll area
    function isAtBottom() {
        if (!resultsDiv) return true;
        const threshold = 50; // Allow some margin for rounding errors
        return resultsDiv.scrollTop + resultsDiv.clientHeight >= resultsDiv.scrollHeight - threshold;
    }

    // Helper function to update content and track changes
    function updateResultsContent(htmlContent) {
        if (!resultsDiv) return;
        
        const wasAtBottom = isAtBottom();
        resultsDiv.innerHTML = htmlContent;
        lastContentUpdateTime = Date.now();
        
        // If user was at bottom before update, keep them there
        if (wasAtBottom) {
            autoScrollEnabled = true;
            scrollResultsToBottom();
        }
    }

    // Add scroll event listener to detect manual scrolling
    if (resultsDiv) {
        resultsDiv.addEventListener('scroll', () => {
            // Ignore scroll events that we triggered programmatically
            if (isScrollingProgrammatically) return;
            
            // Check if user scrolled back to bottom
            if (isAtBottom()) {
                autoScrollEnabled = true;
            } else {
                // User scrolled away from bottom, disable auto-scroll
                autoScrollEnabled = false;
            }
        });
    }

    // Helper: set submit button icon + tooltip. State: 'send' | 'stop'
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
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z" />
                </svg>`;
        }
    }

    // Helper: set clear button icon + tooltip
    function setClearIcon() {
        if (!clearBtn) return;
        clearBtn.title = 'Clear';
        clearBtn.setAttribute('aria-label', 'Clear');
        clearBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M19 13H13v6h-2v-6H5v-2h6V5h2v6h6v2z" />
            </svg>`;
    }

    // Initialize UI
    promptInput.disabled = false;
    // set initial icons and tooltips
    setSubmitIcon('send');
    setClearIcon();

    submitBtn.addEventListener('click', handleSubmit);
    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !promptInput.disabled) {
            handleSubmit();
        }
    });
    
    // Clear button behavior: send clear request with current session uuid and reset UI
    clearBtn.addEventListener('click', async () => {
            // Capture the UUID we'll clear (stopProcessing may null the in-memory uuid).
            // Use the in-memory global `window.mini_a_session_uuid` instead of localStorage.
            let uuidToClear = currentSessionUuid || (typeof window !== 'undefined' ? window.mini_a_session_uuid : null);

            // If processing, stop first (this will also clear polling and preview)
            if (isProcessing) {
                await stopProcessing();
            }

            // Send clear request to server with the captured/persisted uuid if available
            if (uuidToClear) {
                fetch('/clear', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ uuid: uuidToClear })
                }).catch(err => console.error('Error sending clear request:', err));
            }

        // Reset results area to the default welcome message and remove preview
        updateResultsContent('<p></p>');
        removePreview();

        // Clear the in-memory global UUID (fresh restart)
        try {
            if (typeof window !== 'undefined') window.mini_a_session_uuid = null;
        } catch (e) {
            // ignore
        }

        // stop pinging as we've cleared the persisted session
        try { stopPing(); } catch (e) { /* ignore */ }

        // Create a fresh in-memory UUID for subsequent prompts
        try {
            currentSessionUuid = getOrCreateSessionUuid();
        } catch (e) {
            currentSessionUuid = null;
        }

        // Reset auto-scroll state
        autoScrollEnabled = true;
        promptInput.disabled = false;
        setSubmitIcon('send');
        submitBtn.classList.remove('stop');
        clearBtn.disabled = false;
        isProcessing = false;
        scrollResultsToBottom();
    });

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

    function scrollResultsToBottom() {
        // Only auto-scroll if enabled and not disabled by user manual scrolling
        if (!autoScrollEnabled) return;
        
        try {
            isScrollingProgrammatically = true;
            resultsDiv.scrollTop = resultsDiv.scrollHeight;
            // Small delay to ensure the scroll event is processed
            setTimeout(() => {
                isScrollingProgrammatically = false;
            }, 10);
        } catch (e) {
            // ignore in unlikely error cases
            console.error('Scroll error:', e);
            isScrollingProgrammatically = false;
        }
    }

    async function handleSubmit() {
        if (isProcessing) {
            // Stop button clicked
            await stopProcessing();
            return;
        }

        const prompt = promptInput.value.trim();
        if (!prompt) return;

        try {
            // ensure we have a persistent uuid for this client
            if (!currentSessionUuid) currentSessionUuid = getOrCreateSessionUuid();

            const response = await fetch('/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt: prompt, uuid: currentSessionUuid })
            });

            if (!response.ok) {
                throw new Error('Failed to submit prompt');
            }

            // If server returns a different uuid, don't overwrite client uuid.
            // Read response but ignore any uuid the server returns.
            await response.json();

            startProcessing();
            startPolling();
            
        } catch (error) {
            console.error('Error submitting prompt:', error);
            updateResultsContent('<p style="color: red;">Error submitting prompt. Please try again.</p>');
        }
    }

    // Create or retrieve a session UUID stored in a global in-memory variable.
    function getOrCreateSessionUuid() {
        try {
            let uuid = (typeof window !== 'undefined') ? window.mini_a_session_uuid : null;
            if (uuid) return uuid;

            // Prefer crypto.randomUUID if available
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
                uuid = crypto.randomUUID();
            } else {
                // Fallback to a simple RFC4122 v4-like generator
                uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
                    return v.toString(16);
                });
            }

            if (typeof window !== 'undefined') window.mini_a_session_uuid = uuid;
            return uuid;
        } catch (e) {
            // last resort: return a non-persistent uuid
            if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
            return 'tmp-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        }
    }

    // Ping management: POST `{ uuid }` to `/ping` every 60 seconds using the
    // persisted `mini_a_session_uuid`. This keeps the server aware of active
    // clients even across page reloads. Uses a single interval and tolerates
    // missing localStorage or network errors.
    let pingInterval = null;
    const PING_INTERVAL_MS = 60 * 1000; // 60 seconds

    function startPing() {
        try {
            // avoid multiple intervals
            if (pingInterval) return;

            // Use the global in-memory uuid; create one if missing so pings can start.
            let uuid = (typeof window !== 'undefined') ? window.mini_a_session_uuid : null;
            if (!uuid) {
                uuid = getOrCreateSessionUuid();
            }

            // send an immediate ping, then set the interval
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
            // Don't surface ping failures to the user; log for debugging.
            console.debug('ping error for', uuid, e);
        }
    }

    function startProcessing() {
        isProcessing = true;
        autoScrollEnabled = true; // Enable auto-scroll for new processing
        promptInput.disabled = true;
        promptInput.value = '';
        setSubmitIcon('stop');
        submitBtn.classList.add('stop');
        clearBtn.disabled = true;
        //resultsDiv.innerHTML = '<p>Processing your request...</p>';
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
        
        // Send stop request if we have an active session
        if (currentSessionUuid) {
            fetch('/result', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ uuid: currentSessionUuid, request: 'stop' })
            }).catch(error => console.error('Error stopping request:', error));
        }
        
        // clear in-memory session but keep persisted uuid for future prompts
        currentSessionUuid = null;
        removePreview();
        // stop pinging while not actively using the UI
        //try { stopPing(); } catch (e) { /* ignore */ }
    }

    function startPolling() {
        pollingInterval = setInterval(async () => {
            try {
                const response = await fetch('/result', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ uuid: currentSessionUuid })
                });

                if (!response.ok) {
                    throw new Error('Failed to fetch results');
                }

                const data = await response.json();
                
                // Convert markdown to HTML and update content
                const htmlContent = converter.makeHtml(data.content || '');
                updateResultsContent(htmlContent);
                hljs.highlightAll();
                if (typeof __mdcodeclip !== "undefined") __mdcodeclip();

                // Check if finished
                if (data.status === 'finished') {
                    removePreview();
                    stopProcessing();
                } else {
                    addPreview(); // keep anticipation while streaming
                }
                
            } catch (error) {
                console.error('Error fetching results:', error);
                updateResultsContent('<p style="color: red;">Error fetching results. Please try again.</p>');
                stopProcessing();
            }
        }, 1500);
    }

    // Start pinging on initial load using the persisted uuid (if any).
    try { startPing(); } catch (e) { console.error('Failed to start ping on load:', e); }
</script>
<script src="/js/mdtablesort.js"></script>
<script>if (__isDark) document.querySelectorAll('pre code').forEach((block) => { block.classList.add('hljs_dark') })</script>
<script src="/js/mdcodeclip.js"></script>
<script>
    // Apply dark-mode equivalents when the global __isDark flag is true.
    (function applyDarkModeIfNeeded() {
        if (typeof __isDark === 'undefined' || !__isDark) return;

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
    })();
</script>

