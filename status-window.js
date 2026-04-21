const { ipcRenderer } = require('electron');

let recordingStartTime = null;
let recordingTimer = null;
let config = {};

// Load configuration
async function loadConfig() {
    try {
        config = await ipcRenderer.invoke('get-config');
        updateHotkeyHints();
    } catch (error) {
        console.error('Failed to load config:', error);
    }
}

// Update hotkey hints
function updateHotkeyHints() {
    const recordHotkey = document.getElementById('recordHotkey');
    const modeHotkey = document.getElementById('modeHotkey');

    if (recordHotkey) recordHotkey.textContent = config.hotkey || 'Ctrl+Shift+R';
    if (modeHotkey) modeHotkey.textContent = config.modeToggleHotkey || 'Ctrl+Shift+M';
}

// Update status
function updateStatus(status, text, icon = '✓') {
    const mainStatus = document.getElementById('mainStatus');
    const statusText = document.getElementById('statusText');
    const statusIcon = mainStatus.querySelector('.status-icon');

    mainStatus.className = 'status-card ' + status;
    statusText.textContent = text;
    statusIcon.textContent = icon;
}

// Update recording state
function updateRecordingState(isRecording) {
    const indicator = document.getElementById('recordingIndicator');
    const mainStatus = document.getElementById('mainStatus');

    if (isRecording) {
        indicator.classList.add('active');
        mainStatus.style.display = 'none';
        recordingStartTime = Date.now();
        startRecordingTimer();
        updateStatus('recording', '正在录音...', '🎤');
    } else {
        indicator.classList.remove('active');
        mainStatus.style.display = 'block';
        stopRecordingTimer();
        updateStatus('', '就绪 - 按快捷键开始录音', '✓');
    }
}

// Start recording timer
function startRecordingTimer() {
    if (recordingTimer) clearInterval(recordingTimer);

    recordingTimer = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
        const seconds = (elapsed % 60).toString().padStart(2, '0');

        const timeDisplay = document.querySelector('.recording-time');
        if (timeDisplay) {
            timeDisplay.textContent = `${minutes}:${seconds}`;
        }
    }, 100);
}

// Stop recording timer
function stopRecordingTimer() {
    if (recordingTimer) {
        clearInterval(recordingTimer);
        recordingTimer = null;
    }
}

// Show processing status
function showProcessing(step, progress) {
    const processingStatus = document.getElementById('processingStatus');
    const processingText = document.getElementById('processingText');
    const progressFill = document.getElementById('progressFill');
    const resultContainer = document.getElementById('resultContainer');

    processingStatus.style.display = 'block';
    resultContainer.style.display = 'none';

    const stepTexts = {
        'converting': '正在转换音频格式...',
        'uploading': '正在上传到ASR服务器...',
        'recognizing': '正在识别语音...',
        'translating': '正在翻译...',
        'complete': '处理完成'
    };

    processingText.textContent = stepTexts[step] || '处理中...';
    progressFill.style.width = progress + '%';
}

// Show result
function showResult(text, translatedText = null) {
    const processingStatus = document.getElementById('processingStatus');
    const resultContainer = document.getElementById('resultContainer');
    const resultPreview = document.getElementById('resultPreview');

    processingStatus.style.display = 'none';
    resultContainer.style.display = 'block';

    let displayText = text;
    if (translatedText && config.mode === 'translate') {
        displayText = translatedText;
    } else if (translatedText && config.mode === 'dual') {
        displayText = `${text}\n\n${translatedText}`;
    }

    resultPreview.textContent = displayText;

    // Auto-hide after 10 seconds
    setTimeout(() => {
        resultContainer.style.display = 'none';
        updateStatus('', '就绪 - 按快捷键开始录音', '✓');
    }, 10000);
}

// Show error
function showError(message) {
    const processingStatus = document.getElementById('processingStatus');
    processingStatus.style.display = 'none';
    updateStatus('error', '错误: ' + message, '❌');

    setTimeout(() => {
        updateStatus('', '就绪 - 按快捷键开始录音', '✓');
    }, 5000);
}

// Update mode
function updateMode(mode) {
    const modeText = document.getElementById('currentMode');
    const modeNames = {
        'transcribe': '转写模式',
        'translate': '翻译模式',
        'dual': '双语模式'
    };

    if (modeText) {
        modeText.textContent = modeNames[mode] || '转写模式';
    }
}

// IPC Listeners
ipcRenderer.on('recording-state-changed', (event, isRecording) => {
    updateRecordingState(isRecording);
});

ipcRenderer.on('mode-changed', (event, mode) => {
    config.mode = mode;
    updateMode(mode);
});

ipcRenderer.on('processing-progress', (event, data) => {
    showProcessing(data.step, data.progress);
});

ipcRenderer.on('transcription-result', (event, data) => {
    showResult(data.text, data.translatedText);
});

ipcRenderer.on('transcription-error', (event, error) => {
    showError(error.message);
});

// Window controls
function openSettings() {
    ipcRenderer.send('open-settings');
}

function openHistory() {
    ipcRenderer.send('open-history');
}

function hideWindow() {
    ipcRenderer.send('hide-status-window');
}

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    loadConfig();

    // Check initial recording state
    ipcRenderer.invoke('get-recording-state').then(updateRecordingState);
    ipcRenderer.invoke('get-config').then(cfg => {
        config = cfg;
        updateMode(cfg.mode);
    });
});
