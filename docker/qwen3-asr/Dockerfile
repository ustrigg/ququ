# Qwen3-ASR Docker Image
# 基于 vLLM 运行 Qwen3-ASR 语音识别服务
#
# Build:
#   docker build -t qwen3-asr .
#
# Run:
#   docker run --gpus all -p 8002:8002 qwen3-asr

FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV HF_HOME=/root/.cache/huggingface

# 安装系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-dev \
    git \
    wget \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# 升级 pip
RUN pip3 install --no-cache-dir --upgrade pip

# 安装 PyTorch (CUDA 12.1)
RUN pip3 install --no-cache-dir \
    torch==2.3.0 \
    torchaudio==2.3.0 \
    --index-url https://download.pytorch.org/whl/cu121

# 安装 vLLM 和 qwen-asr
RUN pip3 install --no-cache-dir \
    vllm>=0.5.0 \
    qwen-asr \
    transformers \
    accelerate \
    soundfile \
    librosa

# 创建工作目录
WORKDIR /app

# 复制启动脚本
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

# 暴露端口
EXPOSE 8002

# 默认模型
ENV MODEL_NAME="Qwen/Qwen3-ASR-1.7B"
ENV HOST="0.0.0.0"
ENV PORT="8002"
ENV GPU_MEMORY_UTILIZATION="0.9"

# 启动命令
CMD ["/app/start.sh"]
