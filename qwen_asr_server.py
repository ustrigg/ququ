#!/usr/bin/env python3
"""
Qwen3-ASR Docker Server Manager

管理 Qwen3-ASR Docker 容器的启动、停止和状态检查。

Usage:
    python qwen_asr_server.py start     # 启动服务
    python qwen_asr_server.py stop      # 停止服务
    python qwen_asr_server.py status    # 查看状态
    python qwen_asr_server.py logs      # 查看日志
    python qwen_asr_server.py build     # 构建镜像

Requirements:
    - Docker with NVIDIA Container Toolkit (nvidia-docker)
    - NVIDIA GPU with CUDA support
"""

import argparse
import subprocess
import sys
import os
import time


DOCKER_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'docker', 'qwen3-asr')
CONTAINER_NAME = 'qwen3-asr'
DEFAULT_PORT = 8002


def run_command(cmd, capture_output=False, check=True):
    """Run a shell command."""
    print(f"Running: {' '.join(cmd)}")
    try:
        if capture_output:
            result = subprocess.run(cmd, capture_output=True, text=True, check=check)
            return result.stdout.strip()
        else:
            subprocess.run(cmd, check=check)
            return None
    except subprocess.CalledProcessError as e:
        if capture_output:
            print(f"Error: {e.stderr}")
        raise


def check_docker():
    """Check if Docker is available."""
    try:
        run_command(['docker', '--version'], capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: Docker is not installed or not running.")
        print("Please install Docker Desktop: https://www.docker.com/products/docker-desktop")
        return False


def check_nvidia_docker():
    """Check if NVIDIA Container Toolkit is available."""
    try:
        result = run_command(['docker', 'info'], capture_output=True, check=False)
        if 'nvidia' in result.lower() or 'Runtimes' in result:
            return True
        # Try running a simple nvidia-smi in container
        run_command(['docker', 'run', '--rm', '--gpus', 'all', 'nvidia/cuda:12.1-base-ubuntu22.04', 'nvidia-smi'],
                   capture_output=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Warning: NVIDIA Container Toolkit may not be installed.")
        print("Install guide: https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html")
        return False


def is_container_running():
    """Check if the container is running."""
    try:
        result = run_command(['docker', 'ps', '-q', '-f', f'name={CONTAINER_NAME}'], capture_output=True, check=False)
        return bool(result)
    except:
        return False


def is_container_exists():
    """Check if the container exists (running or stopped)."""
    try:
        result = run_command(['docker', 'ps', '-aq', '-f', f'name={CONTAINER_NAME}'], capture_output=True, check=False)
        return bool(result)
    except:
        return False


def build_image():
    """Build the Docker image."""
    print("\n=== Building Qwen3-ASR Docker Image ===\n")

    if not os.path.exists(DOCKER_DIR):
        print(f"Error: Docker directory not found: {DOCKER_DIR}")
        return False

    os.chdir(DOCKER_DIR)
    try:
        run_command(['docker-compose', 'build'])
        print("\nImage built successfully!")
        return True
    except subprocess.CalledProcessError:
        print("\nFailed to build image.")
        return False


def start_server(model=None, port=None, gpu_memory=None):
    """Start the Qwen3-ASR server."""
    print("\n=== Starting Qwen3-ASR Server ===\n")

    if not check_docker():
        return False

    if is_container_running():
        print(f"Container '{CONTAINER_NAME}' is already running.")
        return True

    if not os.path.exists(DOCKER_DIR):
        print(f"Error: Docker directory not found: {DOCKER_DIR}")
        return False

    os.chdir(DOCKER_DIR)

    # Set environment variables
    env = os.environ.copy()
    if model:
        env['MODEL_NAME'] = model
    if port:
        env['PORT'] = str(port)
    if gpu_memory:
        env['GPU_MEMORY_UTILIZATION'] = str(gpu_memory)

    try:
        # Use docker-compose
        subprocess.run(['docker-compose', 'up', '-d'], env=env, check=True)
        print(f"\nQwen3-ASR server starting on port {port or DEFAULT_PORT}...")
        print("First startup may take several minutes to download the model.")
        print(f"\nUse 'python qwen_asr_server.py logs' to view startup progress.")
        return True
    except subprocess.CalledProcessError as e:
        print(f"\nFailed to start server: {e}")
        return False


def stop_server():
    """Stop the Qwen3-ASR server."""
    print("\n=== Stopping Qwen3-ASR Server ===\n")

    if not is_container_exists():
        print(f"Container '{CONTAINER_NAME}' does not exist.")
        return True

    os.chdir(DOCKER_DIR)

    try:
        run_command(['docker-compose', 'down'])
        print("\nServer stopped.")
        return True
    except subprocess.CalledProcessError:
        # Try direct docker stop
        try:
            run_command(['docker', 'stop', CONTAINER_NAME])
            run_command(['docker', 'rm', CONTAINER_NAME])
            print("\nServer stopped.")
            return True
        except:
            print("\nFailed to stop server.")
            return False


def show_status():
    """Show the server status."""
    print("\n=== Qwen3-ASR Server Status ===\n")

    if not check_docker():
        return

    if is_container_running():
        print(f"Status: RUNNING")

        # Get container info
        try:
            result = run_command(['docker', 'inspect', '--format',
                                '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', CONTAINER_NAME],
                               capture_output=True, check=False)
            print(f"Container IP: {result}")

            # Get port mapping
            result = run_command(['docker', 'port', CONTAINER_NAME], capture_output=True, check=False)
            print(f"Port mapping: {result}")

            # Check health
            result = run_command(['docker', 'inspect', '--format', '{{.State.Health.Status}}', CONTAINER_NAME],
                               capture_output=True, check=False)
            if result:
                print(f"Health: {result}")

        except:
            pass

        print(f"\nAPI Endpoint: http://127.0.0.1:{DEFAULT_PORT}/v1/chat/completions")

    elif is_container_exists():
        print(f"Status: STOPPED (container exists)")
        print("Run 'python qwen_asr_server.py start' to start the server.")
    else:
        print(f"Status: NOT INSTALLED")
        print("Run 'python qwen_asr_server.py start' to create and start the server.")


def show_logs(follow=False, tail=100):
    """Show container logs."""
    if not is_container_exists():
        print(f"Container '{CONTAINER_NAME}' does not exist.")
        return

    cmd = ['docker', 'logs']
    if follow:
        cmd.append('-f')
    cmd.extend(['--tail', str(tail), CONTAINER_NAME])

    try:
        subprocess.run(cmd)
    except KeyboardInterrupt:
        pass


def health_check():
    """Check if the server is healthy and responding."""
    import urllib.request
    import json

    url = f"http://127.0.0.1:{DEFAULT_PORT}/v1/models"

    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            data = json.loads(response.read().decode())
            print("Server is healthy!")
            print(f"Available models: {data}")
            return True
    except Exception as e:
        print(f"Server is not responding: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Qwen3-ASR Docker Server Manager',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Commands:
    start   Start the Qwen3-ASR server
    stop    Stop the server
    status  Show server status
    logs    Show server logs
    build   Build Docker image
    health  Check server health

Examples:
    python qwen_asr_server.py start
    python qwen_asr_server.py start --model Qwen/Qwen3-ASR-0.6B
    python qwen_asr_server.py logs -f
    python qwen_asr_server.py stop
        """
    )

    parser.add_argument('command', choices=['start', 'stop', 'status', 'logs', 'build', 'health'],
                       help='Command to execute')
    parser.add_argument('--model', '-m', default=None,
                       help='Model name (e.g., Qwen/Qwen3-ASR-1.7B or Qwen/Qwen3-ASR-0.6B)')
    parser.add_argument('--port', '-p', type=int, default=None,
                       help='Port number (default: 8002)')
    parser.add_argument('--gpu-memory', '-g', type=float, default=None,
                       help='GPU memory utilization (0.0-1.0)')
    parser.add_argument('--follow', '-f', action='store_true',
                       help='Follow log output (for logs command)')
    parser.add_argument('--tail', '-n', type=int, default=100,
                       help='Number of log lines to show (default: 100)')

    args = parser.parse_args()

    if args.command == 'start':
        success = start_server(model=args.model, port=args.port, gpu_memory=args.gpu_memory)
        sys.exit(0 if success else 1)

    elif args.command == 'stop':
        success = stop_server()
        sys.exit(0 if success else 1)

    elif args.command == 'status':
        show_status()

    elif args.command == 'logs':
        show_logs(follow=args.follow, tail=args.tail)

    elif args.command == 'build':
        success = build_image()
        sys.exit(0 if success else 1)

    elif args.command == 'health':
        success = health_check()
        sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
