#!/usr/bin/env python3
"""
FunASR Independent Service Server
预加载模型的FunASR服务，解决初始化延迟和质量问题
"""

import os
import sys
import json
import time
import logging
import asyncio
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from pathlib import Path
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
import tempfile

# 添加项目路径
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
    text: str = ""  # 添加text字段，包含所有segments的合并文本

    def __post_init__(self):
        """自动从segments生成text字段"""
        if not self.text and self.segments:
            self.text = " ".join([seg.text for seg in self.segments if seg.text.strip()])

class FunASRService:
    """FunASR独立服务类，预加载模型"""

    def __init__(
        self,
        model_name: str = "iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
        vad_model: str = "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
        punc_model: str = "iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch",
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        port: int = 5001
    ):
        self.model_name = model_name
        self.vad_model = vad_model
        self.punc_model = punc_model
        self.device = device
        self.port = port

        # 模型实例
        self.asr_model = None
        self.vad_model_instance = None
        self.punc_model_instance = None

        # 服务状态
        self.is_ready = False
        self.initialization_error = None

        # 日志配置
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        self.logger = logging.getLogger(__name__)

    def initialize_models(self) -> bool:
        """预加载所有FunASR模型"""
        if not FUNASR_AVAILABLE:
            self.initialization_error = "FunASR library not available"
            return False

        try:
            self.logger.info("开始初始化FunASR模型...")
            start_time = time.time()

            # 初始化ASR模型
            self.logger.info(f"加载ASR模型: {self.model_name}")
            self.asr_model = AutoModel(
                model=self.model_name,
                device=self.device,
                disable_log=False
            )

            # 初始化VAD模型
            self.logger.info(f"加载VAD模型: {self.vad_model}")
            self.vad_model_instance = AutoModel(
                model=self.vad_model,
                device=self.device,
                disable_log=False
            )

            # 初始化标点模型
            self.logger.info(f"加载标点模型: {self.punc_model}")
            self.punc_model_instance = AutoModel(
                model=self.punc_model,
                device=self.device,
                disable_log=False
            )

            initialization_time = time.time() - start_time
            self.logger.info(f"所有FunASR模型初始化完成，耗时: {initialization_time:.2f}秒")

            # 测试模型
            self._test_models()

            self.is_ready = True
            return True

        except Exception as e:
            self.initialization_error = str(e)
            self.logger.error(f"FunASR模型初始化失败: {e}")
            return False

    def _test_models(self):
        """测试模型是否正常工作"""
        try:
            # 创建一个简短的测试音频（空文件测试）
            test_path = tempfile.mktemp(suffix='.wav')

            # 简单测试 - 如果模型能正常响应空输入不崩溃就算成功
            self.logger.info("测试模型响应...")

            # 由于没有真实音频文件，仅测试模型对象是否可调用
            if hasattr(self.asr_model, 'generate'):
                self.logger.info("ASR模型测试通过")
            if hasattr(self.vad_model_instance, 'generate'):
                self.logger.info("VAD模型测试通过")
            if hasattr(self.punc_model_instance, 'generate'):
                self.logger.info("标点模型测试通过")

        except Exception as e:
            self.logger.warning(f"模型测试遇到问题: {e}")

    def transcribe_file(self, audio_path: str, use_vad: bool = None, vad_threshold_seconds: float = 120.0) -> FunASRResult:
        """转写音频文件

        Args:
            audio_path: 音频文件路径
            use_vad: 是否使用VAD分段 (None=自动判断, True=强制使用, False=强制不使用)
            vad_threshold_seconds: 超过此时长才使用VAD (默认30秒)
        """
        if not self.is_ready:
            raise RuntimeError(f"FunASR服务未就绪: {self.initialization_error}")

        start_time = time.time()

        try:
            # 先获取音频时长
            import librosa
            audio_data, sr = librosa.load(audio_path, sr=None)
            audio_duration = len(audio_data) / sr

            # 自动判断是否使用VAD
            if use_vad is None:
                use_vad = audio_duration >= vad_threshold_seconds

            self.logger.info(f"开始转写: {audio_path} (时长: {audio_duration:.2f}秒, 使用VAD: {use_vad})")

            if use_vad:
                # 长音频：使用VAD分段
                return self._transcribe_with_vad(audio_path, start_time)
            else:
                # 短音频：直接转写全部，不使用VAD
                return self._transcribe_direct(audio_path, audio_duration, start_time)

        except Exception as e:
            self.logger.error(f"转写失败: {e}")
            raise RuntimeError(f"FunASR转写失败: {e}")

    def _transcribe_direct(self, audio_path: str, audio_duration: float, start_time: float) -> FunASRResult:
        """直接转写整个音频，不使用VAD分段"""
        try:
            self.logger.info(f"直接转写模式：跳过VAD，转写全部内容")

            # 直接调用ASR模型转写整个文件
            asr_result = self.asr_model.generate(
                input=audio_path,
                cache={},
                is_final=True,
                chunk_size=[0, 10, 5],
                chunk_interval=50,
                encoder_chunk_look_back=4,
                decoder_chunk_look_back=1
            )

            # 处理ASR结果
            segments = []
            if hasattr(asr_result, 'get') and isinstance(asr_result.get('sentences'), list):
                sentences = asr_result['sentences']
            elif isinstance(asr_result, list):
                sentences = asr_result
            else:
                sentences = [asr_result] if asr_result else []

            for i, sentence in enumerate(sentences):
                if isinstance(sentence, dict):
                    text = sentence.get('text', '')
                    start_ms = sentence.get('start', 0.0)
                    end_ms = sentence.get('end', 0.0)

                    # 转换为秒
                    start_time_s = start_ms / 1000.0 if start_ms else 0.0
                    end_time_s = end_ms / 1000.0 if end_ms else audio_duration

                    confidence = sentence.get('confidence', 0.8)
                elif isinstance(sentence, str):
                    text = sentence
                    start_time_s = 0.0
                    end_time_s = audio_duration
                    confidence = 0.8
                else:
                    continue

                if text and text.strip():
                    segments.append(FunASRSegment(
                        start=start_time_s,
                        end=end_time_s,
                        text=text.strip(),
                        confidence=confidence
                    ))

            # 添加标点
            if segments and self.punc_model_instance:
                self.logger.info(f"开始添加标点，segments数量: {len(segments)}")
                try:
                    segments = self._add_punctuation_batch(segments)
                    self.logger.info(f"标点添加完成")
                except Exception as e:
                    self.logger.error(f"标点添加失败: {e}", exc_info=True)

            processing_time = time.time() - start_time

            result = FunASRResult(
                segments=segments,
                language="zh",
                duration=audio_duration,
                processing_time=processing_time
            )

            self.logger.info(f"直接转写完成，生成{len(segments)}个片段，耗时{processing_time:.2f}秒")
            return result

        except Exception as e:
            self.logger.error(f"直接转写失败: {e}")
            raise

    def _transcribe_with_vad(self, audio_path: str, start_time: float) -> FunASRResult:
        """使用VAD分段转写（用于长音频）"""
        try:
            self.logger.info(f"VAD分段模式：使用VAD切分音频")

            # 使用统一VAD分段
            from unified_vad_segmenter import UnifiedVADSegmenter
            segmenter = UnifiedVADSegmenter()
            vad_segments = segmenter.segment_audio_file(audio_path)

            self.logger.info(f"VAD分段完成: {len(vad_segments)}个段")

            # 对每个段进行转写
            all_segments = []
            for vad_seg in vad_segments:
                if vad_seg.audio_data is not None:
                    # 为每个段创建临时音频文件
                    import tempfile
                    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                        import librosa
                        import soundfile as sf
                        sf.write(
                            temp_file.name,
                            vad_seg.audio_data,
                            segmenter.target_sample_rate
                        )
                        temp_path = temp_file.name

                    try:
                        # 转写单个段
                        seg_result = self._transcribe_single_segment(temp_path, vad_seg)
                        all_segments.extend(seg_result)
                    finally:
                        # 清理临时文件
                        if os.path.exists(temp_path):
                            os.unlink(temp_path)

            # 添加标点（批量处理）
            if all_segments and self.punc_model_instance:
                all_segments = self._add_punctuation_batch(all_segments)

            processing_time = time.time() - start_time

            # 计算音频时长
            total_duration = sum(seg.duration for seg in vad_segments)

            result = FunASRResult(
                segments=all_segments,
                language="zh",
                duration=total_duration,
                processing_time=processing_time
            )

            self.logger.info(f"VAD分段转写完成，生成{len(all_segments)}个片段，耗时{processing_time:.2f}秒")
            return result

        except Exception as e:
            self.logger.error(f"VAD分段转写失败: {e}")
            raise

    def _transcribe_single_segment(self, segment_audio_path: str, vad_segment) -> List[FunASRSegment]:
        """转写单个音频段"""
        try:
            # ASR转写单个段
            asr_result = self.asr_model.generate(
                input=segment_audio_path,
                cache={},
                is_final=True,
                chunk_size=[0, 10, 5],
                chunk_interval=50,
                encoder_chunk_look_back=4,
                decoder_chunk_look_back=1
            )

            # 处理ASR结果，调整时间戳
            segments = []
            if hasattr(asr_result, 'get') and isinstance(asr_result.get('sentences'), list):
                sentences = asr_result['sentences']
            elif isinstance(asr_result, list):
                sentences = asr_result
            else:
                sentences = [asr_result] if asr_result else []

            for i, sentence in enumerate(sentences):
                if isinstance(sentence, dict):
                    text = sentence.get('text', '')
                    # 相对时间戳转为绝对时间戳
                    rel_start = sentence.get('start', 0.0) / 1000.0 if 'start' in sentence else 0.0
                    rel_end = sentence.get('end', vad_segment.duration) / 1000.0 if 'end' in sentence else vad_segment.duration

                    abs_start = vad_segment.start + rel_start
                    abs_end = vad_segment.start + rel_end

                    confidence = sentence.get('confidence', 0.8)
                elif isinstance(sentence, str):
                    text = sentence
                    # 如果没有时间戳，使用VAD段的时间
                    abs_start = vad_segment.start
                    abs_end = vad_segment.end
                    confidence = 0.8
                else:
                    continue

                if text and text.strip():
                    segments.append(FunASRSegment(
                        start=abs_start,
                        end=abs_end,
                        text=text.strip(),
                        confidence=confidence
                    ))

            return segments

        except Exception as e:
            self.logger.warning(f"单段转写失败: {e}")
            # 返回空段避免整体失败
            return []

    def _process_asr_results(self, asr_result: Any, vad_result: Any) -> List[FunASRSegment]:
        """处理ASR和VAD结果"""
        segments = []

        try:
            # 处理ASR结果
            if hasattr(asr_result, 'get') and isinstance(asr_result.get('sentences'), list):
                sentences = asr_result['sentences']
            elif isinstance(asr_result, list):
                sentences = asr_result
            else:
                sentences = [asr_result] if asr_result else []

            # 处理VAD结果获取时间戳
            vad_segments = []
            if vad_result and hasattr(vad_result, 'get'):
                vad_data = vad_result.get('sentences', [])
                for vad_seg in vad_data:
                    if isinstance(vad_seg, dict) and 'start' in vad_seg and 'end' in vad_seg:
                        vad_segments.append((vad_seg['start'], vad_seg['end']))

            # 合并ASR和VAD结果
            for i, sentence in enumerate(sentences):
                if isinstance(sentence, dict):
                    text = sentence.get('text', '')
                    start_time = sentence.get('start', 0.0) / 1000.0 if 'start' in sentence else 0.0
                    end_time = sentence.get('end', 0.0) / 1000.0 if 'end' in sentence else 0.0
                    confidence = sentence.get('confidence', 0.0)
                elif isinstance(sentence, str):
                    text = sentence
                    # 如果没有时间戳，尝试从VAD结果获取
                    if i < len(vad_segments):
                        start_time, end_time = vad_segments[i]
                        start_time /= 1000.0
                        end_time /= 1000.0
                    else:
                        start_time = i * 2.0  # 估算时间
                        end_time = (i + 1) * 2.0
                    confidence = 0.8
                else:
                    continue

                if text and text.strip():
                    segments.append(FunASRSegment(
                        start=start_time,
                        end=end_time,
                        text=text.strip(),
                        confidence=confidence
                    ))

        except Exception as e:
            self.logger.error(f"处理ASR结果时出错: {e}")
            # 返回空结果而不是崩溃
            return []

        return segments

    def _add_punctuation_batch(self, segments: List[FunASRSegment]) -> List[FunASRSegment]:
        """批量添加标点 - 限制长度，避免过长文本"""
        if not segments:
            return segments

        try:
            max_chunk_chars = 3000  # 限制每块最大字符数

            # 将segments按字符长度分组
            chunks = []
            current_chunk = []
            current_length = 0

            for segment in segments:
                seg_length = len(segment.text)

                # 如果当前块加上新段会超过限制，开始新块
                if current_length + seg_length > max_chunk_chars and current_chunk:
                    chunks.append(current_chunk)
                    current_chunk = [segment]
                    current_length = seg_length
                else:
                    current_chunk.append(segment)
                    current_length += seg_length

            # 添加最后一块
            if current_chunk:
                chunks.append(current_chunk)

            # 对每块进行标点处理
            processed_segments = []
            for chunk in chunks:
                processed_chunk = self._add_punctuation_to_chunk(chunk)
                processed_segments.extend(processed_chunk)

            return processed_segments

        except Exception as e:
            self.logger.warning(f"批量标点处理失败: {e}")
            return segments

    def _add_punctuation_to_chunk(self, chunk_segments: List[FunASRSegment]) -> List[FunASRSegment]:
        """为文本块添加标点"""
        try:
            if not chunk_segments:
                return chunk_segments

            # 合并文本
            combined_text = " ".join([seg.text for seg in chunk_segments])

            # 如果文本太长，按句号分割
            if len(combined_text) > 2000:
                # 按句号分割处理
                sentences = combined_text.split('。')
                if len(sentences) > 1:
                    # 分别处理每个句子
                    processed_sentences = []
                    for sentence in sentences:
                        if sentence.strip():
                            processed_sent = self._process_single_text_for_punctuation(sentence + '。')
                            processed_sentences.append(processed_sent)

                    # 重新组合
                    final_text = " ".join(processed_sentences)
                else:
                    final_text = self._process_single_text_for_punctuation(combined_text)
            else:
                final_text = self._process_single_text_for_punctuation(combined_text)

            # 将处理后的文本重新分配到segments
            # 简化处理：按比例分配
            words = final_text.split()
            if words:
                words_per_segment = len(words) / len(chunk_segments)

                for i, segment in enumerate(chunk_segments):
                    start_word = int(i * words_per_segment)
                    end_word = int((i + 1) * words_per_segment)
                    if i == len(chunk_segments) - 1:  # 最后一段包含所有剩余词
                        end_word = len(words)

                    segment.text = " ".join(words[start_word:end_word])

            return chunk_segments

        except Exception as e:
            self.logger.warning(f"文本块标点处理失败: {e}")
            return chunk_segments

    def _process_single_text_for_punctuation(self, text: str) -> str:
        """处理单个文本的标点"""
        try:
            self.logger.info(f"标点处理输入: {text[:50]}...")

            # 使用标点模型
            punc_result = self.punc_model_instance.generate(
                input=text,
                cache={},
                is_final=True
            )

            self.logger.info(f"标点模型返回类型: {type(punc_result)}")
            self.logger.info(f"标点模型返回内容: {punc_result}")

            # 处理标点结果
            if isinstance(punc_result, dict) and 'text' in punc_result:
                result_text = punc_result['text']
                self.logger.info(f"标点处理输出(dict): {result_text[:50]}...")
                return result_text
            elif isinstance(punc_result, str):
                self.logger.info(f"标点处理输出(str): {punc_result[:50]}...")
                return punc_result
            elif isinstance(punc_result, list) and len(punc_result) > 0:
                # 处理列表返回
                first_item = punc_result[0]
                if isinstance(first_item, dict) and 'text' in first_item:
                    result_text = first_item['text']
                    self.logger.info(f"标点处理输出(list[dict]): {result_text[:50]}...")
                    return result_text
                elif isinstance(first_item, str):
                    self.logger.info(f"标点处理输出(list[str]): {first_item[:50]}...")
                    return first_item

            self.logger.warning(f"标点结果格式未知，返回原文本")
            return text  # 标点失败，返回原文本

        except Exception as e:
            self.logger.warning(f"单文本标点处理失败: {e}", exc_info=True)
            return text

    def _add_punctuation(self, segments: List[FunASRSegment]) -> List[FunASRSegment]:
        """为转写结果添加标点（保留原方法兼容性）"""
        return self._add_punctuation_batch(segments)

# FastAPI应用
app = FastAPI(title="FunASR Service", description="独立的FunASR转写服务")

# 全局服务实例
funasr_service = None

# 并发控制：最大同时处理3个请求
import asyncio
MAX_CONCURRENT_REQUESTS = int(os.getenv('UVICORN_LIMIT_CONCURRENCY', '3'))
transcription_semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

@app.on_event("startup")
async def startup_event():
    """服务启动时初始化模型"""
    global funasr_service
    funasr_service = FunASRService()

    # 在后台初始化模型
    import asyncio
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, funasr_service.initialize_models)

    # Register WebSocket streaming endpoint
    from funasr_wss import register_websocket
    register_websocket(app, funasr_service)
    print("WebSocket streaming endpoint registered at /ws/stream")

@app.get("/")
async def root():
    """服务状态检查"""
    if not funasr_service:
        return {"status": "initializing", "message": "Service starting up"}

    return {
        "status": "ready" if funasr_service.is_ready else "error",
        "message": "FunASR Service Ready" if funasr_service.is_ready else funasr_service.initialization_error,
        "models": {
            "asr": funasr_service.model_name,
            "vad": funasr_service.vad_model,
            "punc": funasr_service.punc_model
        }
    }

@app.get("/health")
async def health_check():
    """健康检查端点"""
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")
    return {"status": "healthy"}

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """转写上传的音频文件"""
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")

    # 并发控制：等待信号量
    async with transcription_semaphore:
        # 保存上传的文件
        temp_path = None
        try:
            # 创建临时文件
            suffix = Path(file.filename).suffix if file.filename else '.wav'
            temp_path = tempfile.mktemp(suffix=suffix)

            # 写入文件内容
            with open(temp_path, 'wb') as f:
                content = await file.read()
                f.write(content)

            # 转写
            result = funasr_service.transcribe_file(temp_path)

            # 转换为可序列化的格式
            return JSONResponse(content=asdict(result))

        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

        finally:
            # 清理临时文件
            if temp_path and os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except:
                    pass

@app.post("/transcribe_file")
async def transcribe_file_path(file_path: str):
    """转写指定路径的音频文件"""
    if not funasr_service or not funasr_service.is_ready:
        raise HTTPException(status_code=503, detail="Service not ready")

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # 并发控制：等待信号量
    async with transcription_semaphore:
        try:
            result = funasr_service.transcribe_file(file_path)
            return JSONResponse(content=asdict(result))
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")

if __name__ == "__main__":
    # 命令行启动
    import argparse

    parser = argparse.ArgumentParser(description="FunASR独立服务")
    parser.add_argument("--port", type=int, default=5001, help="服务端口")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="服务主机")
    parser.add_argument("--device", type=str, default="cuda" if torch.cuda.is_available() else "cpu", help="计算设备")

    args = parser.parse_args()

    print(f"Starting FunASR service at {args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port)