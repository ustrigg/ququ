#!/usr/bin/env python3
"""
统一VAD分段器
统一切段：VAD出段后固定用同一段列表给FunASR/WhisperX/标点/分离
防止FunASR吞整段，强制长音频分段转写
"""

import os
import sys
import json
import logging
import numpy as np
import librosa
import torch
from typing import Dict, List, Tuple, Optional
from dataclasses import dataclass
import tempfile
from pathlib import Path

@dataclass
class VADSegment:
    """VAD分段信息"""
    start: float
    end: float
    duration: float
    audio_data: Optional[np.ndarray] = None
    sample_rate: int = 16000
    segment_id: int = 0

class UnifiedVADSegmenter:
    """统一VAD分段器"""

    def __init__(
        self,
        max_segment_duration: float = 45.0,  # 最大段长度45秒
        min_segment_duration: float = 0.3,   # 最小段长度0.3秒（降低以捕获短语）
        overlap_duration: float = 0.5,       # 段间重叠0.5秒
        target_sample_rate: int = 16000,
        speech_pad_ms: float = 700           # 语音段前后padding 700ms（增加保护）
    ):
        self.max_segment_duration = max_segment_duration
        self.min_segment_duration = min_segment_duration
        self.overlap_duration = overlap_duration
        self.target_sample_rate = target_sample_rate
        self.speech_pad_ms = speech_pad_ms

        self.logger = logging.getLogger(__name__)

        # 初始化Silero VAD
        self._init_silero_vad()

    def _init_silero_vad(self):
        """初始化Silero VAD模型"""
        try:
            # 使用torch hub加载Silero VAD
            self.vad_model, _ = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            self.vad_model.eval()
            self.logger.info("[OK] Silero VAD模型初始化成功")
        except Exception as e:
            self.logger.error(f"Silero VAD初始化失败: {e}")
            self.vad_model = None

    def segment_audio_file(self, audio_path: str) -> List[VADSegment]:
        """对音频文件进行统一VAD分段"""
        try:
            self.logger.info(f"[VAD] 开始统一分段: {audio_path}")

            # 加载音频
            audio_data, original_sr = librosa.load(audio_path, sr=None)

            # 重采样到目标采样率
            if original_sr != self.target_sample_rate:
                audio_data = librosa.resample(
                    audio_data,
                    orig_sr=original_sr,
                    target_sr=self.target_sample_rate
                )

            # 获取音频总时长
            total_duration = len(audio_data) / self.target_sample_rate
            self.logger.info(f"[VAD] 音频总时长: {total_duration:.2f}秒")

            # 执行VAD检测
            vad_segments = self._detect_speech_segments(audio_data)

            # 强制分段：确保每段不超过最大时长
            final_segments = self._enforce_max_duration(vad_segments, audio_data)

            self.logger.info(f"[VAD] 统一分段完成: {len(final_segments)}个段")
            return final_segments

        except Exception as e:
            self.logger.error(f"[VAD] 分段失败: {e}")
            raise

    def _detect_speech_segments(self, audio_data: np.ndarray) -> List[VADSegment]:
        """使用Silero VAD检测语音段"""
        if self.vad_model is None:
            # 如果VAD模型不可用，使用简单的能量分割
            return self._energy_based_segmentation(audio_data)

        try:
            # 将numpy转为torch tensor
            audio_tensor = torch.from_numpy(audio_data).float()

            # VAD检测 - 使用更保守的参数避免丢字
            speech_timestamps = self.vad_model(
                audio_tensor,
                sampling_rate=self.target_sample_rate,
                threshold=0.2,                    # 从0.3降低到0.2（更敏感）
                min_speech_duration_ms=150,       # 从250降低到150（捕获更短语音）
                min_silence_duration_ms=200,      # 从100增加到200（减少误切）
                speech_pad_ms=700                 # 从500增加到700（更多padding）
            )

            # 计算音频总时长
            total_duration = len(audio_data) / self.target_sample_rate

            segments = []
            for i, timestamp in enumerate(speech_timestamps):
                start_time = timestamp['start'] / self.target_sample_rate
                end_time = timestamp['end'] / self.target_sample_rate

                # 确保时间在有效范围内
                start_time = max(0.0, start_time)
                end_time = min(total_duration, end_time)

                duration = end_time - start_time

                if duration >= self.min_segment_duration:
                    segments.append(VADSegment(
                        start=start_time,
                        end=end_time,
                        duration=duration,
                        segment_id=i
                    ))

            self.logger.info(f"[VAD] Silero检测到 {len(segments)} 个语音段 (threshold=0.3, padding={self.speech_pad_ms}ms)")
            return segments

        except Exception as e:
            self.logger.warning(f"Silero VAD失败，使用能量分割: {e}")
            return self._energy_based_segmentation(audio_data)

    def _energy_based_segmentation(self, audio_data: np.ndarray) -> List[VADSegment]:
        """基于能量的简单分割（备用方案）"""
        # 计算短时能量
        frame_length = int(0.025 * self.target_sample_rate)  # 25ms帧
        hop_length = int(0.01 * self.target_sample_rate)     # 10ms跳跃

        energy = librosa.feature.rms(
            y=audio_data,
            frame_length=frame_length,
            hop_length=hop_length
        )[0]

        # 能量阈值
        energy_threshold = np.mean(energy) * 0.3

        # 检测语音段
        speech_frames = energy > energy_threshold

        # 转换为时间段
        segments = []
        in_speech = False
        start_frame = 0

        for i, is_speech in enumerate(speech_frames):
            if is_speech and not in_speech:
                # 语音开始
                start_frame = i
                in_speech = True
            elif not is_speech and in_speech:
                # 语音结束
                start_time = start_frame * hop_length / self.target_sample_rate
                end_time = i * hop_length / self.target_sample_rate
                duration = end_time - start_time

                if duration >= self.min_segment_duration:
                    segments.append(VADSegment(
                        start=start_time,
                        end=end_time,
                        duration=duration,
                        segment_id=len(segments)
                    ))
                in_speech = False

        # 处理最后一段
        if in_speech:
            start_time = start_frame * hop_length / self.target_sample_rate
            end_time = len(audio_data) / self.target_sample_rate
            duration = end_time - start_time

            if duration >= self.min_segment_duration:
                segments.append(VADSegment(
                    start=start_time,
                    end=end_time,
                    duration=duration,
                    segment_id=len(segments)
                ))

        self.logger.info(f"[VAD] 能量分割检测到 {len(segments)} 个语音段")
        return segments

    def _enforce_max_duration(self, segments: List[VADSegment], audio_data: np.ndarray) -> List[VADSegment]:
        """强制最大时长分段：确保每段≤45秒"""
        final_segments = []

        for segment in segments:
            if segment.duration <= self.max_segment_duration:
                # 段长度符合要求，直接添加音频数据
                start_sample = int(segment.start * self.target_sample_rate)
                end_sample = int(segment.end * self.target_sample_rate)
                segment.audio_data = audio_data[start_sample:end_sample]
                final_segments.append(segment)
            else:
                # 段太长，需要分割
                sub_segments = self._split_long_segment(segment, audio_data)
                final_segments.extend(sub_segments)

        # 重新编号
        for i, segment in enumerate(final_segments):
            segment.segment_id = i

        self.logger.info(f"[VAD] 强制分段后: {len(final_segments)} 个段")
        return final_segments

    def _split_long_segment(self, segment: VADSegment, audio_data: np.ndarray) -> List[VADSegment]:
        """分割过长的段"""
        sub_segments = []

        # 计算需要分割的子段数
        num_splits = int(np.ceil(segment.duration / self.max_segment_duration))
        sub_duration = segment.duration / num_splits

        for i in range(num_splits):
            sub_start = segment.start + i * sub_duration
            sub_end = min(segment.start + (i + 1) * sub_duration, segment.end)

            # 添加重叠（除了最后一段）
            if i < num_splits - 1:
                sub_end = min(sub_end + self.overlap_duration, segment.end)

            # 提取音频数据
            start_sample = int(sub_start * self.target_sample_rate)
            end_sample = int(sub_end * self.target_sample_rate)
            sub_audio_data = audio_data[start_sample:end_sample]

            sub_segment = VADSegment(
                start=sub_start,
                end=sub_end,
                duration=sub_end - sub_start,
                audio_data=sub_audio_data,
                segment_id=len(sub_segments)
            )
            sub_segments.append(sub_segment)

        self.logger.info(f"[VAD] 长段分割: {segment.duration:.1f}s -> {len(sub_segments)}个子段")
        return sub_segments

    def save_segments_to_files(self, segments: List[VADSegment], output_dir: str, base_name: str) -> List[str]:
        """将分段保存为临时音频文件"""
        output_dir = Path(output_dir)
        output_dir.mkdir(exist_ok=True)

        segment_files = []

        for segment in segments:
            if segment.audio_data is not None:
                # 生成分段文件名
                segment_filename = f"{base_name}_seg_{segment.segment_id:03d}_{segment.start:.1f}s-{segment.end:.1f}s.wav"
                segment_path = output_dir / segment_filename

                # 保存音频文件
                import soundfile as sf
                sf.write(
                    str(segment_path),
                    segment.audio_data,
                    self.target_sample_rate
                )

                segment_files.append(str(segment_path))

        self.logger.info(f"[VAD] 保存了 {len(segment_files)} 个分段文件")
        return segment_files

    def get_segment_info(self, segments: List[VADSegment]) -> Dict:
        """获取分段统计信息"""
        if not segments:
            return {"total_segments": 0}

        durations = [seg.duration for seg in segments]

        return {
            "total_segments": len(segments),
            "total_duration": sum(durations),
            "avg_duration": np.mean(durations),
            "min_duration": np.min(durations),
            "max_duration": np.max(durations),
            "segments_over_max": len([d for d in durations if d > self.max_segment_duration]),
            "segments_under_min": len([d for d in durations if d < self.min_segment_duration])
        }

def test_unified_vad():
    """测试统一VAD分段器"""
    segmenter = UnifiedVADSegmenter()

    # 测试音频文件
    test_audio = "transcripts/HA69B1164B7274/2025-09-26T14-18-29L.opus"

    if os.path.exists(test_audio):
        segments = segmenter.segment_audio_file(test_audio)

        # 输出统计信息
        stats = segmenter.get_segment_info(segments)
        print(f"分段统计: {json.dumps(stats, indent=2, ensure_ascii=False)}")

        # 保存分段文件
        output_dir = tempfile.mkdtemp(prefix="vad_segments_")
        segment_files = segmenter.save_segments_to_files(
            segments, output_dir, "test_audio"
        )

        print(f"分段文件保存在: {output_dir}")
        print(f"分段文件数量: {len(segment_files)}")

    else:
        print("测试音频文件不存在")

if __name__ == "__main__":
    test_unified_vad()