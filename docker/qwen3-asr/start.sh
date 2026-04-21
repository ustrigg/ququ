#!/bin/bash
# Qwen3-ASR 启动脚本

echo "=============================================="
echo "Qwen3-ASR Server"
echo "=============================================="
echo "Model: ${MODEL_NAME}"
echo "Host: ${HOST}"
echo "Port: ${PORT}"
echo "GPU Memory Utilization: ${GPU_MEMORY_UTILIZATION}"
echo "=============================================="

# 检查 GPU
if ! nvidia-smi &> /dev/null; then
    echo "Warning: nvidia-smi not found. GPU may not be available."
fi

# 启动服务
exec python3 -m qwen_asr.serve \
    "${MODEL_NAME}" \
    --host "${HOST}" \
    --port "${PORT}" \
    --gpu-memory-utilization "${GPU_MEMORY_UTILIZATION}"
