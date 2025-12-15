# 🎓 GUÍA DE PRESENTACIÓN - ARQUITECTURA DE MICROSERVICIOS CON RESILIENCIA

## 📌 INTRODUCCIÓN (2 minutos)

### Qué Decir Exactamente

**"Hice un sistema de órdenes y productos con 3 servicios que se comunican entre sí. Lo importante es que si algo falla, el sistema se recupera solo sin perder datos."**

### Tecnologías (mencionar solo si preguntan)
- NestJS para los servicios
- RabbitMQ para que los servicios se hablen entre sí
- Redis para evitar duplicados
- Docker para levantar todo junto

---

## 🏗️ PARTE 1: ARQUITECTURA IMPLEMENTADA (3 minutos)

### Qué Decir Mientras Muestras el Diagrama

**"Tengo 3 servicios:**
1. **API Gateway** - Recibe las peticiones del usuario (como crear una orden)
2. **Products Service** - Controla cuánto stock hay de cada producto
3. **Orders Service** - Guarda las órdenes

**Los servicios hablan entre sí con RabbitMQ (mensajes), no HTTP directo. Así si uno está lento, no se traban los demás."**

**"Y uso Redis para que si llega el mismo mensaje dos veces, no se procese duplicado."**

```
┌──────────────┐
│   Cliente    │
└──────┬───────┘
       │ HTTP
       ▼
┌──────────────────┐
│  API Gateway     │ (Puerto 3000)
│  - REST API      │
│  - Validación    │
└────────┬─────────┘
         │ RabbitMQ
         ▼
    ┌────────────────────┐
    │                    │
┌───▼──────────┐  ┌─────▼──────────┐
│   Products   │  │    Orders      │
│   Service    │  │    Service     │
│ (Puerto 3001)│  │ (Puerto 3002)  │
│              │  │                │
│ - SQLite     │  │ - SQLite       │
│ - Stock Mgmt │  │ - Redis        │
└──────────────┘  └────────────────┘
                         │
                         ▼
                  ┌─────────────┐
                  │   Redis     │
                  │ (Puerto 6379)│
                  └─────────────┘
```

### Patrón de Comunicación
1. **Síncrona (HTTP)**: Cliente → API Gateway
2. **Asíncrona (RabbitMQ)**: Entre microservicios
   - Cola `orders_queue`: Para crear órdenes
   - Cola `products_queue`: Para reservar stock

### Patrón de Resiliencia Principal

**Qué Decir:**
**"La estrategia de resiliencia es IDEMPOTENCIA. Significa que si un mensaje se procesa dos veces por error, solo se ejecuta una vez. Cada mensaje tiene un código único que guardo en Redis. Cuando llega un mensaje, pregunto: '¿ya procesé este código?' Si sí, lo ignoro."**

---

## ✅ PARTE 2: DEMOSTRACIÓN HAPPY PATH (5 minutos)

### Qué Decir ANTES de Ejecutar

**"Voy a mostrar el flujo normal: crear una orden, que reserve stock, y que todo quede registrado correctamente."**

### Paso 1: Verificar Estado Inicial

**Decir:** "Primero veo qué productos tengo y cuánto stock hay"
cd C:\Users\Lilibeth\Desktop\practica_microservicios\products-service
@"
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('products.db');
db.all('SELECT id, name, stock FROM products', (err, rows) => {
  if (err) console.error(err);
  else console.table(rows);
});
"@ | Out-File -Encoding utf8 check.js; node check.js; Remove-Item check.js
```

**Decir:** "Laptop tiene X unidades. Ahora voy a crear una orden de 2 unidades."

### Paso 2: Crear Orden (Happy Path)

**Decir:** "Envío la solicitud al API Gateway con el ID del producto Laptop y cantidad 2"

```powershell
# 2.1 Configurar datos de la orden
$body = @{
    productId = "6053d96d-9598-42b6-860b-b58af082a071"  # Laptop
    quantity = 2
} | ConvertTo-Json

# 2.2 Enviar solicitud al API Gateway
Write-Host "`n🔹 Creando nueva orden..." -ForegroundColor Cyan
Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body -ContentType "application/json"
```

**Mientras se ejecuta, decir:**
**"El Gateway creó la orden y le puso un código único. Ahora envía un mensaje a Products para reservar stock. Products revisa, reduce el stock, y envía otro mensaje a Orders diciendo 'stock reservado'. Orders verifica en Redis que el código no exista, lo procesa, y guarda el código para evitar duplicados."**

**Cuando aparezca el resultado:**
**"Aquí está: orden creada con estado PENDING y su código único (idempotencyKey)."**

### Paso 3: Verificar Resultados

**Decir:** "Ahora verifico que todo se guardó bien"

```powershell
# 3.1 Ver clave de idempotencia en Redis
docker exec microservices_redis redis-cli KEYS "processed:*"
```

**Decir:** "Redis tiene guardados todos los códigos de las órdenes procesadas. Si alguna se repite, la ignora."

```powershell
# 3.2 Verificar stock actualizado
@"
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('products.db');
db.all('SELECT name, stock FROM products WHERE id=\"6053d96d-9598-42b6-860b-b58af082a071\"', (err, rows) => {
  if (err) console.error(err);
  else console.table(rows);
});
"@ | Out-File -Encoding utf8 check.js; node check.js; Remove-Item check.js
```

**Decir:** "El stock bajó en 2. Todo consistente."

---

## 🔥 PARTE 3: PRUEBA DE RESILIENCIA (5 minutos)

### Qué Decir ANTES de Ejecutar

**"Ahora voy a tirar abajo RabbitMQ, que es lo que conecta los servicios. Voy a demostrar que el sistema falla controladamente, y cuando lo levanto de nuevo, se recupera solo."**

### Ejecución del Test de Caos

```powershell
# ====================================
# SCRIPT DE DEMOSTRACIÓN DE RESILIENCIA
# ====================================

Write-Host "════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  PRUEBA DE RESILIENCIA - RABBITMQ FAIL" -ForegroundColor Magenta
Write-Host "════════════════════════════════════════`n" -ForegroundColor Magenta

# Configuración de orden de prueba
$body = @{
    productId = "6053d96d-9598-42b6-860b-b58af082a071"
    quantity = 1
} | ConvertTo-Json

# ========== FASE 1: SIMULAR FALLO ==========
Write-Host "📍 FASE 1: Simulando caída de RabbitMQ" -ForegroundColor Red
Write-Host "   Deteniendo contenedor..." -ForegroundColor Gray
docker stop microservices_rabbitmq
Start-Sleep -Seconds 3

Write-Host "`n❌ Intentando crear orden SIN RabbitMQ disponible..." -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 10
    Write-Host "   ⚠️  Se completó (no esperado)" -ForegroundColor Yellow
} catch {
    Write-Host "   ✅ FALLÓ CORRECTAMENTE: $($_.Exception.Message)" -ForegroundColor Green
    Write-Host "   → El sistema detectó el fallo y rechazó la solicitud" -ForegroundColor Gray
}

# ========== FASE 2: RECUPERACIÓN ==========
Write-Host "`n📍 FASE 2: Recuperación automática" -ForegroundColor Cyan
Write-Host "   Reiniciando RabbitMQ..." -ForegroundColor Gray
docker start microservices_rabbitmq

Write-Host "   ⏳ Esperando reconexión de servicios (15 segundos)..." -ForegroundColor Gray
Start-Sleep -Seconds 15

Write-Host "`n✅ Probando DESPUÉS de la recuperación..." -ForegroundColor Green
$result = Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body -ContentType "application/json"
Write-Host "   ✅ ÉXITO: Orden creada con ID: $($result.id)" -ForegroundColor Green
Write-Host "   → IdempotencyKey: $($result.idempotencyKey)" -ForegroundColor Gray

# ========== FASE 3: VERIFICACIÓN ==========
Write-Host "`n📍 FASE 3: Verificación de consistencia" -ForegroundColor Magenta

Write-Host "`n   Clave almacenada en Redis:" -ForegroundColor Yellow
docker exec microservices_redis redis-cli GET "processed:$($result.idempotencyKey)"

Write-Host "`n   Stock actualizado:" -ForegroundColor Yellow
@"
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('products.db');
db.all('SELECT name, stock FROM products WHERE id=\"6053d96d-9598-42b6-860b-b58af082a071\"', (err, rows) => {
  if (err) console.error(err);
  else console.table(rows);
});
"@ | Out-File -Encoding utf8 check.js; node check.js; Remove-Item check.js

Write-Host "`n════════════════════════════════════════" -ForegroundColor Magenta
Write-Host "  ✅ PRUEBA DE RESILIENCIA COMPLETADA" -ForegroundColor Green
Write-Host "════════════════════════════════════════`n" -ForegroundColor Magenta
```

### Explicación DURANTE la Demostración

**FASE 1 - Cuando veas el error:**
**"Perfecto, falló como esperaba. El Gateway intentó enviar el mensaje pero RabbitMQ no está. Dio error 500. No se perdió nada, solo rechazó la petición."**

**FASE 2 - Mientras espera 15 segundos:**
**"Reinicié RabbitMQ. Los servicios se están reconectando automáticamente. Uso una librería que reintenta cada 3 segundos sin que yo tenga que programarlo."**

**FASE 3 - Cuando funcione la orden:**
**"Listo, la misma operación ahora funcionó. No tuve que reiniciar nada más, solo RabbitMQ. El sistema se recuperó solo."**

**Al verificar Redis y stock:**
**"Y acá confirmo: la orden se procesó, Redis la guardó, y el stock bajó. Cero pérdida de datos."**

---

## 💡 PARTE 4: EXPLICACIÓN TÉCNICA (3 minutos)

### Solo Mostrar el Código SI el Profesor Pide Detalles

**Si pregunta "¿Cómo funciona la idempotencia?":**

**Decir:** "Acá está el código clave. Cuando llega un mensaje, primero pregunto a Redis: '¿este código ya existe?' Si existe, retorno y no hago nada. Si no existe, proceso la orden y guardo el código en Redis por 24 horas."

```typescript
// orders-service/src/orders/orders.service.ts
async handleStockReserved(data: any) {
  const { idempotencyKey } = data;

  // 1. Verificar si ya fue procesado
  const exists = await this.redisService.exists(`processed:${idempotencyKey}`);
  if (exists) {
    this.logger.warn(`Mensaje duplicado detectado: ${idempotencyKey}`);
    return; // Ignora sin error
  }

  // 2. Adquirir lock distribuido (previene race conditions)
  const lockAcquired = await this.redisService.setNX(
    `lock:${idempotencyKey}`, 
    '1', 
    10 // TTL 10 segundos
  );

  if (!lockAcquired) {
    this.logger.warn(`Lock no adquirido para: ${idempotencyKey}`);
    return;
  }

  // 3. Procesar orden
  order.status = OrderStatus.CONFIRMED;
  await this.orderRepository.save(order);

  // 4. Guardar clave en Redis (TTL 24 horas)
  await this.redisService.set(`processed:${idempotencyKey}`, '1', 86400);
}
```

**No expliques línea por línea. Solo di:**
**"Con esto evito duplicados. Y uso un lock para que si dos mensajes iguales llegan al mismo tiempo, solo uno se procese."**

---

**Si pregunta "¿Cómo se reconecta?":**

**Decir:** "Uso una librería llamada `amqp-connection-manager` que automáticamente reintenta la conexión cada 3 segundos. Así no tengo que programar la lógica de reintentos manualmente."**

---


---

