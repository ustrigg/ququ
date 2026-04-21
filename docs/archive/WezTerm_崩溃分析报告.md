# WezTerm 崩溃分析报告

**日期：** 2026-03-08
**分析范围：** `C:\Users\trigg\.local\share\wezterm\` 日志目录

---

## 一、崩溃直接原因

### 主线程栈溢出（Stack Overflow）

在主日志文件 `log` 中发现致命错误：

```
thread 'main' has overflowed its stack
```

这是 WezTerm 进程被操作系统终止的直接原因——**主线程的调用栈超出了系统限制**。

---

## 二、崩溃链条分析

### 阶段 1：Mux Server 连接断裂

日志中出现 **海量** `os error 10054`（`WSAECONNRESET`）错误：

```
ERROR wezterm_mux_server_impl::local > encoding PDU to client: writing pdu data buffer:
远程主机强迫关闭了一个现有的连接。 (os error 10054)
```

仅 `wezterm-gui.exe-log-105760.txt` 一个文件就有 **325KB** 几乎全是这个错误，从 21:51 一直持续到 22:43+（约 50 分钟），估算 **数百条/分钟** 的错误产生速率。

**含义：** WezTerm 的 mux server（多路复用服务器）持续尝试向已断开的 GUI 客户端发送 PDU（Protocol Data Unit），但连接已被远程端强制关闭。

### 阶段 2：错误累积导致栈溢出

mux server 对每个失败的 PDU 写入/读取都进行错误处理。在高频错误回调的场景下，错误处理链可能形成深层递归或嵌套调用，最终触发：

```
thread 'main' has overflowed its stack
```

### 阶段 3：后续进程无法连接

崩溃后，新启动的 wezterm.exe 尝试连接已死亡的 socket，失败并退出：

```
wezterm.exe-log-124416.txt:
ERROR wezterm > failed to connect to Socket("gui-sock-105760"):
connecting to gui-sock-105760; terminating
```

---

## 三、根因分析

### 核心问题：僵尸 Socket 连接未清理

WezTerm 采用 client-server 架构：
- **wezterm-gui.exe**（mux server）：管理终端会话
- **wezterm.exe**（client）：连接到 server 显示 UI

当客户端异常断开（如系统休眠/RDP断开/内存压力导致 GUI 进程被杀），mux server **没有正确检测并清理死连接**，而是持续向已断开的 socket 发送数据，每次都失败并记录错误。

### 触发因素分析

结合配置文件 `.wezterm.lua`：

| 因素 | 配置 | 影响 |
|------|------|------|
| `update-right-status` 回调 | 每 2000ms 触发 | 产生 PDU 通信，遇到死连接则报错 |
| `format-tab-title` 回调 | 每次 tab 更新触发 | 同上 |
| 4窗格 WSL+tmux 布局 | Ctrl+Shift+O | 4个 pane × 各自的 PTY = 大量并发 PDU |
| WSL2 连接 | `wsl -d Ubuntu-22.04` | WSL 子系统偶发挂起可导致连接异常 |

**触发链路：**
```
WSL2/系统休眠/RDP断开
    ↓
GUI 客户端连接中断
    ↓
mux server 持续向死连接发 PDU（10054 error flood）
    ↓
错误处理回调深层嵌套
    ↓
thread 'main' has overflowed its stack
    ↓
WezTerm 崩溃
```

---

## 四、当前已有的稳定性优化（配置中标注）

```lua
-- [稳定性优化] GPU 渲染后端 - 使用 OpenGL 避免 WebGPU 长时间运行死锁
config.front_end = "OpenGL"

-- [稳定性优化] 限制滚动缓冲区，防止内存持续增长
config.scrollback_lines = 5000

-- [稳定性优化] 降低状态栏刷新频率，减少事件回调压力
config.status_update_interval = 2000
```

这些优化方向正确，但**未能解决 mux server 僵尸连接问题**。

---

## 五、建议修复方案

### 方案 1：禁用 mux server（推荐，最简单有效）

在 `.wezterm.lua` 中添加：

```lua
-- 禁用 mux server，使用单进程模式
-- 避免 client-server 架构的连接管理问题
config.mux_env_remove = {}  -- 不继承 mux 环境变量
```

或者直接用命令行参数启动：
```
wezterm-gui.exe --no-auto-connect
```

### 方案 2：清理 stale socket 文件

创建一个启动脚本，在 WezTerm 启动前清理残留 socket：

```powershell
# cleanup-wezterm.ps1
Remove-Item "$env:USERPROFILE\.local\share\wezterm\gui-sock-*" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:USERPROFILE\.local\share\wezterm\sock" -Force -ErrorAction SilentlyContinue
wezterm-gui.exe
```

### 方案 3：降低 PDU 通信频率

进一步减少状态更新：

```lua
-- 将状态栏更新间隔从 2秒 提高到 10秒
config.status_update_interval = 10000

-- 简化 update-right-status 回调，减少通信开销
wezterm.on('update-right-status', function(window, pane)
  -- 仅显示静态文本，不做任何网络/IPC 操作
  window:set_right_status(' GMIC ')
end)
```

### 方案 4：升级 WezTerm

检查当前版本是否存在已知的 mux server 连接泄漏 bug：

```powershell
wezterm --version
```

WezTerm 在近期版本中对 mux server 的连接管理有多次修复，建议升级到最新 nightly 版本。

---

## 六、总结

| 项目 | 结论 |
|------|------|
| **崩溃类型** | 主线程栈溢出 (Stack Overflow) |
| **直接原因** | mux server 持续向死连接发送 PDU，错误处理导致栈耗尽 |
| **根因** | 僵尸 socket 连接未被检测和清理 |
| **触发条件** | 客户端异常断开（休眠/RDP/内存压力） |
| **推荐修复** | 清理 stale socket + 降低状态更新频率 + 升级 WezTerm |
