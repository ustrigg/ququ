#!/usr/bin/env python3
"""
FunASR Server with automatic model download
Provides POST /asr endpoint for wav/pcm audio processing
"""

import os
import sys
import json
import logging
import asyncio
from pathlib import Path
from typing import Optional
import uvicorn
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="FunASR Server", version="1.0.0")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global variables for model
asr_model = None
model_initialized = False

def download_paraformer_model():
    """Download Paraformer model on first startup"""
    try:
        from modelscope import snapshot_download

        model_dir = os.environ.get('FUNASR_MODEL_PATH', './models')
        os.makedirs(model_dir, exist_ok=True)

        model_path = os.path.join(model_dir, 'paraformer')

        if not os.path.exists(model_path):
            logger.info("Downloading Paraformer model...")
            snapshot_download(
                'damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch',
                cache_dir=model_dir,
                local_dir=model_path
            )
            logger.info("Paraformer model downloaded successfully")
        else:
            logger.info("Paraformer model already exists")

        return model_path
    except Exception as e:
        logger.error(f"Failed to download model: {e}")
        raise

def initialize_model():
    """Initialize FunASR model"""
    global asr_model, model_initialized

    if model_initialized:
        return

    try:
        from funasr import AutoModel

        model_path = download_paraformer_model()

        logger.info("Initializing FunASR model WITHOUT VAD...")
        asr_model = AutoModel(
            model=model_path,
            # Disable VAD to avoid audio truncation
            vad_model=None,
            punc_model="ct-punc",
            spk_model=None,  # Also disable speaker detection for faster processing
        )
        model_initialized = True
        logger.info("FunASR model initialized successfully (VAD disabled)")

    except Exception as e:
        logger.error(f"Failed to initialize model: {e}")
        raise

@app.on_event("startup")
async def startup_event():
    """Initialize model on startup"""
    try:
        initialize_model()
    except Exception as e:
        logger.error(f"Startup failed: {e}")

@app.post("/asr")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribe audio file (wav/pcm) and return JSON result
    """
    try:
        if not model_initialized:
            raise HTTPException(status_code=503, detail="Model not initialized")

        # Read audio bytes
        audio_bytes = await file.read()

        # Save temporary file
        temp_dir = Path("temp")
        temp_dir.mkdir(exist_ok=True)
        temp_file = temp_dir / f"audio_{id(audio_bytes)}.wav"

        with open(temp_file, "wb") as f:
            f.write(audio_bytes)

        try:
            # Perform ASR WITHOUT VAD to avoid truncation issues
            # This will process the entire audio file without voice activity detection
            result = asr_model.generate(
                input=str(temp_file),
                batch_size_s=300,  # Process longer segments
                # Disable VAD by not providing vad_kwargs
                # This means the entire audio will be processed
            )

            # Extract text from result
            if isinstance(result, list) and len(result) > 0:
                text = result[0].get("text", "")
            else:
                text = str(result) if result else ""

            return JSONResponse(content={
                "success": True,
                "text": text,
                "result": result
            })

        finally:
            # Clean up temp file
            if temp_file.exists():
                temp_file.unlink()

    except Exception as e:
        logger.error(f"ASR error: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "error": str(e)
            }
        )

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return JSONResponse(content={
        "status": "healthy",
        "model_initialized": model_initialized
    })

@app.get("/")
async def root():
    """Root endpoint"""
    return JSONResponse(content={
        "message": "FunASR Server",
        "version": "1.0.0",
        "endpoints": ["/asr", "/health"]
    })

if __name__ == "__main__":
    port = int(os.environ.get('FUNASR_PORT', 8001))
    host = os.environ.get('FUNASR_HOST', '0.0.0.0')

    logger.info(f"Starting FunASR server on {host}:{port}")
    uvicorn.run(app, host=host, port=port)