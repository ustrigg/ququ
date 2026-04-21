#!/usr/bin/env python3
"""
FunASR SenseVoice Service - 高速语音识别服务
使用 SenseVoice-Small 模型，内置标点和情感识别，速度比 Paraformer 快 3-5 倍
"""

import os
import sys
import json
import time
import logging
import asyncio
import re
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from pathlib import Path
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import tempfile

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from funasr import AutoModel
    import torch
    FUNASR_AVAILABLE = True
except ImportError:
    FUNASR_AVAILABLE = False
    print("Warning: FunASR not available")

@dataclass
class FunASRSegment:
    start: float
    end: float
    text: str
    speaker: Optional[str] = None
    confidence: float = 0.0

@dataclass
class FunASRResult:
    segments: List[FunASRSegment]
    language: str = "zh"
    duration: float = 0.0
    processing_time: float = 0.0
    text: str = ""

    def __post_init__(self):
        if not self.text and self.segments:
            self.text = "".join([seg.text for seg in self.segments if seg.text.strip()])


class SenseVoiceService:
    """SenseVoice-Small 语音识别服务"""

    def __init__(
        self,
        model_name: str = "iic/SenseVoiceSmall",
        vad_model: str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        port: int = 5001
    ):
        self.model_name = model_name
        self.vad_model = vad_model
        self.device = device
        self.port = port

        self.asr_model = None
        self.is_ready = False
        self.initialization_error = None

        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

    def initialize_models(self) -> bool:
        """预加载 SenseVoice 模型"""
        if not FUNASR_AVAILABLE:
            self.initialization_error = "FunASR library not available"
            return False

        try:
            self.logger.info("="*60)
            self.logger.info(f"初始化 SenseVoice 模型...")
            self.logger.info(f"设备: {self.device}")
            if self.device == "cuda":
                self.logger.info(f"GPU: {torch.cuda.get_device_name(0)}")
                self.logger.info(f"显存: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")
            start_time = time.time()

            # SenseVoice-Small: 内置 VAD + 标点 + 情感，一个模型搞定
            self.logger.info(f"加载模型: {self.model_name}")
            self.asr_model = AutoModel(
                model=self.model_name,
                vad_model=self.vad_model,
                vad_kwargs={"max_single_segment_time": 30000},
                trust_remote_code=True,
                device=self.device,
                disable_log=False
            )

            init_time = time.time() - start_time
            self.logger.info(f"模型加载完成，耗时: {init_time:.2f}秒")
            self.logger.info("="*60)

            self.is_ready = True
            return True

        except Exception as e:
            self.initialization_error = str(e)
            self.logger.error(f"模型初始化失败: {e}", exc_info=True)
            return False

    @staticmethod
    def clean_sensevoice_tags(text: str) -> str:
        """清理 SenseVoice 输出中的特殊标记 (如 <|zh|><|NEUTRAL|><|Speech|> 等)"""
        # 移除所有 <|...|> 标记
        cleaned = re.sub(r'<\|[^|]*\|>', '', text)
        return cleaned.strip()

    def transcribe_file(self, audio_path: str) -> FunASRResult:
        """转写音频文件"""
        if not self.is_ready:
            raise RuntimeError(f"服务未就绪: {self.initialization_error}")

        start_time = time.time()

        try:
            # 获取音频时长
            import librosa
            audio_data, sr = librosa.load(audio_path, sr=None)
            audio_duration = len(audio_data) / sr

            self.logger.info(f"开始转写: {audio_path} (时长: {audio_duration:.2f}s, 设备: {self.device})")

            # SenseVoice 一次调用完成：VAD分段 + ASR + 标点
            result = self.asr_model.generate(
                input=audio_path,
                cache={},
                language="auto",
                use_itn=True,
                batch_size_s=60,
            )

            # 解析结果
            segments = []
            if isinstance(result, list):
                for item in result:
                    if isinstance(item, dict):
                        text = self.clean_sensevoice_tags(item.get('text', ''))
                        if text.strip():
                            segments.append(FunASRSegment(
                                start=item.get('start', 0) / 1000.0 if 'start' in item else 0.0,
                                end=item.get('end', 0) / 1000.0 if 'end' in item else audio_duration,
                                text=text.strip(),
                                confidence=item.get('confidence', 0.9)
                            ))
                    elif isinstance(item, str):
                        cleaned = self.clean_sensevoice_tags(item)
                        if cleaned.strip():
                            segments.append(FunASRSegment(
                                start=0.0,
                                end=audio_duration,
                                text=cleaned.strip(),
                                confidence=0.9
                            ))

            processing_time = time.time() - start_time
            rtf = processing_time / audio_duration if audio_duration > 0 else 0

            self.logger.info(
                f"转写完成: {len(segments)}个片段, "
                f"耗时{processing_time:.2f}s, "
                f"RTF={rtf:.3f} ({1/rtf:.0f}x实时)" if rtf > 0 else ""
            )

            return FunASRResult(
                segments=segments,
                language="zh",
                duration=audio_duration,
                processing_time=processing_time
            )

        except Exception as e:
            self.logger.error(f"转写失败: {e}", exc_info=True)
            raise RuntimeError(f"转写失败: {e}")


# FastAPI 应用
app = FastAPI(title="SenseVoice ASR Service")

funasr_service = None

MAX_CONCURRENT = int(os.getenv('UVICORN_LIMIT_CONCURRENCY', '3'))
transcription_semaphore = asyncio.Semaphore(MAX_CONCURRENT)


@app.on_event("startup")
async def startup_event():
    global funasr_service
    funasr_service = SenseVoiceService()
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, funasr_service.initialize_models)

    # 注册 WebSocket 端点（兼容旧客户端）
    try:
        from funasr_wss import register_websocket
        register_websocket(app, funasr_service)
        print("WebSocket endpoint registered at /ws/stream")
    except ImportError:
        print("WebSocket module not found, HTTP-only mode")


@app.get("/")
async def root():
    if not funasr_service:
        return {"status": "initializing"}
    return {
        "status": "ready" if funasr_service.is_ready else "error",
        "message": "SenseVoice Service Ready" if funasr_service.is_ready else funasr_service.initialization_error,
        "models": {
            "asr": funasr_service.model_name,
            "vad": funasr_service.vad_model,
            "punc": "built-in (SenseVoice)"
        },
        "device": funasr_service.device
    }


@app.get("/health")
async def health_check():
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")
    return {"status": "healthy"}


@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")

    async with transcription_semaphore:
        temp_path = None
        try:
            suffix = Path(file.filename).suffix if file.filename else '.wav'
            temp_path = tempfile.mktemp(suffix=suffix)
            with open(temp_path, 'wb') as f:
                content = await file.read()
                f.write(content)

            # 在线程池中执行转写（避免阻塞事件循环）
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, funasr_service.transcribe_file, temp_path)
            return JSONResponse(content=asdict(result))

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except:
                    pass


@app.post("/transcribe_file")
async def transcribe_file_path(file_path: str):
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    async with transcription_semaphore:
        try:
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(None, funasr_service.transcribe_file, file_path)
            return JSONResponse(content=asdict(result))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="SenseVoice ASR Service")
    parser.add_argument("--port", type=int, default=5001)
    parser.add_argument("--host", type=str, default="0.0.0.0")
    args = parser.parse_args()

    print(f"Starting SenseVoice service at {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)
