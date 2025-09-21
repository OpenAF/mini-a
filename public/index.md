<script src="https://cdn.jsdelivr.net/npm/showdown@2.1.0/dist/showdown.min.js"></script>
<script>
    document.title = 'Chat Interface';
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
        gap: 10px;
        margin-bottom: 20px;
    }

    #promptInput {
        flex: 1;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: transparent;
        color: inherit;
    }

    #submitBtn {
        padding: 10px 20px;
        background-color: var(--accent);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    }

    #submitBtn:disabled {
        background-color: var(--accent-disabled);
        cursor: not-allowed;
    }

    #submitBtn.stop {
        background-color: var(--danger);
    }

    #resultsDiv {
        flex: 1;
        border: 1px solid var(--border);
        border-radius: 4px;
        padding: 20px;
        overflow-y: auto;
        background-color: var(--panel-bg);
        color: inherit;
    }

    /* Anticipation preview styles */
    .preview {
        margin-top: 16px;
        height: 48px;
        border-radius: 6px;
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
        left: 12px;
        right: 12px;
        height: 10px;
        background: var(--preview-highlight);
        border-radius: 4px;
    }

    .preview::before { top: 10px; width: 65%; }
    .preview::after { top: 26px; width: 40%; }
    @keyframes shimmer {
        0% { background-position: 0% 50%; }
        100% { background-position: -200% 50%; }
    }
</style>
<div class="chat-container">
    <div id="resultsDiv">
        <p>Welcome! Enter a prompt to start chatting.</p>
    </div>
    <small style="font-size:0.8rem;"><em>Uses AI. Verify results.</em></small>
    <br>
    <div class="input-section">
        <input type="text" id="promptInput" placeholder="Enter your prompt..." disabled>
        <button id="submitBtn">Send</button>
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
    let pollingInterval = null;
    let isProcessing = false;

    const promptInput = document.getElementById('promptInput');
    const submitBtn = document.getElementById('submitBtn');
    const resultsDiv = document.getElementById('resultsDiv');
    const PREVIEW_ID = 'anticipationPreview';

    // Initialize UI
    promptInput.disabled = false;
    
    submitBtn.addEventListener('click', handleSubmit);
    promptInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !promptInput.disabled) {
            handleSubmit();
        }
    });

    function addPreview() {
        if (document.getElementById(PREVIEW_ID)) return;
        const el = document.createElement('div');
        el.id = PREVIEW_ID;
        el.className = 'preview';
        resultsDiv.appendChild(el);
    }

    function removePreview() {
        const el = document.getElementById(PREVIEW_ID);
        if (el) el.remove();
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
            const response = await fetch('/prompt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ prompt: prompt })
            });

            if (!response.ok) {
                throw new Error('Failed to submit prompt');
            }

            const data = await response.json();
            currentSessionUuid = data.uuid;
            
            startProcessing();
            startPolling();
            
        } catch (error) {
            console.error('Error submitting prompt:', error);
            resultsDiv.innerHTML = '<p style="color: red;">Error submitting prompt. Please try again.</p>';
        }
    }

    function startProcessing() {
        isProcessing = true;
        promptInput.disabled = true;
        promptInput.value = '';
        submitBtn.textContent = 'Stop';
        submitBtn.classList.add('stop');
        resultsDiv.innerHTML = '<p>Processing your request...</p>';
        addPreview();
    }

    function stopProcessing() {
        isProcessing = false;
        promptInput.disabled = false;
        submitBtn.textContent = 'Send';
        submitBtn.classList.remove('stop');
        
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
                body: JSON.stringify({ 
                    uuid: currentSessionUuid,
                    request: 'stop' 
                })
            }).catch(error => console.error('Error stopping request:', error));
        }
        
        currentSessionUuid = null;
        removePreview();
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
                
                // Convert markdown to HTML
                const htmlContent = converter.makeHtml(data.content || '');
                resultsDiv.innerHTML = htmlContent;

                // Check if finished
                if (data.status === 'finished') {
                    removePreview();
                    stopProcessing();
                } else {
                    addPreview(); // keep anticipation while streaming
                }
                
            } catch (error) {
                console.error('Error fetching results:', error);
                resultsDiv.innerHTML = '<p style="color: red;">Error fetching results. Please try again.</p>';
                stopProcessing();
            }
        }, 1500);
    }
</script>

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

