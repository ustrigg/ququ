const { ipcRenderer } = require('electron');
const ASRAdapter = require('./src/asrAdapter');

let config = {};
let historyItems = [];
let mediaRecorder;
let audioChunks = [];
let currentStream = null; // 保存当前的 MediaStream 引用
let recordingCancelled = false; // 取消录音标志（丢弃不转写）
let microphoneAvailable = false; // 麦克风可用状态

// ASR Adapter instance
let asrAdapter = null;

// Waveform visualization variables
let audioContext = null;
let analyser = null;
let animationFrameId = null;

// 加载配置
async function loadConfig() {
    config = await ipcRenderer.invoke('get-config');
    updateModeButtons();
    updateOptimizationToggle();

    // 初始化 ASR 适配器
    initASRAdapter();

    // 检查麦克风权限
    await checkMicrophonePermission();
}

// 初始化 ASR 适配器
function initASRAdapter() {
    console.log('[ASR] Initializing ASR adapter...');
    console.log('[ASR] Backend:', config.asrBackend || 'paraformer');

    asrAdapter = new ASRAdapter({
        asrBackend: config.asrBackend || 'paraformer',
        asrServerUrl: config.asrServerUrl,
        useVAD: config.useVAD,
        vadThreshold: config.vadThreshold,
        sentenceTimestamp: config.sentenceTimestamp,
        maxSingleSegmentTime: config.maxSingleSegmentTime,
        qwen3Asr: config.qwen3Asr,
        asrFallback: config.asrFallback
    });

    console.log('[ASR] Adapter initialized successfully');

    // 暴露到 window 对象供调试使用
    window.asrAdapter = asrAdapter;
}

// 更新 ASR 适配器配置
function updateASRAdapter() {
    if (asrAdapter) {
        asrAdapter.updateConfig({
            asrBackend: config.asrBackend,
            asrServerUrl: config.asrServerUrl,
            useVAD: config.useVAD,
            vadThreshold: config.vadThreshold,
            sentenceTimestamp: config.sentenceTimestamp,
            maxSingleSegmentTime: config.maxSingleSegmentTime,
            qwen3Asr: config.qwen3Asr,
            asrFallback: config.asrFallback
        });
        console.log('[ASR] Adapter configuration updated');
    }
}

// 检查麦克风权限和可用性
async function checkMicrophonePermission() {
    try {
        console.log('[Microphone Check] Checking microphone permission...');

        // 检查浏览器是否支持 getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('您的浏览器不支持麦克风访问');
        }

        // 尝试获取麦克风设备列表
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');

        console.log('[Microphone Check] Found audio devices:', audioDevices.length);

        if (audioDevices.length === 0) {
            throw new Error('未检测到麦克风设备');
        }

        // 尝试获取麦克风权限（快速测试）
        const testStream = await navigator.mediaDevices.getUserMedia({
            audio: true
        });

        // 立即释放测试流
        testStream.getTracks().forEach(track => track.stop());

        microphoneAvailable = true;
        console.log('[Microphone Check] Microphone permission granted and devices available');

        // 更新UI显示麦克风就绪
        updateMicrophoneStatus(true);

    } catch (error) {
        microphoneAvailable = false;
        console.error('[Microphone Check] Failed:', error);

        // 显示友好的错误提示
        let errorMessage = '麦克风初始化失败：';

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += '麦克风权限被拒绝。请在系统设置中允许此应用使用麦克风。';
        } else if (error.name === 'NotFoundError' || error.message.includes('未检测到')) {
            errorMessage += '未检测到麦克风设备。请连接麦克风后重启应用。';
        } else if (error.name === 'NotReadableError') {
            errorMessage += '麦克风被其他程序占用。请关闭其他使用麦克风的应用。';
        } else {
            errorMessage += error.message;
        }

        updateMicrophoneStatus(false, errorMessage);
    }
}

// 更新麦克风状态显示
function updateMicrophoneStatus(available, errorMessage = '') {
    const statusText = document.getElementById('statusText');
    const statusHint = document.getElementById('statusHint');
    const statusIcon = document.getElementById('statusIcon');
    const recordToggleBtn = document.getElementById('recordToggleBtn');

    if (available) {
        statusIcon.textContent = '🎤';
        statusText.textContent = '按 Ctrl+Shift+R 开始录音';
        statusHint.textContent = '麦克风就绪';
        if (recordToggleBtn) recordToggleBtn.disabled = false;
    } else {
        statusIcon.textContent = '⚠️';
        statusText.textContent = '麦克风不可用';
        statusHint.textContent = errorMessage;
        if (recordToggleBtn) recordToggleBtn.disabled = true;
    }
}

// 更新模式按钮状态
function updateModeButtons() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === config.mode);
    });
}

// 更新文本优化开关状态
function updateOptimizationToggle() {
    const toggle = document.getElementById('optimizationToggle');
    if (toggle) {
        // 确保只有明确为 true 时才显示为激活状态
        toggle.classList.toggle('active', config.textRefinementEnabled === true);
    }
}

// 模式切换和文本优化开关的事件监听器将在 DOMContentLoaded 中注册
// 避免在 DOM 加载前访问元素

// ==================== 录音提示音 ====================

// 播放短促提示音（Web Audio API，无需外部音频文件）
function playRecordingTone(type) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        gain.gain.setValueAtTime(0.12, ctx.currentTime);

        if (type === 'start') {
            // 上升音调 - 录音开始
            osc.frequency.setValueAtTime(660, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(880, ctx.currentTime + 0.12);
        } else if (type === 'cancel') {
            // 双降音调 - 录音取消
            osc.frequency.setValueAtTime(550, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(330, ctx.currentTime + 0.15);
        } else {
            // 下降音调 - 录音停止
            osc.frequency.setValueAtTime(660, ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(440, ctx.currentTime + 0.12);
        }

        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.2);

        // 清理
        osc.onended = () => ctx.close();
    } catch (e) {
        console.log('[Sound] Failed to play recording tone:', e.message);
    }
}

// 监听主进程的提示音事件
ipcRenderer.on('play-recording-sound', (event, type) => {
    console.log('[Sound] Playing recording tone:', type);
    playRecordingTone(type);
});

// 监听 F6 快捷键切换文本优化状态
ipcRenderer.on('text-refinement-toggled', (event, enabled) => {
    console.log('[F6] Text refinement toggled:', enabled);
    config.textRefinementEnabled = enabled;
    updateOptimizationToggle();

    // 显示状态提示
    const statusHint = document.getElementById('statusHint');
    if (statusHint) {
        const originalText = statusHint.textContent;
        statusHint.textContent = enabled ? '✓ 文本优化已启用 (F6)' : '✗ 文本优化已关闭 (F6)';
        setTimeout(() => { statusHint.textContent = originalText; }, 2000);
    }
});

// 录音状态更新
ipcRenderer.on('recording-state-changed', (event, isRecording) => {
    console.log('[Main Window] Recording state changed:', isRecording);

    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusHint = document.getElementById('statusHint');
    const progressSteps = document.getElementById('progressSteps');

    // 同步录音切换按钮状态
    const recordToggleBtn = document.getElementById('recordToggleBtn');

    if (isRecording) {
        console.log('[Main Window] Starting recording UI update...');
        statusDot.className = 'status-dot recording';
        statusLabel.textContent = '准备中';
        statusIcon.textContent = '⏳';
        statusText.textContent = '正在准备录音...';
        statusHint.textContent = '请稍候，准备就绪后再说话';
        progressSteps.style.display = 'flex';
        setProgressStep(1, 'active');

        // 更新按钮为录音中状态
        if (recordToggleBtn) {
            recordToggleBtn.classList.add('recording');
            recordToggleBtn.textContent = '⏹';
            recordToggleBtn.title = '停止录音 (Ctrl+Shift+R)';
        }

        // Start actual recording
        console.log('[Main Window] Calling startRecording()...');
        startRecording().then(() => {
            // 录音准备就绪，更新UI
            if (statusLabel.textContent === '准备中') {
                statusLabel.textContent = '录音中';
                statusIcon.textContent = '🔴';
                statusText.textContent = '正在录音中，请说话...';
                statusHint.textContent = '按 ESC 或 Ctrl+Shift+E 停止';
            }
        });
    } else {
        console.log('[Main Window] Stopping recording UI update...');
        statusDot.className = 'status-dot';
        statusLabel.textContent = '就绪';
        statusIcon.textContent = '🎤';
        statusText.textContent = '按 Ctrl+Shift+R 开始录音';
        statusHint.textContent = 'Ctrl+Shift+M 切换模式';
        progressSteps.style.display = 'none';
        resetProgressSteps();

        // 恢复按钮为就绪状态
        if (recordToggleBtn) {
            recordToggleBtn.classList.remove('recording');
            recordToggleBtn.textContent = '▶';
            recordToggleBtn.title = '开始录音 (Ctrl+Shift+R)';
        }

        // Stop actual recording
        console.log('[Main Window] Calling stopRecording()...');
        stopRecording();
    }
});

// 处理录音取消（丢弃音频，不转写）
ipcRenderer.on('recording-cancelled', (event) => {
    console.log('[Main Window] Recording CANCELLED - discarding audio');
    recordingCancelled = true;

    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusHint = document.getElementById('statusHint');
    const progressSteps = document.getElementById('progressSteps');
    const recordToggleBtn = document.getElementById('recordToggleBtn');

    statusDot.className = 'status-dot';
    statusLabel.textContent = '已取消';
    statusIcon.textContent = '🚫';
    statusText.textContent = '录音已取消，音频已丢弃';
    statusHint.textContent = 'Ctrl+Shift+R 重新开始录音';
    progressSteps.style.display = 'none';
    resetProgressSteps();

    if (recordToggleBtn) {
        recordToggleBtn.classList.remove('recording');
        recordToggleBtn.textContent = '▶';
        recordToggleBtn.title = '开始录音 (Ctrl+Shift+R)';
    }

    // 停止录音（会触发 onstop，但 recordingCancelled 标志会阻止 processAudio）
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
            mediaRecorder.stop();
        } catch (e) {
            console.error('[Recording] Error stopping cancelled recording:', e);
            cleanupRecording();
        }
    } else {
        cleanupRecording();
    }

    // 1.5秒后恢复就绪状态
    setTimeout(() => {
        if (statusLabel.textContent === '已取消') {
            statusLabel.textContent = '就绪';
            statusIcon.textContent = '🎤';
            statusText.textContent = '按 Ctrl+Shift+R 开始录音';
            statusHint.textContent = 'Ctrl+Shift+M 切换模式';
        }
    }, 1500);
});

// 处理状态更新
ipcRenderer.on('processing-status', (event, status) => {
    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusHint = document.getElementById('statusHint');

    switch (status.type) {
        case 'converting':
            statusDot.className = 'status-dot processing';
            statusLabel.textContent = '转换中';
            statusIcon.textContent = '🔄';
            statusText.textContent = '正在转换音频格式...';
            statusHint.textContent = '请稍候';
            setProgressStep(1, 'completed');
            setProgressStep(2, 'active');
            break;

        case 'transcribing':
            statusDot.className = 'status-dot processing';
            statusLabel.textContent = '转写中';
            statusIcon.textContent = '📝';
            statusText.textContent = '正在进行语音识别...';
            statusHint.textContent = '请稍候';
            setProgressStep(2, 'completed');
            setProgressStep(3, 'active');
            break;

        case 'translating':
            statusDot.className = 'status-dot processing';
            statusLabel.textContent = '翻译中';
            statusIcon.textContent = '🌐';
            statusText.textContent = '正在翻译文本...';
            statusHint.textContent = '请稍候';
            setProgressStep(3, 'active');
            break;

        case 'completed':
            statusDot.className = 'status-dot';
            statusLabel.textContent = '完成';
            statusIcon.textContent = '✅';
            statusText.textContent = '处理完成！';
            statusHint.textContent = '结果已复制到剪贴板';
            setProgressStep(3, 'completed');

            // 2秒后恢复就绪状态
            setTimeout(() => {
                statusDot.className = 'status-dot';
                statusLabel.textContent = '就绪';
                statusIcon.textContent = '🎤';
                statusText.textContent = '按 Ctrl+Shift+R 开始录音';
                statusHint.textContent = '按 Ctrl+Shift+M 切换模式';
                document.getElementById('progressSteps').style.display = 'none';
                resetProgressSteps();
            }, 2000);
            break;

        case 'error':
            statusDot.className = 'status-dot';
            statusLabel.textContent = '错误';
            statusIcon.textContent = '❌';
            statusText.textContent = status.message || '处理失败';
            statusHint.textContent = '请重试';
            setTimeout(() => {
                statusDot.className = 'status-dot';
                statusLabel.textContent = '就绪';
                statusIcon.textContent = '🎤';
                statusText.textContent = '按 Ctrl+Shift+R 开始录音';
                statusHint.textContent = '按 Ctrl+Shift+M 切换模式';
                document.getElementById('progressSteps').style.display = 'none';
                resetProgressSteps();
            }, 3000);
            break;
    }
});

// 设置进度步骤
function setProgressStep(step, state) {
    const stepEl = document.getElementById(`step${step}`);
    if (stepEl) {
        stepEl.className = `step ${state}`;
    }
}

// 重置进度步骤
function resetProgressSteps() {
    for (let i = 1; i <= 3; i++) {
        const stepEl = document.getElementById(`step${i}`);
        if (stepEl) {
            stepEl.className = 'step';
        }
    }
}


// 模式变化
ipcRenderer.on('mode-changed', (event, mode) => {
    config.mode = mode;
    updateModeButtons();
});

// 添加历史记录
ipcRenderer.on('transcription-result', (event, data) => {
    addHistoryItem(data);
});

// 添加历史记录项
function addHistoryItem(data) {
    const item = {
        id: Date.now(),
        timestamp: new Date(),
        mode: data.mode,
        text: data.text,
        translation: data.translation || null,
        audioPath: data.audioPath || null
    };

    historyItems.unshift(item);

    // 最多保留50条
    if (historyItems.length > 50) {
        historyItems = historyItems.slice(0, 50);
    }

    renderHistory();
    saveHistory();
}

// 渲染历史记录
function renderHistory() {
    const historyList = document.getElementById('historyList');

    if (historyItems.length === 0) {
        historyList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-text">暂无记录</div>
            </div>
        `;
        return;
    }

    const modeNames = {
        transcribe: '转写',
        translate: '翻译',
        dual: '双语'
    };

    historyList.innerHTML = historyItems.map((item, index) => {
        // 对于 data 属性，需要转义引号以防止破坏 HTML 属性
        const escapeDataAttr = (str) => str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

        return `
        <div class="history-item" data-index="${index}">
            <div class="history-item-header">
                <span class="history-mode ${item.mode}">${modeNames[item.mode]}</span>
                <div class="history-item-actions">
                    ${item.audioPath ? `
                        <button class="audio-play-btn" data-audio-path="${escapeDataAttr(item.audioPath)}" title="播放录音">
                            ▶️
                        </button>
                    ` : ''}
                    <span class="history-time">${formatTime(item.timestamp)}</span>
                </div>
            </div>
            <div class="history-content"
                 data-original="${escapeDataAttr(item.text)}"
                 data-translation="${item.translation ? escapeDataAttr(item.translation) : ''}">
                <div class="history-text" title="点击复制${item.translation ? '双语格式' : '原文'}">
                    ${escapeHtml(item.text)}
                </div>
                ${item.translation ? `
                    <div class="history-translation" title="点击复制双语格式">
                        ${escapeHtml(item.translation)}
                    </div>
                ` : ''}
            </div>
        </div>
        `;
    }).join('');

    // 添加事件监听器（使用事件委托）
    setupHistoryEventListeners();
}

// 设置历史记录事件监听器（使用事件委托）
function setupHistoryEventListeners() {
    const historyList = document.getElementById('historyList');

    // 移除旧的监听器（如果存在）
    const oldListener = historyList._clickListener;
    if (oldListener) {
        historyList.removeEventListener('click', oldListener);
    }

    // 添加新的事件委托监听器
    const clickListener = function(e) {
        // 处理播放按钮点击
        if (e.target.classList.contains('audio-play-btn') || e.target.closest('.audio-play-btn')) {
            const btn = e.target.classList.contains('audio-play-btn') ? e.target : e.target.closest('.audio-play-btn');
            const audioPath = btn.getAttribute('data-audio-path');
            if (audioPath) {
                e.stopPropagation();
                playAudio(audioPath);
            }
            return;
        }

        // 处理文本复制点击
        if (e.target.classList.contains('history-text') || e.target.classList.contains('history-translation')) {
            // 找到history-content父元素以获取原文和翻译
            const historyContent = e.target.closest('.history-content');
            if (historyContent) {
                const originalText = historyContent.getAttribute('data-original');
                const translation = historyContent.getAttribute('data-translation');

                let textToCopy;
                if (translation && translation.trim().length > 0) {
                    // 有翻译：复制双语格式 "English (Chinese)"
                    textToCopy = `${translation} (${originalText})`;
                } else {
                    // 无翻译：只复制原文
                    textToCopy = originalText;
                }

                if (textToCopy) {
                    copyText(textToCopy, '双语');
                }
            }
            return;
        }
    };

    historyList.addEventListener('click', clickListener);
    historyList._clickListener = clickListener; // 保存引用以便后续移除
}

// 复制文本（改进版：使用后备方法和重试机制）
window.copyText = async function(text, label) {
    try {
        // 解码 HTML 实体（&quot;, &#39; 等）
        const textarea = document.createElement('textarea');
        textarea.innerHTML = text;
        const decodedText = textarea.value;

        // 尝试使用 Clipboard API
        try {
            await navigator.clipboard.writeText(decodedText);
            console.log(`[Copy] Copied ${label}:`, decodedText);

            // 显示复制成功的视觉反馈
            const statusHint = document.getElementById('statusHint');
            if (statusHint) {
                const originalText = statusHint.textContent;
                statusHint.textContent = `✓ 已复制${label}`;
                setTimeout(() => {
                    statusHint.textContent = originalText;
                }, 1500);
            }
        } catch (clipboardErr) {
            // Clipboard API 失败，使用后备方法（document.execCommand）
            console.warn('[Copy] Clipboard API failed, trying fallback method:', clipboardErr);

            const fallbackTextarea = document.createElement('textarea');
            fallbackTextarea.value = decodedText;
            fallbackTextarea.style.position = 'fixed';
            fallbackTextarea.style.opacity = '0';
            document.body.appendChild(fallbackTextarea);
            fallbackTextarea.select();

            const success = document.execCommand('copy');
            document.body.removeChild(fallbackTextarea);

            if (success) {
                console.log(`[Copy] Copied ${label} using fallback method:`, decodedText);
                const statusHint = document.getElementById('statusHint');
                if (statusHint) {
                    const originalText = statusHint.textContent;
                    statusHint.textContent = `✓ 已复制${label}`;
                    setTimeout(() => {
                        statusHint.textContent = originalText;
                    }, 1500);
                }
            } else {
                throw new Error('Both clipboard methods failed');
            }
        }
    } catch (error) {
        console.error('[Copy] All copy methods failed:', error);
        // 不使用 alert，改为在界面上显示错误
        const statusHint = document.getElementById('statusHint');
        if (statusHint) {
            statusHint.textContent = `✗ 复制失败：${error.message}`;
            setTimeout(() => {
                statusHint.textContent = '按 Ctrl+Shift+M 切换模式';
            }, 3000);
        }
    }
};

// 复制历史记录项（保留向后兼容）
window.copyHistoryItem = function(id) {
    const item = historyItems.find(i => i.id === id);
    if (item) {
        let textToCopy = item.text;
        if (item.translation && item.mode !== 'transcribe') {
            textToCopy = item.mode === 'dual'
                ? `${item.text}\n\n${item.translation}`
                : item.translation;
        }
        navigator.clipboard.writeText(textToCopy).then(() => {
            console.log('Copied to clipboard:', textToCopy);
        });
    }
};

// 格式化时间
function formatTime(date) {
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '刚刚';
    if (diffMins < 60) return `${diffMins}分钟前`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}小时前`;

    const month = d.getMonth() + 1;
    const day = d.getDate();
    const hour = d.getHours().toString().padStart(2, '0');
    const minute = d.getMinutes().toString().padStart(2, '0');
    return `${month}/${day} ${hour}:${minute}`;
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 清空历史记录
document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('确定要清空所有历史记录吗？')) {
        historyItems = [];
        renderHistory();
        saveHistory();
    }
});

// 保存历史记录到本地
function saveHistory() {
    localStorage.setItem('transcriptionHistory', JSON.stringify(historyItems));
}

// 加载历史记录
function loadHistory() {
    const saved = localStorage.getItem('transcriptionHistory');
    if (saved) {
        try {
            historyItems = JSON.parse(saved);
            renderHistory();
        } catch (e) {
            console.error('Failed to load history:', e);
            historyItems = [];
        }
    }
}

// 设置按钮
document.getElementById('settingsBtn').addEventListener('click', () => {
    ipcRenderer.send('open-settings');
});

// 退出按钮
document.getElementById('exitBtn').addEventListener('click', () => {
    if (confirm('确定要退出应用吗？')) {
        ipcRenderer.send('quit-app');
    }
});

// 最小化按钮
document.getElementById('minBtn').addEventListener('click', () => {
    ipcRenderer.send('minimize-window');
});

// 关闭按钮（隐藏窗口）- 已移除，合并到退出按钮
// document.getElementById('closeBtn').addEventListener('click', () => {
//     ipcRenderer.send('hide-window');
// });

// 监听设备变化
function setupDeviceChangeListener() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.addEventListener) {
        console.warn('[Device Monitor] Device change monitoring not supported');
        return;
    }

    navigator.mediaDevices.addEventListener('devicechange', async () => {
        console.log('[Device Monitor] Device change detected');

        // 重新检查麦克风权限和可用性
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(device => device.kind === 'audioinput');

        console.log('[Device Monitor] Current audio devices:', audioDevices.length);

        if (audioDevices.length === 0) {
            console.warn('[Device Monitor] No audio devices available');
            microphoneAvailable = false;
            updateMicrophoneStatus(false, '未检测到麦克风设备');

            // 如果正在录音，停止录音
            if (mediaRecorder && mediaRecorder.state === 'recording') {
                showRecordingError('麦克风设备已断开');
                cleanupRecording();
                ipcRenderer.send('force-stop-recording');
            }
        } else {
            console.log('[Device Monitor] Audio devices available, re-checking permission');
            // 重新检查麦克风权限
            await checkMicrophonePermission();
        }
    });

    console.log('[Device Monitor] Device change listener set up');
}

// 初始化
window.addEventListener('DOMContentLoaded', async () => {
    console.log('[Main Window] DOMContentLoaded event fired');
    console.log('[Main Window] Loading config and history...');

    // 设置模式切换按钮
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const mode = btn.dataset.mode;
            if (mode !== config.mode) {
                config.mode = mode;
                await ipcRenderer.invoke('save-config', config);
                updateModeButtons();
                console.log('Mode switched to:', mode);
            }
        });
    });

    // 设置文本优化开关
    const optimizationToggle = document.getElementById('optimizationToggle');
    if (optimizationToggle) {
        optimizationToggle.addEventListener('click', async () => {
            config.textRefinementEnabled = !config.textRefinementEnabled;
            await ipcRenderer.invoke('save-config', config);
            updateOptimizationToggle();
            console.log('Text optimization toggled to:', config.textRefinementEnabled);

            // 显示提示
            const statusHint = document.getElementById('statusHint');
            if (statusHint) {
                const originalText = statusHint.textContent;
                statusHint.textContent = config.textRefinementEnabled ? '✓ 文本优化已启用' : '✗ 文本优化已关闭';
                setTimeout(() => {
                    statusHint.textContent = originalText;
                }, 2000);
            }
        });
    }

    // 设置录音切换按钮
    const recordToggleBtn = document.getElementById('recordToggleBtn');
    if (recordToggleBtn) {
        recordToggleBtn.addEventListener('click', () => {
            console.log('[RecordBtn] Toggle recording button clicked');
            ipcRenderer.send('toggle-recording');
        });
    }

    // 加载配置和历史（等待完成）
    await loadConfig();
    loadHistory();
    setupDeviceChangeListener();
    setupKeyboardListeners();

    console.log('[Main Window] Initialization complete');
    console.log('[Main Window] Microphone available:', microphoneAvailable);
});

// 设置键盘监听器（ESC 停止录音）
function setupKeyboardListeners() {
    document.addEventListener('keydown', async (event) => {
        // ESC 键：停止录音
        if (event.key === 'Escape' || event.keyCode === 27) {
            console.log('[Keyboard] ESC key pressed');

            // 检查当前是否在录音
            const isRecording = await ipcRenderer.invoke('get-recording-state');

            if (isRecording) {
                console.log('[Keyboard] Stopping recording via ESC key');
                event.preventDefault();

                // 通过主进程的 stopRecording 函数停止录音
                // 由于我们在渲染进程，需要通知主进程
                ipcRenderer.send('request-stop-recording');
            }
        }
    });

    console.log('[Keyboard] Keyboard listeners set up (ESC to stop recording)');
}

// ==================== 波形可视化函数 ====================

// Start waveform visualization
function startWaveformVisualization(stream) {
    try {
        const canvas = document.getElementById('waveformCanvas');
        if (!canvas) {
            console.warn('[Waveform] Canvas element not found');
            return;
        }

        const canvasCtx = canvas.getContext('2d');

        // Show canvas
        canvas.style.display = 'block';

        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = 60;

        // Create audio context and analyser
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        const source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        analyser.fftSize = 256;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        console.log('[Waveform] Visualization started');

        // 为向 indicator 发送频谱数据做节流计数
        let frameCounter = 0;

        // Animation loop
        function draw() {
            animationFrameId = requestAnimationFrame(draw);

            analyser.getByteFrequencyData(dataArray);

            // 每 2 帧向 indicator 发一次频谱数据（约 30fps，避免 IPC 过载）
            frameCounter++;
            if (frameCounter % 2 === 0) {
                // TypedArray 不能直接 IPC 传输，转为普通数组
                ipcRenderer.send('waveform-data', Array.from(dataArray));
            }

            canvasCtx.fillStyle = 'rgba(102, 126, 234, 0.1)';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

            const barWidth = (canvas.width / bufferLength) * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                barHeight = (dataArray[i] / 255) * canvas.height * 0.8;

                const gradient = canvasCtx.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
                gradient.addColorStop(0, '#667eea');
                gradient.addColorStop(1, '#764ba2');

                canvasCtx.fillStyle = gradient;
                canvasCtx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);

                x += barWidth + 1;
            }
        }

        draw();
    } catch (error) {
        console.error('[Waveform] Failed to start visualization:', error);
    }
}

// Stop waveform visualization
function stopWaveformVisualization() {
    try {
        const canvas = document.getElementById('waveformCanvas');
        if (canvas) {
            canvas.style.display = 'none';
        }

        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        if (audioContext) {
            audioContext.close();
            audioContext = null;
        }

        analyser = null;
        console.log('[Waveform] Visualization stopped');
    } catch (error) {
        console.error('[Waveform] Failed to stop visualization:', error);
    }
}

// ==================== 录音处理函数 ====================

// Audio recording functions
async function startRecording() {
    try {
        console.log('[Recording] Starting recording...');
        recordingCancelled = false; // 重置取消标志

        // 首先检查麦克风是否可用
        if (!microphoneAvailable) {
            console.error('[Recording] Microphone not available');
            showRecordingError('麦克风不可用，请检查麦克风权限和设备连接');
            // 通知主进程停止录音状态
            ipcRenderer.send('force-stop-recording');
            return;
        }

        // 如果之前有流在运行，先停止
        if (currentStream) {
            console.log('[Recording] Stopping previous stream...');
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }

        // 枚举音频设备并选择最佳麦克风
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioDevices = devices.filter(d => d.kind === 'audioinput');
        console.log('[Recording] Available microphones:');
        audioDevices.forEach((d, i) => console.log(`[Recording]   [${i}] ${d.label} (${d.deviceId.substring(0, 8)}...)`));

        // 构建音频约束
        const audioConstraints = {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        };

        // 如果配置了指定设备ID则使用，否则用默认
        if (config.preferredMicDeviceId) {
            audioConstraints.deviceId = { exact: config.preferredMicDeviceId };
            console.log('[Recording] Using configured mic device:', config.preferredMicDeviceId);
        }

        console.log('[Recording] Requesting microphone access...');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

        // 保存当前流的引用
        currentStream = stream;

        // Start waveform visualization
        startWaveformVisualization(stream);

        const audioTrack = stream.getAudioTracks()[0];
        if (audioTrack) {
            console.log('[Recording] Using microphone:', audioTrack.label);

            // 获取实际的音频设置
            const settings = audioTrack.getSettings();
            console.log('[Recording] Actual audio settings:');
            console.log('[Recording] - Sample rate:', settings.sampleRate, 'Hz');
            console.log('[Recording] - Channel count:', settings.channelCount);
            console.log('[Recording] - Echo cancellation:', settings.echoCancellation);
            console.log('[Recording] - Noise suppression:', settings.noiseSuppression);
            console.log('[Recording] - Auto gain control:', settings.autoGainControl);

            // 监听音轨结束事件（麦克风断开）
            audioTrack.onended = () => {
                console.error('[Recording] Audio track ended unexpectedly (microphone disconnected?)');
                showRecordingError('麦克风连接已断开');
                cleanupRecording();
                ipcRenderer.send('force-stop-recording');
            };
        }

        // Check supported MIME types
        const possibleTypes = [
            'audio/webm;codecs=opus',
            'audio/webm',
            'audio/ogg;codecs=opus',
            'audio/wav'
        ];

        let selectedMimeType = '';
        for (const type of possibleTypes) {
            if (MediaRecorder.isTypeSupported(type)) {
                selectedMimeType = type;
                break;
            }
        }

        console.log('[Recording] Selected MIME type:', selectedMimeType || 'default');

        if (!selectedMimeType) {
            mediaRecorder = new MediaRecorder(stream);
        } else {
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: selectedMimeType,
                audioBitsPerSecond: 128000  // 提高音质
            });
        }

        audioChunks = [];

        // 收集所有音频数据
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                console.log('[Recording] Audio chunk received:', event.data.size, 'bytes', 'at', new Date().toISOString());
                audioChunks.push(event.data);
                console.log('[Recording] Total chunks so far:', audioChunks.length);
            } else {
                console.warn('[Recording] Received empty audio chunk at', new Date().toISOString());
            }
        };

        mediaRecorder.onstop = async () => {
            console.log('[Recording] MediaRecorder stopped, chunks collected:', audioChunks.length);
            const totalSize = audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
            console.log('[Recording] Total audio data collected:', totalSize, 'bytes');

            // 检查是否被取消
            if (recordingCancelled) {
                console.log('[Recording] Recording was CANCELLED, discarding audio data');
                recordingCancelled = false;
                cleanupRecording();
                return;
            }

            // 等待1000ms确保所有数据都收集完毕，包括结尾的音频和最后的数据块
            // 这个延迟很关键，确保 ondataavailable 有足够时间处理所有数据
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('[Recording] After wait, final chunks count:', audioChunks.length);
            console.log('[Recording] Final total size:', audioChunks.reduce((sum, chunk) => sum + chunk.size, 0), 'bytes');

            processAudio();
        };

        mediaRecorder.onerror = (event) => {
            console.error('[Recording] MediaRecorder error:', event.error);
            showRecordingError('录音过程出错：' + event.error.message);
            cleanupRecording();
        };

        // 使用较大的timeslice (250ms) 来确保数据完整性
        // 较大的timeslice意味着更少的数据块，减少丢失风险
        mediaRecorder.start(250);
        console.log('[Recording] MediaRecorder started with timeslice: 250ms');
        console.log('[Recording] Recording state:', mediaRecorder.state);

        // 等待500ms让MediaRecorder完全准备好，并预录制一些缓冲
        // 这样即使用户立即开始说话，前面的声音也能被录到
        await new Promise(resolve => setTimeout(resolve, 500));
        console.log('[Recording] Recording ready - you can start speaking now!');

    } catch (error) {
        console.error('[Recording] Failed to start recording:', error);

        // 显示详细的错误信息
        let errorMessage = '启动录音失败：';

        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += '麦克风权限被拒绝';
            microphoneAvailable = false;
        } else if (error.name === 'NotFoundError') {
            errorMessage += '未找到麦克风设备';
            microphoneAvailable = false;
        } else if (error.name === 'NotReadableError') {
            errorMessage += '麦克风被其他程序占用';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage += '麦克风不支持请求的配置';
        } else {
            errorMessage += error.message;
        }

        showRecordingError(errorMessage);
        cleanupRecording();

        // 通知主进程停止录音状态
        ipcRenderer.send('force-stop-recording');
    }
}

// 显示录音错误
function showRecordingError(message) {
    const statusDot = document.getElementById('statusDot');
    const statusLabel = document.getElementById('statusLabel');
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const statusHint = document.getElementById('statusHint');

    statusDot.className = 'status-dot';
    statusLabel.textContent = '错误';
    statusIcon.textContent = '❌';
    statusText.textContent = '录音失败';
    statusHint.textContent = message;

    // 3秒后恢复
    setTimeout(() => {
        statusDot.className = 'status-dot';
        statusLabel.textContent = '就绪';
        statusIcon.textContent = microphoneAvailable ? '🎤' : '⚠️';
        statusText.textContent = microphoneAvailable ? '按 Ctrl+Shift+R 开始录音' : '麦克风不可用';
        statusHint.textContent = microphoneAvailable ? '按 Ctrl+Shift+M 切换模式' : '请检查麦克风设置';
    }, 3000);
}

// 清理录音资源
function cleanupRecording() {
    console.log('[Recording] Cleaning up recording resources...');

    // Stop waveform visualization
    stopWaveformVisualization();

    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try {
            mediaRecorder.stop();
        } catch (e) {
            console.error('[Recording] Error stopping media recorder:', e);
        }
    }

    if (currentStream) {
        currentStream.getTracks().forEach(track => {
            console.log('[Recording] Stopping track:', track.label);
            track.stop();
        });
        currentStream = null;
    }

    mediaRecorder = null;
    audioChunks = [];
}

async function stopRecording() {
    console.log('[Recording] Stopping recording...');
    console.log('[Recording] Current time:', new Date().toISOString());

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
            // 请求最后一次数据收集并快速停止
            console.log('[Recording] Requesting final data...');
            mediaRecorder.requestData();

            // 等待 100ms 让最后的数据到达 ondataavailable
            await new Promise(resolve => setTimeout(resolve, 100));

            // 现在停止录音 - 这会触发 onstop 事件
            console.log('[Recording] Calling mediaRecorder.stop()...');
            mediaRecorder.stop();

            // 注意：不要在这里停止音轨！
            // 音轨将在 processAudio() 完成后由 cleanupRecording() 停止
            // 这样可以确保所有数据都被完整处理

            console.log('[Recording] Stop recording requested, waiting for onstop event...');
        } catch (error) {
            console.error('[Recording] Error stopping recording:', error);
            // 强制清理
            cleanupRecording();
        }
    } else {
        console.log('[Recording] No active recording to stop');
        // 确保清理所有资源
        cleanupRecording();
    }
}

// Convert WebM audio to WAV format
async function convertToWav(webmBlob) {
    return new Promise((resolve, reject) => {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const fileReader = new FileReader();

        fileReader.onload = async function(event) {
            try {
                const arrayBuffer = event.target.result;
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                console.log('[Audio Conversion] Original audio info:');
                console.log('[Audio Conversion] - Sample rate:', audioBuffer.sampleRate, 'Hz');
                console.log('[Audio Conversion] - Channels:', audioBuffer.numberOfChannels);
                console.log('[Audio Conversion] - Duration:', audioBuffer.duration, 'seconds');
                console.log('[Audio Conversion] - Length:', audioBuffer.length, 'samples');

                // 检查是否需要重采样到16kHz（FunASR 的标准采样率）
                const targetSampleRate = 16000;
                let finalAudioBuffer = audioBuffer;

                if (audioBuffer.sampleRate !== targetSampleRate) {
                    console.log('[Audio Conversion] Resampling from', audioBuffer.sampleRate, 'Hz to', targetSampleRate, 'Hz...');
                    finalAudioBuffer = await resampleAudioBuffer(audioBuffer, targetSampleRate);
                    console.log('[Audio Conversion] Resampling completed');
                    console.log('[Audio Conversion] - New sample rate:', finalAudioBuffer.sampleRate, 'Hz');
                    console.log('[Audio Conversion] - New length:', finalAudioBuffer.length, 'samples');
                } else {
                    console.log('[Audio Conversion] No resampling needed, already at', targetSampleRate, 'Hz');
                }

                // Convert to WAV
                const wavBuffer = audioBufferToWav(finalAudioBuffer);
                const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });

                console.log('[Audio Conversion] WAV file created, size:', wavBlob.size, 'bytes');

                resolve(wavBlob);
            } catch (error) {
                console.error('[Audio Conversion] Error:', error);
                reject(error);
            }
        };

        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(webmBlob);
    });
}

// 重采样音频到目标采样率
async function resampleAudioBuffer(audioBuffer, targetSampleRate) {
    const offlineContext = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.duration * targetSampleRate,
        targetSampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineContext.destination);
    source.start(0);

    return await offlineContext.startRendering();
}

// Convert AudioBuffer to WAV format
function audioBufferToWav(audioBuffer) {
    const numChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numChannels * bytesPerSample;

    const data = [];
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        data.push(audioBuffer.getChannelData(i));
    }

    const interleaved = interleave(data);
    const dataLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    // Write WAV header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);

    // Write audio data
    let offset = 44;
    for (let i = 0; i < interleaved.length; i++) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        offset += 2;
    }

    return buffer;
}

function interleave(channelData) {
    const length = channelData[0].length;
    const result = new Float32Array(length * channelData.length);
    let offset = 0;
    for (let i = 0; i < length; i++) {
        for (let channel = 0; channel < channelData.length; channel++) {
            result[offset++] = channelData[channel][i];
        }
    }
    return result;
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

// Process recorded audio
async function processAudio() {
    if (audioChunks.length === 0) {
        console.log('No audio data to process');
        return;
    }

    try {
        const perfStart = Date.now();
        const perf = (label) => console.log(`[Perf] ${label}: ${Date.now() - perfStart}ms`);

        perf('processAudio start');
        console.log('Audio chunks:', audioChunks.length);

        // Create blob from recorded chunks (WebM format)
        const webmBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        console.log('WebM blob size:', webmBlob.size);

        // Save recording and convert to WAV in parallel
        const timestamp = Date.now();
        const audioData = await webmBlob.arrayBuffer();

        console.log('Converting to WAV + saving in parallel...');
        const statusDot = document.getElementById('statusDot');
        const statusLabel = document.getElementById('statusLabel');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');
        statusDot.className = 'status-dot processing';
        statusLabel.textContent = '处理中';
        statusIcon.textContent = '⚡';
        statusText.textContent = '正在处理音频...';
        setProgressStep(1, 'completed');
        setProgressStep(2, 'active');

        // 并行执行：保存录音 + 转换WAV
        const t0 = Date.now();
        const [savedAudioPath, wavBlob] = await Promise.all([
            ipcRenderer.invoke('save-recording', {
                data: Buffer.from(audioData).toString('base64'),
                timestamp: timestamp,
                encoding: 'base64'
            }),
            convertToWav(webmBlob)
        ]);
        perf('save+convert done');

        // 直接发送到 ASR
        statusLabel.textContent = '转写中';
        statusIcon.textContent = '📝';
        statusText.textContent = '正在语音识别...';
        setProgressStep(2, 'completed');
        setProgressStep(3, 'active');

        // Use ASR adapter for transcription
        if (!asrAdapter) {
            throw new Error('ASR adapter not initialized');
        }

        const result = await asrAdapter.transcribe(wavBlob);
        perf('ASR transcribe done');
        console.log('[ASR] Backend used:', result.backend);
        if (result.fallbackUsed) {
            console.log('[ASR] Fallback was used, original backend:', result.originalBackend);
        }

        // Check result success
        if (!result.success) {
            throw new Error(result.error || 'ASR transcription failed');
        }

        const transcriptionText = result.text;

        if (transcriptionText && transcriptionText.trim()) {
            console.log('Transcription text:', transcriptionText);
            console.log('Audio duration:', result.duration || 0, 'seconds');
            console.log('ASR backend:', result.backend);

            // Text refinement: spoken to written language for all transcriptions
            let finalTranscriptionText = transcriptionText;
            const duration = result.duration || 0;

            if (config.textRefinementEnabled) {
                console.log(`[Text Refinement] Refining text (duration: ${duration}s)...`);

                // Update status
                const statusDot = document.getElementById('statusDot');
                const statusLabel = document.getElementById('statusLabel');
                const statusIcon = document.getElementById('statusIcon');
                const statusText = document.getElementById('statusText');
                const statusHint = document.getElementById('statusHint');
                statusDot.className = 'status-dot processing';
                statusLabel.textContent = '优化中';
                statusIcon.textContent = '✨';
                statusText.textContent = '正在优化口语表达...';
                statusHint.textContent = '转换为书面语';

                try {
                    perf('text refinement start');
                    const refinementResult = await ipcRenderer.invoke('refine-text', transcriptionText);
                    perf('text refinement done');

                    if (refinementResult.success) {
                        finalTranscriptionText = refinementResult.refinedText;
                        console.log('[Text Refinement] Success!');
                        console.log('[Text Refinement] Original:', transcriptionText);
                        console.log('[Text Refinement] Refined:', finalTranscriptionText);
                    } else {
                        console.warn('[Text Refinement] Failed, using original text:', refinementResult.error);
                    }
                } catch (error) {
                    console.error('[Text Refinement] Error:', error);
                    // Continue with original text on error
                }
            } else {
                console.log(`[Text Refinement] Skipped (duration: ${duration}s, enabled: ${config.textRefinementEnabled})`);
            }

            perf('before handleResult');
            await handleTranscriptionResult(finalTranscriptionText, savedAudioPath);
            perf('TOTAL DONE');

            // 处理成功，清理录音资源
            console.log('[Recording] Transcription completed successfully, cleaning up resources...');
            cleanupRecording();
        } else {
            console.error('No transcription text in response');
            // 清理录音资源
            cleanupRecording();

            // Check if segments is empty or transcription failed
            const errorMsg = result.error || '转写失败，未获取到文本结果';
            if (errorMsg.includes('未检测到') || (result.segments && result.segments.length === 0)) {
                throw new Error('未检测到语音，请确保：\n1. 录音时清晰说话\n2. 麦克风音量足够\n3. 环境噪音较小');
            } else {
                throw new Error(errorMsg);
            }
        }

    } catch (error) {
        console.error('Failed to process audio:', error);

        // 发生错误时也要清理录音资源和隐藏指示器
        console.log('[Recording] Error occurred, cleaning up resources...');
        cleanupRecording();
        ipcRenderer.send('processing-complete');

        const statusDot = document.getElementById('statusDot');
        const statusLabel = document.getElementById('statusLabel');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');
        statusDot.className = 'status-dot';
        statusLabel.textContent = '错误';
        statusIcon.textContent = '❌';
        statusText.textContent = '处理失败：' + error.message;

        setTimeout(() => {
            statusDot.className = 'status-dot';
            statusLabel.textContent = '就绪';
            statusIcon.textContent = '🎤';
            statusText.textContent = '按 Ctrl+Shift+R 开始录音';
            document.getElementById('progressSteps').style.display = 'none';
            resetProgressSteps();
        }, 3000);
    }
}

// Insert text to active window using auto-paste
async function insertText(text) {
    try {
        console.log('[Auto-Paste] Attempting to paste text at cursor position...');
        // Use auto-paste via main process (PowerShell)
        await ipcRenderer.invoke('auto-paste-text', text);
        console.log('[Auto-Paste] Text pasted successfully at cursor position');
        return true;
    } catch (error) {
        console.error('[Auto-Paste] Failed:', error);
        // Fallback to clipboard only if auto-paste fails
        try {
            await navigator.clipboard.writeText(text);
            console.log('[Auto-Paste] Fallback: Text copied to clipboard only');
            return false;
        } catch (clipboardError) {
            console.error('[Auto-Paste] Clipboard fallback also failed:', clipboardError);
            return false;
        }
    }
}

// Handle transcription result
async function handleTranscriptionResult(text, audioPath = null) {
    console.log('Transcription result:', text);
    console.log('Audio path:', audioPath);
    console.log('Current mode:', config.mode);

    let finalText = text;
    let translationResult = null;

    try {
        // Process based on mode
        switch (config.mode) {
            case 'transcribe':
                finalText = text;
                console.log('[Transcribe Mode] Output:', finalText);
                break;

            case 'translate':
                if (config.translationEnabled) {
                    console.log('[Translate Mode] Translating...');
                    const statusDot = document.getElementById('statusDot');
                    const statusLabel = document.getElementById('statusLabel');
                    const statusIcon = document.getElementById('statusIcon');
                    const statusText = document.getElementById('statusText');
                    statusDot.className = 'status-dot processing';
                    statusLabel.textContent = '翻译中';
                    statusIcon.textContent = '🌐';
                    statusText.textContent = '正在翻译文本...';

                    translationResult = await ipcRenderer.invoke('translate-text', text, config.translationStyle);

                    if (translationResult.success) {
                        finalText = translationResult.translation;
                        console.log('[Translate Mode] Translation:', finalText);
                    } else {
                        console.error('[Translate Mode] Translation failed:', translationResult.error);
                        finalText = text;
                    }
                } else {
                    console.warn('[Translate Mode] Translation disabled in config');
                    finalText = text;
                }
                break;

            case 'dual':
                if (config.translationEnabled) {
                    console.log('[Dual Mode] Translating...');
                    const statusDot = document.getElementById('statusDot');
                    const statusLabel = document.getElementById('statusLabel');
                    const statusIcon = document.getElementById('statusIcon');
                    const statusText = document.getElementById('statusText');
                    statusDot.className = 'status-dot processing';
                    statusLabel.textContent = '翻译中';
                    statusIcon.textContent = '🌐';
                    statusText.textContent = '正在翻译文本...';

                    translationResult = await ipcRenderer.invoke('translate-text', text, config.translationStyle);

                    if (translationResult.success) {
                        // Format: English (Chinese)
                        finalText = `${translationResult.translation} (${text})`;
                        console.log('[Dual Mode] Dual output:', finalText);
                    } else {
                        console.error('[Dual Mode] Translation failed:', translationResult.error);
                        finalText = text;
                    }
                } else {
                    console.warn('[Dual Mode] Translation disabled in config');
                    finalText = text;
                }
                break;

            default:
                finalText = text;
        }

        // Log the result
        await ipcRenderer.invoke('log-result', {
            timestamp: new Date().toISOString(),
            text: text,
            mode: config.mode,
            translation: translationResult && translationResult.success ? translationResult.translation : null
        });

        // Auto-paste if enabled
        if (config.autoUpload) {
            setTimeout(async () => {
                const success = await insertText(finalText);
                if (success) {
                    console.log('[Auto-Paste] Text auto-pasted to active window:', finalText.substring(0, 50) + '...');
                } else {
                    console.warn('[Auto-Paste] Auto-paste failed, text only copied to clipboard');
                }
            }, config.uploadDelay || 1000);
        }

        // Add to history
        addHistoryItem({
            mode: config.mode,
            text: text,
            translation: translationResult && translationResult.success ? translationResult.translation : null,
            audioPath: audioPath
        });

        // Show completion status
        const statusDot = document.getElementById('statusDot');
        const statusLabel = document.getElementById('statusLabel');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');
        const statusHint = document.getElementById('statusHint');
        statusDot.className = 'status-dot';
        statusLabel.textContent = '完成';
        statusIcon.textContent = '✅';
        statusText.textContent = '处理完成！';
        statusHint.textContent = config.autoUpload ? '正在自动粘贴...' : '处理完成';
        setProgressStep(3, 'completed');

        // 如果没有开启自动粘贴，通知主进程处理完成（让指示器消失）
        if (!config.autoUpload) {
            ipcRenderer.send('processing-complete');
        }

        // Reset after 2 seconds
        setTimeout(() => {
            statusDot.className = 'status-dot';
            statusLabel.textContent = '就绪';
            statusIcon.textContent = '🎤';
            statusText.textContent = '按 Ctrl+Shift+R 开始录音';
            statusHint.textContent = '按 Ctrl+Shift+M 切换模式';
            document.getElementById('progressSteps').style.display = 'none';
            resetProgressSteps();
        }, 2000);

    } catch (error) {
        console.error('Error handling transcription:', error);

        const statusDot = document.getElementById('statusDot');
        const statusLabel = document.getElementById('statusLabel');
        const statusIcon = document.getElementById('statusIcon');
        const statusText = document.getElementById('statusText');
        statusDot.className = 'status-dot';
        statusLabel.textContent = '错误';
        statusIcon.textContent = '❌';
        statusText.textContent = '处理失败：' + error.message;

        setTimeout(() => {
            statusDot.className = 'status-dot';
            statusLabel.textContent = '就绪';
            statusIcon.textContent = '🎤';
            statusText.textContent = '按 Ctrl+Shift+R 开始录音';
            document.getElementById('progressSteps').style.display = 'none';
            resetProgressSteps();
        }, 3000);
    }
}

// ==================== 音频播放功能 ====================

let currentAudio = null;

// 播放录音
window.playAudio = async function(audioPath) {
    try {
        console.log('[Audio Player] Playing audio:', audioPath);

        // 停止之前的播放
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }

        // 使用 Node.js fs 模块读取文件
        const fs = require('fs');
        const path = require('path');

        // 检查文件是否存在
        if (!fs.existsSync(audioPath)) {
            console.error('[Audio Player] File not found:', audioPath);
            alert('录音文件不存在：' + path.basename(audioPath));
            return;
        }

        // 读取文件内容
        const fileBuffer = fs.readFileSync(audioPath);

        // 创建 Blob
        const blob = new Blob([fileBuffer], { type: 'audio/webm' });

        // 创建 Blob URL
        const blobUrl = URL.createObjectURL(blob);

        console.log('[Audio Player] Created blob URL:', blobUrl);

        // 创建新的音频对象
        currentAudio = new Audio(blobUrl);

        // 播放音频
        await currentAudio.play();

        console.log('[Audio Player] Audio playing');

        // 播放结束后清理
        currentAudio.addEventListener('ended', () => {
            console.log('[Audio Player] Audio ended');
            URL.revokeObjectURL(blobUrl); // 释放 Blob URL
            currentAudio = null;
        });

        // 错误处理
        currentAudio.addEventListener('error', (e) => {
            console.error('[Audio Player] Error playing audio:', e);
            alert('播放录音失败，请检查文件格式');
            URL.revokeObjectURL(blobUrl); // 释放 Blob URL
            currentAudio = null;
        });

    } catch (error) {
        console.error('[Audio Player] Failed to play audio:', error);
        alert('播放录音失败：' + error.message);
    }
};
