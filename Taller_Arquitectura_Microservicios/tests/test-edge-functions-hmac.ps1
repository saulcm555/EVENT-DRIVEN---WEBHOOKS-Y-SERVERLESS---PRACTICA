# Script de PowerShell para probar Edge Functions con validación HMAC
# Genera la firma HMAC-SHA256 correcta

# Configuración
$WEBHOOK_SECRET = "dev_secret_key_123456"
$TELEGRAM_NOTIFIER_URL = "https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/telegram-notifier"
$WEBHOOK_LOGGER_URL = "https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/webhook-logger"

# Payload de prueba
$payload = @{
    event = "product.stockReserved"
    idempotency_key = "test-hmac-$(Get-Date -Format 'yyyyMMddHHmmss')"
    timestamp = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ")
    data = @{
        approved = $true
        productId = "6053d96d-9598-42b6-860b-b58af082a071"
        quantity = 2
    }
    metadata = @{
        source = "products-service"
    }
}

# Convertir a JSON
$payloadJson = $payload | ConvertTo-Json -Depth 10 -Compress

# Generar timestamp Unix (segundos desde epoch)
$timestamp = [Math]::Floor((Get-Date -UFormat %s))

Write-Host "🔐 Generando firma HMAC..." -ForegroundColor Yellow

# Generar firma HMAC-SHA256
$hmac = New-Object System.Security.Cryptography.HMACSHA256
$hmac.Key = [System.Text.Encoding]::UTF8.GetBytes($WEBHOOK_SECRET)
$hashBytes = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($payloadJson))
$signature = "sha256=" + [System.BitConverter]::ToString($hashBytes).Replace("-", "").ToLower()

Write-Host "✅ Payload JSON: $payloadJson" -ForegroundColor Gray
Write-Host "✅ Timestamp: $timestamp" -ForegroundColor Green
Write-Host "✅ Firma HMAC: $signature" -ForegroundColor Green
Write-Host ""

# Función para probar endpoint
function Test-EdgeFunction {
    param(
        [string]$Name,
        [string]$Url,
        [string]$Payload,
        [string]$Signature,
        [string]$Timestamp
    )
    
    Write-Host "🧪 Probando: $Name" -ForegroundColor Cyan
    Write-Host "URL: $Url"
    Write-Host "Signature: $Signature"
    Write-Host "Timestamp: $Timestamp"
    Write-Host ""
    
    try {
        $headers = @{ 
            "X-Webhook-Signature" = $Signature
            "X-Webhook-Timestamp" = $Timestamp
        }
        
        $response = Invoke-RestMethod `
            -Uri $Url `
            -Method Post `
            -ContentType "application/json" `
            -Body $Payload `
            -Headers $headers
        
        Write-Host "✅ Respuesta exitosa:" -ForegroundColor Green
        $response | ConvertTo-Json -Depth 10 | Write-Host
        Write-Host ""
        return $true
    }
    catch {
        Write-Host "❌ Error:" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Write-Host ""
        return $false
    }
}

Write-Host "================================================" -ForegroundColor Yellow
Write-Host "  PRUEBA DE EDGE FUNCTIONS CON HMAC" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""

# Probar telegram-notifier
$result1 = Test-EdgeFunction `
    -Name "telegram-notifier" `
    -Url $TELEGRAM_NOTIFIER_URL `
    -Payload $payloadJson `
    -Signature $signature `
    -Timestamp $timestamp

Start-Sleep -Seconds 2

# Probar webhook-logger
$result2 = Test-EdgeFunction `
    -Name "webhook-logger" `
    -Url $WEBHOOK_LOGGER_URL `
    -Payload $payloadJson `
    -Signature $signature `
    -Timestamp $timestamp

Write-Host "================================================" -ForegroundColor Yellow
Write-Host "  RESUMEN DE PRUEBAS" -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Yellow

if ($result1) {
    Write-Host "✅ telegram-notifier: OK" -ForegroundColor Green
    Write-Host "   → Deberías haber recibido un mensaje en Telegram" -ForegroundColor Gray
} else {
    Write-Host "❌ telegram-notifier: FAILED" -ForegroundColor Red
}

if ($result2) {
    Write-Host "✅ webhook-logger: OK" -ForegroundColor Green
    Write-Host "   → Evento registrado en tabla webhook_events_log" -ForegroundColor Gray
} else {
    Write-Host "❌ webhook-logger: FAILED" -ForegroundColor Red
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Yellow
Write-Host ""

# Probar sin firma (debe fallar)
Write-Host "🧪 Probando sin firma HMAC (debe fallar con 401):" -ForegroundColor Cyan
Write-Host ""

try {
    $response = Invoke-RestMethod `
        -Uri $TELEGRAM_NOTIFIER_URL `
        -Method Post `
        -ContentType "application/json" `
        -Body $payloadJson
    
    Write-Host "❌ ERROR: La función aceptó webhook sin firma" -ForegroundColor Red
}
catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 401) {
        Write-Host "✅ Correcto: Rechazado con 401 Unauthorized" -ForegroundColor Green
    } else {
        Write-Host "⚠️ Error inesperado: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Pruebas completadas exitosamente" -ForegroundColor Green
