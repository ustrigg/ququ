# Ququ Voice Input 蛐蛐语音输入

基于 Electron + FunASR 的桌面语音输入法，支持 Windows / macOS。

## 功能特性

- 🎙️ **高速语音识别** — 使用 FunASR SenseVoice-Small，GPU 加速 RTF ~ 0.03
- 🌐 **多模式输出** — 转写 / 翻译 / 双语
- 🧹 **文本优化** — LLM 口语转书面语，自动清理填充词
- ⚡ **全局热键** — F4/F9 一键录音，F6 开关优化，Escape 取消
- 🖥️ **跨平台** — Windows 原生 + macOS 适配
- 📋 **自动粘贴** — 录音结束自动填入焦点输入框
- 🔴 **实时反馈** — 托盘闪烁 + 悬浮指示器 + 提示音

## 架构

```
┌─────────────────────┐     ┌──────────────────────┐
│  Electron 主进程    │────▶│  FunASR 服务         │
│  - 全局热键         │     │  - SenseVoice-Small  │
│  - 托盘/悬浮指示器  │     │  - GPU 加速          │
│  - 自动粘贴 (OS API)│     │  - :8001/transcribe  │
└─────────┬───────────┘     └──────────────────────┘
          │
          ▼
┌─────────────────────┐     ┌──────────────────────┐
│  Renderer 进程      │────▶│  LLM 文本优化        │
│  - MediaRecorder    │     │  - Qwen3/GPT-OSS     │
│  - WebM → WAV       │     │  - 可选              │
│  - 历史记录         │     └──────────────────────┘
└─────────────────────┘
```

## 默认热键

| 热键 | 功能 |
|------|------|
| `F4` | 开始/停止录音 |
| `F5` | 切换模式（转写/翻译/双语）|
| `F6` | 开关文本优化 |
| `Ctrl+Shift+E` | 停止录音 |
| `Escape` | 取消录音（丢弃不转写，仅录音中生效）|

所有热键可在设置页自定义。

## 快速开始

### Windows

```bash
npm install
npm run pack
# 安装包: dist/Ququ Voice Input Setup <version>.exe
```

### macOS

```bash
npm install
npx electron-builder --mac
# 安装包: dist/Ququ Voice Input-<version>.dmg
```

### 启动 ASR 服务

```bash
# 本机 Python（推荐 GPU 环境）
python funasr_service_sensevoice.py --host 0.0.0.0 --port 8001

# 或 Docker
docker run -d --name funasr -p 8001:8001 \
  registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12
```

## 目录结构

```
.
├── main.js                        # Electron 主进程
├── main-window.js                 # 主窗口 renderer
├── renderer.js                    # 设置页 renderer
├── src/
│   ├── asrAdapter.js              # ASR 后端适配器
│   ├── paraformerClient.js        # ASR HTTP 客户端
│   ├── funasrManager.js           # ASR 服务管理
│   ├── qwenAsrClient.js           # Qwen3-ASR 客户端
│   └── longPressCtrl.js           # 长按 Ctrl 检测（跨平台）
├── export/
│   ├── logger.js                  # 日志
│   └── translator.js              # 翻译客户端
├── assets/                        # 图标
├── funasr_service_sensevoice.py   # ASR 服务 (SenseVoice)
├── funasr_service.py              # ASR 服务 (Paraformer 旧版)
├── funasr_server.py               # 服务管理脚本
├── qwen_asr_server.py             # Qwen3-ASR 服务管理
├── *-window.html                  # 各窗口 UI
├── docs/                          # 历史文档和归档
└── docker/                        # Docker 配置
```

## 跨平台适配

| 功能 | Windows | macOS |
|------|---------|-------|
| 自动粘贴 | PowerShell + `SendKeys` | `pbcopy` + `osascript` |
| 杀冲突进程 | `taskkill` | `pkill` |
| 长按 Ctrl | PowerShell `GetAsyncKeyState` | `node-global-key-listener` |
| 应用图标 | `.ico` | `.png` → `.icns` |
| 打包格式 | NSIS installer | DMG |

## 开发模式

```bash
npm run dev    # electron .
```

## 版本历史

### v1.2.0 (当前)
- 取消录音快捷键 (Escape)
- 移除长按 Ctrl 触发（精简代码）
- macOS 跨平台支持
- 单实例锁 + 启动冲突清理
- 悬浮指示器 + 托盘图标闪烁
- 音频提示音（开始/停止/取消）
- SenseVoice-Small GPU 加速
- ASR fallback 逻辑修复

### v1.1.x
- 文本优化（口语转书面语）
- F6 热键开关
- Docker ASR 服务

## 许可证

MIT
