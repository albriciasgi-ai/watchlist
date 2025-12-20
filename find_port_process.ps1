$connections = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    $processId = $conn.OwningProcess
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Puerto: $($conn.LocalPort) | PID: $processId | Proceso: $($proc.ProcessName) | Path: $($proc.Path)"
    } else {
        Write-Host "Puerto: $($conn.LocalPort) | PID: $processId | Proceso: (zombie/no existe)"
    }
}
