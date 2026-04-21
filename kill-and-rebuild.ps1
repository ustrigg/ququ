# 强制关闭所有相关进程并重新编译

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  蛐蛐语音 - 清理并重新编译" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. 关闭所有相关进程
Write-Host "[1/4] 关闭运行中的进程..." -ForegroundColor Yellow
$processes = @('Ququ Voice Input', 'electron', 'node')
foreach ($proc in $processes) {
    $running = Get-Process -Name $proc -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "  - 关闭 $proc..." -ForegroundColor Gray
        Stop-Process -Name $proc -Force -ErrorAction SilentlyContinue
    }
}
Start-Sleep -Seconds 3
Write-Host "  ✓ 进程已关闭" -ForegroundColor Green
Write-Host ""

# 2. 删除 dist 目录
Write-Host "[2/4] 清理构建目录..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Write-Host "  - 删除 dist 目录..." -ForegroundColor Gray
    Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1

    # 如果还存在，强制删除
    if (Test-Path "dist") {
        Write-Host "  - 强制删除残留文件..." -ForegroundColor Gray
        cmd /c "rd /s /q dist" 2>$null
    }
}
Write-Host "  ✓ 构建目录已清理" -ForegroundColor Green
Write-Host ""

# 3. 重新编译
Write-Host "[3/4] 开始编译新版本..." -ForegroundColor Yellow
Write-Host ""
npm run pack

# 4. 检查结果
Write-Host ""
Write-Host "[4/4] 检查编译结果..." -ForegroundColor Yellow
if (Test-Path "dist\win-unpacked\Ququ Voice Input.exe") {
    $exe = Get-Item "dist\win-unpacked\Ququ Voice Input.exe"
    $sizeMB = [math]::Round($exe.Length / 1MB, 2)
    Write-Host "  ✓ 编译成功!" -ForegroundColor Green
    Write-Host "  - 可执行文件: $($exe.Name)" -ForegroundColor Gray
    Write-Host "  - 大小: $sizeMB MB" -ForegroundColor Gray
    Write-Host "  - 时间: $($exe.LastWriteTime)" -ForegroundColor Gray
} else {
    Write-Host "  ✗ 编译失败，未找到可执行文件" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  完成!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
