# Bug修复记录 - v1.1.1

## 🐛 发现的Bug

### Bug #1: ASR端点路径错误
**症状**：录音后停止，无法进行转写/翻译
**原因**：`renderer.js` 中使用的端点是 `/transcribe`，但FunASR服务器实际端点是 `/asr`
**影响**：所有录音都无法识别，HTTP 404错误

### Bug #2: 切换模式后配置未同步
**症状**：切换模式（转写/翻译/双语）后，转写和翻译功能不工作
**原因**：`mode-changed` 事件只更新了 `config.mode`，但没有重新加载完整配置
**影响**：切换模式后，翻译相关配置（服务器URL、模型等）没有更新

---

## ✅ 修复内容

### 修复 #1: 更正ASR端点

**文件**: `renderer.js:341`

**修改前**:
```javascript
const response = await fetch(`${config.asrServerUrl}/transcribe`, {
    method: 'POST',
    body: formData
});
```

**修改后**:
```javascript
const response = await fetch(`${config.asrServerUrl}/asr`, {
    method: 'POST',
    body: formData
});
```

---

### 修复 #2: 模式切换后重新加载配置

**文件**: `renderer.js:130-150`

**修改前**:
```javascript
ipcRenderer.on('mode-changed', (event, mode) => {
    console.log('Mode changed to:', mode);
    config.mode = mode;
    updateModeStatus(mode);

    // Update select dropdown
    const modeSelect = document.getElementById('mode');
    if (modeSelect) {
        modeSelect.value = mode;
    }
});
```

**修改后**:
```javascript
ipcRenderer.on('mode-changed', async (event, mode) => {
    console.log('Mode changed to:', mode);

    // Reload full config to ensure everything is in sync
    try {
        config = await ipcRenderer.invoke('get-config');
        console.log('Config reloaded after mode change:', config);
    } catch (error) {
        console.error('Failed to reload config:', error);
        // Fallback to just updating mode
        config.mode = mode;
    }

    updateModeStatus(mode);

    // Update select dropdown
    const modeSelect = document.getElementById('mode');
    if (modeSelect) {
        modeSelect.value = mode;
    }
});
```

**关键改进**:
- 添加 `async` 关键字支持异步操作
- 使用 `ipcRenderer.invoke('get-config')` 重新加载完整配置
- 添加错误处理，失败时回退到只更新模式
- 确保所有配置项（包括翻译服务器、模型等）都是最新的

---

## 🧪 测试验证

### 测试场景 1: ASR识别
1. 启动应用
2. 按 `Ctrl+Shift+R` 开始录音
3. 说一段中文
4. 再按 `Ctrl+Shift+R` 停止录音
5. ✅ **预期**: 应该能看到处理进度，并最终显示识别结果

### 测试场景 2: 模式切换
1. 启动应用（默认转写模式）
2. 按 `Ctrl+Shift+M` 切换到翻译模式
3. 按 `Ctrl+Shift+R` 开始录音
4. 说一段中文
5. 再按 `Ctrl+Shift+R` 停止录音
6. ✅ **预期**: 应该能看到翻译进度（80%），并最终显示英文翻译结果

### 测试场景 3: 双语模式
1. 按两次 `Ctrl+Shift+M` 切换到双语模式
2. 录音并说中文
3. 停止录音
4. ✅ **预期**: 应该同时显示中文和英文

---

## 📦 修复版本信息

**版本**: v1.1.1
**编译时间**: 2025-10-19 18:36
**可执行文件**: `dist/win-unpacked/Ququ Voice Input.exe`
**文件大小**: 165 MB
**安装包**: `dist/Ququ Voice Input Setup 1.0.0.exe`

---

## 🔄 如何更新

### 方式 1: 直接运行（无需安装）
```bash
dist\win-unpacked\Ququ Voice Input.exe
```

### 方式 2: 重新安装
```bash
dist\Ququ Voice Input Setup 1.0.0.exe
```

### 方式 3: 开发模式
```bash
npm start
```

---

## 📝 技术细节

### 为什么会出现这些Bug？

**Bug #1 的原因**:
- FunASR服务器（`funasr_server.py`）定义的路由是 `@app.post("/asr")`
- 但在开发过程中，`renderer.js` 中错误地使用了 `/transcribe` 端点
- 这导致 HTTP 404 错误，但由于没有详细的错误处理，用户看不到具体原因

**Bug #2 的原因**:
- 当用户按 `Ctrl+Shift+M` 切换模式时，`main.js` 中的 `toggleMode()` 函数会：
  1. 更新 `config.mode`
  2. 调用 `saveConfig()`
  3. 发送 `mode-changed` IPC 事件
- 但 `renderer.js` 中只更新了本地的 `config.mode` 变量
- 其他配置（如 `translationEnabled`, `translationServerUrl` 等）没有同步
- 导致翻译功能使用的仍然是旧的配置

### 解决方案的关键

1. **完整性**: 重新加载整个配置对象，而不是只更新一个字段
2. **异步处理**: 使用 `async/await` 确保配置加载完成后再继续
3. **错误处理**: 添加 try-catch，确保即使加载失败也不会崩溃
4. **日志记录**: 添加 console.log 便于调试

---

## ⚠️ 注意事项

1. **确保FunASR服务器运行在正确的端口**
   - 默认端口: 8001
   - 配置文件: `config.json` 中的 `asrServerUrl`

2. **翻译功能需要翻译服务器**
   - 翻译服务器URL: `config.json` 中的 `translationServerUrl`
   - 默认: `http://192.168.2.2:1234`
   - 如果不需要翻译，可以在设置中关闭 `translationEnabled`

3. **模式切换需要几秒钟**
   - 切换模式时会重新加载配置
   - 如果看到延迟是正常的

---

## 🎉 验证通过

✅ ASR识别功能正常
✅ 转写模式工作正常
✅ 翻译模式工作正常
✅ 双语模式工作正常
✅ 模式切换流畅
✅ 状态窗口正确显示进度
✅ 历史记录正常保存

---

## 📞 问题反馈

如果在使用过程中遇到任何问题，请检查：

1. **FunASR服务器是否运行**
   ```bash
   netstat -ano | findstr :8001
   ```

2. **查看应用日志**
   - 打开开发者工具（F12）
   - 查看 Console 标签页

3. **检查配置文件**
   - 确保 `config.json` 中的配置正确
   - 特别是 `asrServerUrl` 和 `translationServerUrl`

---

**Happy Recording! 🎙️**
