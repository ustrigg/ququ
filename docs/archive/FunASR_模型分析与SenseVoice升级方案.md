# FunASR 模型分析与 SenseVoice 升级方案

## 当前配置

| 组件 | 模型 | 大小 |
|------|------|------|
| ASR | `speech_paraformer-large` (vocab8404) | 848MB |
| VAD | `speech_fsmn_vad` | 3.9MB |
| 标点 | `punc_ct-transformer` (vocab272727) | 283MB |
| **总计** | 3个模型串行处理 | **1.1GB** |

**运行环境**: Docker 容器, **CPU 模式**（CUDA 不可用！）

## 慢的根本原因

1. **Paraformer-Large 是 220M 参数的大模型**，在 CPU 上推理很慢
2. **三模型串行流水线**: ASR → VAD → 标点，每个都要单独推理
3. **容器没有 GPU 直通**：`CUDA: False`，所有计算跑在 CPU 上

## SenseVoice 方案对比

| | Paraformer-Large (当前) | SenseVoice-Small |
|---|---|---|
| 参数量 | 220M | 234M |
| 架构 | Encoder-Decoder | 非自回归，单次前向 |
| 推理速度 | ~1x 实时 (CPU) | **比 Whisper-Large 快 5倍** |
| 内置标点 | 需要单独标点模型 | **内置富文本标记** |
| 内置 VAD | 无 | **SenseVoice 内置** |
| 流水线 | ASR+VAD+标点=3个模型 | **1个模型搞定** |
| 语言 | 中文为主 | 中/英/日/韩/粤 50+语言 |
| ModelScope ID | `iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch` | `iic/SenseVoiceSmall` |

**结论**: SenseVoice-Small 是明确的升级选择：
- 速度：单模型 vs 三模型串行，CPU 上快 3-5 倍
- 质量：富文本输出含标点，无需单独标点模型
- 简化：去掉 VAD + 标点模型，减少 283MB 依赖

## 升级方案

### 修改 `funasr_service.py`

将 ASR 模型从 Paraformer 换为 SenseVoice，去掉独立标点模型：

```python
# 旧
model_name = "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
vad_model = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"
punc_model = "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch"

# 新
model_name = "iic/SenseVoiceSmall"
vad_model = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch"  # 保留 VAD 用于长音频分段
punc_model = None  # SenseVoice 内置标点，不需要了
```

### 进一步加速：启用 GPU

容器当前 `CUDA: False`。如果启用 GPU 直通（`--gpus all`），SenseVoice-Small 在 GPU 上可达 **25倍实时速度**。

---
*分析日期: 2026-03-30*
