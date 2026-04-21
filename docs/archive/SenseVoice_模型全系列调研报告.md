# SenseVoice 模型全系列调研报告

**日期**: 2026-03-30
**来源**: FunAudioLLM / 阿里巴巴达摩院
**论文**: FunAudioLLM: Voice Understanding and Generation Foundation Models (arXiv:2407.04051, 2024-07)

---

## 1. 模型变体总览

| 属性 | SenseVoice-Small | SenseVoice-Large |
|------|-----------------|-----------------|
| **参数量** | 234M | 1,587M (1.59B) |
| **架构** | Encoder-only (非自回归) | Encoder-Decoder (自回归, beam search) |
| **模型文件大小** | ~936 MB (model.pt) | 未公开 |
| **支持语言数** | 5 (中/英/粤/日/韩) | 50+ |
| **训练数据量** | ~300,000 小时 | 400,000+ 小时 |
| **开源状态** | 已开源 (2024年7月) | **未开源** (仅论文中有评测数据) |
| **功能** | ASR + LID + SER + AED + ITN | ASR + LID + SER + AED |

---

## 2. 模型 ID 和下载地址

### SenseVoice-Small (官方)

| 平台 | Model ID / URL |
|------|---------------|
| **ModelScope** | `iic/SenseVoiceSmall` |
| **ModelScope ONNX** | `iic/SenseVoiceSmall-onnx` |
| **HuggingFace** | `FunAudioLLM/SenseVoiceSmall` |
| **GitHub** | https://github.com/FunAudioLLM/SenseVoice |

### 社区衍生版本

| 平台 | Model ID | 说明 |
|------|---------|------|
| ModelScope | `manyeyes/sensevoice-small-onnx` | 社区 ONNX 版 |
| ModelScope | `danieldong/sensevoice-small-onnx-quant` | 量化 ONNX 版 |
| HuggingFace | `ThomasTheMaker/SenseVoiceSmall-RKNN2` | RK3588 NPU 版 |

### sherpa-onnx 预编译包

| 包名 | 格式 | 说明 |
|------|------|------|
| `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` | float32 ONNX (~895MB) | 全精度 |
| `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17` | INT8 ONNX (~229MB) | 动态量化 |
| `sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09` | INT8 ONNX | 更新版 |
| `sherpa-onnx-rk3588-*-sense-voice-*` | RKNN | RK3588 专用 |
| `sherpa-onnx-qnn-SM8850-*-sense-voice-*` | QNN INT8 | 高通 SM8850 专用 |

### SenseVoice.cpp (GGML) 量化支持

- 支持 3-bit / 4-bit / 5-bit / 8-bit 量化
- 纯 C/C++ 实现，无第三方依赖
- 项目: https://github.com/lovemefan/SenseVoice.cpp

### SenseVoice-Large

- **未开源**，无公开模型文件下载
- 仅在论文 benchmark 中出现评测数据

---

## 3. 语音识别精度 (CER/WER) 对比

来源: 论文 Table 6 (A800 GPU, beam_size=5 for encoder-decoder models)

### 中文数据集 (CER%, 越低越好)

| 数据集 | Whisper-Small | Whisper-Large-V3 | **SenseVoice-Small** | **SenseVoice-Large** |
|--------|:---:|:---:|:---:|:---:|
| AISHELL-1 test | 10.04 | 5.14 | **2.96** | **2.09** |
| AISHELL-2 test_ios | 8.78 | 4.96 | **3.80** | **3.04** |
| WenetSpeech test_meeting | 25.62 | 18.87 | **7.44** | **6.73** |
| WenetSpeech test_net | 16.66 | 10.48 | **7.84** | **6.01** |
| CommonVoice zh-CN | 19.60 | 12.55 | **10.78** | **7.68** |

### 英文数据集 (WER%, 越低越好)

| 数据集 | Whisper-Small | Whisper-Large-V3 | **SenseVoice-Small** | **SenseVoice-Large** |
|--------|:---:|:---:|:---:|:---:|
| LibriSpeech test_clean | **3.13** | **1.82** | 3.15 | 2.57 |
| LibriSpeech test_other | 7.37 | **3.50** | 7.18 | 4.28 |
| CommonVoice en | 14.85 | **9.39** | 14.71 | 9.00 |

**关键结论**:
- 中文/粤语场景: SenseVoice-Small 大幅领先 Whisper-Large-V3 (参数量仅为其 1/6)
- 英文场景: SenseVoice-Small 与 Whisper-Small 持平; SenseVoice-Large 接近 Whisper-Large-V3
- SenseVoice-Large 在几乎所有数据集上达到最优

---

## 4. 推理速度 (RTF) 对比

来源: 论文 Table 7 (A800 GPU, batch_size=1)

| 模型 | 参数量 | RTF | 10s音频延迟 |
|------|:---:|:---:|:---:|
| **SenseVoice-Small** | 234M | **0.007** | **70 ms** |
| Whisper-Small | 244M | 0.042 | 518 ms |
| **SenseVoice-Large** | 1,587M | 0.110 | 1,623 ms |
| Whisper-Large-V3 | 1,550M | 0.111 | 1,281 ms |

**关键结论**:
- SenseVoice-Small 比 Whisper-Small 快 **5倍以上** (非自回归 vs 自回归)
- SenseVoice-Small 比 Whisper-Large-V3 快 **15倍以上**
- SenseVoice-Large 与 Whisper-Large-V3 速度相当 (两者均为自回归架构)
- SenseVoice-Small 的 RTF=0.007 意味着处理 1 小时音频仅需 ~25 秒

---

## 5. GPU vs CPU 性能

### GPU 性能 (来源: 论文, A800)

- SenseVoice-Small: RTF = 0.007, 10s 音频仅需 70ms

### CPU 性能 (来源: sherpa-onnx 基准测试 + VoicePing 评测)

#### ARM 处理器 (INT8 ONNX, sherpa-onnx)

| CPU 核心 | 1线程 RTF | 2线程 RTF | 4线程 RTF |
|---------|:---:|:---:|:---:|
| Cortex-A55 | 0.436 | 0.260 | 0.175 |
| Cortex-A76 | 0.099 | 0.065 | 0.049 |

#### x86 CPU (VoicePing 评测, 2026-02)

- 测试平台: Intel Core i5-1035G1 (4C/8T), 8GB RAM, CPU-only
- SenseVoice-Small 位列最快模型之一 (与 Moonshine Tiny 并列)
- 具体 RTF 数值需参考完整评测报告

### ONNX 模型尺寸对比

| 格式 | 大小 | 适用场景 |
|------|------|---------|
| PyTorch model.pt | 936 MB | GPU 训练/推理 |
| ONNX float32 | ~895 MB | GPU/高端CPU 推理 |
| ONNX INT8 | ~229 MB | CPU/边缘设备 |
| GGML 4-bit | 估计 ~120 MB | 极端边缘场景 |

---

## 6. 流式/实时推理支持

### 原生设计

SenseVoice **并非为流式识别设计** — 它是非自回归 (non-autoregressive) 模型，需要完整音频输入后一次性推理。官方论文也提到未来工作方向之一是开发流式版本。

### 伪流式方案 (社区)

| 方案 | 原理 | 项目 |
|------|------|------|
| **streaming-sensevoice** | 截断注意力 + CTC prefix beam search，按 chunk 推理 | https://github.com/pengzhendong/streaming-sensevoice |
| **api4sensevoice** | VAD 分段 + WebSocket 实时推送 | https://github.com/0x5446/api4sensevoice |
| **FunASR 2pass** | VAD + SenseVoice 离线模式 (1pass流式 + 2pass离线修正) | FunASR Real-time Service v1.11+ |
| **WebRTC 集成** | 小 chunk (20-40ms) + SenseVoice 推理 | 各社区方案 |

### 实际可行性

由于 SenseVoice-Small 的 RTF 仅 0.007 (GPU)，即便采用"VAD 分段 + 非流式推理"的方式:
- 每 1 秒音频处理仅需 ~7ms (GPU)
- 搭配 200-500ms 的 VAD 分段，整体延迟可控制在 300-600ms
- 对于大多数"实时"场景已足够

---

## 7. 语音情感识别 (SER) 性能

来源: 论文 Table 8 (无目标域微调)

| 数据集 | 语言 | SenseVoice-Large UA | SenseVoice-Large WA |
|--------|------|:---:|:---:|
| CASIA | 中文 | 96.0% | 96.0% |
| CREMA-D | 英文 | 90.1% | 90.4% |
| ESD | 中/英 | 93.2% | 93.2% |
| IEMOCAP | 英文 | 73.9% | 75.3% |

- SenseVoice-Large 在几乎所有 SER 数据集上超越现有最佳模型
- SenseVoice-Small 在多数数据集上也超越其他开源模型

---

## 8. 部署方式汇总

| 部署方式 | 框架 | 语言 | 适用场景 |
|---------|------|------|---------|
| FunASR Python | PyTorch | Python | 服务端 GPU 推理 |
| FunASR ONNX | ONNX Runtime | Python | 服务端 CPU/GPU |
| sherpa-onnx | ONNX Runtime | C++/Python/Java/Go/Swift/Kotlin/JS/Dart/C#/C | 跨平台/边缘/移动端 |
| SenseVoice.cpp | GGML | C/C++ | 嵌入式/边缘 |
| FastAPI Service | PyTorch/ONNX | Python | Web API 服务 |
| Docker | PyTorch/ONNX | - | 容器化部署 |
| RKNN | RKNN | C++ | 瑞芯微 NPU |
| QNN | Qualcomm QNN | C++ | 高通 NPU |

---

## 9. 关键结论

1. **SenseVoice-Small 是目前性价比最高的开源中文 ASR 模型** — 234M 参数，中文 CER 碾压 Whisper-Large-V3，速度快 15 倍
2. **SenseVoice-Large (1.59B) 未开源** — 仅有论文评测数据，50+ 语言支持，精度最高但速度与 Whisper-Large 相当
3. **不原生支持流式** — 但 RTF 极低 (0.007)，搭配 VAD 分段可实现伪实时，延迟 300-600ms
4. **CPU 部署可行** — INT8 ONNX 仅 229MB，ARM Cortex-A76 单线程 RTF=0.099 (实时性达标)
5. **附加能力突出** — 情感识别、声音事件检测、语种识别一个模型全搞定
6. **ModelScope 下载量 3700万+** — 社区活跃度极高

---

## 参考来源

- [GitHub - FunAudioLLM/SenseVoice](https://github.com/FunAudioLLM/SenseVoice)
- [论文 - FunAudioLLM (arXiv:2407.04051)](https://arxiv.org/html/2407.04051v1)
- [ModelScope - iic/SenseVoiceSmall](https://www.modelscope.cn/models/iic/SenseVoiceSmall)
- [HuggingFace - FunAudioLLM/SenseVoiceSmall](https://huggingface.co/FunAudioLLM/SenseVoiceSmall)
- [sherpa-onnx SenseVoice 文档](https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html)
- [sherpa-onnx 预训练模型](https://k2-fsa.github.io/sherpa/onnx/sense-voice/pretrained.html)
- [VoicePing 离线语音转写评测](https://voiceping.net/en/blog/research-offline-speech-transcription-benchmark/)
- [streaming-sensevoice](https://github.com/pengzhendong/streaming-sensevoice)
- [api4sensevoice](https://github.com/0x5446/api4sensevoice)
- [SenseVoice.cpp](https://github.com/lovemefan/SenseVoice.cpp)
