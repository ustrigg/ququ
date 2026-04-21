# 故障排查指南

## 问题1: 第一次转写很慢

### 原因
- FunASR模型第一次加载需要时间（10-30秒）
- 模型文件大小约 840MB，需要加载到内存

### 解决方案
✅ **正常现象**，后续转写会很快（1-3秒）

---

## 问题2: 录音后没有反应

### 可能原因

1. **翻译服务器不可达** (最常见)
   - 默认配置: `http://192.168.2.2:1234`
   - 如果服务器不存在，会超时30秒

2. **ASR服务器未启动**
   - 需要端口 8001

3. **音频录制失败**
   - 没有麦克风权限

### 诊断步骤

#### 步骤1: 检查翻译服务器
```bash
# 测试连接
curl http://192.168.2.2:1234
```

如果失败，需要**关闭翻译功能**或**修改配置**：

**方法A**: 在设置中关闭翻译
1. 右键托盘图标 → Show Settings
2. 翻译设置 → 取消勾选"启用翻译功能"
3. 保存设置

**方法B**: 修改 config.json
```json
{
  "translationEnabled": false  // 改为 false
}
```

**方法C**: 修改翻译服务器地址
```json
{
  "translationServerUrl": "http://localhost:1234"  // 改为本地或可用地址
}
```

#### 步骤2: 检查ASR服务器
```bash
# 检查端口
netstat -ano | findstr :8001

# 如果没有运行，手动启动
python funasr_server.py
```

#### 步骤3: 检查麦克风权限
- Windows设置 → 隐私 → 麦克风
- 允许应用访问麦克风

---

## 问题3: 切换模式后不工作

### 已修复 (v1.1.1)
- Bug: 切换模式后配置未同步
- 修复: 模式切换时重新加载完整配置

---

## 开发模式调试

### 启动开发模式
```bash
npm start
```

### 打开开发者工具查看日志
在应用窗口按 `F12` 或 `Ctrl+Shift+I`

### 查看关键日志

**录音开始**:
```
Recording started
```

**录音停止**:
```
Processing audio...
Audio chunks: X
```

**ASR请求**:
```
ASR result: {...}
```

**翻译请求** (如果启用):
```
[Translate Mode] Translating...
[Translate Mode] Translation result: {...}
```

---

## 快速修复方案

### 方案1: 关闭翻译功能（推荐）

如果不需要翻译，最简单的方法是关闭它：

1. 编辑 `config.json`:
```json
{
  "mode": "transcribe",  // 改为转写模式
  "translationEnabled": false  // 关闭翻译
}
```

2. 重启应用

### 方案2: 使用本地翻译服务

如果需要翻译功能，需要先启动翻译服务器：

1. 确保翻译服务器在运行
2. 修改 `config.json` 中的 `translationServerUrl`
3. 测试连接：
```bash
curl http://localhost:1234/v1/models
```

### 方案3: 只使用转写模式

1. 按 `Ctrl+Shift+M` 切换到转写模式
2. 或在设置中选择"转写模式"
3. 这样就不需要翻译服务器

---

## 性能优化

### 第一次转写慢的解决方案

**预加载模型**:
1. 启动应用
2. 等待30秒让模型加载完成
3. 之后的转写会很快

**验证模型已加载**:
检查 FunASR 服务器日志，应该看到：
```
Model loaded successfully
```

---

## 常见错误代码

### HTTP 404
- **原因**: ASR端点错误
- **解决**: 已在 v1.1.1 中修复 (`/transcribe` → `/asr`)

### HTTP 500
- **原因**: ASR服务器内部错误
- **解决**: 检查 FunASR 服务器日志

### Network Error
- **原因**: 无法连接到ASR或翻译服务器
- **解决**: 检查服务器是否运行，检查端口

### Timeout
- **原因**: 翻译服务器响应超时（默认30秒）
- **解决**: 关闭翻译或修改超时时间

---

## 推荐配置（快速启动）

### 纯转写模式（最快）
```json
{
  "mode": "transcribe",
  "translationEnabled": false,
  "autoUpload": true,
  "uploadDelay": 1000,
  "asrServerUrl": "http://localhost:8001"
}
```

### 翻译模式（需要翻译服务器）
```json
{
  "mode": "translate",
  "translationEnabled": true,
  "translationServerUrl": "http://localhost:1234",
  "autoUpload": true,
  "asrServerUrl": "http://localhost:8001"
}
```

---

## 联系支持

如果问题仍然存在：

1. 打开开发者工具（F12）
2. 截图 Console 标签页的错误
3. 查看 `export/logs/` 目录中的日志文件
4. 提供以上信息以便诊断

---

**Happy Debugging! 🔧**
