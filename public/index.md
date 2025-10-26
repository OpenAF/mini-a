<script src="showdown.min.js?raw=true"></script>
<!-- Chart.js (v4 UMD) -->
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<!-- Time adapter (bundle includes date-fns) -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3/dist/chartjs-adapter-date-fns.bundle.min.js"></script>
<!-- Boxplot (scoped package name!) -->
<script src="https://cdn.jsdelivr.net/npm/@sgratzl/chartjs-chart-boxplot@4.4.5/build/index.umd.min.js"></script>
<!-- Treemap -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-treemap@3.1.0/dist/chartjs-chart-treemap.min.js"></script>
<!-- Sankey -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-sankey@0.14.0/dist/chartjs-chart-sankey.min.js"></script>
<!-- Matrix (v3 for Chart.js v4) -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-matrix@3.0.0/dist/chartjs-chart-matrix.min.js"></script>
<!-- Graph -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-graph@4.3.5/build/index.umd.min.js"></script>
<!-- Geo -->
<script src="https://cdn.jsdelivr.net/npm/chartjs-chart-geo@4.3.6/build/index.umd.min.js"></script>
<script>
    // Best-effort registration for plugins that expose globals in UMD builds
    // Some @sgratzl UMD bundles auto-register themselves if Chart is present
    // but we explicitly register the common ones when globals are available.
    (function registerChartPlugins() {
        if (!window || !window.Chart) return;
        const { Chart } = window;
        try { if (window.ChartDataLabels) Chart.register(window.ChartDataLabels); } catch (e) { /* noop */ }
        try {
            const annotation = window.ChartAnnotation || window['chartjs-plugin-annotation'] || window.annotationPlugin;
            if (annotation) Chart.register(annotation);
        } catch (e) { /* noop */ }
        // No action needed for date-fns adapter; it hooks the time scale when loaded.
    })();
    // Expose a flag for quick diagnostics in dev tools
    window.__chartjs_plugins_loaded = true;
</script>
<script type="module">
    import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
    mermaid.initialize({ 
        startOnLoad: false,
        theme: 'default',
        themeVariables: {
            darkMode: false
        }
    });
    window.mermaid = mermaid;
</script>
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
                const isAttachmentModal = div.id === 'attachmentModal';

                if (!isChatContainer && !isHistoryElement && !isAttachmentModal) {
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
                //promptInput.style.background = '#1a1d23';
                promptInput.style.background = 'transparent';
                promptInput.style.color = '#e6e6e6';
                promptInput.style.boxShadow = '0 1px 3px rgba(0,0,0,0.3)';
                promptInput.style.height = 'auto'
            }

            const inputSection = document.getElementById('inputSection');
            if (inputSection) {
                inputSection.style.background = '#1a1d23';
                inputSection.style.border = '1px solid #242629';
            }

            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) {
                submitBtn.style.background = 'linear-gradient(135deg, #3390ff 0%, #0056b3 100%)';
                submitBtn.style.color = '#e6e6e6';
            }

            const attachBtn = document.getElementById('attachBtn');
            if (attachBtn) {
                attachBtn.style.background = 'linear-gradient(135deg, #2d3238 0%, #1a1d23 100%)';
                attachBtn.style.color = '#e6e6e6';
                attachBtn.style.border = '1px solid rgba(255,255,255,0.1)';
                attachBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
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
                const isAttachmentModal = div.id === 'attachmentModal';
                if (!isChatContainer && !isHistoryElement && !isAttachmentModal) {
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
                /*promptInput.style.background = '#ffffff';*/
                promptInput.style.background = 'transparent';
                promptInput.style.color = '#000000';
                promptInput.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
                promptInput.style.height = 'auto'
            }

            const inputSection = document.getElementById('inputSection');
            if (inputSection) {
                inputSection.style.background = 'white';
                inputSection.style.border = '1px solid #cccccc';
            }

            const submitBtn = document.getElementById('submitBtn');
            if (submitBtn) {
                submitBtn.style.background = 'linear-gradient(135deg, #007bff 0%, #0056b3 100%)';
                submitBtn.style.color = 'white';
            }

            const attachBtn = document.getElementById('attachBtn');
            if (attachBtn) {
                attachBtn.style.background = 'linear-gradient(135deg, #f3f3f3 0%, #e0e0e0 100%)';
                attachBtn.style.color = '#333';
                attachBtn.style.border = 'none';
                attachBtn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.08)';
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

    .chartjs-chart {
        position: relative;
        max-width: 100%;
        overflow-x: auto;
    }

    .chartjs-chart canvas {
        display: block;
        width: 100%;
        height: auto !important;
    }

    /* ========== INPUT SECTION ========== */
    .input-section {
        display: flex;
        align-items: flex-end;
        gap: 0.8vmin;
        margin-bottom: 2vmin;
        background: white;
        border: 1px solid var(--border);
        border-radius: 1.2vmin;
        padding: 0.6vmin;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: box-shadow 0.2s ease;
    }

    .prompt-wrapper {
        flex: 1;
        display: grid;
        /*flex-direction: column;*/
        gap: 0.4vmin;
    /* min-height removed to allow textarea to grow */
    }

    .attachments-container {
        display: none;
        flex-wrap: wrap;
        gap: 0.4vmin;
        align-items: center;
    }

    .attachments-container.visible {
        display: flex;
    }

    .attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.5em;
        padding: 0.35em 0.6em;
        background: rgba(0,123,255,0.12);
        border: 1px solid rgba(0,123,255,0.35);
        border-radius: 0.25rem;
        font-size: 0.8rem;
        color: inherit;
        max-width: 100%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }

    .attachment-chip span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .attachment-chip button {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 0.8rem;
        width: 1.4em;
        height: 1.4em;
        border-radius: 50%;
        transition: background 0.2s ease, color 0.2s ease;
    }

    .attachment-chip button:hover,
    .attachment-chip button:focus-visible {
        background: rgba(0,0,0,0.08);
        color: var(--danger);
    }

    #promptInput {
        flex: 1;
        padding: 0.7vmin;
        border: none;
        border-radius: 0.8vmin;
        background: transparent;
        color: inherit;
        font-size: 0.9rem;
        font-family: inherit;
        line-height: 1.5;
        resize: none;
        overflow-y: auto;
        min-height: 2.4em;
        max-height: 20vh;
        height: auto;
        box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        outline: none;
        transition: box-shadow 0.2s ease;
        box-sizing: border-box;
        /*zoom: 0.9;*/
    }

    #promptInput:focus {
        outline: none;
        box-shadow: 0 2px 6px rgba(0,123,255,0.15);
    }

    /* ========== BUTTONS ========== */

    #attachBtn,
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

    #attachBtn {
        background: linear-gradient(135deg, #f3f3f3 0%, #e0e0e0 100%);
        color: #333;
        box-shadow: 0 2px 6px rgba(0,0,0,0.08);
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

    #attachBtn:hover:not(:disabled),
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
    #submitBtn:disabled, #attachBtn:disabled, #clearBtn:disabled, #historyBtn:disabled {
        background: linear-gradient(135deg, #6c757d 0%, #5a6268 100%);
        cursor: not-allowed;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }

    .user-attachment {
        display: inline-flex;
        align-items: center;
        gap: 0.4em;
        margin: 0.2em 0;
        padding: 0.3em 0.7em;
        border-radius: 0.25rem;
        border: 1px solid rgba(0,123,255,0.35);
        background: rgba(0,123,255,0.1);
        color: inherit;
        cursor: pointer;
        font-size: 0.8rem;
        transition: background 0.2s ease, box-shadow 0.2s ease;
    }

    .user-attachment:hover,
    .user-attachment:focus-visible {
        background: rgba(0,123,255,0.2);
        box-shadow: 0 3px 8px rgba(0,123,255,0.25);
    }

    .attachment-modal {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        /* Blur content underneath the modal */
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        transition: backdrop-filter 0.2s ease, background 0.2s ease;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 2rem;
        z-index: 2000;
    }

    .attachment-modal.open {
        display: flex;
    }

    .attachment-modal-content {
        width: min(95vw, 1200px);
        max-height: 90vh;
        /* Semi-transparent background for frosted glass effect */
        background: rgba(255, 255, 255, 0.4);
        backdrop-filter: blur(40px) saturate(1.8);
        -webkit-backdrop-filter: blur(40px) saturate(1.8);
        border: 1px solid rgba(0, 0, 0, 0.1);
        box-shadow: 
            0 12px 32px rgba(0,0,0,0.35),
            inset 0 1px 0 rgba(255, 255, 255, 0.5);
        color: inherit;
        border-radius: 1rem;
        display: flex;
        flex-direction: column;
        overflow: hidden;
    }

    .attachment-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.2rem;
        border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        background: transparent;
        gap: 1rem;
    }

    .attachment-modal-header h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .attachment-modal-close {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 1rem;
        display: inline-flex;
        width: 2rem;
        height: 2rem;
        align-items: center;
        justify-content: center;
        border-radius: 0.25rem;
        transition: background 0.2s ease, color 0.2s ease;
    }

    .attachment-modal-close:hover,
    .attachment-modal-close:focus-visible {
        background: rgba(0,0,0,0.08);
        color: var(--danger);
    }

    .attachment-modal-body {
        padding: 1rem 1.2rem 1.2rem 1.2rem;
        overflow: auto;
        background: transparent;
    }

    .attachment-modal-body pre {
        margin: 0;
        max-height: 75vh;
        overflow: auto;
        border-radius: 0.8rem;
        border: 1px solid rgba(0, 0, 0, 0.08);
        background: rgba(255, 255, 255, 0.3);
        padding: 1rem;
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
        border-radius: 0.25rem;
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

    body.markdown-body-dark .attachment-chip {
        background: rgba(51,144,255,0.18);
        border-color: rgba(51,144,255,0.4);
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
    }

    body.markdown-body-dark .attachment-chip button:hover,
    body.markdown-body-dark .attachment-chip button:focus-visible {
        background: rgba(255,255,255,0.12);
    }

    body.markdown-body-dark .user-attachment {
        background: rgba(51,144,255,0.18);
        border-color: rgba(51,144,255,0.4);
        box-shadow: 0 3px 8px rgba(0,0,0,0.5);
    }

    body.markdown-body-dark .user-attachment:hover,
    body.markdown-body-dark .user-attachment:focus-visible {
        background: rgba(51,144,255,0.25);
    }
    body.markdown-body-dark #attachBtn,
    body.markdown-body-dark #clearBtn {
        background: linear-gradient(135deg, #23262b 0%, #181a1d 100%) !important;
        color: #e6e6e6 !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.18);
        border: 1.5px solid rgba(255,255,255,0.08) !important;
    }

    body.markdown-body-dark .attachment-modal-content {
        /* Dark theme frosted glass effect */
        background: rgba(15, 17, 21, 0.4);
        backdrop-filter: blur(40px) saturate(1.8);
        -webkit-backdrop-filter: blur(40px) saturate(1.8);
        border: 1px solid rgba(255, 255, 255, 0.08);
        box-shadow: 
            0 18px 40px rgba(0,0,0,0.65),
            inset 0 1px 0 rgba(255, 255, 255, 0.05);
    }

    body.markdown-body-dark .attachment-modal-header {
        background: transparent;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    body.markdown-body-dark .attachment-modal-body {
        background: transparent;
    }

    /* Dark mode overlay tweaks for modal */
    body.markdown-body-dark .attachment-modal {
        background: rgba(0,0,0,0.6);
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
    }

    body.markdown-body-dark .attachment-modal-body pre {
        background: rgba(0, 0, 0, 0.3);
        border-color: rgba(255, 255, 255, 0.08);
    }

    body.markdown-body-dark .attachment-modal-close:hover,
    body.markdown-body-dark .attachment-modal-close:focus-visible {
        background: rgba(255,255,255,0.12);
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

    /* ========== COPY ACTIONS ========== */
    .copy-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-start;
        align-items: center;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.3s ease;
        margin-top: 1rem;
        margin-bottom: 1rem;
        padding-left: 0.5rem;
    }

    .copy-actions.show {
        opacity: 1;
        pointer-events: auto;
    }

    .copy-actions button {
        background: transparent;
        color: var(--text);
        border: none;
        border-radius: 4px;
        width: 28px;
        height: 28px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: none;
        transition: all 0.2s ease;
        padding: 0;
        position: relative;
        opacity: 0.6;
    }

    .copy-actions button:hover {
        background: var(--panel-bg);
        box-shadow: none;
        opacity: 1;
    }

    .copy-actions button:active {
        transform: translateY(0);
        box-shadow: none;
    }

    .copy-actions button.copied svg {
        opacity: 0;
    }

    .copy-actions button.copied::after {
        content: '✓';
        position: absolute;
        font-size: 16px;
        font-weight: bold;
        color: var(--text);
    }

    .copy-actions button svg {
        pointer-events: none;
        transition: opacity 0.2s ease;
    }

    /* ========== LOADING PREVIEW ANIMATION ========== */
    
    /* Reduce spacing before preview animation */
    #resultsDiv > p:has(+ .preview),
    #resultsDiv > div:has(+ .preview),
    #resultsDiv > *:has(+ .preview) {
        margin-bottom: 0 !important;
    }
    
    .preview {
        margin-top: 0.5em;
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

    /* ========== PLAN PANEL ========== */
    .plan-panel {
        margin-top: 0.6rem;
        border: 1px solid var(--border);
        border-radius: 0.6rem;
        background: var(--panel-bg);
        color: var(--text);
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
        overflow: hidden;
    }

    .plan-panel[hidden] {
        display: none;
    }

    .plan-panel[open] {
        box-shadow: 0 6px 18px rgba(0,0,0,0.12);
        border-color: rgba(51,144,255,0.35);
    }

    .plan-panel summary {
        list-style: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.6rem;
        padding: 0.6rem 0.7rem;
        cursor: pointer;
        font-weight: 600;
    }

    .plan-panel summary::-webkit-details-marker {
        display: none;
    }

    .plan-panel summary:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 4px;
        border-radius: 0.75rem;
    }

    .plan-summary-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
    }

    .plan-summary-text {
        font-size: 0.9rem;
        letter-spacing: 0.01em;
    }

    .plan-summary-icon {
        font-size: 1rem;
        opacity: 0.8;
    }

    .plan-progress-ring {
        width: 24px;
        height: 24px;
    }

    .plan-progress-ring-bg {
        fill: none;
        stroke: var(--border);
        stroke-width: 2.5;
        opacity: 0.45;
    }

    .plan-progress-ring-value {
        fill: none;
        stroke: var(--accent);
        stroke-width: 2.5;
        stroke-linecap: round;
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        transition: stroke-dashoffset 0.4s ease;
    }

    .plan-panel-body {
        padding: 0.3rem 0.9rem 0.6rem 0.9rem;
        border-top: 1px solid var(--border);
        background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0));
    }

    .plan-list {
        list-style: none;
        padding: 0;
        margin: 0;
        counter-reset: plan-step;
    }

    .plan-item {
        display: grid;
        grid-template-columns: min-content min-content 1fr auto;
        align-items: center;
        gap: 0.5rem;
        padding: 0.3rem 0;
        border-bottom: 1px solid rgba(255,255,255,0.04);
    }

    .plan-item:last-child {
        border-bottom: none;
    }

    .plan-item::before {
        counter-increment: plan-step;
        content: counter(plan-step) '.';
        font-weight: 600;
        color: var(--text);
        opacity: 0.8;
    }

    .plan-item-icon {
        font-size: 1rem;
        line-height: 1;
    }

    .plan-item-text {
        font-size: 0.9rem;
        line-height: 1.35;
    }

    .plan-item-text.completed {
        text-decoration: line-through;
        opacity: 0.6;
    }

    .plan-item-status {
        justify-self: end;
        font-size: 0.72rem;
        padding: 0.15rem 0.5rem;
        border-radius: 999px;
        background: rgba(51,144,255,0.12);
        color: var(--accent);
        text-transform: capitalize;
        letter-spacing: 0.03em;
        font-weight: 600;
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
        <!-- Copy actions -->
        <div id="copyActions" class="copy-actions">
            <button id="copyLastAnswerBtn" title="Copy last answer" aria-label="Copy last answer" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
            </button>
            <button id="copyConversationBtn" title="Copy entire conversation" aria-label="Copy entire conversation" type="button">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                </svg>
            </button>
        </div>
    </div>
    <details id="planPanel" class="plan-panel" hidden>
        <summary>
            <span class="plan-summary-left">
                <svg class="plan-progress-ring" viewBox="0 0 36 36" aria-hidden="true">
                    <path class="plan-progress-ring-bg" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831a15.9155 15.9155 0 1 1 0-31.831" />
                    <path id="planProgressValue" class="plan-progress-ring-value" d="M18 2.0845a15.9155 15.9155 0 1 1 0 31.831a15.9155 15.9155 0 1 1 0-31.831" stroke-dasharray="100" stroke-dashoffset="100" />
                </svg>
                <span id="planSummaryText" class="plan-summary-text">0% overall · 0/0 tasks completed</span>
            </span>
            <span class="plan-summary-icon" aria-hidden="true">🗺️</span>
        </summary>
        <div class="plan-panel-body">
            <ol id="planList" class="plan-list"></ol>
        </div>
    </details>
    <small style="font-size:0.8rem;"><em>Uses AI. Verify results.</em></small>
    <br>
    <div id="inputSection" class="input-section">
        <button id="attachBtn" title="Attach files" aria-label="Attach files" type="button"></button>
        <input type="file" id="fileInput" accept="text/*,.md,.markdown,.txt,.json,.yaml,.yml,.csv,.tsv,.xml,.html,.css,.scss,.less,.js,.ts,.jsx,.tsx,.py,.rb,.go,.java,.kt,.c,.cpp,.cs,.rs,.php,.sh,.bash,.zsh,.fish,.sql,.toml,.ini,.env" multiple style="display:none" />
        <div class="prompt-wrapper">
            <div id="attachmentsContainer" class="attachments-container" aria-live="polite"></div>
            <textarea id="promptInput" placeholder="Enter your prompt..." rows="1" disabled></textarea>
        </div>
        <button id="submitBtn" title="Send" aria-label="Send" type="button"></button>
        <button id="clearBtn" title="Clear" aria-label="Clear" type="button"></button>
        <button id="historyBtn" title="History" aria-label="History" type="button"></button>
    </div>
</div>

<div id="attachmentModal" class="attachment-modal" aria-hidden="true">
    <div class="attachment-modal-content" role="dialog" aria-modal="true" aria-labelledby="attachmentModalTitle">
        <div class="attachment-modal-header">
            <h3 id="attachmentModalTitle"></h3>
            <button id="attachmentModalClose" class="attachment-modal-close" type="button" aria-label="Close attachment preview">✕</button>
        </div>
        <div class="attachment-modal-body">
            <pre><code id="attachmentModalCode" class="hljs"></code></pre>
        </div>
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
    const MAX_ATTACHMENT_SIZE = 512 * 1024; // 512 KB per file
    const TEXT_FILE_EXTENSIONS = new Set([
        'txt','md','markdown','json','yaml','yml','csv','tsv','xml','html','htm','css','scss','less','js','mjs','cjs','ts','jsx','tsx','py','rb','go','java','kt','c','h','cpp','cc','hpp','cs','rs','php','sh','bash','zsh','fish','sql','toml','ini','cfg','conf','env','properties','gradle','dockerfile','makefile','cmake','r','lua','swift','scala'
    ]);
    const ATTACHMENT_LANGUAGE_MAP = {
        md: 'markdown', markdown: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml',
        csv: 'csv', tsv: 'tsv', xml: 'xml', html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
        js: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx',
        py: 'python', rb: 'ruby', go: 'go', java: 'java', kt: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
        rs: 'rust', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', sql: 'sql', toml: 'toml', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini',
        properties: 'ini', gradle: 'groovy', dockerfile: 'dockerfile', makefile: 'makefile', cmake: 'cmake', r: 'r', lua: 'lua', swift: 'swift', scala: 'scala'
    };
    const PLAN_DONE_STATUSES = new Set(['done', 'complete', 'completed', 'finished', 'success']);

    /* ========== CHART PREPROCESSING ========== */
    let chartBlockStore = [];

    /**
     * Preprocesses markdown to extract chart blocks that might be
     * malformed due to preceding image syntax or inline text.
     * Returns normalized markdown with chart placeholders.
     */
    function preprocessChartBlocks(markdown) {
        if (!markdown) return markdown;
        chartBlockStore = [];
        let counter = 0;
        
        // Match chart blocks that may be preceded by anything on the same line
        // Pattern: (optional content)```chart or ```chartjs or ```chart.js
        const pattern = /^(.*)```(chart(?:\.js|-js)?|chartjs)\s*\n([\s\S]*?)\n```/gm;
        
        const processed = markdown.replace(pattern, (match, prefix, lang, content) => {
            const id = counter++;
            const trimmedPrefix = (prefix || '').trim();
            
            // Store the chart config
            chartBlockStore.push({
                id: id,
                content: content,
                language: lang
            });
            
            // Return a clean marker that will survive markdown conversion
            // If there was a prefix (like ![text]), preserve it on a separate line
            const marker = `<div class="chart-placeholder" data-chart-id="${id}"></div>`;
            return trimmedPrefix ? `${trimmedPrefix}\n\n${marker}` : marker;
        });
        
        return processed;
    }

    /**
     * Restores chart blocks after markdown conversion by replacing
     * placeholders with properly formatted code blocks.
     */
    function postprocessChartBlocks(html) {
        if (!html || chartBlockStore.length === 0) return html;
        
        let processed = html;
        chartBlockStore.forEach(item => {
            const placeholder = `<div class="chart-placeholder" data-chart-id="${item.id}"></div>`;
            // Create a proper pre/code structure with chart class
            const replacement = `<pre><code class="language-chart">${escapeHtml(item.content)}</code></pre>`;
            processed = processed.replace(placeholder, replacement);
        });
        
        // Clear the store after processing
        chartBlockStore = [];
        return processed;
    }

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
    let attachmentsEnabled = false;
    let attachments = [];
    let attachmentModalKeyListenerBound = false;
    let lastPlanDigest = '';
    let chartResizeTimer = null;
    let chartResizeHandlerBound = false;
    let lastRawContent = '';
    let lastRenderedHtml = '';

    // Store session uuid in global in-memory variable (no localStorage persistence)
    if (typeof window !== 'undefined') {
        window.mini_a_session_uuid = window.mini_a_session_uuid || null;
    }

    /* ========== DOM ELEMENT REFERENCES ========== */
    const promptInput = document.getElementById('promptInput');
    const attachBtn = document.getElementById('attachBtn');
    const fileInput = document.getElementById('fileInput');
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
    const attachmentsContainer = document.getElementById('attachmentsContainer');
    const attachmentModal = document.getElementById('attachmentModal');
    const attachmentModalTitle = document.getElementById('attachmentModalTitle');
    const attachmentModalCode = document.getElementById('attachmentModalCode');
    const attachmentModalClose = document.getElementById('attachmentModalClose');
    const planPanel = document.getElementById('planPanel');
    const planSummaryText = document.getElementById('planSummaryText');
    const planList = document.getElementById('planList');
    const planProgressValue = document.getElementById('planProgressValue');
    const copyActions = document.getElementById('copyActions');
    const copyLastAnswerBtn = document.getElementById('copyLastAnswerBtn');
    const copyConversationBtn = document.getElementById('copyConversationBtn');

    applyAttachmentAvailability(false);

    /* ========== UTILITY FUNCTIONS ========== */
    function isAtBottom() {
        if (!resultsDiv) return true;
        const threshold = 50; // Allow margin for rounding errors
        return resultsDiv.scrollTop + resultsDiv.clientHeight >= resultsDiv.scrollHeight - threshold;
    }

    function getOrCreateSessionUuid() {
        try {
            let uuid = (typeof window !== 'undefined') ? window.mini_a_session_uuid : null;

            // If URL has ?uuid=... prefer and persist it
            if (typeof window !== 'undefined' && window.location && window.location.search) {
                const params = new URLSearchParams(window.location.search);
                const urlUuid = params.get('uuid');
                if (urlUuid && typeof urlUuid === 'string' && urlUuid.length > 0) {
                    uuid = urlUuid;
                    window.mini_a_session_uuid = uuid;
                    return uuid;
                }
            }

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

    function destroyRenderedCharts() {
        if (!resultsDiv) return;
        const containers = resultsDiv.querySelectorAll('.chartjs-chart');
        containers.forEach(container => {
            if (container.__chartInstance && typeof container.__chartInstance.destroy === 'function') {
                try {
                    container.__chartInstance.destroy();
                } catch (error) {
                    console.error('Failed to destroy Chart.js instance:', error);
                }
            }
            if (container.__chartInstance) {
                delete container.__chartInstance;
            }
            if (container.__chartCanvasPrefs) {
                delete container.__chartCanvasPrefs;
            }
        });
    }

    function updateCopyActionsVisibility() {
        const actions = document.getElementById('copyActions');
        if (!actions) return;

        if (!isProcessing && resultsDiv && resultsDiv.textContent.trim().length > 0) {
            actions.classList.add('show');
        } else {
            actions.classList.remove('show');
        }
    }

    const EVENT_MARKERS = ['⚙️','🖥️','💡','💭','🌀','🛑','⏳','🏁','✅','❌','📚','ℹ️','📂','⚠️'];

    function isEventMarkerLine(line) {
        if (!line) return false;
        const trimmed = line.trim();
        if (!trimmed) return false;
        return EVENT_MARKERS.some(marker => trimmed.startsWith(marker));
    }

    function removeEventMarkerLines(text) {
        if (!text) return '';
        const lines = text.split('\n');
        const filtered = lines.filter(line => {
            const trimmed = line.trim();
            if (!trimmed) return true;
            return !isEventMarkerLine(line);
        });
        return filtered.join('\n');
    }

    function copyToClipboard(text) {
        function manualCopy(value) {
            if (typeof window === 'undefined' || typeof window.prompt !== 'function') return false;
            try {
                const promptText = 'Unable to access the clipboard automatically. Copy the text below manually (Ctrl+C, Enter to close):';
                const result = window.prompt(promptText, value);
                return result !== null;
            } catch (error) {
                return false;
            }
        }

        function legacyCopy(value) {
            return new Promise((resolve, reject) => {
                const textarea = document.createElement('textarea');
                textarea.value = value;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                textarea.style.left = '0';
                textarea.style.top = '0';
                document.body.appendChild(textarea);

                const selection = document.getSelection();
                const previousRange = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;

                textarea.focus();
                textarea.select();
                textarea.setSelectionRange(0, textarea.value.length);

                let succeeded = false;
                let copyError = null;
                try {
                    succeeded = document.execCommand('copy');
                } catch (error) {
                    copyError = error;
                } finally {
                    document.body.removeChild(textarea);

                    if (selection) {
                        selection.removeAllRanges();
                        if (previousRange) selection.addRange(previousRange);
                    }
                }

                if (succeeded) {
                    resolve();
                } else {
                    if (manualCopy(value)) {
                        resolve();
                        return;
                    }
                    reject(copyError || new Error('Copy command failed'));
                }
            });
        }

        // Try modern clipboard API first and fall back only on failure
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
        }

        // Fallback to legacy execCommand path (handles http/file contexts)
        return legacyCopy(text);
    }

    function getLatestConversationHtml() {
        if (lastRenderedHtml && lastRenderedHtml.length > 0) {
            return lastRenderedHtml;
        }
        if (resultsDiv && resultsDiv.innerHTML) {
            return resultsDiv.innerHTML;
        }
        return '';
    }

    async function ensureConversationContentForCopy() {
        const cachedHtml = getLatestConversationHtml();
        if (lastRawContent && lastRawContent.trim().length > 0) {
            return { raw: lastRawContent, html: cachedHtml };
        }

        const uuid = currentSessionUuid || (typeof window !== 'undefined' ? window.mini_a_session_uuid : null);
        if (!uuid) {
            return { raw: '', html: cachedHtml };
        }

        try {
            const response = await fetch('/result', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ uuid })
            });

            if (!response.ok) {
                return { raw: '', html: cachedHtml };
            }

            const data = await response.json();
            lastRawContent = data.content || '';
            return { raw: lastRawContent, html: cachedHtml };
        } catch (error) {
            console.error('Failed to refresh conversation for copy:', error);
            return { raw: '', html: cachedHtml };
        }
    }

    function extractPlainTextFromHtml(html) {
        if (!html) return '';
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        // Normalize <br> to newline
        const brNodes = tempDiv.querySelectorAll('br');
        brNodes.forEach(node => {
            node.replaceWith('\n');
        });

        // Convert code blocks to fenced markdown
        const preBlocks = tempDiv.querySelectorAll('pre');
        preBlocks.forEach(pre => {
            const code = pre.querySelector('code');
            const rawText = code ? code.textContent : pre.textContent;
            const codeText = rawText ? rawText.trimEnd() : '';
            let language = '';
            if (code && code.className) {
                const match = code.className.match(/language-([\w-]+)/i);
                if (match) {
                    language = match[1];
                }
            }
            const fence = `\n\`\`\`${language ? language.trim() : ''}\n${codeText.trim()}\n\`\`\`\n`;
            pre.replaceWith(document.createTextNode(fence));
        });

        // Wrap inline code with backticks
        const inlineCodes = tempDiv.querySelectorAll('code');
        inlineCodes.forEach(code => {
            if (code.closest('pre')) return;
            const inlineText = code.textContent || '';
            const backticked = '`' + inlineText.trim() + '`';
            code.replaceWith(document.createTextNode(backticked));
        });

        return tempDiv.textContent || tempDiv.innerText || '';
    }

    function extractLastAnswerFromText(text) {
        const allText = text || '';
        if (!allText) return '';

        const lines = allText.split('\n');
        let lastUserPromptIndex = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
            const trimmed = lines[i].trim();
            if (trimmed.endsWith('👤')) {
                lastUserPromptIndex = i;
                break;
            }
        }

        if (lastUserPromptIndex < 0) {
            for (let i = lines.length - 1; i >= 0; i--) {
                if (lines[i].includes('👤')) {
                    lastUserPromptIndex = i;
                    break;
                }
            }
        }

        let lastAnswer;
        if (lastUserPromptIndex >= 0) {
            const answerLines = lines.slice(lastUserPromptIndex + 1);
            const filteredLines = answerLines.filter(line => {
                const trimmed = line.trim();
                if (!trimmed) return false;
                if (isEventMarkerLine(line)) return false;
                return true;
            });
            lastAnswer = filteredLines.join('\n').trim();
        } else {
            lastAnswer = allText.trim();
        }

        if (!lastAnswer || lastAnswer.length < 10) {
            const fallback = removeEventMarkerLines(allText).trim();
            lastAnswer = fallback || lastAnswer;
        }
        return removeEventMarkerLines(lastAnswer).trim();
    }

    async function handleCopyLastAnswer() {
        try {
            const { raw, html } = await ensureConversationContentForCopy();
            let sourceText = '';
            if (raw && raw.trim().length > 0) {
                sourceText = raw;
            } else if (html) {
                sourceText = extractPlainTextFromHtml(html);
            }

            const lastAnswer = extractLastAnswerFromText(sourceText);
            if (!lastAnswer) {
                throw new Error('No answer available to copy.');
            }

            await copyToClipboard(lastAnswer);

            // Visual feedback
            const btn = document.getElementById('copyLastAnswerBtn');
            if (btn) {
                const originalTitle = btn.title;
                btn.title = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.title = originalTitle;
                    btn.classList.remove('copied');
                }, 1500);
            }
        } catch (error) {
            console.error('Failed to copy last answer:', error);
        }
    }

    async function handleCopyConversation() {
        try {
            const { raw, html } = await ensureConversationContentForCopy();
            let sourceText = '';
            if (raw && raw.trim().length > 0) {
                sourceText = raw;
            } else if (html) {
                sourceText = extractPlainTextFromHtml(html);
            }

            const plainText = removeEventMarkerLines(sourceText).trim();
            if (!plainText) {
                throw new Error('No conversation available to copy.');
            }

            await copyToClipboard(plainText);

            // Visual feedback
            const btn = document.getElementById('copyConversationBtn');
            if (btn) {
                const originalTitle = btn.title;
                btn.title = 'Copied!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.title = originalTitle;
                    btn.classList.remove('copied');
                }, 1500);
            }
        } catch (error) {
            console.error('Failed to copy conversation:', error);
        }
    }

    async function updateResultsContent(htmlContent) {
        if (!resultsDiv) return;

        const wasAtBottom = isAtBottom();
        const currentScrollBtn = document.getElementById('scrollToBottomBtn');
        const wasScrollBtnVisible = (currentScrollBtn && currentScrollBtn.classList.contains('show')) || !autoScrollEnabled;

        destroyRenderedCharts();
        
        // Post-process to restore any chart blocks that were preprocessed
        const processedHtml = postprocessChartBlocks(htmlContent);
        lastRenderedHtml = processedHtml;
        resultsDiv.innerHTML = processedHtml;
        
        // Re-add scroll button and copy actions
        const scrollBtnHTML = `
            <button id="scrollToBottomBtn" title="Scroll to bottom" aria-label="Scroll to bottom">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M7 13l5 5 5-5M7 6l5 5 5-5"/>
                </svg>
            </button>`;
        const copyActionsHTML = `
            <div id="copyActions" class="copy-actions">
                <button id="copyLastAnswerBtn" title="Copy last answer" aria-label="Copy last answer" type="button">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                </button>
                <button id="copyConversationBtn" title="Copy entire conversation" aria-label="Copy entire conversation" type="button">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                </button>
            </div>`;
        resultsDiv.insertAdjacentHTML('beforeend', scrollBtnHTML);
        resultsDiv.insertAdjacentHTML('beforeend', copyActionsHTML);

        // Reattach event listener and restore state for scroll button
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

        // Reattach event listeners for copy actions
        const newCopyLastAnswerBtn = document.getElementById('copyLastAnswerBtn');
        const newCopyConversationBtn = document.getElementById('copyConversationBtn');
        if (newCopyLastAnswerBtn) {
            newCopyLastAnswerBtn.addEventListener('click', handleCopyLastAnswer);
        }
        if (newCopyConversationBtn) {
            newCopyConversationBtn.addEventListener('click', handleCopyConversation);
        }

        // Show/hide copy actions based on processing state
        updateCopyActionsVisibility();

        bindUserAttachmentPreviews();
        
        // Wait for Mermaid rendering to complete before scrolling
        // This ensures the content height is final
        await renderMermaidDiagrams();
        await renderChartBlocks();

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

    function sanitizeAttachmentName(name) {
        const trimmed = (name || '').replace(/[\r\n]+/g, ' ').trim();
        if (!trimmed) return 'attachment.txt';
        return trimmed;
    }

    function detectAttachmentLanguage(name) {
        if (!name) return 'text';
        const lowered = name.toLowerCase();
        if (lowered === 'dockerfile') return 'dockerfile';
        if (lowered.startsWith('makefile')) return 'makefile';
        const parts = lowered.split('.');
        const ext = parts.length > 1 ? parts.pop() : '';
        return ATTACHMENT_LANGUAGE_MAP[ext] || 'text';
    }

    function isAllowedTextFile(file) {
        if (!file) return false;
        if (file.type && file.type.startsWith('text/')) return true;
        const allowedMimes = [
            'application/json', 'application/xml', 'application/javascript', 'application/x-javascript',
            'application/x-sh', 'application/sql', 'application/x-yaml'
        ];
        if (file.type && allowedMimes.includes(file.type)) return true;
        const name = file.name || '';
        const lowered = name.toLowerCase();
        if (lowered === 'dockerfile' || lowered.startsWith('makefile')) return true;
        const parts = lowered.split('.');
        const ext = parts.length > 1 ? parts.pop() : '';
        if (ext && TEXT_FILE_EXTENSIONS.has(ext)) return true;
        return false;
    }

    function renderAttachments() {
        if (!attachmentsContainer) return;
        attachmentsContainer.innerHTML = '';

        if (!attachmentsEnabled) {
            attachmentsContainer.classList.remove('visible');
            autoResizeTextarea();
            return;
        }

        if (!attachments || attachments.length === 0) {
            attachmentsContainer.classList.remove('visible');
            autoResizeTextarea();
            return;
        }

        attachmentsContainer.classList.add('visible');

        attachments.forEach(item => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';

            const label = document.createElement('span');
            label.textContent = item.name;
            chip.appendChild(label);

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.setAttribute('aria-label', 'Remove ' + item.name);
            removeBtn.innerHTML = '✕';
            removeBtn.addEventListener('click', () => removeAttachment(item.id));
            chip.appendChild(removeBtn);

            attachmentsContainer.appendChild(chip);
        });

        autoResizeTextarea();
    }

    function removeAttachment(id) {
        attachments = attachments.filter(item => item.id !== id);
        renderAttachments();
    }

    function clearAttachments() {
        attachments = [];
        renderAttachments();
        if (fileInput) fileInput.value = '';
    }

    async function handleFileInputChange(event) {
        if (attachmentsEnabled === false) return;
        if (!event || !event.target) return;
        const files = Array.from(event.target.files || []);
        if (files.length === 0) return;

        for (const file of files) {
            if (!isAllowedTextFile(file)) {
                notifyAttachmentWarning('Only text-based files can be attached. Skipping "' + (file.name || 'file') + '".');
                continue;
            }
            if (file.size > MAX_ATTACHMENT_SIZE) {
                notifyAttachmentWarning('"' + (file.name || 'file') + '" exceeds the 512 KB size limit and will be skipped.');
                continue;
            }

            try {
                const text = await file.text();
                attachments.push({
                    id: 'att-' + Date.now() + '-' + Math.random().toString(16).slice(2),
                    name: sanitizeAttachmentName(file.name || 'attachment.txt'),
                    content: (text || '').replace(/\r\n/g, '\n'),
                    language: detectAttachmentLanguage(file.name)
                });
            } catch (error) {
                console.error('Failed to read attachment', file.name, error);
            }
        }

        renderAttachments();
        event.target.value = '';
    }

    function handleAttachClick() {
        if (attachmentsEnabled === false) return;
        if (!fileInput || (attachBtn && attachBtn.disabled)) return;
        try {
            fileInput.click();
        } catch (error) {
            console.error('Failed to open file picker:', error);
        }
    }

    function notifyAttachmentWarning(message) {
        if (typeof window !== 'undefined' && typeof window.alert === 'function') {
            window.alert(message);
        } else {
            console.warn(message);
        }
    }

    function buildPromptWithAttachments(basePrompt, items) {
        const normalized = (basePrompt || '').replace(/\r\n/g, '\n');
        if (!items || items.length === 0) return normalized;

        let output = normalized;
        if (output.trim().length > 0) {
            if (!output.endsWith('\n')) output += '\n';
            output += '\n';
        } else {
            output = '';
        }

        const blocks = items.map(item => {
            const safeName = sanitizeAttachmentName(item.name).replace(/```/g, '`');
            const cleanContent = (item.content || '').replace(/\r\n/g, '\n');
            return '```attachment ' + safeName + '\n' + cleanContent + '\n```';
        });

        return output + blocks.join('\n\n');
    }

    function stripAttachmentBlocks(text) {
        if (!text) return '';
        return text.replace(/```attachment[^\n]*\n[\s\S]*?```/g, '').trim();
    }

    function sanitizeLanguageToken(lang) {
        if (!lang) return 'text';
        return lang.replace(/[^a-z0-9\-+]+/gi, '').toLowerCase() || 'text';
    }

    function decodeAttachmentContent(encoded) {
        if (!encoded) return '';
        try {
            const binary = atob(encoded);
            if (typeof TextDecoder !== 'undefined') {
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                    bytes[i] = binary.charCodeAt(i);
                }
                const decoder = new TextDecoder();
                return decoder.decode(bytes);
            }
            let result = '';
            for (let i = 0; i < binary.length; i++) {
                const hex = binary.charCodeAt(i).toString(16).padStart(2, '0');
                result += '%' + hex;
            }
            return decodeURIComponent(result);
        } catch (error) {
            console.error('Failed to decode attachment content:', error);
            return '';
        }
    }

    function openAttachmentModal(name, content, language) {
        if (!attachmentModal || !attachmentModalTitle || !attachmentModalCode) return;

        attachmentModalTitle.textContent = sanitizeAttachmentName(name);
        attachmentModalCode.textContent = content || '';
        attachmentModalCode.className = 'hljs';

        const safeLanguage = sanitizeLanguageToken(language);
        if (safeLanguage && safeLanguage !== 'text') {
            attachmentModalCode.classList.add('language-' + safeLanguage);
        }

        // Ensure syntax highlighting matches current theme
        try {
            const isDark = document.body.classList.contains('markdown-body-dark') || _isD === true || (typeof __isDark !== 'undefined' && __isDark);
            if (isDark) {
                attachmentModalCode.classList.add('hljs_dark');
            } else {
                attachmentModalCode.classList.remove('hljs_dark');
            }
        } catch (e) { /* ignore */ }

        attachmentModal.classList.add('open');
        attachmentModal.setAttribute('aria-hidden', 'false');

        setTimeout(() => {
            try { hljs.highlightElement(attachmentModalCode); } catch (e) { /* ignore */ }
        }, 0);
    }

    function closeAttachmentModal() {
        if (!attachmentModal || !attachmentModalCode) return;
        attachmentModal.classList.remove('open');
        attachmentModal.setAttribute('aria-hidden', 'true');
        attachmentModalCode.textContent = '';
        attachmentModalCode.className = 'hljs';
    }

    function bindUserAttachmentPreviews() {
        if (!resultsDiv) return;
        const nodes = resultsDiv.querySelectorAll('.user-attachment');
        nodes.forEach(node => {
            if (node.dataset.bound === 'true') return;
            node.dataset.bound = 'true';
            node.addEventListener('click', () => {
                const encoded = node.getAttribute('data-content') || '';
                const name = node.getAttribute('data-name') || 'Attachment';
                const language = node.getAttribute('data-language') || 'text';
                const content = decodeAttachmentContent(encoded);
                openAttachmentModal(name, content, language);
            });
        });
    }

    async function renderMermaidDiagrams() {
        if (typeof window.mermaid === 'undefined') return;

        try {
            // Update theme based on current dark mode state
            const isDark = document.body.classList.contains('markdown-body-dark') || _isD === true || (typeof __isDark !== 'undefined' && __isDark);
            await window.mermaid.initialize({
                startOnLoad: false,
                theme: isDark ? 'dark' : 'default',
                themeVariables: {
                    darkMode: isDark
                },
                suppressErrorRendering: true  // Suppress error messages in rendered output
            });

            // Find all code blocks with language 'mermaid'
            const mermaidBlocks = resultsDiv.querySelectorAll('pre code.language-mermaid, pre code.mermaid');

            for (let i = 0; i < mermaidBlocks.length; i++) {
                const block = mermaidBlocks[i];
                if (block.dataset.mermaidRendered === 'true') continue;

                const code = block.textContent;
                const pre = block.parentElement;

                try {
                    // Validate syntax first using parse
                    if (typeof window.mermaid.parse === 'function') {
                        const parseResult = await window.mermaid.parse(code, { suppressErrors: true });
                        if (!parseResult) {
                            // Invalid syntax, keep original code block
                            console.warn('Mermaid syntax validation failed, keeping original code block');
                            block.dataset.mermaidRendered = 'true';
                            continue;
                        }
                    }

                    // Create a container for the diagram
                    const container = document.createElement('div');
                    container.className = 'mermaid-diagram';
                    container.style.textAlign = 'center';
                    container.style.padding = '1rem';
                    container.style.background = isDark ? '#0f1115' : '#f8f9fa';
                    container.style.borderRadius = '0.5rem';
                    container.style.margin = '1rem 0';
                    container.setAttribute('data-mermaid-source', code);

                    // Render the diagram
                    const { svg } = await window.mermaid.render('mermaid-' + Date.now() + '-' + i, code);
                    container.innerHTML = svg;

                    // Replace the pre/code block with the rendered diagram
                    pre.replaceWith(container);
                    block.dataset.mermaidRendered = 'true';
                } catch (error) {
                    console.error('Failed to render Mermaid diagram:', error);
                    // Mark as rendered to avoid retry loops, keep original code block
                    block.dataset.mermaidRendered = 'true';
                }
            }
        } catch (error) {
            console.error('Mermaid rendering error:', error);
        }
    }

    function configureChartDefaults(isDark) {
        if (!window.Chart || !window.Chart.defaults) return;
        try {
            window.Chart.defaults.color = isDark ? '#e6e6e6' : '#1b1d25';
            window.Chart.defaults.borderColor = isDark ? 'rgba(230,230,230,0.2)' : 'rgba(33,37,41,0.15)';
            window.Chart.defaults.backgroundColor = isDark ? 'rgba(51,144,255,0.18)' : 'rgba(0,123,255,0.12)';
        } catch (error) {
            console.error('Failed to configure Chart.js defaults:', error);
        }
    }

    function applyChartThemeDefaults(config, isDark) {
        if (!config || typeof config !== 'object') return config;

        const fallbackText = isDark ? '#e6e6e6' : '#1b1d25';
        const fallbackGrid = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(33,37,41,0.1)';

        config.options = config.options || {};
        const options = config.options;

        options.plugins = options.plugins || {};

        if (options.plugins.legend !== false) {
            if (options.plugins.legend === true) options.plugins.legend = {};
            const legend = (options.plugins.legend && typeof options.plugins.legend === 'object') ? options.plugins.legend : {};
            legend.labels = legend.labels || {};
            if (!legend.labels.color) legend.labels.color = fallbackText;
            options.plugins.legend = legend;
        }

        if (options.plugins.title !== false) {
            if (options.plugins.title === true) options.plugins.title = { display: true };
            if (options.plugins.title && typeof options.plugins.title === 'object' && !options.plugins.title.color) {
                options.plugins.title.color = fallbackText;
            }
        }

        if (options.plugins.tooltip !== false) {
            if (options.plugins.tooltip === true) options.plugins.tooltip = {};
            const tooltip = (options.plugins.tooltip && typeof options.plugins.tooltip === 'object') ? options.plugins.tooltip : {};
            if (!tooltip.titleColor) tooltip.titleColor = fallbackText;
            if (!tooltip.bodyColor) tooltip.bodyColor = fallbackText;
            options.plugins.tooltip = tooltip;
        }

        if (options.scales && typeof options.scales === 'object') {
            Object.values(options.scales).forEach(scale => {
                if (!scale || typeof scale !== 'object') return;

                if (scale.ticks !== false) {
                    if (!scale.ticks || typeof scale.ticks !== 'object') scale.ticks = {};
                    if (!scale.ticks.color) scale.ticks.color = fallbackText;
                }

                if (scale.grid !== false) {
                    if (!scale.grid || typeof scale.grid !== 'object') scale.grid = {};
                    if (!scale.grid.color) scale.grid.color = fallbackGrid;
                }

                if (scale.title && typeof scale.title === 'object' && !scale.title.color) {
                    scale.title.color = fallbackText;
                }
            });
        }

        return config;
    }

    function tryParseChartConfig(raw) {
        if (!raw) return null;
        const trimmed = raw.trim();
        if (!trimmed) return null;

        try {
            return JSON.parse(trimmed);
        } catch (jsonError) {
            // Continue with more permissive parsing
        }

        let expr = trimmed;
        const assignmentMatch = expr.match(/^\s*(?:const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*/);
        if (assignmentMatch) expr = expr.slice(assignmentMatch[0].length);

        const exportMatch = expr.match(/^\s*(?:module\.exports|export\s+default)\s*=\s*/);
        if (exportMatch) expr = expr.slice(exportMatch[0].length);

        if (expr.endsWith(';')) expr = expr.slice(0, -1);

        // Strip comments and string literals to reduce false positives
        const cleaned = expr
            .replace(/\/\*[\s\S]*?\*\//g, '')        // block comments
            .replace(/\/\/[^\n\r]*/g, '')              // line comments
            .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g, ''); // strings

        // Disallow risky tokens using word-boundary aware patterns (avoid matching inside words like 'forecast')
        const bannedPatterns = [
            { re: /\bfunction\b/i,        label: 'function' },
            { re: /=>/,                    label: '=>'},
            { re: /\bwhile\b/i,           label: 'while' },
            { re: /\bfor\b/i,             label: 'for' },
            { re: /\bclass\b/i,           label: 'class' },
            { re: /\bconstructor\b/i,     label: 'constructor' },
            { re: /\bprocess\b/i,         label: 'process' },
            { re: /\bwindow\b/i,          label: 'window' },
            { re: /\bdocument\b/i,        label: 'document' },
            { re: /\brequire\b/i,         label: 'require' },
            { re: /\bimport\b/i,          label: 'import' },
            { re: /\bexport\b/i,          label: 'export' },
            { re: /\beval\b/i,            label: 'eval' },
            { re: /\bxmlhttprequest\b/i,  label: 'XMLHttpRequest' },
            { re: /\bfetch\b/i,           label: 'fetch' },
            { re: /\bsettimeout\b/i,      label: 'setTimeout' },
            { re: /\bsetinterval\b/i,     label: 'setInterval' },
            { re: /\balert\b/i,           label: 'alert' },
            { re: /\bprompt\b/i,          label: 'prompt' }
        ];

        const matched = bannedPatterns.find(p => p.re.test(cleaned));
        if (matched) {
            console.warn('Skipping chart block - disallowed token present in configuration. (' + matched.label + ')');
            return null;
        }

        try {
            const fn = new Function('"use strict"; return (' + expr + ');');
            const evaluated = fn();
            if (evaluated && typeof evaluated === 'object') {
                return evaluated;
            }
        } catch (evalError) {
            console.warn('Failed to evaluate chart configuration literal:', evalError);
        }

        return null;
    }

    function layoutChartContainer(container, canvasSettings) {
        if (!container) return;

        const rawViewportWidth = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 0;
        const rawViewportHeight = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 0;
        const fallbackWidth = (resultsDiv && resultsDiv.clientWidth) ? resultsDiv.clientWidth : 0;
        const viewportWidth = Math.max(320, Math.floor((rawViewportWidth > 0 ? rawViewportWidth : fallbackWidth || 320) * 0.92));
        const viewportHeight = Math.max(240, Math.floor((rawViewportHeight > 0 ? rawViewportHeight : 540) * 0.6));
        const parentWidth = resultsDiv && resultsDiv.clientWidth ? Math.max(320, resultsDiv.clientWidth - 32) : viewportWidth;

        const prefWidth = canvasSettings && canvasSettings.width ? Number(canvasSettings.width) : Math.max(parentWidth, viewportWidth);
        const prefHeight = canvasSettings && canvasSettings.height ? Number(canvasSettings.height) : Math.round(prefWidth * 0.62);

        const width = Math.max(320, Math.min(prefWidth, parentWidth, viewportWidth));
        const heightFromWidth = Math.max(220, Math.round(width * (prefHeight > 0 ? prefHeight / Math.max(prefWidth, 1) : 0.62)));
        const maxHeight = Math.max(240, Math.min(prefHeight, viewportHeight));
        const height = Math.min(Math.max(220, heightFromWidth), maxHeight || heightFromWidth);

        container.style.width = width + 'px';
        container.style.maxWidth = '100%';
        container.style.height = height + 'px';
        container.style.maxHeight = Math.max(240, Math.min(prefHeight, viewportHeight)) + 'px';
    }

    function reflowRenderedCharts() {
        const containers = document.querySelectorAll('.chartjs-chart');
        containers.forEach(container => {
            layoutChartContainer(container, container.__chartCanvasPrefs);
            if (container.__chartInstance && typeof container.__chartInstance.resize === 'function') {
                try {
                    container.__chartInstance.resize();
                } catch (error) {
                    console.error('Failed to resize Chart.js instance:', error);
                }
            }
        });
    }

    function scheduleChartReflow() {
        if (chartResizeTimer) {
            clearTimeout(chartResizeTimer);
        }
        chartResizeTimer = setTimeout(() => {
            chartResizeTimer = null;
            reflowRenderedCharts();
        }, 150);
    }

    function renderChartBlocks() {
        if (!resultsDiv || typeof window.Chart === 'undefined') return;

        // Be liberal in what we accept: match common variants (chart, chartjs, chart.js)
        // and also fall back to content sniffing for objects that look like Chart.js configs.
        const allCodeBlocks = Array.from(resultsDiv.querySelectorAll('pre code'));
        if (allCodeBlocks.length === 0) return;

        function looksLikeChartClass(cls) {
            const c = (cls || '').toLowerCase();
            return (
                /\blanguage-?chart(\.js|-js)?\b/.test(c) ||
                /\bchartjs\b/.test(c) ||
                /\bchart\.js\b/.test(c) ||
                // Some highlighters add only a raw class name without the language- prefix
                /(^|\s)chart(\.js|-js)?(\s|$)/.test(c)
            );
        }

        // Quick content heuristic to catch blocks that were labeled as json/js but contain a Chart.js config
        function looksLikeChartContent(text) {
            if (!text) return false;
            const t = String(text).trim();
            // Avoid parsing huge blocks unnecessarily
            if (t.length < 8) return false;
            if (!/(^|\W)type\s*:/.test(t) || !/(^|\W)data\s*:/.test(t)) return false;
            // Common Chart.js keys to further reduce false positives
            if (!/(datasets|labels)\s*:/.test(t)) return false;
            return true;
        }

        const blocks = allCodeBlocks.filter(block => {
            return looksLikeChartClass(block.className) || looksLikeChartContent(block.textContent);
        });
        if (blocks.length === 0) return;

        if (!chartResizeHandlerBound && typeof window !== 'undefined') {
            window.addEventListener('resize', scheduleChartReflow);
            chartResizeHandlerBound = true;
        }

        const isDark = document.body.classList.contains('markdown-body-dark') || _isD === true || (typeof __isDark !== 'undefined' && __isDark);
        configureChartDefaults(isDark);

        blocks.forEach((block) => {
            const pre = block.parentElement;
            if (!pre) return;

            const raw = (block.textContent || '').trim();
            if (!raw) return;

            const parsed = tryParseChartConfig(raw);
            if (!parsed) return;
            let config = parsed;

            if (config && typeof config === 'object' && config.chart) {
                config = config.chart;
            }

            if (!config || typeof config !== 'object' || !config.type || !config.data) {
                console.warn('Skipping chart block - configuration must include "type" and "data".');
                return;
            }

            // Extra guard to avoid false positives when using the content heuristic
            const hasDatasetsOrLabels = (config.data && (Array.isArray(config.data.datasets) || Array.isArray(config.data.labels)));
            if (!hasDatasetsOrLabels) {
                console.warn('Skipping chart block - data requires datasets or labels array.');
                return;
            }

            const canvasSettings = (config.canvas && typeof config.canvas === 'object') ? config.canvas : null;
            if (config.canvas) delete config.canvas;

            const container = document.createElement('div');
            container.className = 'chartjs-chart';
            container.style.display = 'block';
            container.style.textAlign = 'center';
            container.style.margin = '1.5rem auto';
            container.style.padding = '1rem';
            container.style.borderRadius = '0.6rem';
            container.style.background = isDark ? '#0f1115' : '#f8f9fa';
            container.style.border = isDark ? '1px solid #242629' : '1px solid #e0e0e0';
            container.setAttribute('data-chart-source', raw);
            container.__chartCanvasPrefs = canvasSettings || null;

            const canvas = document.createElement('canvas');
            if (canvasSettings) {
                if (canvasSettings.width) canvas.setAttribute('data-width', canvasSettings.width);
                if (canvasSettings.height) canvas.setAttribute('data-height', canvasSettings.height);
            }
            layoutChartContainer(container, canvasSettings);
            const chartTitle = config.options && config.options.plugins && config.options.plugins.title && config.options.plugins.title.text;
            if (chartTitle) {
                canvas.setAttribute('aria-label', chartTitle);
            } else {
                canvas.setAttribute('aria-label', `${config.type} chart`);
            }
            canvas.setAttribute('role', 'img');
            canvas.style.width = '100%';
            canvas.style.height = '100%';
            container.appendChild(canvas);

            if (pre.parentElement) {
                pre.parentElement.insertBefore(container, pre);
            } else {
                pre.replaceWith(container);
            }

            const themedConfig = applyChartThemeDefaults(config, isDark);

            try {
                themedConfig.options = themedConfig.options || {};
                if (typeof themedConfig.options.responsive === 'undefined') themedConfig.options.responsive = true;
                if (typeof themedConfig.options.maintainAspectRatio === 'undefined') themedConfig.options.maintainAspectRatio = false;

                const ctx = canvas.getContext('2d');
                const chartInstance = new window.Chart(ctx, themedConfig);
                container.__chartInstance = chartInstance;
                pre.remove();
            } catch (error) {
                console.error('Failed to render Chart.js block:', error);
                container.remove();
            }
        });
    }

    /**
     * Attempts to force re-rendering of all Chart.js blocks.
     * 
     * Depends on the global `renderChartBlocks` function, which is defined above in this script.
     * If `renderChartBlocks` is missing, this function will do nothing.
     * 
     * If you refactor or modularize this code, ensure that `renderChartBlocks` is available in the global scope.
     */
    function forceRenderChartBlocks() {
        if (typeof renderChartBlocks !== 'function') return;

        const triggerRender = () => {
            try {
                renderChartBlocks();
            } catch (error) {
                console.error('Failed to force Chart.js rendering:', error);
            }
        };

        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(triggerRender);
        } else {
            setTimeout(triggerRender, 0);
        }
    }

    function resetRenderedChartsForTheme() {
        const chartContainers = document.querySelectorAll('.chartjs-chart');
        chartContainers.forEach(container => {
            try {
                if (container.__chartInstance && typeof container.__chartInstance.destroy === 'function') {
                    container.__chartInstance.destroy();
                }
            } catch (error) {
                console.error('Failed to destroy Chart.js instance during theme change:', error);
            }
            if (container.__chartInstance) {
                delete container.__chartInstance;
            }

            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = 'language-chart';
            code.textContent = container.getAttribute('data-chart-source') || '';
            pre.appendChild(code);
            container.replaceWith(pre);
        });
    }

    function resetMermaidDiagramsForTheme() {
        const mermaidContainers = document.querySelectorAll('.mermaid-diagram');
        mermaidContainers.forEach(container => {
            const parent = container.parentElement;
            if (!parent) return;
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.className = 'language-mermaid';
            code.textContent = container.getAttribute('data-mermaid-source') || '';
            pre.appendChild(code);
            container.replaceWith(pre);
        });
    }

    function bindAttachmentModalHandlers() {
        if (attachmentModalClose && attachmentModalClose.dataset.bound !== 'true') {
            attachmentModalClose.addEventListener('click', closeAttachmentModal);
            attachmentModalClose.dataset.bound = 'true';
        }

        if (attachmentModal && attachmentModal.dataset.bound !== 'true') {
            attachmentModal.addEventListener('click', (event) => {
                if (event.target === attachmentModal) {
                    closeAttachmentModal();
                }
            });
            attachmentModal.dataset.bound = 'true';
        }

        if (!attachmentModalKeyListenerBound) {
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && attachmentModal && attachmentModal.classList.contains('open')) {
                    closeAttachmentModal();
                }
            });
            attachmentModalKeyListenerBound = true;
        }
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
        const sanitized = stripAttachmentBlocks(prompt || '');
        const base = sanitized.split('\n').map(line => line.trim()).find(Boolean) || fallback;
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

    function applyAttachmentAvailability(enabled) {
        attachmentsEnabled = !!enabled;

        if (attachBtn) {
            attachBtn.style.display = attachmentsEnabled ? '' : 'none';
            attachBtn.disabled = !attachmentsEnabled || isProcessing;
        }

        if (attachmentsContainer) {
            attachmentsContainer.style.display = attachmentsEnabled ? '' : 'none';
        }

        if (fileInput) {
            fileInput.disabled = !attachmentsEnabled || isProcessing;
            if (!attachmentsEnabled) fileInput.value = '';
        }

        if (!attachmentsEnabled) {
            clearAttachments();
        } else {
            renderAttachments();
        }
    }

    async function configureFeatureAvailability() {
        let shouldEnableHistory = true;
        let shouldEnableAttachments = false;

        try {
            const response = await fetch('/info', {
                headers: { 'Accept': 'application/json' }
            });

            if (!response.ok) {
                throw new Error('Failed to load server info');
            }

            const data = await response.json();
            if (typeof data.usehistory === 'boolean') {
                shouldEnableHistory = data.usehistory;
            }
            if (typeof data.useattach === 'boolean') {
                shouldEnableAttachments = data.useattach;
            }
        } catch (error) {
            console.error('Unable to determine feature availability:', error);
        }

        applyHistoryAvailability(shouldEnableHistory);
        applyAttachmentAvailability(shouldEnableAttachments);

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

        const preprocessed = preprocessChartBlocks(entry.content || '');
        const htmlContent = converter.makeHtml(preprocessed);
        await updateResultsContent(htmlContent);
        resetPlanPanel();
        try { hljs.highlightAll(); } catch (e) { /* ignore */ }
        forceRenderChartBlocks();
        if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
        __refreshDarkMode();
        refreshHistoryPanel();
        closeHistoryPanel();
        lastRawContent = entry.content || '';
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
            updatePlanPanel(data.plan);
            const preprocessed = preprocessChartBlocks(data.content || '');
            const htmlContent = converter.makeHtml(preprocessed);
            await updateResultsContent(htmlContent);
            try { hljs.highlightAll(); } catch (e) { /* ignore */ }
            forceRenderChartBlocks();
            if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
            __refreshDarkMode();
            refreshHistoryPanel();
            lastRawContent = data.content || '';

            // If the conversation hasn't finished and has actual content, resume live polling and set processing UI state
            if (data && data.status !== 'finished' && data.content && data.content.trim().length > 0) {
                currentSessionUuid = uuid;
                isProcessing = true;
                if (promptInput) promptInput.disabled = true;
                setSubmitIcon('stop');
                if (submitBtn) submitBtn.classList.add('stop');
                if (clearBtn) clearBtn.disabled = true;
                if (attachBtn) attachBtn.disabled = true;
                if (fileInput) fileInput.disabled = true;
                addPreview();
                if (!pollingInterval) startPolling();
            }
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

    function setAttachIcon() {
        if (!attachBtn) return;

        attachBtn.title = 'Attach files';
        attachBtn.setAttribute('aria-label', 'Attach files');
        attachBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <path d="M21.44 11.05l-9.19 9.19a5 5 0 0 1-7.07-7.07l9.19-9.19a3 3 0 0 1 4.24 4.24L9.62 17.41a1 1 0 0 1-1.41-1.41l8.48-8.48" />
            </svg>`;
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
        
        // Reset height to get accurate scrollHeight
        promptInput.style.height = '1px';

        promptInput.style.background = 'transparent';
        
        const minHeight = parseFloat(getComputedStyle(promptInput).minHeight) || 0;
        const maxHeight = parseFloat(getComputedStyle(promptInput).maxHeight) || Infinity;
        
        // Use scrollHeight for the actual content height
        let newHeight = Math.max(minHeight, promptInput.scrollHeight);
        
        if (maxHeight && maxHeight > 0 && newHeight > maxHeight) {
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

    /* ========== PLAN PANEL HELPERS ========== */
    function resetPlanPanel(clearDigest = true) {
        if (!planPanel) return;
        if (clearDigest) lastPlanDigest = '';
        planPanel.setAttribute('hidden', 'hidden');
        planPanel.removeAttribute('open');
        if (planList) planList.innerHTML = '';
        if (planSummaryText) planSummaryText.textContent = '0% overall · 0/0 tasks completed';
        if (planProgressValue) planProgressValue.style.strokeDashoffset = '100';
    }

    function updatePlanPanel(planPayload) {
        if (!planPanel) return;

        const digest = JSON.stringify(planPayload || {});
        if (digest === lastPlanDigest) return;
        lastPlanDigest = digest;

        const hasItems = planPayload && planPayload.active === true && Array.isArray(planPayload.items) && planPayload.items.length > 0;
        if (!hasItems) {
            resetPlanPanel(false);
            return;
        }

        const items = planPayload.items || [];
        const total = planPayload.total && planPayload.total > 0 ? planPayload.total : items.length;
        let completed = planPayload.completed;
        if (typeof completed !== 'number' || completed < 0) {
            completed = items.filter(item => {
                const status = (item && item.status ? String(item.status).toLowerCase() : '');
                return (item && item.done === true) || PLAN_DONE_STATUSES.has(status);
            }).length;
        }

        let overall = planPayload && typeof planPayload.overall === 'number' ? planPayload.overall : undefined;
        if (typeof overall !== 'number' || Number.isNaN(overall)) {
            const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 0;
            overall = Math.round(ratio * 100);
        } else {
            overall = Math.max(0, Math.min(100, Math.round(overall)));
        }

        let checkpoints = { reached: 0, total: 0 };
        if (planPayload && typeof planPayload.checkpoints === 'object' && planPayload.checkpoints !== null) {
            const raw = planPayload.checkpoints;
            const reached = typeof raw.reached === 'number' && !Number.isNaN(raw.reached) ? raw.reached : 0;
            const totalCheckpoints = typeof raw.total === 'number' && !Number.isNaN(raw.total) ? raw.total : 0;
            checkpoints = {
                reached: Math.max(0, reached),
                total: Math.max(0, totalCheckpoints)
            };
        }

        planPanel.removeAttribute('hidden');
        if (planSummaryText) {
            const summaryPieces = [`${overall}% overall`, `${completed}/${total} tasks completed`];
            if (checkpoints.total > 0) {
                summaryPieces.push(`checkpoints ${checkpoints.reached}/${checkpoints.total}`);
            }
            planSummaryText.textContent = summaryPieces.join(' · ');
        }

        if (planProgressValue) {
            const offset = (100 - overall).toFixed(2);
            planProgressValue.style.strokeDashoffset = offset;
        }

        if (planList) {
            planList.innerHTML = '';
            items.forEach((item, index) => {
                const li = document.createElement('li');
                li.className = 'plan-item';

                const iconSpan = document.createElement('span');
                iconSpan.className = 'plan-item-icon';
                iconSpan.textContent = (item && item.icon) ? item.icon : '•';
                li.appendChild(iconSpan);

                const textSpan = document.createElement('span');
                textSpan.className = 'plan-item-text';
                textSpan.textContent = item && item.title ? item.title : `Step ${index + 1}`;

                const statusKey = item && item.status ? String(item.status).toLowerCase() : '';
                if ((item && item.done === true) || PLAN_DONE_STATUSES.has(statusKey)) {
                    textSpan.classList.add('completed');
                }
                li.appendChild(textSpan);

                if (item && item.label) {
                    const badge = document.createElement('span');
                    badge.className = 'plan-item-status';
                    badge.textContent = item.label;
                    li.appendChild(badge);
                }

                planList.appendChild(li);
            });
        }
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
        if (attachBtn) attachBtn.disabled = true;
        if (fileInput) fileInput.disabled = true;
        scrollResultsToBottom();
        addPreview();
        clearAttachments();
        resetPlanPanel();
        updateCopyActionsVisibility();
    }

    function stopProcessing() {
        isProcessing = false;
        promptInput.disabled = false;
        setSubmitIcon('send');
        submitBtn.classList.remove('stop');
        clearBtn.disabled = false;
        if (attachBtn) attachBtn.disabled = !attachmentsEnabled;
        if (fileInput) fileInput.disabled = !attachmentsEnabled;

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
        updateCopyActionsVisibility();
    }

    /* ========== API FUNCTIONS ========== */
    async function handleSubmit() {
        if (isProcessing) {
            await stopProcessing();
            return;
        }

        const rawPrompt = promptInput.value || '';
        const finalPrompt = buildPromptWithAttachments(rawPrompt, attachmentsEnabled ? attachments : []);
        if (!finalPrompt.trim()) return;

        lastSubmittedPrompt = finalPrompt;
        activeHistoryId = null;

        try {
            if (!currentSessionUuid) currentSessionUuid = getOrCreateSessionUuid();

            const response = await fetch('/prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json; charset=utf-8' },
                body: JSON.stringify({ prompt: finalPrompt, uuid: currentSessionUuid })
            });

            if (!response.ok) throw new Error('Failed to submit prompt');

            await response.json();
            lastRawContent = '';
            startProcessing();
            startPolling();

        } catch (error) {
            console.error('Error submitting prompt:', error);
            await updateResultsContent('<p style="color: red;">Error submitting prompt. Please try again.</p>');
            forceRenderChartBlocks();
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
                updatePlanPanel(data.plan);

                // Only update content if it has actually changed to prevent chart flickering
                const rawContent = data.content || '';
                if (rawContent !== lastRawContent) {
                    const preprocessed = preprocessChartBlocks(rawContent);
                    const htmlContent = converter.makeHtml(preprocessed);
                    await updateResultsContent(htmlContent);
                    hljs.highlightAll();
                    forceRenderChartBlocks();
                    if (typeof __mdcodeclip !== "undefined") __mdcodeclip();
                    __refreshDarkMode();
                    lastRawContent = rawContent;
                }

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
                await updateResultsContent('<p style="color: red;">Error fetching results. Please try again.</p>');
                forceRenderChartBlocks();
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
    async function handleClearClick() {
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

        await updateResultsContent('<p></p>');
        forceRenderChartBlocks();
        resetPlanPanel();
        removePreview();
        promptInput.value = '';
        clearAttachments();
        lastRawContent = '';
        hideScrollToBottomButton();

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
        if (attachBtn) attachBtn.disabled = !attachmentsEnabled;
        if (fileInput) fileInput.disabled = !attachmentsEnabled;
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
        // If uuid exists in URL or session, set it and refresh current view
        const uuid = getOrCreateSessionUuid();
        if (uuid) {
            currentSessionUuid = uuid;
            refreshCurrentConversationView();
        }
        if (attachBtn) attachBtn.disabled = false;
        if (fileInput) fileInput.disabled = false;
        setSubmitIcon('send');
        setAttachIcon();
        setClearIcon();
        setHistoryIcon();
        renderAttachments();
        bindAttachmentModalHandlers();
        autoResizeTextarea();

        // Add event listeners
        promptInput.addEventListener('input', autoResizeTextarea);
        promptInput.addEventListener('paste', () => setTimeout(autoResizeTextarea, 0));
        promptInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey && !promptInput.disabled) {
                e.preventDefault();
                handleSubmit();
            }
        });

        // Initialize textarea height
        autoResizeTextarea();

        if (attachBtn) {
            attachBtn.addEventListener('click', handleAttachClick);
        }

        if (fileInput) {
            fileInput.addEventListener('change', handleFileInputChange);
        }

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

        if (copyLastAnswerBtn) {
            copyLastAnswerBtn.addEventListener('click', handleCopyLastAnswer);
        }

        if (copyConversationBtn) {
            copyConversationBtn.addEventListener('click', handleCopyConversation);
        }

        // Start ping system
        try {
            startPing();
        } catch (e) {
            console.error('Failed to start ping on load:', e);
        }

        configureFeatureAvailability();
        refreshHistoryPanel();
        updateCopyActionsVisibility();
    }

    // Initialize the application
    initializeUI();
</script>
<script src="/js/mdtablesort.js"></script>
<script>if (_isD) document.querySelectorAll('pre code').forEach((block) => { block.classList.add('hljs_dark') })</script>
<script src="/js/mdcodeclip.js"></script>
<script>
    /* ========== DARK MODE INTEGRATION ========== */
    function __syncAttachmentModalTheme() {
        try {
            const codeEl = document.getElementById('attachmentModalCode');
            if (!codeEl) return;
            const isDark = document.body.classList.contains('markdown-body-dark') || (typeof _isD !== 'undefined' && _isD === true) || (typeof __isDark !== 'undefined' && __isDark);
            if (isDark) {
                codeEl.classList.add('hljs_dark');
            } else {
                codeEl.classList.remove('hljs_dark');
            }
        } catch (e) { /* ignore */ }
    }

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
        __syncAttachmentModalTheme();
    });

    function handleSystemThemeChange() {
        __refreshDarkMode();
        __applyDarkModeIfNeeded();
        __syncAttachmentModalTheme();

        if (typeof renderMermaidDiagrams === 'function') {
            resetMermaidDiagramsForTheme();
            setTimeout(() => renderMermaidDiagrams(), 100);
        }

        if (typeof renderChartBlocks === 'function') {
            resetRenderedChartsForTheme();
            setTimeout(() => renderChartBlocks(), 120);
        }
    }

    function bindThemeListener(mediaQuery) {
        if (!mediaQuery) return;
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleSystemThemeChange);
        } else if (typeof mediaQuery.addListener === 'function') {
            mediaQuery.addListener(handleSystemThemeChange);
        }
    }

    bindThemeListener(window.matchMedia('(prefers-color-scheme: dark)'));
    bindThemeListener(window.matchMedia('(prefers-color-scheme: light)'));
</script>
