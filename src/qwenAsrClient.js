/**
 * Qwen3-ASR Client
 *
 * Qwen3-ASR 语音识别客户端
 * 使用 OpenAI 兼容 API 格式 (/v1/chat/completions)
 */

class Qwen3ASRClient {
  /**
   * @param {Object} config - 配置对象
   * @param {string} config.serverUrl - ASR 服务器地址
   * @param {string} config.model - 模型名称
   * @param {number} config.timeout - 请求超时时间（毫秒）
   */
  constructor(config = {}) {
    this.serverUrl = config.serverUrl || 'http://127.0.0.1:8002';
    this.model = config.model || 'Qwen/Qwen3-ASR-1.7B';
    this.timeout = config.timeout || 60000;
  }

  /**
   * 更新配置
   * @param {Object} config - 新的配置对象
   */
  updateConfig(config) {
    if (config.serverUrl) this.serverUrl = config.serverUrl;
    if (config.model) this.model = config.model;
    if (config.timeout !== undefined) this.timeout = config.timeout;
  }

  /**
   * 将 Blob 转换为 Base64
   * @private
   */
  async _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // 移除 data URL 前缀，只保留 base64 数据
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * 执行语音转写
   * @param {Blob} wavBlob - WAV 格式的音频 Blob
   * @returns {Promise<TranscriptionResult>} 转写结果
   */
  async transcribe(wavBlob) {
    const startTime = Date.now();
    console.log('[Qwen3ASRClient] Starting transcription...');
    console.log('[Qwen3ASRClient] Audio size:', wavBlob.size, 'bytes');
    console.log('[Qwen3ASRClient] Server URL:', this.serverUrl);
    console.log('[Qwen3ASRClient] Model:', this.model);

    try {
      // 将音频转换为 Base64
      console.log('[Qwen3ASRClient] Converting audio to Base64...');
      const base64Audio = await this._blobToBase64(wavBlob);
      console.log('[Qwen3ASRClient] Base64 length:', base64Audio.length);

      // 构建 OpenAI 兼容格式的请求体
      const requestBody = {
        model: this.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'audio_url',
                audio_url: {
                  url: `data:audio/wav;base64,${base64Audio}`
                }
              }
            ]
          }
        ],
        temperature: 0,
        max_tokens: 4096
      };

      const apiUrl = `${this.serverUrl}/v1/chat/completions`;
      console.log('[Qwen3ASRClient] Sending request to:', apiUrl);

      // 发送请求
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Qwen3ASRClient] Server error:', errorText);
        throw new Error(`Qwen3-ASR request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[Qwen3ASRClient] Raw result:', JSON.stringify(result, null, 2));

      // 解析响应
      const transcriptionResult = this._parseResponse(result);
      transcriptionResult.latency = Date.now() - startTime;

      console.log('[Qwen3ASRClient] Transcription completed in', transcriptionResult.latency, 'ms');
      console.log('[Qwen3ASRClient] Text:', transcriptionResult.text);

      return transcriptionResult;

    } catch (error) {
      console.error('[Qwen3ASRClient] Transcription failed:', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          text: '',
          segments: [],
          backend: 'qwen3',
          error: `请求超时 (${this.timeout}ms)`,
          latency: Date.now() - startTime
        };
      }

      return {
        success: false,
        text: '',
        segments: [],
        backend: 'qwen3',
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }

  /**
   * 解析 OpenAI 格式响应
   * @private
   */
  _parseResponse(result) {
    let text = '';

    try {
      // OpenAI 格式：response.choices[0].message.content
      if (result.choices && result.choices.length > 0) {
        const message = result.choices[0].message;
        if (message && message.content) {
          text = message.content;
        }
      }

      // 某些实现可能直接返回 text 字段
      if (!text && result.text) {
        text = result.text;
      }

      // 或者 transcription 字段
      if (!text && result.transcription) {
        text = result.transcription;
      }

      // 清理文本（移除可能的前后空白和特殊标记）
      text = text.trim();

      // Qwen3-ASR 可能返回带有特殊标记的文本，需要清理
      // 例如：<|startoftranscript|>...<|endoftranscript|>
      text = text.replace(/<\|[^|]+\|>/g, '').trim();

    } catch (e) {
      console.error('[Qwen3ASRClient] Error parsing response:', e);
    }

    const success = text && text.length > 0;

    return {
      success,
      text,
      segments: [], // Qwen3-ASR 标准响应不包含分段信息
      backend: 'qwen3',
      error: success ? null : '未检测到语音内容'
    };
  }

  /**
   * 健康检查
   * @returns {Promise<boolean>} 服务是否可用
   */
  async healthCheck() {
    try {
      console.log('[Qwen3ASRClient] Performing health check...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // 尝试访问模型列表端点 (OpenAI 兼容 API 标准)
      const healthUrls = [
        `${this.serverUrl}/v1/models`,
        `${this.serverUrl}/health`,
        `${this.serverUrl}/`
      ];

      for (const url of healthUrls) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal
          });

          if (response.ok) {
            clearTimeout(timeoutId);
            console.log('[Qwen3ASRClient] Health check passed via:', url);
            return true;
          }
        } catch (e) {
          // 继续尝试下一个 URL
        }
      }

      clearTimeout(timeoutId);
      console.log('[Qwen3ASRClient] Health check failed: no response');
      return false;

    } catch (error) {
      console.error('[Qwen3ASRClient] Health check error:', error);
      return false;
    }
  }

  /**
   * 获取后端名称
   */
  getBackendName() {
    return 'qwen3';
  }

  /**
   * 获取后端显示名称
   */
  getDisplayName() {
    return 'Qwen3-ASR';
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Qwen3ASRClient;
}
