Get-Process | Where-Object { $_.ProcessName -like '*electron*' -or $_.ProcessName -like '*ququ*' } | Stop-Process -Force
