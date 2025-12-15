# =========================================================
# Test: Dynamic Webhook Subscribers from Supabase
# Este script prueba la lectura dinámica de suscriptores
# =========================================================

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Test: Webhook Subscribers Dinámicos" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$baseUrl = "http://localhost:3003"

# Test 1: Health check con información de suscriptores
Write-Host "`n[TEST 1] Health Check con Subscribers Stats" -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$baseUrl/health" -Method Get
    Write-Host "  Status: $($health.status)" -ForegroundColor Green
    Write-Host "  Subscribers Count: $($health.subscribers.count)" -ForegroundColor White
    Write-Host "  Cache Valid: $($health.subscribers.cacheValid)" -ForegroundColor White
    Write-Host "  Using Fallback: $($health.subscribers.usingFallback)" -ForegroundColor $(if ($health.subscribers.usingFallback) { "Yellow" } else { "Green" })
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 2: Listar todos los suscriptores activos
Write-Host "`n[TEST 2] Listar Subscribers Activos" -ForegroundColor Yellow
try {
    $subscribers = Invoke-RestMethod -Uri "$baseUrl/health/subscribers" -Method Get
    Write-Host "  Total: $($subscribers.total)" -ForegroundColor Green
    Write-Host "  Cache Age: $($subscribers.cache.ageMs)ms" -ForegroundColor White
    
    foreach ($sub in $subscribers.subscribers) {
        Write-Host "`n  📌 $($sub.name)" -ForegroundColor Cyan
        Write-Host "     URL: $($sub.url)" -ForegroundColor White
        Write-Host "     Patterns: $($sub.eventPatterns -join ', ')" -ForegroundColor White
        Write-Host "     Active: $($sub.isActive)" -ForegroundColor White
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 3: Forzar refresh del caché
Write-Host "`n[TEST 3] Forzar Refresh de Cache" -ForegroundColor Yellow
try {
    $refresh = Invoke-RestMethod -Uri "$baseUrl/health/subscribers/refresh" -Method Post
    Write-Host "  Message: $($refresh.message)" -ForegroundColor Green
    Write-Host "  Count: $($refresh.count)" -ForegroundColor White
    
    foreach ($sub in $refresh.subscribers) {
        Write-Host "  - $($sub.name): $($sub.eventPatterns -join ', ')" -ForegroundColor White
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Test 4: Verificar readiness
Write-Host "`n[TEST 4] Readiness Check" -ForegroundColor Yellow
try {
    $ready = Invoke-RestMethod -Uri "$baseUrl/health/ready" -Method Get
    Write-Host "  Status: $($ready.status)" -ForegroundColor Green
    Write-Host "  Subscribers Loaded: $($ready.subscribers.loaded)" -ForegroundColor White
    Write-Host "  Subscribers Count: $($ready.subscribers.count)" -ForegroundColor White
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host " Tests Completados" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# =========================================================
# Instrucciones para simular diferentes escenarios
# =========================================================
Write-Host "`n📋 INSTRUCCIONES PARA PRUEBAS MANUALES:" -ForegroundColor Magenta
Write-Host @"

1. AGREGAR SUBSCRIBER EN SUPABASE:
   - Ve a Supabase Dashboard > SQL Editor
   - Ejecuta:
     INSERT INTO webhook_subscribers (name, target_url, event_patterns, is_active)
     VALUES ('mi-nuevo-webhook', 'https://mi-servidor.com/webhook', '["order.*"]', true);

2. SIMULAR 2 SUBSCRIBERS DISTINTOS:
   - Subscriber 1: Solo eventos de productos
     INSERT INTO webhook_subscribers (name, target_url, event_patterns, is_active)
     VALUES ('products-only', 'https://ejemplo.com/products', '["product.*"]', true);
   
   - Subscriber 2: Solo eventos de órdenes confirmadas
     INSERT INTO webhook_subscribers (name, target_url, event_patterns, is_active)
     VALUES ('orders-confirmed', 'https://ejemplo.com/orders', '["order.confirmed"]', true);

3. DESACTIVAR UN SUBSCRIBER:
   UPDATE webhook_subscribers SET is_active = false WHERE name = 'telegram-notifier';

4. CAMBIAR PATRONES DE EVENTOS:
   UPDATE webhook_subscribers SET event_patterns = '["*"]' WHERE name = 'webhook-logger';

5. VER SUSCRIPTORES EN TIEMPO REAL:
   - Espera 45 segundos para que expire el caché
   - O usa POST /health/subscribers/refresh para forzar actualización

"@ -ForegroundColor White
