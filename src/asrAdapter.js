/**
 * ASR Adapter
 *
 * ASR 适配层 - 统一管理多种 ASR 后端
 * 支持 Paraformer (FunASR) 和 Qwen3-ASR
 * 提供一致的调用接口和自动回退机制
 */

const ParaformerClient = require('./paraformerClient');
const Qwen3ASRClient = require('./qwenAsrClient');

/**
 * ASR 后端类型枚举
 */
const ASR_BACKENDS = {
  PARAFORMER: 'paraformer',
  QWEN3: 'qwen3',
  AUTO: 'auto'  // 自动选择，优先使用配置的后端，失败则回退
};

/**
 * ASR 适配器类
 */
class ASRAdapter {
  /**
   * @param {Object} config - 配置对象
   * @param {string} config.asrBackend - ASR 后端选择 ('paraformer' | 'qwen3' | 'auto')
   * @param {Object} config.paraformer - Paraformer 配置
   * @param {Object} config.qwen3Asr - Qwen3-ASR 配置
   * @param {Object} config.asrFallback - 回退配置
   */
  constructor(config = {}) {
    this.currentBackend = config.asrBackend || ASR_BACKENDS.PARAFORMER;
    this.fallbackEnabled = config.asrFallback?.enabled !== false;
    this.fallbackBackend = config.asrFallback?.fallbackBackend || ASR_BACKENDS.PARAFORMER;

    // 客户端实例 (懒加载)
    this._paraformerClient = null;
    this._qwen3Client = null;

    // 保存配置
    this._config = config;

    // 后端健康状态缓存
    this._healthCache = {
      paraformer: { healthy: null, lastCheck: 0 },
      qwen3: { healthy: null, lastCheck: 0 }
    };
    this._healthCacheTTL = 30000; // 30秒缓存

    console.log('[ASRAdapter] Initialized with backend:', this.currentBackend);
    console.log('[ASRAdapter] Fallback enabled:', this.fallbackEnabled);
    console.log('[ASRAdapter] Fallback backend:', this.fallbackBackend);
  }

  /**
   * 获取 Paraformer 客户端 (懒加载)
   * @private
   */
  _getParaformerClient() {
    if (!this._paraformerClient) {
      const paraformerConfig = {
        serverUrl: this._config.asrServerUrl || this._config.paraformer?.serverUrl || 'http://localhost:8001',
        useVAD: this._config.useVAD,
        vadThreshold: this._config.vadThreshold,
        sentenceTimestamp: this._config.sentenceTimestamp,
        maxSingleSegmentTime: this._config.maxSingleSegmentTime,
        timeout: this._config.paraformer?.timeout || 60000
      };
      this._paraformerClient = new ParaformerClient(paraformerConfig);
      console.log('[ASRAdapter] Paraformer client created');
    }
    return this._paraformerClient;
  }

  /**
   * 获取 Qwen3-ASR 客户端 (懒加载)
   * @private
   */
  _getQwen3Client() {
    if (!this._qwen3Client) {
      const qwen3Config = {
        serverUrl: this._config.qwen3Asr?.serverUrl || 'http://127.0.0.1:8002',
        model: this._config.qwen3Asr?.model || 'Qwen/Qwen3-ASR-1.7B',
        timeout: this._config.qwen3Asr?.timeout || 60000
      };
      this._qwen3Client = new Qwen3ASRClient(qwen3Config);
      console.log('[ASRAdapter] Qwen3-ASR client created');
    }
    return this._qwen3Client;
  }

  /**
   * 获取指定后端的客户端
   * @private
   */
  _getClient(backend) {
    switch (backend) {
      case ASR_BACKENDS.QWEN3:
        return this._getQwen3Client();
      case ASR_BACKENDS.PARAFORMER:
      default:
        return this._getParaformerClient();
    }
  }

  /**
   * 更新配置
   * @param {Object} config - 新的配置对象
   */
  updateConfig(config) {
    console.log('[ASRAdapter] Updating configuration...');

    // 更新后端选择
    if (config.asrBackend) {
      this.currentBackend = config.asrBackend;
      console.log('[ASRAdapter] Backend changed to:', this.currentBackend);
    }

    // 更新回退配置
    if (config.asrFallback) {
      if (config.asrFallback.enabled !== undefined) {
        this.fallbackEnabled = config.asrFallback.enabled;
      }
      if (config.asrFallback.fallbackBackend) {
        this.fallbackBackend = config.asrFallback.fallbackBackend;
      }
    }

    // 保存新配置
    this._config = { ...this._config, ...config };

    // 更新已创建的客户端
    if (this._paraformerClient) {
      this._paraformerClient.updateConfig({
        serverUrl: config.asrServerUrl || config.paraformer?.serverUrl,
        useVAD: config.useVAD,
        vadThreshold: config.vadThreshold,
        sentenceTimestamp: config.sentenceTimestamp,
        maxSingleSegmentTime: config.maxSingleSegmentTime,
        timeout: config.paraformer?.timeout
      });
    }

    if (this._qwen3Client && config.qwen3Asr) {
      this._qwen3Client.updateConfig(config.qwen3Asr);
    }
  }

  /**
   * 设置当前后端
   * @param {string} backend - 后端名称
   */
  setBackend(backend) {
    if (Object.values(ASR_BACKENDS).includes(backend)) {
      this.currentBackend = backend;
      console.log('[ASRAdapter] Backend set to:', backend);
    } else {
      console.error('[ASRAdapter] Invalid backend:', backend);
    }
  }

  /**
   * 获取当前后端名称
   */
  getCurrentBackend() {
    return this.currentBackend;
  }

  /**
   * 执行语音转写
   * @param {Blob} wavBlob - WAV 格式的音频 Blob
   * @param {Object} options - 可选参数
   * @returns {Promise<TranscriptionResult>} 转写结果
   */
  async transcribe(wavBlob, options = {}) {
    console.log('[ASRAdapter] Starting transcription...');
    console.log('[ASRAdapter] Current backend:', this.currentBackend);
    console.log('[ASRAdapter] Audio size:', wavBlob.size, 'bytes');

    let primaryBackend = this.currentBackend;
    let result = null;

    // 如果是 AUTO 模式，先检查 Qwen3 是否可用
    if (this.currentBackend === ASR_BACKENDS.AUTO) {
      const qwen3Healthy = await this.healthCheck(ASR_BACKENDS.QWEN3);
      primaryBackend = qwen3Healthy ? ASR_BACKENDS.QWEN3 : ASR_BACKENDS.PARAFORMER;
      console.log('[ASRAdapter] Auto mode selected backend:', primaryBackend);
    }

    // 尝试主后端
    try {
      const client = this._getClient(primaryBackend);
      console.log('[ASRAdapter] Trying primary backend:', primaryBackend);
      result = await client.transcribe(wavBlob);

      if (result.success) {
        console.log('[ASRAdapter] Primary backend succeeded');
        return result;
      } else {
        console.warn('[ASRAdapter] Primary backend returned error:', result.error);
      }
    } catch (error) {
      console.error('[ASRAdapter] Primary backend failed:', error.message);
      result = {
        success: false,
        text: '',
        segments: [],
        backend: primaryBackend,
        error: error.message
      };
    }

    // 如果主后端失败且启用了回退
    if (!result.success && this.fallbackEnabled) {
      // 确定回退后端
      let fallbackBackend = this.fallbackBackend;

      // 如果回退后端和主后端相同，跳过回退（没有别的可用后端）
      if (fallbackBackend === primaryBackend) {
        console.log('[ASRAdapter] Fallback backend same as primary, skipping fallback');
        return result;
      }

      console.log('[ASRAdapter] Attempting fallback to:', fallbackBackend);

      try {
        const fallbackClient = this._getClient(fallbackBackend);
        const fallbackResult = await fallbackClient.transcribe(wavBlob);

        if (fallbackResult.success) {
          console.log('[ASRAdapter] Fallback succeeded');
          fallbackResult.fallbackUsed = true;
          fallbackResult.originalBackend = primaryBackend;
          return fallbackResult;
        } else {
          console.warn('[ASRAdapter] Fallback also failed:', fallbackResult.error);
          // 返回回退结果（即使失败），包含更多信息
          fallbackResult.fallbackUsed = true;
          fallbackResult.originalBackend = primaryBackend;
          fallbackResult.originalError = result.error;
          return fallbackResult;
        }
      } catch (fallbackError) {
        console.error('[ASRAdapter] Fallback failed:', fallbackError.message);
        // 返回原始错误，附加回退失败信息
        result.fallbackAttempted = true;
        result.fallbackError = fallbackError.message;
      }
    }

    return result;
  }

  /**
   * 健康检查
   * @param {string} backend - 要检查的后端 (可选，默认检查当前后端)
   * @returns {Promise<boolean>} 服务是否可用
   */
  async healthCheck(backend = null) {
    const targetBackend = backend || this.currentBackend;

    // 如果是 AUTO 模式且未指定后端，检查所有后端
    if (targetBackend === ASR_BACKENDS.AUTO && !backend) {
      const paraformerHealthy = await this.healthCheck(ASR_BACKENDS.PARAFORMER);
      const qwen3Healthy = await this.healthCheck(ASR_BACKENDS.QWEN3);
      return paraformerHealthy || qwen3Healthy;
    }

    // 检查缓存
    const cache = this._healthCache[targetBackend];
    if (cache && (Date.now() - cache.lastCheck) < this._healthCacheTTL) {
      console.log(`[ASRAdapter] Using cached health for ${targetBackend}:`, cache.healthy);
      return cache.healthy;
    }

    // 执行健康检查
    console.log(`[ASRAdapter] Performing health check for ${targetBackend}...`);
    const client = this._getClient(targetBackend);
    const healthy = await client.healthCheck();

    // 更新缓存
    this._healthCache[targetBackend] = {
      healthy,
      lastCheck: Date.now()
    };

    console.log(`[ASRAdapter] Health check result for ${targetBackend}:`, healthy);
    return healthy;
  }

  /**
   * 获取所有后端的健康状态
   * @returns {Promise<Object>} 各后端的健康状态
   */
  async getAllHealthStatus() {
    const [paraformerHealthy, qwen3Healthy] = await Promise.all([
      this.healthCheck(ASR_BACKENDS.PARAFORMER),
      this.healthCheck(ASR_BACKENDS.QWEN3)
    ]);

    return {
      paraformer: paraformerHealthy,
      qwen3: qwen3Healthy,
      current: this.currentBackend,
      fallbackEnabled: this.fallbackEnabled
    };
  }

  /**
   * 清除健康状态缓存
   */
  clearHealthCache() {
    this._healthCache = {
      paraformer: { healthy: null, lastCheck: 0 },
      qwen3: { healthy: null, lastCheck: 0 }
    };
    console.log('[ASRAdapter] Health cache cleared');
  }

  /**
   * 获取可用的后端列表
   */
  static getAvailableBackends() {
    return [
      { value: ASR_BACKENDS.PARAFORMER, label: 'Paraformer (FunASR)', description: '阿里达摩院开源模型，Docker 部署' },
      { value: ASR_BACKENDS.QWEN3, label: 'Qwen3-ASR', description: '通义千问语音模型，需要 GPU' },
      { value: ASR_BACKENDS.AUTO, label: '自动选择', description: '优先 Qwen3，失败回退 Paraformer' }
    ];
  }
}

// 导出
ASRAdapter.BACKENDS = ASR_BACKENDS;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ASRAdapter;
}
