# Quick Test Guide - Ququ Voice Input

This guide helps you verify that all components are working correctly.

## Pre-Test Checklist

1. **Installation Complete**
   - [ ] Python 3.8+ installed
   - [ ] Node.js 16+ installed
   - [ ] All dependencies installed via `scripts\install-windows.ps1`
   - [ ] System tray icon visible

2. **Services Running**
   - [ ] ASR server started: `npm run asr:serve`
   - [ ] Application started: `npm start`
   - [ ] No error messages in terminals

## Component Tests

### 1. FunASR Server Test

```bash
# Test server health
curl http://localhost:8000/health

# Expected response:
{
  "status": "healthy",
  "model_initialized": true
}
```

**Manual Test:**
1. Navigate to `http://localhost:8000` in browser
2. Should see server info JSON
3. Check terminal for "FunASR model initialized successfully"

### 2. Audio Recording Test

1. **Start Application**
   - Launch application with `npm start`
   - Verify system tray icon appears
   - Right-click tray → "Show Settings"

2. **Test Recording**
   - Press `F4` (default hotkey)
   - Status should change to "正在录音..."
   - Speak clearly for 2-3 seconds
   - Press `F4` again to stop
   - Check terminal for ASR processing logs

3. **Verify Results**
   - Text should appear in clipboard or auto-upload
   - Check developer console for transcription results

### 3. Settings Configuration Test

1. **Open Settings Window**
   - Right-click tray icon → "Show Settings"
   - Verify all UI elements load correctly

2. **Test Configuration Changes**
   - Change mode from "语音输入" to "转写"
   - Modify target language
   - Change hotkey from F4 to F5
   - Click "保存设置"
   - Verify settings persist after restart

### 4. Export and Logging Test

1. **Verify Log Creation**
   ```bash
   # Check log directory structure
   ls export/logs/
   ls export/logs/$(date +%Y-%m)/
   ```

2. **Test Log Entries**
   - Perform a voice recording
   - Check `export/logs/YYYY-MM/day.jsonl` for new entry
   - Verify JSON format and content

3. **Test CSV Export** (if enabled)
   - Enable CSV in settings
   - Perform recording
   - Check `export/logs/YYYY-MM/day.csv`

### 5. Webhook Test (Optional)

1. **Setup Test Webhook**
   ```bash
   # Use httpbin.org for testing
   # In settings, set webhook URL to: https://httpbin.org/post
   ```

2. **Configure Webhook**
   - Enable webhook in settings
   - Set URL: `https://httpbin.org/post`
   - Set headers: `{"Content-Type": "application/json"}`
   - Save settings

3. **Test Webhook Delivery**
   - Perform voice recording
   - Check webhook response
   - Verify no files in `export/pending/`

## Performance Tests

### 1. Model Loading Time
- Restart ASR server
- Time from start to "model initialized"
- Should complete within 30-60 seconds

### 2. Recognition Latency
- Record 3-second audio clip
- Measure time from stop to result
- Should be under 2-3 seconds

### 3. Memory Usage
- Monitor RAM usage during operation
- Should be under 2GB for typical usage

## Error Scenarios

### 1. Test ASR Server Failure
1. Stop ASR server
2. Try recording
3. Verify graceful error handling
4. Check error messages in UI

### 2. Test Webhook Failure
1. Set invalid webhook URL
2. Perform recording
3. Verify files appear in `export/pending/`
4. Restart with valid URL
5. Check retry mechanism

### 3. Test Permission Issues
1. Revoke microphone permissions
2. Try recording
3. Verify appropriate error message

## Acceptance Test Scenarios

### Scenario 1: Basic Voice Input
1. Start application
2. Open text editor (Notepad)
3. Press F4, say "Hello world"
4. Press F4 to stop
5. **Expected**: Text appears in editor

### Scenario 2: Chinese Recognition
1. Change language to "中文(简体)"
2. Record Chinese speech: "你好世界"
3. **Expected**: Correct Chinese text output

### Scenario 3: Auto-Startup
1. Configure auto-startup in installation
2. Restart computer
3. **Expected**: Application starts with Windows

### Scenario 4: Settings Persistence
1. Change multiple settings
2. Restart application
3. **Expected**: All settings retained

### Scenario 5: Export Functionality
1. Perform 3 recordings
2. Check log files
3. **Expected**: 3 entries in JSONL with timestamps

## Test Results Log

Copy and fill out this checklist:

```
Test Date: ___________
Tester: _____________

[ ] FunASR Server Health
[ ] Model Loading (Time: ____ seconds)
[ ] Audio Recording Works
[ ] Hotkey Functions (F4)
[ ] Settings UI Loads
[ ] Settings Persistence
[ ] Log File Creation
[ ] CSV Export (if enabled)
[ ] Webhook Delivery (if configured)
[ ] Auto-upload Function
[ ] Chinese Recognition
[ ] English Recognition
[ ] System Tray Integration
[ ] Auto-startup (if configured)

Issues Found:
_________________________________
_________________________________
_________________________________

Overall Status: PASS / FAIL
```

## Troubleshooting Quick Fixes

### ASR Server Issues
```bash
# Check Python modules
python -c "import funasr; print('FunASR OK')"

# Check model directory
ls models/paraformer/

# Restart server with verbose logging
python funasr_server.py
```

### Audio Issues
```bash
# Test microphone access
# Windows: Settings > Privacy > Microphone
# Allow desktop apps to access microphone
```

### Application Issues
```bash
# Check Electron version
npm list electron

# Clear cache and restart
rm -rf node_modules/.cache
npm start
```

## Performance Benchmarks

Record these metrics for your system:

- **Model Load Time**: _____ seconds
- **Recognition Latency**: _____ seconds
- **Memory Usage**: _____ MB
- **CPU Usage**: _____ %
- **First Recognition**: _____ seconds (includes audio processing)

## Next Steps

After successful testing:

1. Configure production settings
2. Set up any required webhooks
3. Configure auto-startup if desired
4. Train users on hotkey usage
5. Monitor logs for issues

---

**Note**: Keep this test log for future reference and debugging.