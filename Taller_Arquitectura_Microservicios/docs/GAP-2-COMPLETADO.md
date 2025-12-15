# ✅ GAP #2 - Eventos order.confirmed y order.cancelled: COMPLETADO

## 📋 Resumen
Orders Service ahora emite eventos de dominio propios (`order.confirmed` y `order.cancelled`) cuando procesa el resultado de la reserva de stock.

## 🎯 Objetivo Cumplido
Cuando una orden pasa de `PENDING` a `CONFIRMED` o `REJECTED`, orders-service emite:
- ✅ `order.confirmed` cuando `approved: true`
- ✅ `order.cancelled` cuando `approved: false` (con razón del rechazo)

## 📝 Cambios Implementados

### 1. Archivos Modificados

#### `orders-service/src/orders/orders.module.ts`
**Cambio**: Agregado nuevo ClientProxy `EVENTS_SERVICE` para publicar eventos.

```typescript
{
  name: 'EVENTS_SERVICE',
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
    queue: 'orders_queue',
    queueOptions: {
      durable: true,
    },
    // Publicar al exchange para que todos los consumidores reciban los eventos
    exchange: process.env.RABBITMQ_EXCHANGE || 'microservices.events',
    exchangeType: 'topic',
  },
}
```

**Justificación**: 
- Usa el exchange `microservices.events` configurado en GAP #1
- Publica a través del exchange (no directamente a la cola) para fanout
- Usa variables de entorno para flexibilidad

#### `orders-service/src/orders/orders.service.ts`
**Cambio 1**: Inyección del nuevo ClientProxy

```typescript
constructor(
  @InjectRepository(Order)
  private orderRepository: Repository<Order>,
  @Inject('PRODUCTS_SERVICE') private productsClient: ClientProxy,
  @Inject('EVENTS_SERVICE') private eventsClient: ClientProxy, // 👈 NUEVO
  private redisService: RedisService,
) {}
```

**Cambio 2**: Emisión de eventos en `handleStockReserved()`

```typescript
// Emitir eventos de dominio según el resultado
const eventPayload = {
  orderId: order.id,
  status: order.status,
  productId: data.productId,
  quantity: data.quantity,
  idempotencyKey: data.idempotencyKey,
  timestamp: new Date().toISOString(),
};

if (data.approved) {
  this.logger.log(`📤 Emitting event: order.confirmed for order ${order.id}`);
  this.eventsClient.emit('order.confirmed', eventPayload);
} else {
  this.logger.log(`📤 Emitting event: order.cancelled for order ${order.id}`);
  this.eventsClient.emit('order.cancelled', {
    ...eventPayload,
    reason: data.reason || 'STOCK_NOT_AVAILABLE',
  });
}
```

**Ubicación**: Después de `orderRepository.save(order)` y antes de marcar como procesado.

**Justificación**:
- Los eventos se emiten **después** de persistir en DB (garantiza consistencia)
- Usa `emit()` (fire-and-forget) ya que son eventos de dominio
- Incluye todos los datos necesarios: orderId, status, productId, quantity, timestamp
- `order.cancelled` incluye campo adicional `reason`

#### `orders-service/Dockerfile`
**Cambio**: `npm ci` → `npm install`

```dockerfile
RUN npm install
```

**Justificación**: El proyecto no tiene `package-lock.json`, por lo que `npm ci` falla.

### 2. Nuevos Archivos

#### `scripts/test-gap2-events.ps1`
Script automatizado de prueba que:
- ✅ Verifica servicios corriendo
- ✅ Limpia colas antes de la prueba
- ✅ **TEST 1**: Crea orden exitosa → verifica `order.confirmed`
- ✅ **TEST 2**: Crea orden rechazada → verifica `order.cancelled`
- ✅ Muestra logs de orders-service y webhook-publisher
- ✅ Verifica estado de colas en RabbitMQ

## 📊 Payload de los Eventos

### `order.confirmed`
```json
{
  "orderId": "123e4567-e89b-12d3-a456-426614174000",
  "status": "CONFIRMED",
  "productId": "1",
  "quantity": 2,
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-12-15T13:30:45.123Z"
}
```

### `order.cancelled`
```json
{
  "orderId": "123e4567-e89b-12d3-a456-426614174001",
  "status": "REJECTED",
  "productId": "999",
  "quantity": 10,
  "idempotencyKey": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2025-12-15T13:30:50.456Z",
  "reason": "PRODUCT_NOT_FOUND"
}
```

## 🔄 Flujo Completo

```
1. API Gateway recibe POST /orders
   ↓
2. Orders Service:
   - Crea orden (status: PENDING)
   - Emite: product.reserveStock
   ↓
3. Products Service:
   - Reserva stock (si hay disponible)
   - Emite: product.stockReserved {approved: true/false}
   ↓
4. Orders Service (GAP #2 🆕):
   - Recibe: product.stockReserved
   - Actualiza orden (CONFIRMED o REJECTED)
   - Emite: order.confirmed o order.cancelled 👈 NUEVO
   ↓
5. Webhook Publisher Service:
   - Recibe: order.confirmed o order.cancelled 👈 NUEVO
   - Envía webhooks a suscriptores
```

## 🧪 Cómo Probar

### Opción 1: Script Automatizado
```powershell
cd scripts
.\test-gap2-events.ps1
```

### Opción 2: Manual

#### Paso 1: Crear orden exitosa
```powershell
$body = @{
    customerId = "test-123"
    items = @(@{ productId = 1; quantity = 2 })
    idempotencyKey = [guid]::NewGuid().ToString()
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/orders" -Method Post -Body $body -ContentType "application/json"
```

#### Paso 2: Ver logs
```powershell
# Orders Service debe mostrar:
docker logs orders-service --tail 20
# Buscar: "📤 Emitting event: order.confirmed"

# Webhook Publisher debe mostrar:
docker logs webhook-publisher-service --tail 20
# Buscar: "📦 Received event: order.confirmed"
```

#### Paso 3: Verificar en RabbitMQ UI
- URL: http://localhost:15672 (guest/guest)
- Ir a: **Exchanges** → `microservices.events` → **Message rates**
- Debe mostrar tráfico con routing key `order.*`

## ✅ Verificaciones Esperadas

### Logs de Orders Service
```
[OrdersService] Order 42 CONFIRMED
[OrdersService] 📤 Emitting event: order.confirmed for order 42
```

### Logs de Webhook Publisher
```
[WebhookConsumer] 📦 Received event: order.confirmed
[WebhookService] Processing webhook for event: order.confirmed
[WebhookService] Sending webhook to: https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/webhook-logger
✅ Webhook delivered successfully
```

### RabbitMQ Colas
```
orders_queue: 0 messages (todos procesados)
webhook_publisher_queue: 0 messages (todos procesados)
```

## 🎯 Bindings Activos

El exchange `microservices.events` ahora distribuye 3 tipos de eventos:

| Routing Key | Colas Destino | Descripción |
|------------|---------------|-------------|
| `product.*` | orders_queue, webhook_publisher_queue | Eventos de Products Service |
| `order.*` | webhook_publisher_queue | 🆕 Eventos de Orders Service |

## 🚫 Lo Que NO Cambió

- ✅ Flujo actual de creación de órdenes: **INTACTO**
- ✅ Idempotencia con Redis: **FUNCIONA IGUAL**
- ✅ Actualización de estado de órdenes: **SIN CAMBIOS**
- ✅ Comunicación con Products Service: **INALTERADA**

Los eventos `order.confirmed` y `order.cancelled` son **adicionales**, no sustituyen nada.

## 🔍 Troubleshooting

### Problema: No veo los eventos emitidos
```powershell
# 1. Verificar que orders-service esté corriendo
docker ps | Select-String "orders-service"

# 2. Ver logs completos
docker logs orders-service

# 3. Verificar variable de entorno
docker exec orders-service printenv | Select-String "RABBITMQ"
# Debe mostrar:
# RABBITMQ_URL=amqp://rabbitmq:5672
# RABBITMQ_EXCHANGE=microservices.events
```

### Problema: Webhook Publisher no recibe los eventos
```powershell
# 1. Verificar bindings en RabbitMQ
docker exec microservices_rabbitmq rabbitmqadmin list bindings | Select-String "order"

# 2. Debe mostrar:
# microservices.events | webhook_publisher_queue | order.*
```

### Problema: Orden se crea pero no se confirma/cancela
```powershell
# 1. Verificar que Products Service esté corriendo
docker ps | Select-String "products-service"

# 2. Ver logs de products-service
docker logs products-service --tail 30

# 3. Verificar que emita product.stockReserved
# Buscar: "Emitting event: product.stockReserved"
```

## 📈 Siguientes Pasos

Con GAP #2 completado, puedes proceder a:

- **GAP #3**: Dynamic subscribers desde Supabase (webhook_subscribers table)
- **GAP #4**: Ajustar Redis TTL de 7 días a 1 hora para idempotencia
- **GAP #5**: Testing end-to-end completo con caos engineering

## 🎉 Estado: COMPLETADO

El GAP #2 está **100% implementado y probado**. Orders Service ahora emite correctamente `order.confirmed` y `order.cancelled` que son recibidos por Webhook Publisher Service.
