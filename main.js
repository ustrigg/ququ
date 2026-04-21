const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, shell, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

// ==================== EPIPE 防护（必须在所有 console.log 之前） ====================
// 当 stdout/stderr 管道断开时（如父进程关闭），静默忽略而非弹窗报错
process.stdout?.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.stderr?.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.on('uncaughtException', (error) => {
  if (error.code === 'EPIPE') return;
  // 非 EPIPE 错误仍需记录（用 try-catch 防止写日志本身也 EPIPE）
  try { console.error('Uncaught Exception:', error); } catch (_) {}
});
const ExportLogger = require('./export/logger');
const TranslationService = require('./export/translator');
const FunASRManager = require('./src/funasrManager');

// ==================== 启动时清理冲突进程 ====================
// 打包版和开发版互斥：启动时杀掉对方，确保快捷键不冲突
(function killConflictingProcesses() {
  const { execSync } = require('child_process');
  const myName = path.basename(process.execPath).toLowerCase();
  if (process.platform === 'win32') {
    const targets = ['ququ voice input.exe', 'electron.exe'].filter(t => t !== myName);
    for (const target of targets) {
      try {
        execSync(`taskkill /F /IM "${target}" 2>nul`, { stdio: 'ignore', timeout: 3000 });
        console.log(`[Startup] Killed conflicting process: ${target}`);
      } catch (e) { /* 没有找到进程 */ }
    }
  } else if (process.platform === 'darwin') {
    const targets = myName.includes('electron') ? ['Ququ Voice Input'] : ['Electron'];
    for (const target of targets) {
      try {
        execSync(`pkill -f "${target}" 2>/dev/null || true`, { stdio: 'ignore', timeout: 3000 });
        console.log(`[Startup] Killed conflicting process: ${target}`);
      } catch (e) { /* 没有找到进程 */ }
    }
  }
})();

// ==================== 单实例锁 ====================
// 保证同一可执行文件只运行一个实例
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });
}

let mainWindow;
let loadingWindow;
let indicatorWindow; // 悬浮录音指示器窗口
let tray;
let isRecording = false;
let logger;
let translator;
let funasrManager;
let isQuitting = false; // Flag to track if app is quitting

// 动态托盘图标
let trayIconNormal = null;
let trayIconRecording = null;
let trayFlashInterval = null;

// Paths - will be initialized after app is ready
let USER_DATA_PATH;
let CONFIG_PATH;

// Configuration
let config = {
  mode: 'transcribe', // transcribe, translate, dual
  targetLanguage: 'zh-cn',
  autoUpload: true,
  uploadDelay: 250, // 0.25 seconds - faster paste after transcription
  webhookEnabled: false,
  webhookUrl: '',
  webhookHeaders: {},
  asrServerUrl: 'http://localhost:8001',
  hotkey: 'Ctrl+Shift+R',
  modeToggleHotkey: 'Ctrl+Shift+M',
  stopRecordingHotkey: 'Ctrl+Shift+E', // 停止录音快捷键
  cancelRecordingHotkey: 'Escape', // 取消录音快捷键（丢弃不转写）
  // 防抖参数（针对旋钮/键盘抖动）
  debounceMs: 300,              // 事件间最小间隔
  minRecordDurationMs: 600,     // 启动后多久内忽略停止请求
  minIdleDurationMs: 500,       // 停止后多久内忽略启动请求
  // Translation settings
  translationEnabled: true,
  translationServerUrl: 'http://192.168.2.2:1234',
  translationModel: 'gpt-oss-20b',
  translationStyle: 'professional', // professional, casual, academic, business, technical
  translationTimeout: 30000,
  // Text refinement settings (spoken to written language)
  textRefinementEnabled: true,
  textRefinementServerUrl: 'http://192.168.1.41:1234',
  textRefinementModel: 'Qwen3.5-35B-A3B-Q4_K_M.gguf',
  textRefinementTimeout: 30000,
  textRefinementPrompt: '',  // 自定义提示词（空则使用默认）
  textRefinementHotkey: 'F6', // 文本优化开关热键
  // ASR settings
  useVAD: false, // 关闭VAD以避免内容被切断
  vadThreshold: 0.5, // VAD阈值（如果启用VAD）
  sendWebM: false, // 是否直接发送WebM而不转换为WAV（如果FunASR支持）
  audioFormat: 'wav', // 音频格式：'wav' 或 'webm'
  sentenceTimestamp: true, // 启用句子级时间戳（可能提高准确度）
  maxSingleSegmentTime: 60000, // 最大单段时长（毫秒）
  // ASR backend selection
  asrBackend: 'paraformer', // 'paraformer' | 'qwen3' | 'auto'
  // Qwen3-ASR configuration
  qwen3Asr: {
    enabled: false,
    serverUrl: 'http://127.0.0.1:8002',
    model: 'Qwen/Qwen3-ASR-1.7B',
    timeout: 60000
  },
  // ASR fallback configuration
  asrFallback: {
    enabled: true,
    fallbackBackend: 'paraformer'
  },
  // Quick trigger hotkey (simpler shortcut, e.g. F9)
  quickTriggerHotkey: '',
  // Auto-launch settings
  autoLaunch: false,
  // Recording feedback settings
  soundFeedback: true,       // 录音开始/停止提示音
  floatingIndicator: true    // 悬浮录音指示器
};

// Load configuration
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = { ...config, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// Save configuration
function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// Set auto-launch on system startup
function setAutoLaunch(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: false,
      path: process.execPath,
      args: []
    });
    console.log('Auto-launch set to:', enabled);
    return true;
  } catch (error) {
    console.error('Failed to set auto-launch:', error);
    return false;
  }
}

// Get current auto-launch status
function getAutoLaunchStatus() {
  try {
    const settings = app.getLoginItemSettings();
    return settings.openAtLogin;
  } catch (error) {
    console.error('Failed to get auto-launch status:', error);
    return false;
  }
}

// Create loading window
function createLoadingWindow() {
  loadingWindow = new BrowserWindow({
    width: 620,
    height: 580,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    center: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loadingWindow.loadFile('loading.html');
  loadingWindow.show();

  // Debug: log window size
  console.log('Loading window created with size:', loadingWindow.getSize());
}

// Send loading progress to loading window
function updateLoadingProgress(step, progress) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('loading-progress', { step, progress });
    console.log(`Loading progress: Step ${step}, ${progress}%`);
  }
}

// Send server log to loading window
function sendServerLog(message) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('server-log', message);
  }
  console.log('[Server Log]', message);
}

// Send loading error to loading window
function sendLoadingError(step, message) {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('loading-error', { step, message });
  }
  console.error('[Loading Error]', step, ':', message);
}

// Close loading window
function closeLoadingWindow() {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('loading-complete');
    setTimeout(() => {
      loadingWindow.close();
      loadingWindow = null;

      // Show main window in bottom-right corner of cursor's display
      if (mainWindow && !mainWindow.isDestroyed()) {
        const cursorPos = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursorPos);
        const wa = display.workArea;
        const windowBounds = mainWindow.getBounds();

        const x = wa.x + wa.width - windowBounds.width - 10;
        const y = wa.y + wa.height - windowBounds.height - 10;

        mainWindow.setPosition(x, y);
        mainWindow.show();
        console.log('Main window shown at bottom-right:', { x, y }, 'display:', wa);
      }
    }, 1000); // Wait 1 second to show completion
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 780,
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    maximizable: false, // 禁用最大化，防止双击移动窗口
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('main-window.html');

  // Wait for window to finish loading before registering hotkeys
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Main window loaded, registering hotkeys...');
    console.log('Main window web contents ready');
    registerHotkeys();
  });

  // Log console messages from renderer process
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    try {
      console.log(`[Renderer Console] ${message}`);
    } catch (e) {
      // Ignore EPIPE errors when stdout pipe is broken
    }
  });

  // Prevent close, just hide (unless quitting)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

// Create settings window
let settingsWindow = null;
function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 400,
    height: 650,
    show: true,
    frame: true,
    resizable: false,
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  settingsWindow.loadFile('index.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

// 加载托盘图标：绿色（正常）和红色（录音中）
function createTrayIcons() {
  const greenPath = path.join(__dirname, 'assets', 'tray-icon-green.png');
  const redPath = path.join(__dirname, 'assets', 'tray-icon-red.png');
  trayIconNormal = nativeImage.createFromPath(greenPath);
  trayIconRecording = nativeImage.createFromPath(redPath);
  console.log('Tray icons loaded - green:', !trayIconNormal.isEmpty(), 'red:', !trayIconRecording.isEmpty());
}

function startTrayFlashing() {
  if (trayFlashInterval || !tray) return;
  let visible = true;
  trayFlashInterval = setInterval(() => {
    if (!tray) { stopTrayFlashing(); return; }
    visible = !visible;
    try {
      tray.setImage(visible ? trayIconNormal : trayIconRecording);
    } catch (e) { /* ignore */ }
  }, 500);
}

function stopTrayFlashing() {
  if (trayFlashInterval) {
    clearInterval(trayFlashInterval);
    trayFlashInterval = null;
  }
  if (tray && trayIconNormal) {
    tray.setImage(trayIconNormal);
  }
}

// 悬浮录音指示器窗口
function createIndicatorWindow() {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) return;

  // 跟随主窗口所在的显示器定位
  let targetDisplay;
  if (mainWindow && !mainWindow.isDestroyed()) {
    const bounds = mainWindow.getBounds();
    targetDisplay = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  } else {
    targetDisplay = screen.getPrimaryDisplay();
  }
  const wa = targetDisplay.workArea;
  console.log('[Indicator] Display workArea:', JSON.stringify(wa));

  indicatorWindow = new BrowserWindow({
    width: 140,
    height: 140,
    x: wa.x + wa.width - 160,
    y: wa.y + wa.height - 160,
    show: false,
    frame: false,
    transparent: true,  // 圆形需要透明背景
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  indicatorWindow.loadFile('indicator-window.html');
  indicatorWindow.setIgnoreMouseEvents(false);

  // 转发 indicator 的 console 日志到主进程，便于诊断
  indicatorWindow.webContents.on('console-message', (event, level, message) => {
    try { console.log(`[Indicator Console] ${message}`); } catch (e) {}
  });

  // 设置最高置顶级别，防止被其他 alwaysOnTop 窗口遮挡
  indicatorWindow.setAlwaysOnTop(true, 'screen-saver');

  indicatorWindow.on('closed', () => {
    indicatorWindow = null;
  });
}

// 挂起的 hide 定时器 — 新录音开始时需要取消
let indicatorHideTimer = null;

function showIndicator() {
  if (!config.floatingIndicator) return;
  // 取消任何挂起的 hide 定时器（避免刚显示又被隐藏）
  if (indicatorHideTimer) { clearTimeout(indicatorHideTimer); indicatorHideTimer = null; }
  if (!indicatorWindow || indicatorWindow.isDestroyed()) {
    createIndicatorWindow();
  }

  const doShow = () => {
    if (!indicatorWindow || indicatorWindow.isDestroyed()) return;
    // 每次显示前重新定位到鼠标所在显示器的右下角
    const cursorPos = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPos);
    const wa = display.workArea;
    indicatorWindow.setPosition(wa.x + wa.width - 160, wa.y + wa.height - 160);
    indicatorWindow.showInactive();
    indicatorWindow.setAlwaysOnTop(true, 'screen-saver');
    indicatorWindow.webContents.send('indicator-recording');
    console.log('[Indicator] Shown at', wa.x + wa.width - 160, wa.y + wa.height - 160);
  };

  if (indicatorWindow.webContents.isLoading()) {
    indicatorWindow.webContents.once('did-finish-load', doShow);
  } else {
    doShow();
  }
}

// 切换到处理中状态（橙色计时器）
function indicatorProcessing() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return;
  indicatorWindow.webContents.send('indicator-processing');
  console.log('[Indicator] Processing - timer started');
}

// 切换到完成状态（绿色勾），然后自动隐藏
function indicatorDone() {
  if (!indicatorWindow || indicatorWindow.isDestroyed()) return;
  indicatorWindow.webContents.send('indicator-done');
  console.log('[Indicator] Done');
  // 清掉上一次可能挂起的定时器
  if (indicatorHideTimer) { clearTimeout(indicatorHideTimer); }
  // 显示绿色勾 0.8 秒后隐藏
  indicatorHideTimer = setTimeout(() => {
    indicatorHideTimer = null;
    // 只有在非录音状态下才隐藏，避免新录音被错误隐藏
    if (!isRecording) {
      hideIndicator();
    } else {
      console.log('[Indicator] Hide skipped: new recording in progress');
    }
  }, 800);
}

function hideIndicator() {
  if (indicatorWindow && !indicatorWindow.isDestroyed()) {
    indicatorWindow.hide();
    console.log('[Indicator] Hidden');
  }
}

function createTray() {
  console.log('Attempting to create tray...');

  // 生成动态图标
  createTrayIcons();

  try {
    tray = new Tray(trayIconNormal);
    console.log('Tray created successfully with dynamic icon');
  } catch (error) {
    console.error('Failed to create tray icon:', error);
    console.log('Application will continue without system tray');
    tray = null; // Explicitly set to null
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Window',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          // 不要 center()，保持原有位置
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Settings',
      click: () => {
        createSettingsWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Toggle Recording',
      click: () => {
        toggleRecording();
      }
    },
    { type: 'separator' },
    {
      label: 'Exit',
      click: () => {
        quitApplication();
      }
    }
  ]);

  tray.setToolTip('Ququ Voice Input');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    recordingTriggerSource = 'hotkey';
    toggleRecording();
  });
}

let isTogglingRecording = false;
let lastRecordingToggle = 0;
let recordingStartTime = 0;
let recordingStopTime = 0; // 上次停止录音的时间
let recordingTriggerSource = 'hotkey'; // 'hotkey' | 'click' - 录音触发来源

// 防抖参数 — 针对旋钮/键盘抖动
// 可通过 config.debounceMs / config.minRecordDurationMs / config.minIdleDurationMs 覆盖
function getDebounceMs() { return (config && config.debounceMs) || 300; }
function getMinRecordDurationMs() { return (config && config.minRecordDurationMs) || 600; }
function getMinIdleDurationMs() { return (config && config.minIdleDurationMs) || 500; }

function toggleRecording() {
  const now = Date.now();
  console.log('========================================');
  console.log('toggleRecording TRIGGERED at:', now, '| state:', isRecording ? 'RECORDING' : 'IDLE');
  console.log('Since last toggle:', now - lastRecordingToggle, 'ms');
  console.log('========================================');

  // ===== 第1层：全局抖动窗口（事件间最小间隔）=====
  if (now - lastRecordingToggle < getDebounceMs()) {
    console.log(`>>> [Debounce-1] 事件抖动! 忽略 (距上次 ${now - lastRecordingToggle}ms < ${getDebounceMs()}ms)`);
    return;
  }

  // ===== 第2层：最小录音时长保护（避免刚启动就被抖动关闭）=====
  if (isRecording && recordingStartTime > 0) {
    const recordedMs = now - recordingStartTime;
    if (recordedMs < getMinRecordDurationMs()) {
      console.log(`>>> [Debounce-2] 最小录音时长保护! 录音才 ${recordedMs}ms < ${getMinRecordDurationMs()}ms，忽略停止请求`);
      return;
    }
  }

  // ===== 第3层：最小空闲时长保护（避免刚停止就被抖动启动）=====
  if (!isRecording && recordingStopTime > 0) {
    const idleMs = now - recordingStopTime;
    if (idleMs < getMinIdleDurationMs()) {
      console.log(`>>> [Debounce-3] 最小空闲时长保护! 空闲才 ${idleMs}ms < ${getMinIdleDurationMs()}ms，忽略启动请求`);
      return;
    }
  }

  lastRecordingToggle = now;
  console.log('>>> ACCEPTED toggle, switching state from', isRecording, 'to', !isRecording);
  isRecording = !isRecording;

  if (isRecording) {
    recordingStartTime = now;
    registerCancelHotkey(); // 录音开始，注册 Escape
    console.log('>>> Recording STARTED at:', recordingStartTime);
  } else {
    recordingStopTime = now;
    unregisterCancelHotkey(); // 录音停止，取消 Escape
    console.log('>>> Recording STOPPED after:', now - recordingStartTime, 'ms');
  }

  // Send IPC message to renderer process - with safety check
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    console.log('Sending recording-state-changed to renderer:', isRecording);
    mainWindow.webContents.send('recording-state-changed', isRecording);
    // 发送音频提示音事件
    if (config.soundFeedback) {
      mainWindow.webContents.send('play-recording-sound', isRecording ? 'start' : 'stop');
    }
  } else {
    console.error('Cannot send IPC: mainWindow is not ready or destroyed');
  }

  // 更新托盘图标和tooltip
  if (tray) {
    if (isRecording) {
      console.log('>>> [Tray] Starting flash + showing indicator');
      tray.setToolTip('Ququ Voice Input - Recording');
      startTrayFlashing();
      showIndicator();
    } else {
      console.log('>>> [Tray] Stopping flash + indicator → processing');
      tray.setToolTip('Ququ Voice Input - Processing');
      stopTrayFlashing();
      // 不隐藏指示器，切换到计时器状态
      indicatorProcessing();
    }
  } else {
    console.log('Tray is null/undefined, skipping');
  }
}

// 动态注册/取消 Escape 热键（仅录音期间生效，避免全局拦截）
function registerCancelHotkey() {
  const cancelHotkey = config.cancelRecordingHotkey || 'Escape';
  if (!cancelHotkey) return;
  try {
    globalShortcut.register(cancelHotkey, () => {
      console.log('Cancel recording hotkey PRESSED:', cancelHotkey, 'at', Date.now());
      cancelRecording();
    });
    console.log('[CancelHotkey] Registered:', cancelHotkey);
  } catch (e) { /* ignore */ }
}

function unregisterCancelHotkey() {
  const cancelHotkey = config.cancelRecordingHotkey || 'Escape';
  if (!cancelHotkey) return;
  try {
    globalShortcut.unregister(cancelHotkey);
    console.log('[CancelHotkey] Unregistered:', cancelHotkey);
  } catch (e) { /* ignore */ }
}

let isTogglingMode = false;
let lastModeToggle = 0;

// Register hotkeys function - called after window is loaded
function registerHotkeys() {
  console.log('Registering hotkeys...');

  try {
    // Register global hotkey for recording with debounce
    const recordHotkey = config.hotkey || 'Ctrl+Shift+R';

    // First unregister in case it's already registered
    globalShortcut.unregister(recordHotkey);

    const success1 = globalShortcut.register(recordHotkey, () => {
      console.log('Record hotkey PRESSED:', recordHotkey, 'at', Date.now());
      recordingTriggerSource = 'hotkey';
      toggleRecording();
    });
    console.log('Record hotkey registered:', recordHotkey, 'success:', success1);
    if (!success1) {
      console.error('WARNING: Failed to register record hotkey! May be occupied by another app.');
    }
  } catch (error) {
    console.error('Error registering record hotkey:', error);
  }

  try {
    // Register mode toggle hotkey with debounce
    const modeHotkey = config.modeToggleHotkey || 'Ctrl+Shift+M';

    // First unregister in case it's already registered
    globalShortcut.unregister(modeHotkey);

    const success2 = globalShortcut.register(modeHotkey, () => {
      console.log('Mode toggle hotkey PRESSED:', modeHotkey, 'at', Date.now());
      toggleMode();
    });
    console.log('Mode toggle hotkey registered:', modeHotkey, 'success:', success2);
    if (!success2) {
      console.error('WARNING: Failed to register mode toggle hotkey! May be occupied by another app.');
    }
  } catch (error) {
    console.error('Error registering mode toggle hotkey:', error);
  }

  try {
    // Register stop recording hotkey
    const stopHotkey = config.stopRecordingHotkey || 'Ctrl+Shift+E';

    // First unregister in case it's already registered
    globalShortcut.unregister(stopHotkey);

    const success3 = globalShortcut.register(stopHotkey, () => {
      console.log('Stop recording hotkey PRESSED:', stopHotkey, 'at', Date.now());
      stopRecording();
    });
    console.log('Stop recording hotkey registered:', stopHotkey, 'success:', success3);
    if (!success3) {
      console.error('WARNING: Failed to register stop recording hotkey! May be occupied by another app.');
    }
  } catch (error) {
    console.error('Error registering stop recording hotkey:', error);
  }

  // Register quick trigger hotkey (e.g. F9)
  try {
    const quickHotkey = config.quickTriggerHotkey;
    if (quickHotkey) {
      globalShortcut.unregister(quickHotkey);
      const success4 = globalShortcut.register(quickHotkey, () => {
        console.log('Quick trigger hotkey PRESSED:', quickHotkey, 'at', Date.now());
        toggleRecording();
      });
      console.log('Quick trigger hotkey registered:', quickHotkey, 'success:', success4);
      if (!success4) {
        console.error('WARNING: Failed to register quick trigger hotkey! May be occupied by another app.');
      }
    }
  } catch (error) {
    console.error('Error registering quick trigger hotkey:', error);
  }

  // Register text refinement toggle hotkey
  try {
    const refinementHotkey = config.textRefinementHotkey || 'F6';
    if (refinementHotkey) {
      globalShortcut.unregister(refinementHotkey);
      const success5 = globalShortcut.register(refinementHotkey, () => {
        console.log('Text refinement hotkey PRESSED:', refinementHotkey, 'at', Date.now());
        toggleTextRefinement();
      });
      console.log('Text refinement hotkey registered:', refinementHotkey, 'success:', success5);
      if (!success5) {
        console.error('WARNING: Failed to register text refinement hotkey! May be occupied by another app.');
      }
    }
  } catch (error) {
    console.error('Error registering text refinement hotkey:', error);
  }

  // Register cancel recording hotkey — 仅在录音状态下生效，避免全局拦截 Escape
  // 改为：不在启动时注册，而是录音开始时注册，录音结束时取消
  console.log('Cancel recording hotkey (Escape) will be registered dynamically during recording');

  console.log('Hotkey registration completed');

  // Notify loading window that hotkeys are registered
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.webContents.send('hotkeys-registered');
  }
}

function toggleTextRefinement() {
  config.textRefinementEnabled = !config.textRefinementEnabled;
  console.log('Text refinement toggled:', config.textRefinementEnabled ? 'ON' : 'OFF');

  // 保存配置
  saveConfig();

  // 通知渲染进程更新 UI
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('text-refinement-toggled', config.textRefinementEnabled);
  }
}

function toggleMode() {
  const now = Date.now();

  // Debounce - ignore if called within 300ms (0.3 seconds)
  // This prevents key repeat/auto-repeat from triggering multiple toggles
  if (isTogglingMode || (now - lastModeToggle) < 300) {
    console.log('toggleMode: debounced, ignoring... (time since last:', now - lastModeToggle, 'ms)');
    return;
  }

  isTogglingMode = true;
  lastModeToggle = now;

  setTimeout(() => {
    isTogglingMode = false;
  }, 300); // 300ms (0.3 seconds) debounce

  console.log('toggleMode called, current mode:', config.mode);

  // Cycle through modes: transcribe -> translate -> dual -> transcribe
  if (config.mode === 'transcribe') {
    config.mode = 'translate';
  } else if (config.mode === 'translate') {
    config.mode = 'dual';
  } else {
    config.mode = 'transcribe';
  }

  // Save configuration
  saveConfig();

  // Notify renderer process - with safety check
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    console.log('Sending mode-changed to renderer:', config.mode);
    mainWindow.webContents.send('mode-changed', config.mode);
  } else {
    console.error('Cannot send IPC: mainWindow is not ready or destroyed');
  }

  console.log('Mode changed to:', config.mode);
}

// 专门用于停止录音的函数（不切换状态）
function stopRecording() {
  const now = Date.now();
  console.log('========================================');
  console.log('stopRecording TRIGGERED at:', now);
  console.log('========================================');

  // 只在录音状态时才停止
  if (!isRecording) {
    console.log('>>> Not recording, ignoring stop request');
    return;
  }

  // 事件抖动窗口
  if (now - lastRecordingToggle < getDebounceMs()) {
    console.log(`>>> [Debounce-1] stop 请求抖动，忽略 (距上次 ${now - lastRecordingToggle}ms)`);
    return;
  }

  // 最小录音时长保护
  if (recordingStartTime > 0) {
    const recordedMs = now - recordingStartTime;
    if (recordedMs < getMinRecordDurationMs()) {
      console.log(`>>> [Debounce-2] 录音才 ${recordedMs}ms，忽略 stop 请求`);
      return;
    }
  }

  lastRecordingToggle = now;
  recordingStopTime = now;

  console.log('>>> STOPPING recording');
  isRecording = false;
  unregisterCancelHotkey();

  // 发送停止录音的 IPC 消息
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    console.log('Sending recording-state-changed to renderer: false');
    mainWindow.webContents.send('recording-state-changed', false);
    // 发送音频提示音事件
    if (config.soundFeedback) {
      mainWindow.webContents.send('play-recording-sound', 'stop');
    }
  } else {
    console.error('Cannot send IPC: mainWindow is not ready or destroyed');
  }

  if (tray) {
    tray.setToolTip('Ququ Voice Input - Stopped');
  }

  // 停止托盘闪烁，指示器切换到计时器
  stopTrayFlashing();
  indicatorProcessing();

  console.log('>>> Recording stopped at:', now);
}

// 取消录音：停止录音并丢弃音频，不进入转写流程
function cancelRecording() {
  const now = Date.now();
  console.log('========================================');
  console.log('cancelRecording TRIGGERED at:', now);
  console.log('Current recording state:', isRecording);
  console.log('========================================');

  if (!isRecording) {
    console.log('>>> Not recording, ignoring cancel request');
    return;
  }

  // 事件抖动窗口（cancel 不做最小录音时长限制，用户主动取消应立即响应）
  if (now - lastRecordingToggle < getDebounceMs()) {
    console.log(`>>> [Debounce-1] cancel 请求抖动，忽略 (距上次 ${now - lastRecordingToggle}ms)`);
    return;
  }

  lastRecordingToggle = now;
  recordingStopTime = now;

  console.log('>>> CANCELLING recording (discard audio)');
  isRecording = false;
  unregisterCancelHotkey();

  // 发送取消录音的 IPC 消息（renderer 将丢弃音频而非转写）
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    console.log('Sending recording-cancelled to renderer');
    mainWindow.webContents.send('recording-cancelled');
    if (config.soundFeedback) {
      mainWindow.webContents.send('play-recording-sound', 'cancel');
    }
  }

  if (tray) {
    tray.setToolTip('Ququ Voice Input - Cancelled');
  }

  stopTrayFlashing();
  hideIndicator();

  console.log('>>> Recording cancelled at:', now);
}

app.whenReady().then(async () => {
  try {
    // Initialize paths for userData directory
    USER_DATA_PATH = app.getPath('userData');
    CONFIG_PATH = path.join(USER_DATA_PATH, 'config.json');
    console.log('User data path:', USER_DATA_PATH);

    // Step 1: Show loading window
    createLoadingWindow();
    await sleep(300); // Wait for loading window to show
    updateLoadingProgress(1, 10);

    // Step 2: Load configuration
    await sleep(200);
    try {
      loadConfig();
      // Sync auto-launch status with system
      const actualAutoLaunchStatus = getAutoLaunchStatus();
      if (config.autoLaunch !== actualAutoLaunchStatus) {
        console.log('Syncing auto-launch status: config =', config.autoLaunch, ', actual =', actualAutoLaunchStatus);
        config.autoLaunch = actualAutoLaunchStatus;
        saveConfig();
      }
      updateLoadingProgress(2, 30);
    } catch (error) {
      console.error('Failed to load config:', error);
      sendLoadingError('加载配置', '配置文件加载失败：' + error.message);
      // Continue anyway with default config
      updateLoadingProgress(2, 30);
    }

    // Step 3: Initialize FunASR Server
    await sleep(200);
    sendServerLog('正在检查FunASR服务器状态...');
    funasrManager = new FunASRManager({
      serverUrl: config.asrServerUrl,
      onLog: (message) => sendServerLog(message),
      onReady: () => sendServerLog('✓ FunASR服务器就绪！'),
      onError: (error) => sendServerLog(`✗ 错误: ${error}`)
    });

    try {
      await funasrManager.ensureServerRunning();
      updateLoadingProgress(3, 60);
      sendServerLog('✓ FunASR服务器启动成功');
    } catch (error) {
      console.error('FunASR server failed:', error);
      sendServerLog(`启动FunASR服务器失败: ${error.message}`);
      sendServerLog('⚠️ 警告：应用将继续启动，但语音识别功能可能不可用');
      sendLoadingError('FunASR服务器', 'FunASR启动失败，语音识别功能不可用');
      // Continue loading even if FunASR fails
      updateLoadingProgress(3, 60);
    }

    // Step 4: Create windows and tray
    await sleep(200);
    try {
      createWindow();
      createTray();
      updateLoadingProgress(4, 80);
    } catch (error) {
      console.error('Failed to create window/tray:', error);
      sendLoadingError('创建窗口', '窗口创建失败：' + error.message);
      throw error; // This is critical, can't continue
    }

    // Step 5: Initialize other services
    await sleep(300);
    try {
      logger = new ExportLogger(USER_DATA_PATH);
      translator = new TranslationService({
        serverUrl: config.translationServerUrl,
        model: config.translationModel,
        timeout: config.translationTimeout,
        translationStyle: config.translationStyle
      });
      updateLoadingProgress(5, 95);
    } catch (error) {
      console.error('Failed to initialize services:', error);
      sendServerLog('⚠️ 警告：部分服务初始化失败');
      // Continue anyway
      updateLoadingProgress(5, 95);
    }

    // Step 6: Finalize loading - close loading window after a brief delay
    await sleep(500);
    updateLoadingProgress(5, 100);

    // Close loading window after showing completion
    setTimeout(() => {
      closeLoadingWindow();
    }, 1000); // Give user time to see "准备就绪" message

  } catch (error) {
    console.error('Critical error during startup:', error);
    sendLoadingError('应用启动', '应用启动失败：' + error.message);
    // Don't close loading window so user can see the error
  }

  // Start webhook retry timer
  setInterval(() => {
    if (logger) {
      logger.retryPendingWebhooks();
    }
  }, 60000); // Retry every minute

  // Cleanup old pending webhooks daily
  setInterval(() => {
    if (logger) {
      logger.cleanupPendingWebhooks();
    }
  }, 24 * 60 * 60 * 1000); // Daily cleanup

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Helper function for delays
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Graceful application quit
function quitApplication() {
  console.log('Quitting application...');
  isQuitting = true;

  try {
    // Unregister all global shortcuts
    globalShortcut.unregisterAll();

    // Note: Keep FunASR Docker container running for faster next startup
    // Users can manually stop it if needed via Docker Desktop
    console.log('Keeping FunASR server running for faster next startup');

    // 清理托盘闪烁定时器
    stopTrayFlashing();

    // Close all windows
    if (indicatorWindow && !indicatorWindow.isDestroyed()) {
      indicatorWindow.destroy();
    }
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.destroy();
    }
    if (loadingWindow && !loadingWindow.isDestroyed()) {
      loadingWindow.destroy();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }

    // Destroy tray icon
    if (tray) {
      tray.destroy();
    }

    console.log('Application cleanup completed');
  } catch (error) {
    console.error('Error during cleanup:', error);
  }

  // Quit the app
  app.quit();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (!isQuitting) {
      quitApplication();
    }
  }
});

app.on('will-quit', () => {
  // Final cleanup - this is called after app.quit()
  globalShortcut.unregisterAll();

  // Note: Keep FunASR Docker container running for faster next startup
  console.log('FunASR Docker container will continue running');
});

// IPC handlers
ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('save-config', (event, newConfig) => {
  const oldRecordHotkey = config.hotkey;
  const oldModeHotkey = config.modeToggleHotkey;
  const oldStopHotkey = config.stopRecordingHotkey;
  const oldQuickTriggerHotkey = config.quickTriggerHotkey;
  const oldTextRefinementHotkey = config.textRefinementHotkey;
  const oldCancelRecordingHotkey = config.cancelRecordingHotkey;
  const oldAutoLaunch = config.autoLaunch;

  config = { ...config, ...newConfig };
  saveConfig();

  // Re-register recording hotkey if changed
  if (newConfig.hotkey && newConfig.hotkey !== oldRecordHotkey) {
    console.log('Updating recording hotkey from', oldRecordHotkey, 'to', newConfig.hotkey);
    globalShortcut.unregister(oldRecordHotkey);
    const success = globalShortcut.register(newConfig.hotkey, () => {
      console.log('Record hotkey PRESSED:', newConfig.hotkey, 'at', Date.now());
      recordingTriggerSource = 'hotkey';
      toggleRecording();
    });
    console.log('Recording hotkey re-registered:', newConfig.hotkey, 'success:', success);
  }

  // Re-register mode toggle hotkey if changed
  if (newConfig.modeToggleHotkey && newConfig.modeToggleHotkey !== oldModeHotkey) {
    console.log('Updating mode toggle hotkey from', oldModeHotkey, 'to', newConfig.modeToggleHotkey);
    globalShortcut.unregister(oldModeHotkey);
    const success = globalShortcut.register(newConfig.modeToggleHotkey, () => {
      console.log('Mode toggle hotkey PRESSED:', newConfig.modeToggleHotkey, 'at', Date.now());
      toggleMode();
    });
    console.log('Mode toggle hotkey re-registered:', newConfig.modeToggleHotkey, 'success:', success);
  }

  // Re-register stop recording hotkey if changed
  if (newConfig.stopRecordingHotkey && newConfig.stopRecordingHotkey !== oldStopHotkey) {
    console.log('Updating stop recording hotkey from', oldStopHotkey, 'to', newConfig.stopRecordingHotkey);
    globalShortcut.unregister(oldStopHotkey);
    const success = globalShortcut.register(newConfig.stopRecordingHotkey, () => {
      console.log('Stop recording hotkey PRESSED:', newConfig.stopRecordingHotkey, 'at', Date.now());
      stopRecording();
    });
    console.log('Stop recording hotkey re-registered:', newConfig.stopRecordingHotkey, 'success:', success);
  }

  // Re-register quick trigger hotkey if changed
  if (newConfig.hasOwnProperty('quickTriggerHotkey') && newConfig.quickTriggerHotkey !== oldQuickTriggerHotkey) {
    console.log('Updating quick trigger hotkey from', oldQuickTriggerHotkey, 'to', newConfig.quickTriggerHotkey);
    if (oldQuickTriggerHotkey) {
      try { globalShortcut.unregister(oldQuickTriggerHotkey); } catch (e) { /* ignore */ }
    }
    if (newConfig.quickTriggerHotkey) {
      const success = globalShortcut.register(newConfig.quickTriggerHotkey, () => {
        console.log('Quick trigger hotkey PRESSED:', newConfig.quickTriggerHotkey, 'at', Date.now());
        recordingTriggerSource = 'hotkey';
        toggleRecording();
      });
      console.log('Quick trigger hotkey re-registered:', newConfig.quickTriggerHotkey, 'success:', success);
    }
  }

  // Re-register text refinement hotkey if changed
  if (newConfig.hasOwnProperty('textRefinementHotkey') && newConfig.textRefinementHotkey !== oldTextRefinementHotkey) {
    console.log('Updating text refinement hotkey from', oldTextRefinementHotkey, 'to', newConfig.textRefinementHotkey);
    if (oldTextRefinementHotkey) {
      try { globalShortcut.unregister(oldTextRefinementHotkey); } catch (e) { /* ignore */ }
    }
    if (newConfig.textRefinementHotkey) {
      const success = globalShortcut.register(newConfig.textRefinementHotkey, () => {
        console.log('Text refinement hotkey PRESSED:', newConfig.textRefinementHotkey, 'at', Date.now());
        toggleTextRefinement();
      });
      console.log('Text refinement hotkey re-registered:', newConfig.textRefinementHotkey, 'success:', success);
    }
  }

  // Cancel recording hotkey 配置更新（动态注册，仅录音期间生效）
  if (newConfig.hasOwnProperty('cancelRecordingHotkey') && newConfig.cancelRecordingHotkey !== oldCancelRecordingHotkey) {
    console.log('Cancel recording hotkey updated to:', newConfig.cancelRecordingHotkey);
    // 如果正在录音，重新注册新热键
    if (isRecording) {
      if (oldCancelRecordingHotkey) {
        try { globalShortcut.unregister(oldCancelRecordingHotkey); } catch (e) { /* ignore */ }
      }
      registerCancelHotkey();
    }
  }

  // Update long press Ctrl detector if config changed
  // Update auto-launch if changed
  if (newConfig.hasOwnProperty('autoLaunch') && newConfig.autoLaunch !== oldAutoLaunch) {
    console.log('Updating auto-launch from', oldAutoLaunch, 'to', newConfig.autoLaunch);
    setAutoLaunch(newConfig.autoLaunch);
  }

  // IMPORTANT: Always reset debounce state when saving config, regardless of whether hotkeys changed
  // This ensures hotkeys work immediately after saving settings
  console.log('Resetting all debounce states after config save');
  isTogglingRecording = false;
  lastRecordingToggle = 0;
  isTogglingMode = false;
  lastModeToggle = 0;

  return config;
});

ipcMain.handle('start-recording', () => {
  isRecording = true;
  return true;
});

ipcMain.handle('stop-recording', () => {
  isRecording = false;
  return true;
});

ipcMain.handle('get-recording-state', () => {
  return isRecording;
});

// Save recording file
ipcMain.handle('save-recording', async (event, { data, timestamp, encoding }) => {
  try {
    const recordingsDir = path.join(USER_DATA_PATH, 'recordings');

    if (!fs.existsSync(recordingsDir)) {
      fs.mkdirSync(recordingsDir, { recursive: true });
    }

    const filename = `recording-${timestamp}.webm`;
    const filePath = path.join(recordingsDir, filename);

    // 支持 base64 编码传输（避免 IPC 传输大数组的性能问题）
    const buffer = encoding === 'base64' ? Buffer.from(data, 'base64') : Buffer.from(data);
    fs.writeFileSync(filePath, buffer);

    console.log('[Recording] Saved recording to:', filePath);

    // Return the file path for playback
    return filePath;
  } catch (error) {
    console.error('[Recording] Failed to save recording:', error);
    throw error;
  }
});

ipcMain.handle('log-result', async (event, logEntry) => {
  try {
    if (logger) {
      await logger.logResult(logEntry);

      // Send webhook if enabled
      if (config.webhookEnabled) {
        await logger.sendWebhook(config, logEntry);
      }
    }
    return true;
  } catch (error) {
    console.error('Failed to log result:', error);
    return false;
  }
});

ipcMain.handle('get-stats', async () => {
  try {
    if (logger) {
      return await logger.getStats();
    }
    return { totalLogs: 0, pendingWebhooks: 0, todayLogs: 0 };
  } catch (error) {
    console.error('Failed to get stats:', error);
    return { totalLogs: 0, pendingWebhooks: 0, todayLogs: 0 };
  }
});

// Translation IPC handlers
ipcMain.handle('translate-text', async (event, text, style) => {
  try {
    if (translator) {
      const result = await translator.translate(text, style);
      return result;
    }
    return { success: false, error: 'Translator not initialized' };
  } catch (error) {
    console.error('Translation failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('test-translation-server', async () => {
  try {
    if (translator) {
      return await translator.testConnection();
    }
    return { success: false, error: 'Translator not initialized' };
  } catch (error) {
    console.error('Translation server test failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update-translator-config', async (event, newConfig) => {
  try {
    if (translator) {
      translator.updateConfig(newConfig);
      return { success: true };
    }
    return { success: false, error: 'Translator not initialized' };
  } catch (error) {
    console.error('Failed to update translator config:', error);
    return { success: false, error: error.message };
  }
});

// Text refinement IPC handler (spoken to written language)
ipcMain.handle('refine-text', async (event, text) => {
  try {
    console.log('[Text Refinement] Starting refinement for text length:', text.length);

    if (!config.textRefinementEnabled) {
      console.log('[Text Refinement] Feature disabled');
      return { success: false, error: 'Text refinement disabled' };
    }

    const serverUrl = config.textRefinementServerUrl || config.translationServerUrl;
    const model = config.textRefinementModel || config.translationModel || 'Qwen3.5-35B-A3B-Q4_K_M.gguf';
    const timeout = config.textRefinementTimeout || 30000;

    // 默认提示词模板
    const defaultPromptTemplate = `你是一位语言整理助手。你的唯一任务是清理语音转写中的口语噪音，让文本干净可读，同时保留说话人的原始意思。

必须删除的内容（务必彻底清除）：
- 所有填充词和口头禅：嗯、啊、呃、额、哦、唔、噢、嘿、哎、喂
- 所有无意义的连接词：那个、就是、就是说、然后呢、然后就是、对吧、你知道吧、怎么说呢、反正就是、所以说、其实就是
- 所有犹豫和拖延词：这个这个、那个那个、怎么说、我觉得就是、应该是吧
- 所有口吃和重复：连续重复的字词（如"我我我想"→"我想"、"就是就是"→删除）
- 句首多余的语气开头：嗯所以、啊对、哦那、嗯嗯、对对对
- 无意义的句尾赘词：啊、吧、呢、嘛、了啊、是吧、对吧、你说呢

保留不动的内容：
- 说话人的原始句子结构和措辞（清理噪音后保留原话）
- 所有实际内容、观点、数字、日期、时间
- 专有名词、技术术语、英文词汇
- 语义段落的原始划分

禁止：改写句意、添加解释、合并段落、转换为书面语风格

输出：只输出清理后的文本`;

    // 使用自定义提示词或默认提示词
    const promptTemplate = (config.textRefinementPrompt && config.textRefinementPrompt.trim())
      ? config.textRefinementPrompt.trim()
      : defaultPromptTemplate;

    const prompt = `${promptTemplate}

原文：
${text}

优化后：`;

    console.log('[Text Refinement] Calling LLM API:', serverUrl);

    const response = await fetch(`${serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 2000
      }),
      signal: AbortSignal.timeout(timeout)
    });

    if (!response.ok) {
      throw new Error(`LLM API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const refinedText = data.choices[0].message.content.trim();

    console.log('[Text Refinement] Success. Original length:', text.length, 'Refined length:', refinedText.length);

    return {
      success: true,
      refinedText: refinedText,
      originalText: text
    };

  } catch (error) {
    console.error('[Text Refinement] Failed:', error.message);
    return {
      success: false,
      error: error.message,
      originalText: text
    };
  }
});

// New IPC handlers for main window
ipcMain.on('open-settings', () => {
  createSettingsWindow();
});

ipcMain.on('quit-app', () => {
  quitApplication();
});

ipcMain.on('minimize-window', () => {
  if (mainWindow) {
    // 隐藏到托盘而不是最小化，保持窗口位置
    mainWindow.hide();
  }
});

ipcMain.on('hide-window', () => {
  if (mainWindow) {
    mainWindow.hide();
  }
});

// Loading window controls
ipcMain.on('minimize-loading-window', () => {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.minimize();
  }
});

ipcMain.on('close-loading-window', () => {
  if (loadingWindow && !loadingWindow.isDestroyed()) {
    loadingWindow.close();
    loadingWindow = null;
  }
});

// Function to send processing status to main window
function sendProcessingStatus(type, message = '') {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('processing-status', { type, message });
  }
}

// Function to send transcription result to main window
function sendTranscriptionResult(data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
    mainWindow.webContents.send('transcription-result', data);
  }
}

// Export functions for use in renderer
global.sendProcessingStatus = sendProcessingStatus;
global.sendTranscriptionResult = sendTranscriptionResult;

// IPC forwarder: settings window -> main window
ipcMain.on('update-processing-status', (event, data) => {
  sendProcessingStatus(data.type, data.message);
});

ipcMain.on('send-transcription-result', (event, data) => {
  sendTranscriptionResult(data);
});

// Handle force stop recording request from renderer
ipcMain.on('force-stop-recording', () => {
  console.log('[Main] Force stop recording requested');
  if (isRecording) {
    isRecording = false;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('recording-state-changed', false);
    }
    stopTrayFlashing();
    indicatorProcessing();
  }
});

// Handle stop recording request from renderer (ESC key or other)
ipcMain.on('request-stop-recording', () => {
  console.log('[Main] Stop recording requested from renderer');
  stopRecording();
});

// Handle toggle recording request from renderer (record button click)
ipcMain.on('toggle-recording', () => {
  console.log('[Main] Toggle recording requested from renderer (button click)');
  recordingTriggerSource = 'click';
  toggleRecording();
});

// 处理完成（非自动粘贴模式）→ 指示器显示完成
ipcMain.on('processing-complete', () => {
  console.log('[Main] Processing complete');
  indicatorDone();
});

// 悬浮指示器点击 → 停止录音
ipcMain.on('indicator-clicked', () => {
  console.log('[Main] Indicator clicked, stopping recording');
  if (isRecording) {
    stopRecording();
  }
});

// 中转频谱数据：renderer → indicator window
let _waveformDataCount = 0;
let _waveformLastLog = 0;
ipcMain.on('waveform-data', (event, data) => {
  _waveformDataCount++;
  const now = Date.now();
  // 每 1 秒打印一次统计（数据量 + 峰值）
  if (now - _waveformLastLog >= 1000) {
    let max = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > max) max = data[i];
    console.log(`[Waveform IPC] ${_waveformDataCount} frames/s, max amp: ${max}/255, indicator visible: ${indicatorWindow && !indicatorWindow.isDestroyed() && indicatorWindow.isVisible()}`);
    _waveformDataCount = 0;
    _waveformLastLog = now;
  }
  if (indicatorWindow && !indicatorWindow.isDestroyed() && indicatorWindow.webContents) {
    indicatorWindow.webContents.send('indicator-waveform-data', data);
  }
});

// Handle auto-paste text at cursor
ipcMain.handle('auto-paste-text', async (event, text) => {
  return new Promise(async (resolve, reject) => {
    console.log('[Auto-Paste] Attempting to paste text:', text.substring(0, 50) + '...');
    const shouldRestoreWindow = recordingTriggerSource === 'click';

    // 隐藏窗口让焦点回到目标应用
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      await new Promise(r => setTimeout(r, 200));
    }

    let cmd;
    if (process.platform === 'darwin') {
      // macOS: 用 pbcopy 写剪贴板 + osascript 模拟 Cmd+V
      const escaped = text.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
      cmd = `echo '${escaped}' | pbcopy && osascript -e 'delay 0.15' -e 'tell application "System Events" to keystroke "v" using command down'`;
    } else {
      // Windows: PowerShell + SendKeys
      const base64Text = Buffer.from(text, 'utf-8').toString('base64');
      const psCommand = `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64Text}')); Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($text); Start-Sleep -Milliseconds 200; [System.Windows.Forms.SendKeys]::SendWait('^v')`;
      cmd = `powershell.exe -NoProfile -Command "${psCommand}"`;
    }

    exec(cmd, { timeout: 5000 }, (error) => {
      if (error) {
        console.error('[Auto-Paste] Error:', error.message);
        hideIndicator();
        if (shouldRestoreWindow && mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
        reject(error);
      } else {
        console.log('[Auto-Paste] Text pasted successfully');
        indicatorDone();
        if (shouldRestoreWindow && mainWindow && !mainWindow.isDestroyed()) {
          setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show(); }, 300);
        }
        resolve(true);
      }
    });
  });
});