const axios = require('axios');

class TranslationService {
  constructor(config = {}) {
    this.serverUrl = config.serverUrl || 'http://192.168.2.2:1234';
    this.model = config.model || 'gpt-oss-20b';
    this.timeout = config.timeout || 30000;
    this.translationStyle = config.translationStyle || 'professional';
  }

  /**
   * Update configuration
   */
  updateConfig(config) {
    if (config.serverUrl) this.serverUrl = config.serverUrl;
    if (config.model) this.model = config.model;
    if (config.timeout) this.timeout = config.timeout;
    if (config.translationStyle) this.translationStyle = config.translationStyle;
  }

  /**
   * Detect language of input text
   * Returns 'zh' for Chinese, 'en' for English
   */
  detectLanguage(text) {
    // Count Chinese characters (CJK Unified Ideographs)
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    // Count English letters
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length;

    const totalChars = text.replace(/\s/g, '').length;
    const chineseRatio = chineseChars / totalChars;
    const englishRatio = englishChars / totalChars;

    console.log(`[Language Detection] Chinese: ${chineseChars} (${(chineseRatio * 100).toFixed(1)}%), English: ${englishChars} (${(englishRatio * 100).toFixed(1)}%)`);

    // If more than 30% Chinese characters, treat as Chinese
    if (chineseRatio > 0.3) {
      return 'zh';
    }
    // If more than 50% English characters, treat as English
    if (englishRatio > 0.5) {
      return 'en';
    }

    // Default to Chinese if unclear
    return 'zh';
  }

  /**
   * Get translation prompt based on style and direction
   */
  getTranslationPrompt(text, style, sourceLang, targetLang) {
    if (sourceLang === 'zh' && targetLang === 'en') {
      // Chinese to English
      const stylePrompts = {
        professional: `将以下中文口语翻译成地道的英文书面语，要求专业、正式：

中文：${text}

请直接输出英文翻译，不要包含任何解释或额外内容：`,

        casual: `将以下中文口语翻译成自然的英文，保持轻松日常的语气：

中文：${text}

请直接输出英文翻译，不要包含任何解释或额外内容：`,

        academic: `将以下中文翻译成学术性的英文书面语，要求严谨、准确：

中文：${text}

请直接输出英文翻译，不要包含任何解释或额外内容：`,

        business: `将以下中文翻译成商务英文，要求专业、得体：

中文：${text}

请直接输出英文翻译，不要包含任何解释或额外内容：`,

        technical: `将以下中文技术内容翻译成准确的英文技术文档语言：

中文：${text}

请直接输出英文翻译，不要包含任何解释或额外内容：`
      };
      return stylePrompts[style] || stylePrompts.professional;
    } else {
      // English to Chinese
      const stylePrompts = {
        professional: `将以下英文翻译成专业、正式的中文书面语：

English: ${text}

请直接输出中文翻译，不要包含任何解释或额外内容：`,

        casual: `将以下英文翻译成自然的中文，保持轻松日常的语气：

English: ${text}

请直接输出中文翻译，不要包含任何解释或额外内容：`,

        academic: `将以下英文翻译成学术性的中文书面语，要求严谨、准确：

English: ${text}

请直接输出中文翻译，不要包含任何解释或额外内容：`,

        business: `将以下英文翻译成商务中文，要求专业、得体：

English: ${text}

请直接输出中文翻译，不要包含任何解释或额外内容：`,

        technical: `将以下英文技术内容翻译成准确的中文技术文档语言：

English: ${text}

请直接输出中文翻译，不要包含任何解释或额外内容：`
      };
      return stylePrompts[style] || stylePrompts.professional;
    }
  }

  /**
   * Parse model response to extract translation
   * Handles special channel formats like <|channel|>analysis
   */
  parseTranslation(rawText) {
    // Check if response contains channel format
    if (rawText.includes('<|channel|>')) {
      // Try to extract content from output channel
      const outputMatch = rawText.match(/<\|channel\|>output<\|message\|>([^<]+)/);
      if (outputMatch) {
        return outputMatch[1].trim();
      }

      // If no output channel, try to extract from the end of analysis
      // Look for the last sentence that looks like a translation
      const lines = rawText.split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        // Skip empty lines and lines with tags
        if (line && !line.includes('<|') && !line.includes('The user') && !line.includes('翻译')) {
          return line;
        }
      }
    }

    // Return as-is if no special format detected
    return rawText.trim();
  }

  /**
   * Translate text with automatic language detection
   */
  async translate(text, style = null) {
    try {
      if (!text || text.trim().length === 0) {
        throw new Error('Empty text to translate');
      }

      const translationStyle = style || this.translationStyle;

      // Detect source language
      const sourceLang = this.detectLanguage(text);
      const targetLang = sourceLang === 'zh' ? 'en' : 'zh';

      console.log(`[Translator] Detected language: ${sourceLang} -> ${targetLang}`);
      console.log(`[Translator] Translating text (${translationStyle} style):`, text);

      const prompt = this.getTranslationPrompt(text, translationStyle, sourceLang, targetLang);

      // Try chat completions API first (more reliable for newer models)
      let response;
      try {
        response = await axios.post(
          `${this.serverUrl}/v1/chat/completions`,
          {
            model: this.model,
            messages: [
              {
                role: "system",
                content: "You are a professional translator. Translate Chinese to English directly without any explanation."
              },
              {
                role: "user",
                content: prompt
              }
            ],
            max_tokens: 2000,
            temperature: 0.3,
            top_p: 0.9
          },
          {
            timeout: this.timeout,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          const rawTranslation = response.data.choices[0].message.content;

          // Debug: log full response
          console.log('[Translator] Full API response:', JSON.stringify(response.data, null, 2));
          console.log('[Translator] Raw response length:', rawTranslation ? rawTranslation.length : 0);
          console.log('[Translator] Raw response:', rawTranslation ? rawTranslation.substring(0, 200) : '(empty)');

          // Handle empty response
          if (!rawTranslation || rawTranslation.trim().length === 0) {
            console.error('[Translator] LLM returned empty content!');
            throw new Error('LLM returned empty translation');
          }

          const translation = this.parseTranslation(rawTranslation);
          console.log('[Translator] Parsed translation:', translation);

          return {
            success: true,
            original: text,
            translation: translation,
            sourceLang: sourceLang,
            targetLang: targetLang,
            style: translationStyle,
            timestamp: new Date().toISOString()
          };
        }
      } catch (chatError) {
        // Fallback to completions API if chat API fails
        console.log('[Translator] Chat API failed, trying completions API');

        response = await axios.post(
          `${this.serverUrl}/v1/completions`,
          {
            model: this.model,
            prompt: prompt,
            max_tokens: 2000,
            temperature: 0.3,
            top_p: 0.9,
            stop: ['\n\n', '中文：', 'Chinese:']
          },
          {
            timeout: this.timeout,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (response.data && response.data.choices && response.data.choices.length > 0) {
          const rawTranslation = response.data.choices[0].text;
          const translation = this.parseTranslation(rawTranslation);
          console.log('[Translator] Raw response:', rawTranslation.substring(0, 100));
          console.log('[Translator] Parsed translation:', translation);

          return {
            success: true,
            original: text,
            translation: translation,
            sourceLang: sourceLang,
            targetLang: targetLang,
            style: translationStyle,
            timestamp: new Date().toISOString()
          };
        }
      }

      throw new Error('Invalid response from translation server');

    } catch (error) {
      console.error('[Translator] Translation failed:', error.message);

      return {
        success: false,
        original: text,
        translation: null,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Test connection to translation server
   */
  async testConnection() {
    try {
      const response = await axios.get(`${this.serverUrl}/v1/models`, {
        timeout: 5000
      });

      console.log('[Translator] Server connection successful');
      return {
        success: true,
        models: response.data
      };
    } catch (error) {
      console.error('[Translator] Server connection failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Batch translate multiple texts
   */
  async batchTranslate(texts, style = null) {
    const results = [];

    for (const text of texts) {
      const result = await this.translate(text, style);
      results.push(result);

      // Small delay to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }
}

module.exports = TranslationService;
