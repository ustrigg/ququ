# 翻译功能使用指南

## 功能概述

蛐蛐语音输入工具现已支持基于 GPT-OSS-20B 的中文转英文翻译功能，可以将您说的中文口语自动优化为地道的英文书面语。

## 三种工作模式

### 1. 转写模式 (Transcribe)
- 仅进行语音识别，输出中文文本
- 适合中文输入场景
- 快速简单，无需翻译

### 2. 翻译模式 (Translate)
- 先识别中文，再翻译成英文
- 自动优化为书面语
- 仅输出英文结果

### 3. 双语模式 (Dual)
- 同时显示中文和英文
- 便于对照和学习
- 格式：
  ```
  中文: [您说的话]

  English: [优化后的英文翻译]
  ```

## 快捷键

- **F4**: 开始/停止录音
- **Tab + \\**: 切换模式（转写 → 翻译 → 双语 → 转写...）

## 使用步骤

### 首次配置

1. **启动应用**
   ```bash
   npm start
   ```

2. **打开设置界面**
   - 右键点击系统托盘图标
   - 选择 "Show Settings"

3. **配置翻译服务**
   - 翻译服务器地址: `http://192.168.2.2:1234`
   - 翻译模型: `gpt-oss-20b`
   - 翻译风格: 选择您需要的风格
     - 专业/正式 (professional)
     - 日常/轻松 (casual)
     - 学术/严谨 (academic)
     - 商务 (business)
     - 技术文档 (technical)

4. **启用翻译功能**
   - 勾选 "启用翻译功能"

5. **保存设置**

### 日常使用

1. **选择模式**
   - 方法1: 在设置界面选择模式
   - 方法2: 按 `Tab + \` 快捷键循环切换

2. **开始录音**
   - 按 `F4` 开始录音
   - 说出您要转写/翻译的内容

3. **停止录音**
   - 再按 `F4` 停止录音
   - 系统自动处理并输出结果

4. **查看结果**
   - 根据当前模式，文本会自动复制到剪贴板
   - 可以直接粘贴使用

## 翻译风格说明

### Professional (专业/正式)
适用于商务邮件、正式文档
- 示例输入: "我觉得这个方案挺好的"
- 示例输出: "I believe this proposal is quite excellent."

### Casual (日常/轻松)
适用于日常对话、社交媒体
- 示例输入: "这个东西真不错"
- 示例输出: "This thing is really nice."

### Academic (学术/严谨)
适用于学术论文、研究报告
- 示例输入: "我们发现了一些有趣的结果"
- 示例输出: "We observed several noteworthy findings."

### Business (商务)
适用于商务谈判、合作沟通
- 示例输入: "我们可以考虑一下合作"
- 示例输出: "We would be pleased to explore potential collaboration opportunities."

### Technical (技术文档)
适用于技术文档、开发文档
- 示例输入: "这个功能需要优化一下"
- 示例输出: "This functionality requires optimization."

## 测试步骤

### 1. 测试翻译服务器连接
```javascript
// 在浏览器控制台执行
const { ipcRenderer } = require('electron');
const result = await ipcRenderer.invoke('test-translation-server');
console.log(result);
```

### 2. 测试翻译功能
1. 设置模式为 "翻译模式"
2. 按 F4 开始录音
3. 说："你好，这是一个测试"
4. 按 F4 停止录音
5. 检查剪贴板内容是否为英文翻译

### 3. 测试模式切换
1. 打开设置界面，观察 "当前模式" 状态栏
2. 按 `Tab + \`
3. 确认状态栏显示切换到下一个模式
4. 重复测试完整循环

### 4. 测试双语模式
1. 切换到双语模式
2. 录音并说："这个功能非常实用"
3. 检查输出是否包含中英文对照

## 配置文件

配置保存在 `config.json`，示例：

```json
{
  "mode": "translate",
  "targetLanguage": "zh-cn",
  "autoUpload": true,
  "uploadDelay": 1000,
  "webhookEnabled": false,
  "webhookUrl": "",
  "webhookHeaders": {},
  "asrServerUrl": "http://localhost:8001",
  "hotkey": "F4",
  "modeToggleHotkey": "Tab+\\",
  "translationEnabled": true,
  "translationServerUrl": "http://192.168.2.2:1234",
  "translationModel": "gpt-oss-20b",
  "translationStyle": "professional",
  "translationTimeout": 30000
}
```

## 日志和调试

### 查看翻译日志
日志保存在 `export/logs/YYYY-MM/DD.jsonl`，每条记录包含：
- `timestamp`: 时间戳
- `text`: 原始中文
- `translation`: 英文翻译 (如果有)
- `translationStyle`: 翻译风格
- `mode`: 当前模式

### 常见问题

**Q: 翻译失败怎么办？**
A: 系统会自动回退到原始中文文本，请检查：
- 翻译服务器是否运行 (http://192.168.2.2:1234)
- 网络连接是否正常
- 查看控制台错误日志

**Q: 翻译速度慢？**
A: 翻译需要调用 GPT 模型，通常需要 2-5 秒
- 检查网络延迟
- 考虑调整 `translationTimeout` 配置

**Q: 模式切换快捷键不生效？**
A:
- 确认应用正在运行
- 检查是否有其他应用占用 Tab+\ 快捷键
- 尝试重启应用

**Q: 想更改快捷键？**
A: 当前 Tab+\ 快捷键在 main.js:182 定义，可以修改为其他组合键

## 技术架构

```
用户说话
  ↓
FunASR 语音识别 (中文)
  ↓
根据模式处理:
  - 转写模式 → 直接输出中文
  - 翻译模式 → GPT-OSS-20B 翻译 → 输出英文
  - 双语模式 → GPT-OSS-20B 翻译 → 输出中英对照
  ↓
复制到剪贴板/发送Webhook/记录日志
```

## 文件结构

```
ququ/
├── main.js                      # 主进程，包含模式切换逻辑
├── renderer.js                  # 渲染进程，处理翻译流程
├── index.html                   # 设置界面UI
├── export/
│   ├── translator.js           # 翻译服务模块
│   └── logger.js               # 日志记录
└── config.json                  # 配置文件
```

## 下一步开发建议

1. **添加翻译缓存**: 避免重复翻译相同内容
2. **支持更多语言**: 中→日、中→韩等
3. **翻译历史查看**: UI 界面显示历史翻译记录
4. **手动编辑翻译**: 允许用户修改翻译结果
5. **批量翻译**: 支持一次性翻译多段文本

## 更新日志

### v1.1.0 (2025-01-XX)
- ✅ 新增翻译功能，支持 GPT-OSS-20B
- ✅ 三种模式：转写/翻译/双语
- ✅ Tab+\ 快捷键切换模式
- ✅ 五种翻译风格可选
- ✅ 界面显示当前模式状态
- ✅ 翻译结果记录到日志

---

**提示**: 首次使用建议先用双语模式测试，便于验证翻译质量！
