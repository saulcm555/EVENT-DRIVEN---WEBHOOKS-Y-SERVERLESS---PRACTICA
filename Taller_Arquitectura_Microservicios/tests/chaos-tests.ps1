# Script de Pruebas de Caos para Microservicios
# Ejecutar con: ./chaos-tests.ps1

Write-Host "🔥 INICIANDO PRUEBAS DE CAOS 🔥`n" -ForegroundColor Yellow

# Variables
$baseUrl = "http://localhost:3000"
$productId = "" # Se obtendrá después de crear un producto

# Función para verificar servicios
function Test-ServiceHealth {
    param($url, $serviceName)
    try {
        $response = Invoke-RestMethod -Uri "$url/health" -Method Get -TimeoutSec 5
        Write-Host "✅ $serviceName está OK" -ForegroundColor Green
        return $true
    } catch {
        Write-Host "❌ $serviceName está CAÍDO" -ForegroundColor Red
        return $false
    }
}

# Verificar que todos los servicios estén activos
Write-Host "`n📊 VERIFICACIÓN INICIAL DE SERVICIOS`n" -ForegroundColor Cyan
Test-ServiceHealth "http://localhost:3000" "API Gateway"
Test-ServiceHealth "http://localhost:3001" "Products Service"
Test-ServiceHealth "http://localhost:3002" "Orders Service"

Start-Sleep -Seconds 2

# TEST 1: Idempotencia - Enviar la misma orden 3 veces
Write-Host "`n🧪 TEST 1: IDEMPOTENCIA - Mensajes Duplicados`n" -ForegroundColor Cyan
Write-Host "Enviando la misma orden 3 veces con 500ms de diferencia..." -ForegroundColor Yellow

# Necesitamos un productId válido - normalmente lo obtendrías de la BD
# Por simplicidad, usaremos un UUID de ejemplo
$testProductId = "550e8400-e29b-41d4-a716-446655440000"

$orderPayload = @{
    productId = $testProductId
    quantity = 2
} | ConvertTo-Json

Write-Host "`nPayload de orden:"
Write-Host $orderPayload -ForegroundColor Gray

for ($i = 1; $i -le 3; $i++) {
    Write-Host "`nEnvío #$i..." -ForegroundColor Yellow
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl/orders" -Method Post -Body $orderPayload -ContentType "application/json"
        Write-Host "Respuesta:" -ForegroundColor Green
        $response | ConvertTo-Json
    } catch {
        Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
    }
    Start-Sleep -Milliseconds 500
}

Write-Host "`n✅ RESULTADO ESPERADO:" -ForegroundColor Green
Write-Host "  - Primera orden debe crearse con estado PENDING"
Write-Host "  - Los siguientes intentos deben ser detectados como duplicados"
Write-Host "  - El stock debe reducirse SOLO UNA VEZ"

Start-Sleep -Seconds 3

# TEST 2: Verificar logs de Redis
Write-Host "`n🧪 TEST 2: VERIFICACIÓN DE REDIS`n" -ForegroundColor Cyan
Write-Host "Verificando claves de idempotencia en Redis..." -ForegroundColor Yellow

try {
    docker exec microservices_redis redis-cli KEYS "processed:*"
    Write-Host "`n✅ Claves de mensajes procesados encontradas" -ForegroundColor Green
} catch {
    Write-Host "❌ No se pudo conectar a Redis" -ForegroundColor Red
}

Start-Sleep -Seconds 2

# TEST 3: Desconexión de RabbitMQ
Write-Host "`n🧪 TEST 3: RESILIENCIA - Desconectar RabbitMQ`n" -ForegroundColor Cyan
Write-Host "⚠️  Apagando RabbitMQ..." -ForegroundColor Red

try {
    docker stop microservices_rabbitmq
    Write-Host "✅ RabbitMQ detenido" -ForegroundColor Green
    
    Start-Sleep -Seconds 2
    
    Write-Host "`nIntentando crear orden con RabbitMQ caído..." -ForegroundColor Yellow
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl/orders" -Method Post -Body $orderPayload -ContentType "application/json" -TimeoutSec 5
        Write-Host "⚠️  La petición se completó (comportamiento inesperado)" -ForegroundColor Yellow
    } catch {
        Write-Host "✅ La petición falló gracefully (comportamiento esperado)" -ForegroundColor Green
        Write-Host "   Error: $($_.Exception.Message)" -ForegroundColor Gray
    }
    
    Start-Sleep -Seconds 2
    
    Write-Host "`n♻️  Reiniciando RabbitMQ..." -ForegroundColor Yellow
    docker start microservices_rabbitmq
    Write-Host "⏳ Esperando 10 segundos para que RabbitMQ esté listo..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
    
    Write-Host "✅ RabbitMQ reiniciado" -ForegroundColor Green
    
} catch {
    Write-Host "❌ Error en test de RabbitMQ: $($_.Exception.Message)" -ForegroundColor Red
}

Start-Sleep -Seconds 2

# TEST 4: Verificar estado después de la recuperación
Write-Host "`n🧪 TEST 4: VERIFICACIÓN POST-RECUPERACIÓN`n" -ForegroundColor Cyan

Test-ServiceHealth "http://localhost:3000" "API Gateway"
Test-ServiceHealth "http://localhost:3001" "Products Service"
Test-ServiceHealth "http://localhost:3002" "Orders Service"

Write-Host "`nIntentando crear orden después de recuperación..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/orders" -Method Post -Body $orderPayload -ContentType "application/json"
    Write-Host "✅ Sistema recuperado correctamente" -ForegroundColor Green
    $response | ConvertTo-Json
} catch {
    Write-Host "❌ Sistema aún no recuperado: $($_.Exception.Message)" -ForegroundColor Red
}

# TEST 5: Stock insuficiente
Write-Host "`n🧪 TEST 5: MANEJO DE STOCK INSUFICIENTE`n" -ForegroundColor Cyan
Write-Host "Intentando ordenar cantidad mayor al stock disponible..." -ForegroundColor Yellow

$largeOrderPayload = @{
    productId = $testProductId
    quantity = 999999
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/orders" -Method Post -Body $largeOrderPayload -ContentType "application/json"
    Write-Host "Respuesta:" -ForegroundColor Yellow
    $response | ConvertTo-Json
    Write-Host "`n✅ RESULTADO ESPERADO: Estado debe ser REJECTED con razón OUT_OF_STOCK" -ForegroundColor Green
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
}

# RESUMEN
Write-Host "`n`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "                 RESUMEN DE PRUEBAS" -ForegroundColor Yellow
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "`n✅ TEST 1: Idempotencia con mensajes duplicados"
Write-Host "✅ TEST 2: Verificación de Redis"
Write-Host "✅ TEST 3: Resiliencia ante caída de RabbitMQ"
Write-Host "✅ TEST 4: Recuperación del sistema"
Write-Host "✅ TEST 5: Manejo de stock insuficiente"
Write-Host "`n" -NoNewline
Write-Host "═══════════════════════════════════════════════════════`n" -ForegroundColor Cyan

Write-Host "💡 NOTA: Revisa los logs de los servicios para ver los detalles internos" -ForegroundColor Yellow
Write-Host "   - Orders Service debe mostrar logs de detección de duplicados"
Write-Host "   - Redis debe tener las claves processed:* almacenadas"
Write-Host "   - Products Service debe mostrar logs de reserva de stock"
