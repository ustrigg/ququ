const fs = require('fs');
const path = require('path');
const axios = require('axios');

class ExportLogger {
    constructor(basePath = __dirname) {
        this.logsDir = path.join(basePath, 'logs');
        this.pendingDir = path.join(basePath, 'pending');
        this.ensureDirectories();
    }

    ensureDirectories() {
        // Create logs directory structure
        if (!fs.existsSync(this.logsDir)) {
            fs.mkdirSync(this.logsDir, { recursive: true });
        }

        // Create pending directory for failed webhooks
        if (!fs.existsSync(this.pendingDir)) {
            fs.mkdirSync(this.pendingDir, { recursive: true });
        }
    }

    getCurrentLogPaths() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');

        const monthDir = path.join(this.logsDir, `${year}-${month}`);
        if (!fs.existsSync(monthDir)) {
            fs.mkdirSync(monthDir, { recursive: true });
        }

        return {
            jsonlPath: path.join(monthDir, `${day}.jsonl`),
            csvPath: path.join(monthDir, `${day}.csv`)
        };
    }

    async logResult(result) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            text: result.text,
            mode: result.mode || 'input',
            targetLanguage: result.targetLanguage || 'zh-cn',
            duration: result.duration || 0,
            confidence: result.confidence || 0,
            processingTime: result.processingTime || 0
        };

        try {
            await this.writeJsonLog(logEntry);
            await this.writeCsvLog(logEntry);
            console.log('Log entry written successfully');
        } catch (error) {
            console.error('Failed to write log entry:', error);
        }
    }

    async writeJsonLog(logEntry) {
        const { jsonlPath } = this.getCurrentLogPaths();
        const jsonLine = JSON.stringify(logEntry) + '\n';

        return new Promise((resolve, reject) => {
            fs.appendFile(jsonlPath, jsonLine, 'utf8', (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async writeCsvLog(logEntry) {
        const { csvPath } = this.getCurrentLogPaths();
        const csvExists = fs.existsSync(csvPath);

        // CSV header
        const headers = ['timestamp', 'text', 'mode', 'targetLanguage', 'duration', 'confidence', 'processingTime'];
        const csvLine = headers.map(field => {
            const value = logEntry[field] || '';
            // Escape CSV values
            if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',') + '\n';

        return new Promise((resolve, reject) => {
            const content = csvExists ? csvLine : headers.join(',') + '\n' + csvLine;

            fs.appendFile(csvPath, content, 'utf8', (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async sendWebhook(config, result) {
        if (!config.webhookEnabled || !config.webhookUrl) {
            return;
        }

        const payload = {
            text: result.text,
            timestamp: new Date().toISOString(),
            mode: result.mode || 'input',
            targetLanguage: result.targetLanguage || 'zh-cn',
            metadata: {
                duration: result.duration || 0,
                confidence: result.confidence || 0,
                processingTime: result.processingTime || 0
            }
        };

        try {
            const response = await axios.post(config.webhookUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    ...config.webhookHeaders
                },
                timeout: 10000 // 10 second timeout
            });

            console.log('Webhook sent successfully:', response.status);
            return true;

        } catch (error) {
            console.error('Webhook failed:', error.message);

            // Save to pending for retry
            await this.savePendingWebhook(config, payload, error.message);
            return false;
        }
    }

    async savePendingWebhook(config, payload, errorMessage) {
        const pendingEntry = {
            url: config.webhookUrl,
            headers: config.webhookHeaders,
            payload: payload,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            retryCount: 0
        };

        const filename = `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.json`;
        const filePath = path.join(this.pendingDir, filename);

        return new Promise((resolve, reject) => {
            fs.writeFile(filePath, JSON.stringify(pendingEntry, null, 2), 'utf8', (err) => {
                if (err) {
                    reject(err);
                } else {
                    console.log('Pending webhook saved:', filename);
                    resolve();
                }
            });
        });
    }

    async retryPendingWebhooks() {
        try {
            const files = fs.readdirSync(this.pendingDir).filter(f => f.endsWith('.json'));

            for (const file of files) {
                const filePath = path.join(this.pendingDir, file);
                const content = fs.readFileSync(filePath, 'utf8');
                const entry = JSON.parse(content);

                // Skip if too many retries
                if (entry.retryCount >= 5) {
                    continue;
                }

                try {
                    const response = await axios.post(entry.url, entry.payload, {
                        headers: {
                            'Content-Type': 'application/json',
                            ...entry.headers
                        },
                        timeout: 10000
                    });

                    console.log('Retry webhook success:', response.status);
                    // Delete successful retry
                    fs.unlinkSync(filePath);

                } catch (error) {
                    console.error('Retry webhook failed:', error.message);

                    // Update retry count
                    entry.retryCount = (entry.retryCount || 0) + 1;
                    entry.lastRetry = new Date().toISOString();

                    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));
                }
            }

        } catch (error) {
            console.error('Failed to retry pending webhooks:', error);
        }
    }

    // Clean up old pending webhooks (older than 7 days)
    async cleanupPendingWebhooks() {
        try {
            const files = fs.readdirSync(this.pendingDir).filter(f => f.endsWith('.json'));
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

            for (const file of files) {
                const filePath = path.join(this.pendingDir, file);
                const stats = fs.statSync(filePath);

                if (stats.mtime.getTime() < sevenDaysAgo) {
                    fs.unlinkSync(filePath);
                    console.log('Cleaned up old pending webhook:', file);
                }
            }

        } catch (error) {
            console.error('Failed to cleanup pending webhooks:', error);
        }
    }

    // Get statistics
    async getStats() {
        try {
            const stats = {
                totalLogs: 0,
                pendingWebhooks: 0,
                todayLogs: 0
            };

            // Count total logs
            const walkDir = (dir) => {
                if (!fs.existsSync(dir)) return 0;

                let count = 0;
                const items = fs.readdirSync(dir);

                for (const item of items) {
                    const itemPath = path.join(dir, item);
                    const stat = fs.statSync(itemPath);

                    if (stat.isDirectory()) {
                        count += walkDir(itemPath);
                    } else if (item.endsWith('.jsonl')) {
                        const content = fs.readFileSync(itemPath, 'utf8');
                        count += (content.match(/\n/g) || []).length;
                    }
                }

                return count;
            };

            stats.totalLogs = walkDir(this.logsDir);

            // Count pending webhooks
            if (fs.existsSync(this.pendingDir)) {
                stats.pendingWebhooks = fs.readdirSync(this.pendingDir)
                    .filter(f => f.endsWith('.json')).length;
            }

            // Count today's logs
            const { jsonlPath } = this.getCurrentLogPaths();
            if (fs.existsSync(jsonlPath)) {
                const content = fs.readFileSync(jsonlPath, 'utf8');
                stats.todayLogs = (content.match(/\n/g) || []).length;
            }

            return stats;

        } catch (error) {
            console.error('Failed to get stats:', error);
            return { totalLogs: 0, pendingWebhooks: 0, todayLogs: 0 };
        }
    }
}

module.exports = ExportLogger;