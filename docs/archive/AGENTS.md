# Ququ Voice Input - Agent Architecture

This document describes the component architecture and interaction patterns for the Ququ Voice Input system.

## System Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Electron UI   │◄──►│   Main Process  │◄──►│  FunASR Server  │
│   (Renderer)    │    │   (Node.js)     │    │   (Python)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  System Tray    │    │  Export Logger  │    │  Model Manager  │
│   Integration   │    │   & Webhooks    │    │  (ModelScope)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Component Agents

### 1. Audio Recording Agent (renderer.js)
**Responsibilities:**
- Capture audio from microphone
- Manage recording state
- Handle media streams and audio encoding
- Interface with Web Audio API

**Key Functions:**
- `startRecording()` - Initialize media capture
- `stopRecording()` - End capture and process audio
- `processAudio()` - Send audio to ASR server

### 2. Speech Recognition Agent (funasr_server.py)
**Responsibilities:**
- Load and manage Paraformer model
- Process audio files (wav/pcm)
- Return structured recognition results
- Handle model downloads and caching

**Key Endpoints:**
- `POST /asr` - Audio processing endpoint
- `GET /health` - Service health check
- `GET /` - Server information

### 3. Configuration Agent (main.js)
**Responsibilities:**
- Load/save user configuration
- Manage application settings
- Handle hotkey registration
- Control application lifecycle

**Key Functions:**
- `loadConfig()` - Read configuration from disk
- `saveConfig()` - Persist configuration changes
- `updateHotkey()` - Re-register global shortcuts

### 4. Export and Logging Agent (export/logger.js)
**Responsibilities:**
- Write recognition results to files
- Manage log rotation and organization
- Handle webhook delivery and retries
- Generate usage statistics

**Key Functions:**
- `logResult()` - Write structured log entries
- `sendWebhook()` - Deliver results to external services
- `retryPendingWebhooks()` - Handle failed deliveries

### 5. System Integration Agent (main.js)
**Responsibilities:**
- System tray integration
- Global hotkey handling
- Windows startup configuration
- Inter-process communication

**Key Functions:**
- `createTray()` - Initialize system tray
- `toggleRecording()` - Handle hotkey events
- `setupStartup()` - Configure auto-start

## Data Flow

### Recording Session Flow
1. **User Input**: Hotkey pressed (F4)
2. **State Change**: `toggleRecording()` called
3. **Audio Capture**: MediaRecorder starts capture
4. **Processing**: Audio sent to FunASR server
5. **Recognition**: Text result returned
6. **Logging**: Result logged to files
7. **Webhook**: Optional external notification
8. **Output**: Text inserted or copied

### Configuration Flow
1. **UI Interaction**: User modifies settings
2. **Validation**: Settings validated in renderer
3. **IPC Communication**: Settings sent to main process
4. **Persistence**: Configuration saved to disk
5. **Application**: New settings applied immediately

## Error Handling Agents

### 1. ASR Error Handler
```javascript
// Graceful degradation when ASR server unavailable
if (!response.ok) {
    throw new Error(`ASR request failed: ${response.status}`);
}
```

### 2. Webhook Retry Agent
```javascript
// Automatic retry mechanism for failed webhooks
async retryPendingWebhooks() {
    // Check pending directory
    // Retry with exponential backoff
    // Clean up old failures
}
```

### 3. Audio Permission Handler
```javascript
// Handle microphone permission requests
try {
    const stream = await navigator.mediaDevices.getUserMedia({audio: true});
} catch (error) {
    // Show permission request UI
}
```

## State Management

### Application State
- `isRecording` - Current recording status
- `config` - User configuration object
- `logger` - Export logger instance
- `tray` - System tray object

### Configuration State
```javascript
{
  mode: 'input|translate|transcribe',
  targetLanguage: 'zh-cn|zh-tw|en|ja|ko',
  autoUpload: boolean,
  uploadDelay: number,
  webhookEnabled: boolean,
  webhookUrl: string,
  webhookHeaders: object,
  asrServerUrl: string,
  hotkey: string
}
```

### Recording State
```javascript
{
  isRecording: boolean,
  mediaRecorder: MediaRecorder,
  audioChunks: Blob[],
  startTime: timestamp,
  endTime: timestamp
}
```

## Integration Points

### 1. Operating System
- **Hotkey Registration**: Global keyboard shortcuts
- **System Tray**: Windows notification area
- **Startup Integration**: Windows registry/startup folder
- **Audio Permissions**: System microphone access

### 2. External Services
- **ModelScope**: Model download and management
- **Webhook Endpoints**: External API integration
- **File System**: Log file management

### 3. Web Technologies
- **Web Audio API**: Audio capture and processing
- **MediaRecorder API**: Audio encoding
- **Fetch API**: HTTP requests to ASR server
- **Electron IPC**: Process communication

## Performance Considerations

### 1. Model Loading
- **Lazy Loading**: Models loaded on first use
- **Caching**: Models cached to disk
- **Memory Management**: Models loaded once per session

### 2. Audio Processing
- **Streaming**: Real-time audio capture
- **Compression**: Audio compressed before transmission
- **Buffering**: Audio buffered during network issues

### 3. File I/O
- **Async Operations**: Non-blocking file operations
- **Batch Processing**: Multiple log entries written together
- **Log Rotation**: Automatic cleanup of old logs

## Security Agents

### 1. Data Privacy Agent
- **Local Processing**: Audio processed locally
- **No Cloud Storage**: Audio not stored remotely
- **Secure Transmission**: HTTPS for webhook delivery

### 2. Permission Management Agent
- **Microphone Access**: Explicit permission requests
- **File System**: Limited file system access
- **Network**: Controlled external connections

## Monitoring and Diagnostics

### 1. Health Check Agent
```python
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_initialized": model_initialized
    }
```

### 2. Statistics Agent
```javascript
async getStats() {
    return {
        totalLogs: this.countLogEntries(),
        pendingWebhooks: this.countPendingWebhooks(),
        todayLogs: this.countTodayLogs()
    };
}
```

### 3. Error Reporting Agent
- **Console Logging**: Development diagnostics
- **Error Persistence**: Critical errors logged to disk
- **User Feedback**: Error messages in UI

## Extension Points

### 1. Language Support
- **New Languages**: Add language codes to configuration
- **Custom Models**: Support for additional ASR models
- **Translation**: Integration with translation services

### 2. Output Formats
- **Custom Formats**: Additional export formats
- **API Integration**: New webhook payload formats
- **File Types**: Support for additional log formats

### 3. Input Sources
- **File Upload**: Process pre-recorded audio
- **Stream Input**: Real-time audio streams
- **Batch Processing**: Multiple file processing

## Deployment Agents

### 1. Installation Agent (install-windows.ps1)
- **Dependency Management**: Automatic dependency installation
- **Service Configuration**: System service setup
- **User Onboarding**: Initial configuration wizard

### 2. Update Agent
- **Version Checking**: Check for new releases
- **Automatic Updates**: Background update downloads
- **Rollback Support**: Revert to previous versions

### 3. Uninstall Agent
- **Clean Removal**: Remove all application files
- **Registry Cleanup**: Remove system integrations
- **Data Preservation**: Optional user data backup

---

This architecture provides a modular, maintainable, and extensible foundation for the Ququ Voice Input system.