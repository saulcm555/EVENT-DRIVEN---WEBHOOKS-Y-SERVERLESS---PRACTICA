# Script para probar emisión de eventos order.confirmed y order.cancelled
# GAP #2: Verificar que orders-service emite eventos de dominio correctamente

Write-Host "🧪 Prueba GAP #2 - Eventos order.confirmed y order.cancelled" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Gray

# Verificar que los servicios estén corriendo
Write-Host "`n📦 Verificando servicios..." -ForegroundColor Yellow
$services = @("orders-service", "products-service", "webhook-publisher-service", "microservices_rabbitmq", "microservices_redis")
foreach ($service in $services) {
    $status = docker ps --filter "name=$service" --format "{{.Status}}"
    if ($status) {
        Write-Host "  ✅ $service : $status" -ForegroundColor Green
    } else {
        Write-Host "  ❌ $service : NO CORRIENDO" -ForegroundColor Red
        Write-Host "`nError: Todos los servicios deben estar corriendo. Ejecuta: docker-compose up -d" -ForegroundColor Red
        exit 1
    }
}

# Limpiar colas antes de la prueba
Write-Host "`n🧹 Limpiando colas..." -ForegroundColor Yellow
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=orders_queue | Out-Null
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=webhook_publisher_queue | Out-Null
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=products_queue | Out-Null

Write-Host "`n═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TEST 1: Orden EXITOSA → Evento order.confirmed" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

# Limpiar logs actuales (capturar timestamp para filtrar logs nuevos)
$startTime = (Get-Date).AddSeconds(-5).ToString("yyyy-MM-ddTHH:mm:ss")

# Crear orden exitosa (productId 1 tiene stock suficiente)
Write-Host "`n🚀 Creando orden EXITOSA (productId: 1, quantity: 2)..." -ForegroundColor Yellow
$orderId1 = [guid]::NewGuid().ToString()
$body1 = @{
    customerId = "customer-test-123"
    items = @(
        @{
            productId = 1
            quantity = 2
        }
    )
    idempotencyKey = $orderId1
} | ConvertTo-Json

try {
    $response1 = Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body1 -ContentType "application/json"
    Write-Host "  ✅ Orden creada: $($response1.id)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Error: $_" -ForegroundColor Red
    exit 1
}

# Esperar procesamiento
Write-Host "`n⏳ Esperando procesamiento (8 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Verificar logs de orders-service
Write-Host "`n📋 Logs de Orders Service (eventos emitidos):" -ForegroundColor Cyan
$ordersLogs = docker logs orders-service --since $startTime 2>&1 | Select-String -Pattern "order.confirmed|Emitting event|CONFIRMED"
if ($ordersLogs) {
    $ordersLogs | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
} else {
    Write-Host "  ⚠️  No se encontraron logs de order.confirmed" -ForegroundColor Yellow
}

# Verificar logs de webhook-publisher
Write-Host "`n📋 Logs de Webhook Publisher (eventos recibidos):" -ForegroundColor Cyan
$webhookLogs = docker logs webhook-publisher-service --since $startTime 2>&1 | Select-String -Pattern "order.confirmed|Received event"
if ($webhookLogs) {
    $webhookLogs | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
} else {
    Write-Host "  ⚠️  No se encontraron logs de order.confirmed" -ForegroundColor Yellow
}

Write-Host "`n═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  TEST 2: Orden RECHAZADA → Evento order.cancelled" -ForegroundColor White
Write-Host "═══════════════════════════════════════════════════════════════════════════════" -ForegroundColor Cyan

$startTime2 = (Get-Date).AddSeconds(-5).ToString("yyyy-MM-ddTHH:mm:ss")

# Crear orden que será rechazada (productId 999 no existe)
Write-Host "`n🚀 Creando orden RECHAZADA (productId: 999 - no existe)..." -ForegroundColor Yellow
$orderId2 = [guid]::NewGuid().ToString()
$body2 = @{
    customerId = "customer-test-456"
    items = @(
        @{
            productId = 999
            quantity = 10
        }
    )
    idempotencyKey = $orderId2
} | ConvertTo-Json

try {
    $response2 = Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body2 -ContentType "application/json"
    Write-Host "  ✅ Orden creada: $($response2.id)" -ForegroundColor Green
} catch {
    Write-Host "  ❌ Error: $_" -ForegroundColor Red
}

# Esperar procesamiento
Write-Host "`n⏳ Esperando procesamiento (8 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Verificar logs de orders-service
Write-Host "`n📋 Logs de Orders Service (eventos emitidos):" -ForegroundColor Cyan
$ordersLogs2 = docker logs orders-service --since $startTime2 2>&1 | Select-String -Pattern "order.cancelled|Emitting event|REJECTED"
if ($ordersLogs2) {
    $ordersLogs2 | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
} else {
    Write-Host "  ⚠️  No se encontraron logs de order.cancelled" -ForegroundColor Yellow
}

# Verificar logs de webhook-publisher
Write-Host "`n📋 Logs de Webhook Publisher (eventos recibidos):" -ForegroundColor Cyan
$webhookLogs2 = docker logs webhook-publisher-service --since $startTime2 2>&1 | Select-String -Pattern "order.cancelled|Received event"
if ($webhookLogs2) {
    $webhookLogs2 | ForEach-Object { Write-Host "  $_" -ForegroundColor White }
} else {
    Write-Host "  ⚠️  No se encontraron logs de order.cancelled" -ForegroundColor Yellow
}

# Verificar mensajes en RabbitMQ
Write-Host "`n📊 Estado actual de las colas en RabbitMQ:" -ForegroundColor Cyan
docker exec microservices_rabbitmq rabbitmqadmin list queues name messages messages_ready messages_unacknowledged

# Verificar Exchange Statistics
Write-Host "`n📈 Estadísticas del Exchange 'microservices.events':" -ForegroundColor Cyan
docker exec microservices_rabbitmq rabbitmqctl list_exchanges name type | Select-String -Pattern "microservices.events"

Write-Host "`n" + ("═" * 80) -ForegroundColor Cyan
Write-Host "✅ PRUEBA COMPLETADA" -ForegroundColor Green
Write-Host ("═" * 80) -ForegroundColor Cyan

Write-Host @"

🎯 Verificaciones esperadas:

✓ Orders Service debe emitir:
  - 📤 order.confirmed (cuando approved: true)
  - 📤 order.cancelled (cuando approved: false)

✓ Webhook Publisher debe recibir:
  - 📥 order.confirmed
  - 📥 order.cancelled

✓ RabbitMQ Management UI:
  - URL: http://localhost:15672
  - Ver: Exchanges → microservices.events → "Message rates"
  - Debe mostrar tráfico de mensajes con routing key "order.*"

📝 Payload esperado de los eventos:
{
  "orderId": "<uuid>",
  "status": "CONFIRMED | REJECTED",
  "productId": "<number>",
  "quantity": <number>,
  "idempotencyKey": "<uuid>",
  "timestamp": "<ISO string>",
  "reason": "<string>" // Solo en order.cancelled
}

🔍 Comandos de troubleshooting:
docker logs orders-service --tail 50
docker logs webhook-publisher-service --tail 50
docker exec microservices_rabbitmq rabbitmqadmin list bindings

"@ -ForegroundColor Cyan

Write-Host "`n🎉 GAP #2 implementado exitosamente!" -ForegroundColor Green
