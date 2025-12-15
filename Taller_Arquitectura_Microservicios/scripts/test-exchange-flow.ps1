# Script para probar el flujo completo con RabbitMQ Exchange
# Este script verifica que los eventos se distribuyan correctamente a múltiples consumidores

Write-Host "🧪 Prueba de RabbitMQ Exchange - Eliminación de Competing Consumers" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Gray

# 1. Verificar estado de contenedores
Write-Host "`n📦 Verificando contenedores..." -ForegroundColor Yellow
docker ps --format "table {{.Names}}\t{{.Status}}" | Select-String -Pattern "rabbitmq|redis|orders|products|webhook"

# 2. Verificar configuración de RabbitMQ
Write-Host "`n🔍 Verificando configuración de RabbitMQ..." -ForegroundColor Yellow
Write-Host "`nExchange:" -ForegroundColor Cyan
docker exec microservices_rabbitmq rabbitmqadmin list exchanges name type | Select-String -Pattern "microservices.events"

Write-Host "`nColas:" -ForegroundColor Cyan
docker exec microservices_rabbitmq rabbitmqadmin list queues name messages

Write-Host "`nBindings activos:" -ForegroundColor Cyan
docker exec microservices_rabbitmq rabbitmqadmin list bindings source destination routing_key | Select-String -Pattern "microservices.events"

# 3. Limpiar mensajes antiguos de las colas
Write-Host "`n🧹 Limpiando mensajes antiguos..." -ForegroundColor Yellow
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=orders_queue
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=products_queue
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=webhook_publisher_queue

# 4. Verificar logs antes de la prueba
Write-Host "`n📝 Preparando para monitorear logs..." -ForegroundColor Yellow
Write-Host "Presiona Enter para iniciar la prueba..." -ForegroundColor Green
Read-Host

# 5. Crear una orden (esto debería generar el evento product.stockReserved)
Write-Host "`n🚀 Creando orden de prueba..." -ForegroundColor Yellow
$orderId = [guid]::NewGuid().ToString()
$body = @{
    customerId = "customer-test-123"
    items = @(
        @{
            productId = 1
            quantity = 2
        }
    )
    idempotencyKey = $orderId
} | ConvertTo-Json

Write-Host "Body: $body" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body -ContentType "application/json"
    Write-Host "✅ Orden creada exitosamente" -ForegroundColor Green
    Write-Host "Response: $($response | ConvertTo-Json -Depth 3)" -ForegroundColor Gray
} catch {
    Write-Host "❌ Error al crear orden: $_" -ForegroundColor Red
    exit 1
}

# 6. Esperar propagación
Write-Host "`n⏳ Esperando propagación de eventos (10 segundos)..." -ForegroundColor Yellow
Start-Sleep -Seconds 10

# 7. Verificar mensajes en las colas
Write-Host "`n📊 Estado de las colas después del evento:" -ForegroundColor Yellow
docker exec microservices_rabbitmq rabbitmqadmin list queues name messages messages_ready messages_unacknowledged

# 8. Revisar logs de cada servicio
Write-Host "`n📋 Logs de Orders Service (últimas 20 líneas):" -ForegroundColor Yellow
docker logs orders-service --tail 20

Write-Host "`n📋 Logs de Webhook Publisher (últimas 20 líneas):" -ForegroundColor Yellow
docker logs webhook-publisher-service --tail 20

# 9. Verificar estadísticas del exchange
Write-Host "`n📈 Estadísticas del exchange:" -ForegroundColor Yellow
docker exec microservices_rabbitmq rabbitmqctl list_exchanges name type | Select-String -Pattern "microservices.events"

# 10. Resumen
Write-Host "`n" + ("=" * 70) -ForegroundColor Gray
Write-Host "✅ Prueba completada" -ForegroundColor Green
Write-Host @"

🎯 Verificaciones esperadas:
   1. Exchange 'microservices.events' existe y es tipo 'topic'
   2. 3 colas existen: orders_queue, products_queue, webhook_publisher_queue
   3. Bindings correctos con routing keys 'product.*' y 'order.*'
   4. AMBOS servicios (orders-service Y webhook-publisher) reciben el evento 'product.stockReserved'
   5. No hay mensajes perdidos (competing consumers resuelto)

📝 Siguiente paso: Revisar RabbitMQ Management UI
   URL: http://localhost:15672
   User/Pass: guest/guest
   
   Ir a: Exchanges → microservices.events → Bindings
   Verificar que aparezcan las 3 colas con sus routing keys

"@ -ForegroundColor Cyan
