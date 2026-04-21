# 调试指南

## 当前问题：一直显示"正在识别语音"

### 可能的原因

1. **Settings窗口被隐藏** - MediaRecorder可能停止工作
2. **ASR请求失败但没有错误处理**
3. **状态窗口收到进度但主窗口没有处理**

### 立即诊断步骤

#### 1. 打开开发者工具

**方式A**: 修改 main.js 让窗口始终显示
```javascript
// 临时注释掉自动隐藏
// mainWindow.on('blur', () => {
//   if (!mainWindow.webContents.isDevToolsOpened()) {
//     mainWindow.hide();
//   }
// });
```

**方式B**: 启动时立即按 F12
```bash
npm start
# 快速按 F12 打开开发者工具
# 这样窗口就不会自动隐藏
```

#### 2. 查看Console日志

应该看到的正常流程：
```
Starting recording...
Using microphone: [麦克风名称]
Recording started
[按停止]
Recording stopped, chunks collected: X
Processing audio...
Audio chunks: X
Total size: XXXX bytes
Converting to WAV format...
WAV blob size: XXXX
ASR result: {...}
```

#### 3. 检查是否卡在某一步

**如果卡在 "Processing audio..."**:
- 音频转换问题
- 检查是否有audioChunks

**如果卡在 "Converting to WAV..."**:
- 音频解码失败
- 可能是格式不支持

**如果卡在ASR请求后**:
- ASR服务器无响应
- 检查网络请求

**如果根本没有 "Processing audio..." 日志**:
- `mediaRecorder.onstop` 没有触发
- 可能是窗口隐藏导致

---

## 快速修复方案

### 方案1: 禁用窗口自动隐藏（调试用）

编辑 `main.js:132-136`，注释掉：

```javascript
// Hide window when it loses focus
// mainWindow.on('blur', () => {
//   if (!mainWindow.webContents.isDevToolsOpened()) {
//     mainWindow.hide();
//   }
// });
```

重启应用后，窗口会一直显示，方便查看日志。

### 方案2: 使用状态窗口的日志

状态窗口应该显示处理进度：
1. 转换音频格式 (10%)
2. 上传到服务器 (40%)
3. 正在识别语音 (60%) ← **卡在这里？**
4. 正在翻译 (80%)
5. 完成 (100%)

如果卡在60%，说明ASR请求有问题。

### 方案3: 手动测试ASR端点

创建一个测试音频文件并发送到ASR服务器：

```bash
# 录制5秒测试音频 (需要ffmpeg)
ffmpeg -f dshow -i audio="麦克风" -t 5 -ar 16000 -ac 1 test.wav

# 测试ASR端点
curl -X POST "http://localhost:8001/asr" \
     -F "file=@test.wav" \
     -H "accept: application/json"
```

应该返回：
```json
{
  "text": "识别的文字..."
}
```

---

## 根本解决方案

### 问题：录音逻辑不应该在Settings窗口中

当前架构问题：
- 录音逻辑在 `renderer.js` (Settings窗口)
- Settings窗口失去焦点会隐藏
- 隐藏后MediaRecorder可能不工作

### 建议的架构改进

**选项A**: 将录音逻辑移到主进程
- 在 `main.js` 中处理录音
- 使用 `node-record-lpcm16` 等库

**选项B**: 使用独立的录音窗口
- 创建一个隐藏的录音专用窗口
- 永不关闭，只是隐藏

**选项C**: 修改Settings窗口行为
- 录音时不自动隐藏
- 或使用 `alwaysOnTop` 保持可见

---

## 临时解决方案（测试用）

### 步骤1: 让窗口保持可见

编辑 `main.js:108-120`:

```javascript
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    show: true,  // 改为 true
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: false,  // 改为 false，显示在任务栏
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  // 打开开发者工具
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Window loaded, registering hotkeys...');
    registerHotkeys();
  });

  // 注释掉自动隐藏
  // mainWindow.on('blur', () => {
  //   if (!mainWindow.webContents.isDevToolsOpened()) {
  //     mainWindow.hide();
  //   }
  // });
}
```

### 步骤2: 重新编译并测试

```bash
npm start
```

现在：
- 窗口会一直显示
- 开发者工具自动打开
- 可以看到所有console日志
- 录音应该能正常工作

---

## 预期看到的日志

### 正常流程

```
[主进程]
Record hotkey PRESSED: Ctrl+Shift+R at 1760925473677
toggleRecording TRIGGERED at: 1760925473677
>>> NEW STATE: true
Sending recording-state-changed to renderer: true

[渲染进程 - Settings窗口]
Recording state changed: true
Starting recording...
Using microphone: Microphone (Realtek)
Recording started

[用户说话...]

[主进程]
Record hotkey PRESSED: Ctrl+Shift+R at 1760925483059
>>> NEW STATE: false
Sending recording-state-changed to renderer: false

[渲染进程 - Settings窗口]
Recording state changed: false
Recording stopped, chunks collected: 93
Processing audio...
Audio chunks: 93
Total size: 149248 bytes
Converting to WAV format...
WAV blob size: 149292
ASR result: { text: "你好世界" }
Transcription result: 你好世界
Current mode: translate
[Translate Mode] Translating...
[Translate Mode] Translation result: { success: true, translation: "Hello world" }
Text copied to clipboard: Hello world
```

### 如果失败，注意看哪一步卡住了

---

## 联系我继续调试

如果按照上面的步骤修改后，请告诉我：

1. 开发者工具Console中最后一条日志是什么？
2. 状态窗口显示卡在哪个进度？
3. 是否有任何红色错误信息？

我会根据具体日志进一步诊断问题。

---

**Happy Debugging! 🐛**
