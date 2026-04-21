const { spawn, execSync } = require('child_process');
const axios = require('axios');

class FunASRManager {
  constructor(config = {}) {
    this.serverUrl = config.serverUrl || 'http://localhost:8001';
    this.containerName = 'funasr-server';
    this.dockerImage = 'pipeline-funasr-service:latest'; // 使用本地已有镜像
    this.containerPort = 5001; // pipeline镜像使用5001端口
    this.hostPort = 8001; // 映射到8001端口
    this.isReady = false;
    this.onLog = config.onLog || (() => {});
    this.onReady = config.onReady || (() => {});
    this.onError = config.onError || (() => {});
  }

  async checkDockerInstalled() {
    try {
      const version = execSync('docker --version', { encoding: 'utf8' }).trim();
      this.onLog(`✓ Docker已安装: ${version}`);
      return true;
    } catch (e) {
      this.onError('Docker未安装或未启动，请先安装Docker Desktop');
      return false;
    }
  }

  async checkServerStatus() {
    try {
      const response = await axios.get(`${this.serverUrl}/health`, { timeout: 2000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  async checkContainerExists() {
    try {
      execSync(`docker inspect ${this.containerName}`, { encoding: 'utf8', stdio: 'pipe' });
      return true;
    } catch (e) {
      return false;
    }
  }

  async isContainerRunning() {
    try {
      const output = execSync(`docker inspect -f {{.State.Running}} ${this.containerName}`, {
        encoding: 'utf8',
        stdio: 'pipe'
      }).trim();
      return output === 'true';
    } catch (e) {
      return false;
    }
  }

  async startServer() {
    this.onLog('正在启动FunASR Docker服务器...');

    try {
      // 1. 检查Docker是否安装
      const hasDocker = await this.checkDockerInstalled();
      if (!hasDocker) {
        return false;
      }

      // 2. 检查容器是否存在
      const containerExists = await this.checkContainerExists();

      if (containerExists) {
        const isRunning = await this.isContainerRunning();

        if (isRunning) {
          this.onLog('容器已在运行，正在检查服务状态...');
        } else {
          this.onLog('启动现有容器...');
          execSync(`docker start ${this.containerName}`, { encoding: 'utf8' });
        }
      } else {
        // 3. 检查镜像是否存在
        this.onLog('检查Docker镜像...');
        try {
          execSync(`docker image inspect ${this.dockerImage}`, { encoding: 'utf8', stdio: 'pipe' });
          this.onLog('✓ 镜像已存在');
        } catch (e) {
          this.onLog('正在拉取FunASR镜像（首次运行需要下载，可能需要几分钟）...');
          try {
            // 使用spawn以便实时显示进度
            await new Promise((resolve, reject) => {
              const pullProcess = spawn('docker', ['pull', this.dockerImage], { shell: true });

              pullProcess.stdout.on('data', (data) => {
                const output = data.toString().trim();
                this.onLog(`下载: ${output}`);
              });

              pullProcess.stderr.on('data', (data) => {
                const output = data.toString().trim();
                this.onLog(output);
              });

              pullProcess.on('close', (code) => {
                if (code === 0) {
                  this.onLog('✓ 镜像下载完成');
                  resolve();
                } else {
                  reject(new Error(`镜像拉取失败，退出码: ${code}`));
                }
              });
            });
          } catch (error) {
            this.onError(`拉取镜像失败: ${error.message}`);
            return false;
          }
        }

        // 4. 创建并启动容器
        this.onLog('创建并启动FunASR容器...');
        this.onLog(`端口映射: ${this.hostPort} -> ${this.containerPort}`);

        try {
          execSync(
            `docker run -d --restart=always --name ${this.containerName} -p ${this.hostPort}:${this.containerPort} ${this.dockerImage}`,
            { encoding: 'utf8' }
          );
          this.onLog('✓ 容器已创建并启动（系统启动时自动启动）');
        } catch (error) {
          this.onError(`启动容器失败: ${error.message}`);
          return false;
        }
      }

      // 5. 等待服务就绪
      this.onLog('等待FunASR服务启动...');
      const maxWait = 60000; // 60秒
      const checkInterval = 2000; // 2秒
      let waited = 0;

      while (waited < maxWait) {
        await this.sleep(checkInterval);
        waited += checkInterval;

        const isRunning = await this.checkServerStatus();
        if (isRunning) {
          this.onLog('✓ FunASR服务器就绪！');
          this.isReady = true;
          this.onReady();
          return true;
        }

        if (waited % 10000 === 0) {
          this.onLog(`等待中... (${waited / 1000}秒)`);
        }
      }

      // 超时但继续
      this.onLog('警告：服务器健康检查超时，但容器可能已在后台启动');
      this.isReady = true;
      return true;

    } catch (error) {
      console.error('Error starting FunASR Docker server:', error);
      this.onError(error.message);
      return false;
    }
  }

  async stopServer() {
    try {
      this.onLog('停止FunASR容器...');
      const isRunning = await this.isContainerRunning();

      if (isRunning) {
        execSync(`docker stop ${this.containerName}`, { encoding: 'utf8' });
        this.onLog('✓ 容器已停止');
      } else {
        this.onLog('容器未在运行');
      }

      this.isReady = false;
    } catch (error) {
      console.error('Failed to stop container:', error);
    }
  }

  async removeContainer() {
    try {
      this.onLog('删除FunASR容器...');
      await this.stopServer();

      const exists = await this.checkContainerExists();
      if (exists) {
        execSync(`docker rm ${this.containerName}`, { encoding: 'utf8' });
        this.onLog('✓ 容器已删除');
      }
    } catch (error) {
      console.error('Failed to remove container:', error);
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async ensureServerRunning() {
    // 检查服务是否已经在运行
    const isRunning = await this.checkServerStatus();

    if (isRunning) {
      this.onLog('FunASR服务器已经在运行');
      this.isReady = true;
      this.onReady();
      return true;
    }

    // 启动服务
    this.onLog('FunASR服务器未运行，正在启动...');
    return await this.startServer();
  }
}

module.exports = FunASRManager;
