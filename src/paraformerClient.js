/**
 * Paraformer ASR Client
 *
 * FunASR Paraformer 语音识别客户端
 * 提供与 FunASR Docker 服务的通信接口
 */

class ParaformerClient {
  /**
   * @param {Object} config - 配置对象
   * @param {string} config.serverUrl - ASR 服务器地址
   * @param {boolean} config.useVAD - 是否启用 VAD
   * @param {number} config.vadThreshold - VAD 阈值
   * @param {boolean} config.sentenceTimestamp - 是否启用句子时间戳
   * @param {number} config.maxSingleSegmentTime - 最大单段时长
   * @param {number} config.timeout - 请求超时时间（毫秒）
   */
  constructor(config = {}) {
    this.serverUrl = config.serverUrl || 'http://localhost:8001';
    this.useVAD = config.useVAD !== undefined ? config.useVAD : false;
    this.vadThreshold = config.vadThreshold || 0.5;
    this.sentenceTimestamp = config.sentenceTimestamp !== undefined ? config.sentenceTimestamp : true;
    this.maxSingleSegmentTime = config.maxSingleSegmentTime || 60000;
    this.timeout = config.timeout || 60000;
  }

  /**
   * 更新配置
   * @param {Object} config - 新的配置对象
   */
  updateConfig(config) {
    if (config.serverUrl) this.serverUrl = config.serverUrl;
    if (config.useVAD !== undefined) this.useVAD = config.useVAD;
    if (config.vadThreshold !== undefined) this.vadThreshold = config.vadThreshold;
    if (config.sentenceTimestamp !== undefined) this.sentenceTimestamp = config.sentenceTimestamp;
    if (config.maxSingleSegmentTime !== undefined) this.maxSingleSegmentTime = config.maxSingleSegmentTime;
    if (config.timeout !== undefined) this.timeout = config.timeout;
  }

  /**
   * 执行语音转写
   * @param {Blob} wavBlob - WAV 格式的音频 Blob
   * @returns {Promise<TranscriptionResult>} 转写结果
   */
  async transcribe(wavBlob) {
    const startTime = Date.now();
    console.log('[ParaformerClient] Starting transcription...');
    console.log('[ParaformerClient] Audio size:', wavBlob.size, 'bytes');

    try {
      // 构建 FormData
      const formData = new FormData();
      formData.append('file', wavBlob, 'audio.wav');

      // 添加 VAD 控制参数
      formData.append('use_vad', this.useVAD ? 'true' : 'false');
      formData.append('vad', this.useVAD ? 'true' : 'false');
      formData.append('enable_vad', this.useVAD ? 'true' : 'false');
      console.log('[ParaformerClient] VAD setting:', this.useVAD ? 'enabled' : 'disabled');

      // VAD 阈值
      if (this.useVAD && this.vadThreshold) {
        formData.append('vad_threshold', this.vadThreshold.toString());
        console.log('[ParaformerClient] VAD threshold:', this.vadThreshold);
      }

      // 句子时间戳
      formData.append('sentence_timestamp', this.sentenceTimestamp ? 'true' : 'false');
      formData.append('timestamp', this.sentenceTimestamp ? 'true' : 'false');
      console.log('[ParaformerClient] Sentence timestamp:', this.sentenceTimestamp ? 'enabled' : 'disabled');

      // 最大单段时长
      if (this.maxSingleSegmentTime) {
        formData.append('max_single_segment_time', this.maxSingleSegmentTime.toString());
        console.log('[ParaformerClient] Max single segment time:', this.maxSingleSegmentTime, 'ms');
      }

      // 构建 URL 参数
      const urlParams = [];
      urlParams.push(`use_vad=${this.useVAD}`);
      urlParams.push(`sentence_timestamp=${this.sentenceTimestamp}`);
      const queryString = urlParams.length > 0 ? '?' + urlParams.join('&') : '';
      const asrUrl = `${this.serverUrl}/transcribe${queryString}`;

      console.log('[ParaformerClient] Sending request to:', asrUrl);

      // 发送请求
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(asrUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`ASR request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      console.log('[ParaformerClient] Raw result:', JSON.stringify(result, null, 2));

      // 解析响应
      const transcriptionResult = this._parseResponse(result);
      transcriptionResult.latency = Date.now() - startTime;

      console.log('[ParaformerClient] Transcription completed in', transcriptionResult.latency, 'ms');
      console.log('[ParaformerClient] Text:', transcriptionResult.text);

      return transcriptionResult;

    } catch (error) {
      console.error('[ParaformerClient] Transcription failed:', error);

      if (error.name === 'AbortError') {
        return {
          success: false,
          text: '',
          segments: [],
          backend: 'paraformer',
          error: `请求超时 (${this.timeout}ms)`,
          latency: Date.now() - startTime
        };
      }

      return {
        success: false,
        text: '',
        segments: [],
        backend: 'paraformer',
        error: error.message,
        latency: Date.now() - startTime
      };
    }
  }

  /**
   * 解析 FunASR 响应
   * @private
   */
  _parseResponse(result) {
    let text = '';
    let segments = [];
    let duration = 0;

    // 处理不同的响应格式
    if (result.text) {
      text = result.text;
    } else if (result.transcription) {
      text = result.transcription;
    } else if (result.segments && Array.isArray(result.segments)) {
      console.log('[ParaformerClient] Processing segments, count:', result.segments.length);

      segments = result.segments.map((seg, index) => ({
        index,
        text: seg.text || seg.transcript || '',
        start: seg.start || seg.begin_time || null,
        end: seg.end || seg.end_time || null,
        duration: seg.duration || null
      }));

      // 拼接所有段落文本
      const textParts = segments
        .map(seg => seg.text)
        .filter(t => t && t.trim());
      text = textParts.join(' ');

      console.log('[ParaformerClient] Extracted segments:', segments.length);
    } else if (typeof result === 'string') {
      text = result;
    }

    // 提取时长信息
    if (result.duration) {
      duration = result.duration;
    }

    // 检查是否成功
    const success = text && text.trim().length > 0;

    return {
      success,
      text: text.trim(),
      segments,
      duration,
      backend: 'paraformer',
      error: success ? null : '未检测到语音内容'
    };
  }

  /**
   * 健康检查
   * @returns {Promise<boolean>} 服务是否可用
   */
  async healthCheck() {
    try {
      console.log('[ParaformerClient] Performing health check...');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // 尝试访问服务器根路径或 /health 端点
      const healthUrls = [
        `${this.serverUrl}/health`,
        `${this.serverUrl}/`,
        this.serverUrl
      ];

      for (const url of healthUrls) {
        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal
          });

          if (response.ok || response.status === 404) {
            // 404 也表示服务器在运行，只是没有这个端点
            clearTimeout(timeoutId);
            console.log('[ParaformerClient] Health check passed');
            return true;
          }
        } catch (e) {
          // 继续尝试下一个 URL
        }
      }

      clearTimeout(timeoutId);
      console.log('[ParaformerClient] Health check failed: no response');
      return false;

    } catch (error) {
      console.error('[ParaformerClient] Health check error:', error);
      return false;
    }
  }

  /**
   * 获取后端名称
   */
  getBackendName() {
    return 'paraformer';
  }

  /**
   * 获取后端显示名称
   */
  getDisplayName() {
    return 'Paraformer (FunASR)';
  }
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ParaformerClient;
}
