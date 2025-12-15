# Test webhook-logger Edge Function
$Secret = "dev_secret_key_123456"
$WEBHOOK_LOGGER_URL = "https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/webhook-logger"

Write-Host "Probando webhook-logger..." -ForegroundColor Cyan

# Payload
$payload = @{
    event = "product.stockReserved"
    idempotency_key = [guid]::NewGuid().ToString()
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    data = @{
        approved = $true
        productId = "test-product-id"
        quantity = 2
    }
    metadata = @{
        source = "products-service"
    }
} | ConvertTo-Json -Compress

# Timestamp Unix
$timestamp = [Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalSeconds)

# Generar HMAC
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = "sha256=" + [BitConverter]::ToString($hash).Replace("-","").ToLower()

Write-Host "Payload: $payload" -ForegroundColor Gray
Write-Host "Timestamp: $timestamp" -ForegroundColor Yellow
Write-Host "Signature: $signature" -ForegroundColor Green
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri $WEBHOOK_LOGGER_URL -Method Post `
        -ContentType "application/json" `
        -Body $payload `
        -Headers @{
            "X-Webhook-Signature" = $signature
            "X-Webhook-Timestamp" = $timestamp.ToString()
        }
    
    Write-Host "SUCCESS!" -ForegroundColor Green
    $response | ConvertTo-Json | Write-Host
}
catch {
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Ver logs en:" -ForegroundColor Yellow
    Write-Host "https://supabase.com/dashboard/project/zjynrmbugltvupttaxqz/logs/edge-functions" -ForegroundColor Blue
    Write-Host ""
    Write-Host "O en CLI: supabase functions logs webhook-logger" -ForegroundColor Cyan
}
