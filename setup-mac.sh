#!/bin/bash
# Ququ Voice Input - macOS 快速部署脚本
# 用法: chmod +x setup-mac.sh && ./setup-mac.sh

set -e
echo "=============================="
echo " Ququ Voice Input macOS Setup"
echo "=============================="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "[!] Node.js 未安装，请先安装: brew install node"
    exit 1
fi
echo "[OK] Node.js $(node -v)"

# 检查 npm
if ! command -v npm &> /dev/null; then
    echo "[!] npm 未安装"
    exit 1
fi
echo "[OK] npm $(npm -v)"

# 安装依赖
echo ""
echo "[1/3] 安装依赖..."
npm install

# macOS 辅助功能提醒
echo ""
echo "[2/3] macOS 权限提醒:"
echo "  - 麦克风权限: 首次录音时系统会弹窗请求"
echo "  - 辅助功能权限: 自动粘贴需要 (系统设置 > 隐私与安全 > 辅助功能)"
echo "  - 全局快捷键: Electron 自动注册，无需额外配置"
echo ""

# 构建
echo "[3/3] 构建 macOS 应用..."
npx electron-builder --mac

echo ""
echo "=============================="
echo " 构建完成!"
echo " 安装包位置: dist/"
echo " 默认热键:"
echo "   Ctrl+Shift+R  开始/停止录音"
echo "   Ctrl+Shift+E  停止录音"
echo "   Escape         取消录音(丢弃)"
echo "   F6             文本优化开关"
echo ""
echo " ASR 服务器默认: http://localhost:8001"
echo " 需要在 macOS 上部署 FunASR Docker:"
echo "   docker run -d --name funasr -p 8001:8001 \\"
echo "     registry.cn-hangzhou.aliyuncs.com/funasr_repo/funasr:funasr-runtime-sdk-online-cpu-0.1.12"
echo "=============================="
