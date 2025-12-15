# GAP #1: RabbitMQ Exchange Configuration - RESUELTO ✅

## Problema Identificado
Los servicios `orders-service` y `webhook-publisher-service` compartían el exchange por defecto (default exchange), causando **competing consumers**: ambos servicios competían por los mismos mensajes, resultando en que solo uno de ellos recibía cada evento.

## Solución Implementada

### 1. Arquitectura con Topic Exchange

```
products-service
     │
     └──[emit('product.stockReserved')]
                │
                ▼
     ┌──────────────────────┐
     │ microservices.events │  (Topic Exchange)
     │   type: topic        │
     └──────────────────────┘
          │              │
          │ product.*    │ product.*
          │              │ order.*
          ▼              ▼
    ┌──────────┐   ┌──────────────────┐
    │  orders  │   │ webhook_publisher│
    │  _queue  │   │     _queue       │
    └──────────┘   └──────────────────┘
          │                  │
          ▼                  ▼
    orders-service   webhook-publisher
```

### 2. Configuración de RabbitMQ

#### Exchange
- **Nombre**: `microservices.events`
- **Tipo**: `topic` (permite routing keys con wildcards)
- **Durable**: `true` (persiste reinicios)

#### Colas
1. **orders_queue**: Consumida por `orders-service`
2. **products_queue**: Consumida por `products-service` (reservada para futuros eventos)
3. **webhook_publisher_queue**: Consumida por `webhook-publisher-service`

#### Bindings (Routing Keys)
```
orders_queue:
  - product.* (recibe product.stockReserved, product.updated, etc.)
  - order.* (recibe order.confirmed, order.cancelled, etc.)

webhook_publisher_queue:
  - product.* (recibe todos los eventos de productos)
  - order.* (recibe todos los eventos de órdenes)
```

### 3. Comandos de Configuración

#### Opción A: Script Automatizado (PowerShell)
```powershell
# Desde la raíz del proyecto
cd scripts
.\setup-rabbitmq.sh  # Si tienes bash/WSL
```

#### Opción B: Comandos Manuales
```powershell
# 1. Crear exchange
docker exec microservices_rabbitmq rabbitmqadmin declare exchange name=microservices.events type=topic durable=true

# 2. Crear colas
docker exec microservices_rabbitmq rabbitmqadmin declare queue name=orders_queue durable=true
docker exec microservices_rabbitmq rabbitmqadmin declare queue name=products_queue durable=true
docker exec microservices_rabbitmq rabbitmqadmin declare queue name=webhook_publisher_queue durable=true

# 3. Bindings para orders_queue
docker exec microservices_rabbitmq rabbitmqadmin declare binding source=microservices.events destination=orders_queue routing_key='product.*'
docker exec microservices_rabbitmq rabbitmqadmin declare binding source=microservices.events destination=orders_queue routing_key='order.*'

# 4. Bindings para webhook_publisher_queue
docker exec microservices_rabbitmq rabbitmqadmin declare binding source=microservices.events destination=webhook_publisher_queue routing_key='product.*'
docker exec microservices_rabbitmq rabbitmqadmin declare binding source=microservices.events destination=webhook_publisher_queue routing_key='order.*'

# 5. Verificar configuración
docker exec microservices_rabbitmq rabbitmqadmin list exchanges
docker exec microservices_rabbitmq rabbitmqadmin list queues
docker exec microservices_rabbitmq rabbitmqadmin list bindings
```

### 4. Cambios en el Código

#### A. docker-compose.yml
Se agregaron variables de entorno `RABBITMQ_EXCHANGE` a todos los servicios:

```yaml
environment:
  - RABBITMQ_EXCHANGE=microservices.events
```

#### B. products-service/src/products/products.module.ts
```typescript
ClientsModule.register([
  {
    name: 'ORDERS_SERVICE',
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'orders_queue',
      queueOptions: {
        durable: true,
      },
      // ✅ NUEVO: Publicar al exchange en lugar de directamente a la cola
      exchange: process.env.RABBITMQ_EXCHANGE || 'microservices.events',
      exchangeType: 'topic',
    },
  },
])
```

#### C. Servicios main.ts (products, orders, webhook-publisher)
Cambio de `urls: ['amqp://localhost:5672']` a:
```typescript
urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672']
```

### 5. Pruebas

#### Script de Prueba Automatizado
```powershell
cd scripts
.\test-exchange-flow.ps1
```

#### Prueba Manual
```powershell
# 1. Crear una orden
curl -X POST http://localhost:3000/orders `
  -H "Content-Type: application/json" `
  -d '{
    "customerId": "test-123",
    "items": [{"productId": 1, "quantity": 2}],
    "idempotencyKey": "test-order-1"
  }'

# 2. Verificar que AMBOS servicios recibieron el evento
docker logs orders-service --tail 20 | Select-String "product.stockReserved"
docker logs webhook-publisher-service --tail 20 | Select-String "product.stockReserved"

# 3. Verificar RabbitMQ Management UI
# http://localhost:15672 (guest/guest)
# Ir a: Exchanges → microservices.events → Bindings
```

### 6. Resultados Esperados

#### ✅ Antes (Problema)
```
Event: product.stockReserved
  └─> Solo UNO de estos servicios lo recibe:
      - orders-service ❌ (a veces)
      - webhook-publisher ❌ (otras veces)
```

#### ✅ Después (Solución)
```
Event: product.stockReserved
  ├─> orders-service ✅ (SIEMPRE)
  └─> webhook-publisher ✅ (SIEMPRE)
```

### 7. Verificación en RabbitMQ Management UI

1. Abrir: http://localhost:15672
2. Login: `guest` / `guest`
3. Ir a **Exchanges** → buscar `microservices.events`
4. Click en el nombre → pestaña **Bindings**
5. Verificar:
   ```
   To queue: orders_queue
     - Routing key: product.*
     - Routing key: order.*
   
   To queue: webhook_publisher_queue
     - Routing key: product.*
     - Routing key: order.*
   ```

### 8. Logs Esperados

#### products-service
```
[ProductsService] Stock reserved for product 1. New stock: 98
[ProductsService] Emitting event: product.stockReserved
```

#### orders-service
```
[OrdersController] Received event: product.stockReserved
[OrdersController] Processing stock reservation for order: {...}
```

#### webhook-publisher-service
```
[WebhookConsumer] Received event: product.stockReserved
[WebhookService] Processing webhook for event: product.stockReserved
[WebhookService] Enqueuing webhook job...
```

### 9. Troubleshooting

#### Problema: Servicios no reciben eventos
```powershell
# Verificar que el exchange existe
docker exec microservices_rabbitmq rabbitmqadmin list exchanges | Select-String "microservices"

# Verificar bindings
docker exec microservices_rabbitmq rabbitmqadmin list bindings

# Reiniciar servicios
docker-compose restart products-service orders-service webhook-publisher
```

#### Problema: Mensajes quedan en la cola
```powershell
# Ver estado de las colas
docker exec microservices_rabbitmq rabbitmqadmin list queues name messages messages_ready

# Purgar cola si es necesario
docker exec microservices_rabbitmq rabbitmqadmin purge queue name=orders_queue
```

### 10. Siguientes Pasos

- [ ] **GAP #2**: Implementar eventos `order.confirmed` y `order.cancelled` en orders-service
- [ ] **GAP #3**: Implementar SubscribersService para leer suscriptores de Supabase
- [ ] **GAP #4**: Reducir TTL de Redis de 7 días a 1 hora

## Referencias

- [RabbitMQ Topic Exchange Tutorial](https://www.rabbitmq.com/tutorials/tutorial-five-javascript.html)
- [NestJS RabbitMQ Integration](https://docs.nestjs.com/microservices/rabbitmq)
- [Pattern Matching with Topic Exchange](https://www.rabbitmq.com/tutorials/amqp-concepts.html#exchange-topic)
