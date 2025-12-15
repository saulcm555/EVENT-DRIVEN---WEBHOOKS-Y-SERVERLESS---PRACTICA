# Test HMAC Edge Functions
param(
    [string]$Secret = "dev_secret_key_123456"
)

$TELEGRAM_URL = "https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/telegram-notifier"

# Payload de prueba
$payload = @{
    event = "product.stockReserved"
    idempotency_key = "test-$(Get-Date -Format 'yyyyMMddHHmmss')"
    timestamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
    data = @{
        approved = $true
        productId = "test-product-id"
        quantity = 2
    }
} | ConvertTo-Json -Compress

# Timestamp Unix
$timestamp = [Math]::Floor((Get-Date).ToUniversalTime().Subtract([DateTime]'1970-01-01').TotalSeconds)

# Generar HMAC
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
$hash = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($payload))
$signature = "sha256=" + [BitConverter]::ToString($hash).Replace("-","").ToLower()

Write-Host "Payload: $payload" -ForegroundColor Cyan
Write-Host "Timestamp: $timestamp" -ForegroundColor Yellow
Write-Host "Signature: $signature" -ForegroundColor Green
Write-Host ""

# Hacer request
try {
    $response = Invoke-RestMethod -Uri $TELEGRAM_URL -Method Post `
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
}
