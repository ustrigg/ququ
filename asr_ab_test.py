#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASR A/B 测试工具
同时调用 FunASR SenseVoice 和 Qwen3-ASR，对比识别结果与延迟

用法:
  python asr_ab_test.py recording.wav
  python asr_ab_test.py --dir recordings/
  python asr_ab_test.py --live    # 实时录 5 秒测试
"""
import argparse
import time
import json
import os
import sys
import requests
from pathlib import Path
from datetime import datetime

FUNASR_URL = "http://localhost:8001/transcribe"
QWEN3_URL = "http://localhost:8002/v1/audio/transcriptions"
QWEN3_MODEL = "Qwen/Qwen3-ASR-1.7B"


def transcribe_funasr(wav_path: str) -> dict:
    """FunASR SenseVoice 转写"""
    t0 = time.time()
    try:
        with open(wav_path, "rb") as f:
            r = requests.post(
                f"{FUNASR_URL}?use_vad=false&sentence_timestamp=true",
                files={"file": ("audio.wav", f, "audio/wav")},
                timeout=30,
            )
        elapsed = time.time() - t0
        if r.status_code == 200:
            data = r.json()
            text = data.get("text", "") or " ".join(
                s.get("text", "") for s in data.get("segments", [])
            )
            return {"ok": True, "text": text.strip(), "latency_ms": elapsed * 1000}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:100]}",
                "latency_ms": elapsed * 1000}
    except Exception as e:
        return {"ok": False, "error": str(e), "latency_ms": (time.time() - t0) * 1000}


def transcribe_qwen3(wav_path: str) -> dict:
    """Qwen3-ASR 转写（OpenAI 兼容 API）"""
    t0 = time.time()
    try:
        with open(wav_path, "rb") as f:
            r = requests.post(
                QWEN3_URL,
                files={"file": ("audio.wav", f, "audio/wav")},
                data={"model": QWEN3_MODEL, "language": "zh"},
                timeout=60,
            )
        elapsed = time.time() - t0
        if r.status_code == 200:
            data = r.json()
            text = data.get("text", "")
            return {"ok": True, "text": text.strip(), "latency_ms": elapsed * 1000}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:100]}",
                "latency_ms": elapsed * 1000}
    except Exception as e:
        return {"ok": False, "error": str(e), "latency_ms": (time.time() - t0) * 1000}


def test_one(wav_path: str) -> dict:
    """对单个音频做 A/B 测试"""
    print(f"\n{'=' * 70}")
    print(f"音频: {wav_path}")
    file_size = os.path.getsize(wav_path)
    print(f"大小: {file_size / 1024:.1f} KB")

    # 并行调用两个（为了公平，串行运行，各自独占 GPU）
    print("\n[FunASR SenseVoice]")
    r1 = transcribe_funasr(wav_path)
    if r1["ok"]:
        print(f"  延迟: {r1['latency_ms']:.0f} ms")
        print(f"  文本: {r1['text']}")
    else:
        print(f"  ❌ 失败: {r1['error']}")

    print("\n[Qwen3-ASR]")
    r2 = transcribe_qwen3(wav_path)
    if r2["ok"]:
        print(f"  延迟: {r2['latency_ms']:.0f} ms")
        print(f"  文本: {r2['text']}")
    else:
        print(f"  ❌ 失败: {r2['error']}")

    # 并排对比
    if r1["ok"] and r2["ok"]:
        print("\n--- 对比 ---")
        print(f"  延迟:  FunASR {r1['latency_ms']:.0f}ms  vs  Qwen3 {r2['latency_ms']:.0f}ms"
              f"  (Qwen3 慢 {r2['latency_ms'] / r1['latency_ms']:.1f}x)")
        if r1["text"] == r2["text"]:
            print("  识别:  完全一致 ✓")
        else:
            print(f"  FunASR: {r1['text']}")
            print(f"  Qwen3:  {r2['text']}")

    return {"file": wav_path, "funasr": r1, "qwen3": r2}


def test_dir(dir_path: str):
    """批量测试目录下所有 wav/webm"""
    p = Path(dir_path)
    files = sorted(list(p.glob("*.wav")) + list(p.glob("*.webm")))
    if not files:
        print(f"目录 {dir_path} 下没有 wav/webm 文件")
        return

    print(f"找到 {len(files)} 个文件")
    results = []
    for f in files:
        r = test_one(str(f))
        results.append(r)

    # 统计
    print(f"\n{'=' * 70}")
    print("总结:")
    funasr_lat = [r["funasr"]["latency_ms"] for r in results if r["funasr"]["ok"]]
    qwen3_lat = [r["qwen3"]["latency_ms"] for r in results if r["qwen3"]["ok"]]
    if funasr_lat:
        print(f"  FunASR 成功 {len(funasr_lat)}/{len(files)}, 平均延迟 {sum(funasr_lat) / len(funasr_lat):.0f}ms")
    if qwen3_lat:
        print(f"  Qwen3  成功 {len(qwen3_lat)}/{len(files)}, 平均延迟 {sum(qwen3_lat) / len(qwen3_lat):.0f}ms")

    # 写报告
    report = {
        "timestamp": datetime.now().isoformat(),
        "total": len(files),
        "results": results,
    }
    report_path = f"asr_ab_report_{datetime.now():%Y%m%d_%H%M%S}.json"
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"\n详细报告已保存: {report_path}")


def check_services():
    """健康检查两个服务"""
    print("检查服务状态...")

    try:
        r = requests.get("http://localhost:8001/health", timeout=3)
        print(f"  FunASR (8001): {'✓ 就绪' if r.status_code == 200 else '✗ 异常'}")
    except Exception as e:
        print(f"  FunASR (8001): ✗ 不可达 — {e}")
        return False

    try:
        r = requests.get("http://localhost:8002/v1/models", timeout=3)
        print(f"  Qwen3  (8002): {'✓ 就绪' if r.status_code == 200 else '✗ 异常'}")
    except Exception as e:
        print(f"  Qwen3  (8002): ✗ 不可达 — {e}")
        print("  提示: 启动 Qwen3-ASR Docker:")
        print("        cd docker/qwen3-asr && docker-compose up -d")
        return False

    return True


def main():
    ap = argparse.ArgumentParser(description="ASR A/B 测试")
    ap.add_argument("path", nargs="?", help="wav 文件路径")
    ap.add_argument("--dir", help="批量测试目录")
    ap.add_argument("--check", action="store_true", help="仅健康检查")
    args = ap.parse_args()

    if args.check or (not args.path and not args.dir):
        ok = check_services()
        if not ok:
            sys.exit(1)
        if not args.path and not args.dir:
            print("\n用法:")
            print("  python asr_ab_test.py recording.wav     # 单文件测试")
            print("  python asr_ab_test.py --dir recordings/ # 批量测试")
        return

    # 先检查服务
    if not check_services():
        sys.exit(1)

    if args.dir:
        test_dir(args.dir)
    else:
        test_one(args.path)


if __name__ == "__main__":
    main()
