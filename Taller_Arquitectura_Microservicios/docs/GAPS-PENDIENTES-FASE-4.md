# 🔧 GAPS Y SOLUCIONES PENDIENTES - FASE 4

**Documento:** Análisis de implementación incompleta  
**Estado:** 🟡 70% Completo - Requiere ajustes  
**Fecha:** 15 de Diciembre, 2025

---

## 📊 Resumen Ejecutivo

La **FASE 4 (Webhook Publisher Service)** está **funcionalmente implementada** pero tiene **gaps arquitecturales** que deben resolverse antes de considerarla production-ready. Este documento lista todos los puntos pendientes, su criticidad y cómo resolverlos.

### **Estado General por Componente:**

| Componente | Estado | Criticidad | Bloqueante |
|------------|--------|------------|------------|
| **RabbitMQ Exchange** | ❌ No configurado | 🔴 CRÍTICA | ✅ SÍ |
| **Eventos de Orders** | ❌ No emiten | 🔴 CRÍTICA | ✅ SÍ |
| **Suscriptores dinámicos** | ❌ Hardcoded | 🟡 MEDIA | ❌ NO |
| **Deduplicación** | ⚠️ Redundante | 🟡 MEDIA | ❌ NO |
| **Bull Dashboard** | ❌ No instalado | 🟢 BAJA | ❌ NO |
| **Retry Logic** | ✅ Completo | - | - |
| **HMAC Signing** | ✅ Completo | - | - |
| **Idempotencia Redis** | ✅ Completo | - | - |

---

## 🔴 GAP #1: RabbitMQ Exchange No Configurado (CRÍTICO)

### **Problema Detectado:**

**Situación actual:**
- Products Service emite `product.stockReserved` con `rabbitClient.emit()`
- Orders Service consume con `@EventPattern('product.stockReserved')`
- Webhook Publisher consume con `@EventPattern('product.stockReserved')`

**¿Qué está mal?**
Sin un **Topic Exchange** configurado, RabbitMQ usa el **default exchange** (direct), lo que causa:
- **Competing consumers:** Orders y Webhook Publisher compiten por el mismo mensaje
- **Mensajes se pierden:** Solo UNO de los dos servicios recibe cada evento
- **Round-robin distribution:** Mensaje 1 → Orders, Mensaje 2 → Webhook Publisher (alternando)

### **Impacto:**

```
❌ Evento 1: product.stockReserved
   ├─> Orders Service (✅ recibe, actualiza orden)
   └─> Webhook Publisher (❌ NO recibe, NO envía webhook)

❌ Evento 2: product.stockReserved
   ├─> Orders Service (❌ NO recibe, orden queda PENDING)
   └─> Webhook Publisher (✅ recibe, envía webhook)

Resultado: 50% de las órdenes se quedan en PENDING ❌
           50% de los webhooks nunca se envían ❌
```

### **Solución: Topic Exchange con Fanout**

#### **Paso 1: Crear Exchange en RabbitMQ**

**Script de configuración:**
```bash
# Crear archivo: scripts/setup-rabbitmq.sh

#!/bin/bash
echo "🐰 Configurando RabbitMQ..."

# Esperar a que RabbitMQ esté listo
sleep 10

# 1. Crear exchange tipo topic
docker exec microservices_rabbitmq rabbitmqadmin declare exchange \
  name=microservices.events \
  type=topic \
  durable=true

# 2. Crear bindings para webhook-publisher
docker exec microservices_rabbitmq rabbitmqadmin declare binding \
  source=microservices.events \
  destination=webhook_publisher_queue \
  routing_key="product.*"

docker exec microservices_rabbitmq rabbitmqadmin declare binding \
  source=microservices.events \
  destination=webhook_publisher_queue \
  routing_key="order.*"

# 3. Crear bindings para orders-service
docker exec microservices_rabbitmq rabbitmqadmin declare binding \
  source=microservices.events \
  destination=orders_queue \
  routing_key="product.*"

# 4. Crear bindings para products-service
docker exec microservices_rabbitmq rabbitmqadmin declare binding \
  source=microservices.events \
  destination=products_queue \
  routing_key="order.*"

echo "✅ RabbitMQ configurado correctamente"
```

**Dar permisos y ejecutar:**
```bash
chmod +x scripts/setup-rabbitmq.sh

# Ejecutar DESPUÉS de levantar RabbitMQ:
docker-compose up -d rabbitmq
sleep 15
./scripts/setup-rabbitmq.sh
```

#### **Paso 2: Verificar en RabbitMQ Management**

**Acceder a:**
```
http://localhost:15672
Username: guest
Password: guest
```

**Verificar en UI:**
1. **Exchanges** → Buscar `microservices.events`
   - Type: topic ✅
   - Durable: D ✅

2. **Queues** → Verificar colas existen:
   - `webhook_publisher_queue` ✅
   - `orders_queue` ✅
   - `products_queue` ✅

3. **Exchanges** → `microservices.events` → **Bindings**:
   ```
   To queue: webhook_publisher_queue | Routing key: product.*
   To queue: webhook_publisher_queue | Routing key: order.*
   To queue: orders_queue            | Routing key: product.*
   To queue: products_queue          | Routing key: order.*
   ```

#### **Paso 3: Actualizar Configuración de Servicios (Opcional)**

**Si los servicios NO detectan el exchange automáticamente**, agregar configuración explícita:

**products-service/src/app.module.ts:**
```typescript
// Agregar en @Module imports:
ClientsModule.register([
  {
    name: 'RABBITMQ_CLIENT',
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL],
      queue: 'products_queue',
      queueOptions: { durable: true },
      // ✅ Agregar exchange explícito:
      exchangeOptions: {
        name: 'microservices.events',
        type: 'topic',
        durable: true,
      },
    },
  },
]),
```

**⚠️ NOTA:** Si NestJS ya usa el exchange por defecto, este paso puede NO ser necesario. Verificar primero con las pruebas.

### **Prueba de Verificación:**

```bash
# 1. Crear orden
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","productId":"prod-1","quantity":2}'

# 2. Verificar en logs de AMBOS servicios:
docker logs orders-service | grep "product.stockReserved"
# ✅ Debe mostrar: "Received product.stockReserved"

docker logs webhook-publisher-service | grep "product.stockReserved"
# ✅ Debe mostrar: "📬 Received event: product.stockReserved"

# Si AMBOS reciben el evento → Exchange funciona ✅
# Si solo UNO recibe → Exchange falta ❌
```

### **Archivos Afectados:**

```
✅ Crear:
   scripts/setup-rabbitmq.sh (nuevo)

⚠️ Modificar (solo si es necesario):
   products-service/src/app.module.ts
   orders-service/src/app.module.ts
```

---

## 🔴 GAP #2: Orders Service No Emite Eventos (CRÍTICO)

### **Problema Detectado:**

**Eventos documentados pero NO implementados:**
- `order.confirmed` - Cuando orden es confirmada (stock OK)
- `order.cancelled` - Cuando orden es cancelada (sin stock)

**Código actual (orders-service):**
```typescript
// orders-service/src/orders/orders.controller.ts

@EventPattern('product.stockReserved')
async handleStockReserved(@Payload() data: any, @Ctx() context: RmqContext) {
  const order = await this.findByIdempotencyKey(data.idempotencyKey);
  
  if (data.approved) {
    order.status = 'CONFIRMED';
    await this.orderRepository.save(order);
    // ❌ FALTA: Emitir order.confirmed
  } else {
    order.status = 'CANCELLED';
    await this.orderRepository.save(order);
    // ❌ FALTA: Emitir order.cancelled
  }
  
  context.getChannelRef().ack(context.getMessage());
}
```

### **Impacto:**

```
❌ Webhook Publisher NO recibe eventos de Orders
   └─> telegram-notifier NO envía notificaciones de órdenes confirmadas
   └─> webhook-logger NO registra eventos de órdenes

❌ Products Service NO sabe si liberar stock (orden cancelada)
   └─> Stock queda reservado permanentemente
   └─> Productos se "agotan" falsamente
```

### **Solución: Agregar Emisión de Eventos**

#### **Paso 1: Modificar orders.controller.ts**

**Archivo:** `orders-service/src/orders/orders.controller.ts`

**Agregar inyección del cliente RabbitMQ:**
```typescript
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Controller()
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    @Inject('RABBITMQ_CLIENT') private readonly rabbitClient: ClientProxy, // ✅ AGREGAR
  ) {}
}
```

**Modificar el handler:**
```typescript
@EventPattern('product.stockReserved')
async handleStockReserved(
  @Payload() data: StockReservedEvent,
  @Ctx() context: RmqContext,
) {
  const order = await this.ordersService.findByIdempotencyKey(
    data.idempotencyKey,
  );

  if (!order) {
    this.logger.error(`Order not found for key: ${data.idempotencyKey}`);
    context.getChannelRef().ack(context.getMessage());
    return;
  }

  if (data.approved) {
    // ✅ AGREGAR: Actualizar estado
    order.status = 'CONFIRMED';
    await this.orderRepository.save(order);

    // ✅ AGREGAR: Emitir evento de dominio
    await this.rabbitClient.emit('order.confirmed', {
      orderId: order.id,
      userId: order.userId,
      productId: data.productId,
      quantity: data.quantity,
      status: 'CONFIRMED',
      totalAmount: order.totalAmount,
      idempotencyKey: data.idempotencyKey,
      timestamp: new Date().toISOString(),
      metadata: {
        source: 'orders-service',
        version: '1.0',
      },
    });

    this.logger.log(`✅ Order confirmed: ${order.id}`);
  } else {
    // ✅ AGREGAR: Actualizar estado
    order.status = 'CANCELLED';
    order.cancellationReason = 'INSUFFICIENT_STOCK';
    await this.orderRepository.save(order);

    // ✅ AGREGAR: Emitir evento de cancelación
    await this.rabbitClient.emit('order.cancelled', {
      orderId: order.id,
      userId: order.userId,
      productId: data.productId,
      quantity: data.quantity,
      reason: 'INSUFFICIENT_STOCK',
      idempotencyKey: data.idempotencyKey,
      timestamp: new Date().toISOString(),
      metadata: {
        source: 'orders-service',
        version: '1.0',
      },
    });

    this.logger.log(`❌ Order cancelled: ${order.id}`);
  }

  context.getChannelRef().ack(context.getMessage());
}
```

#### **Paso 2: Verificar que RABBITMQ_CLIENT está registrado**

**Archivo:** `orders-service/src/app.module.ts`

**Debe tener:**
```typescript
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    // ... otros módulos ...
    
    ClientsModule.register([
      {
        name: 'RABBITMQ_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
          queue: 'orders_queue',
          queueOptions: { durable: true },
        },
      },
    ]),
  ],
})
export class AppModule {}
```

### **Prueba de Verificación:**

```bash
# 1. Reiniciar orders-service
docker-compose restart orders-service

# 2. Crear orden con producto que TIENE stock
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","productId":"valid-product","quantity":1}'

# 3. Verificar en logs de webhook-publisher
docker logs webhook-publisher-service | grep "order.confirmed"
# ✅ Debe mostrar: "📬 Received event: order.confirmed"

# 4. Crear orden con producto SIN stock
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","productId":"invalid-product","quantity":999}'

# 5. Verificar evento de cancelación
docker logs webhook-publisher-service | grep "order.cancelled"
# ✅ Debe mostrar: "📬 Received event: order.cancelled"
```

### **Archivos Afectados:**

```
✅ Modificar:
   orders-service/src/orders/orders.controller.ts
   
⚠️ Verificar (debe existir):
   orders-service/src/app.module.ts (ClientsModule)
```

---

## 🟡 GAP #3: Suscriptores Hardcoded (MEDIA PRIORIDAD)

### **Problema Detectado:**

**Código actual:**
```typescript
// webhook-publisher-service/src/webhook/webhook.service.ts

private readonly subscribers = [
  {
    name: 'webhook-logger',
    url: this.configService.get('WEBHOOK_LOGGER_URL'),
    events: ['product.*', 'order.*'],
  },
  {
    name: 'telegram-notifier',
    url: this.configService.get('TELEGRAM_NOTIFIER_URL'),
    events: ['product.*', 'order.*'],
  },
];
```

**Problemas:**
- ❌ Agregar suscriptor = Modificar código + redeploy
- ❌ Cambiar URL = Modificar código + redeploy
- ❌ Activar/desactivar = Modificar código + redeploy
- ❌ Secret diferente por suscriptor = Imposible

### **Solución: Suscriptores Dinámicos desde Supabase**

#### **Paso 1: Verificar Tabla en Supabase**

**La tabla `webhook_subscribers` ya existe (creada en FASE 2):**
```sql
-- Verificar en SQL Editor:
SELECT * FROM webhook_subscribers LIMIT 5;
```

**Si está vacía, insertar suscriptores iniciales:**
```sql
INSERT INTO webhook_subscribers (name, webhook_url, secret_key, events, is_active)
VALUES 
  (
    'webhook-logger',
    'https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/webhook-logger',
    'dev_secret_key_123456',
    ARRAY['product.stockReserved', 'order.confirmed', 'order.cancelled'],
    true
  ),
  (
    'telegram-notifier',
    'https://zjynrmbugltvupttaxqz.supabase.co/functions/v1/telegram-notifier',
    'dev_secret_key_123456',
    ARRAY['product.stockReserved', 'order.confirmed', 'order.cancelled'],
    true
  );
```

#### **Paso 2: Instalar Cliente de Supabase**

```bash
cd webhook-publisher-service
npm install @supabase/supabase-js
```

#### **Paso 3: Agregar Variables de Entorno**

**Archivo:** `webhook-publisher-service/.env`

```env
# Agregar al final:

# Supabase Connection
SUPABASE_URL=https://zjynrmbugltvupttaxqz.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
# ⚠️ Usar Service Role Key (no Anon Key)
```

**Obtener Service Role Key:**
```
1. Ir a https://supabase.com/dashboard/project/zjynrmbugltvupttaxqz/settings/api
2. Copiar "service_role" key (secret)
3. Pegar en .env
```

#### **Paso 4: Crear SubscribersService**

**Archivo:** `webhook-publisher-service/src/subscribers/subscribers.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface Subscriber {
  id: string;
  name: string;
  webhook_url: string;
  secret_key: string;
  events: string[];
  is_active: boolean;
}

@Injectable()
export class SubscribersService {
  private readonly logger = new Logger(SubscribersService.name);
  private readonly supabase: SupabaseClient;
  private cache: Subscriber[] = [];
  private lastFetch: Date | null = null;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutos

  constructor(private readonly configService: ConfigService) {
    const url = this.configService.get<string>('SUPABASE_URL');
    const key = this.configService.get<string>('SUPABASE_SERVICE_KEY');
    
    if (!url || !key) {
      this.logger.error('Supabase credentials not configured');
      return;
    }

    this.supabase = createClient(url, key);
    this.logger.log('✅ Supabase client initialized');
  }

  async getActiveSubscribers(eventName: string): Promise<Subscriber[]> {
    // Verificar caché
    if (this.cache.length > 0 && this.lastFetch) {
      const age = Date.now() - this.lastFetch.getTime();
      if (age < this.CACHE_TTL) {
        return this.filterByEvent(this.cache, eventName);
      }
    }

    // Consultar desde Supabase
    try {
      const { data, error } = await this.supabase
        .from('webhook_subscribers')
        .select('*')
        .eq('is_active', true);

      if (error) {
        this.logger.error(`Failed to fetch subscribers: ${error.message}`);
        return this.getFallbackSubscribers(eventName);
      }

      this.cache = data as Subscriber[];
      this.lastFetch = new Date();
      
      this.logger.log(`✅ Loaded ${this.cache.length} subscribers from Supabase`);
      
      return this.filterByEvent(this.cache, eventName);
    } catch (error) {
      this.logger.error(`Error fetching subscribers: ${error.message}`);
      return this.getFallbackSubscribers(eventName);
    }
  }

  private filterByEvent(subscribers: Subscriber[], eventName: string): Subscriber[] {
    return subscribers.filter(sub => 
      sub.events.some(pattern => 
        pattern === eventName || 
        pattern === `${eventName.split('.')[0]}.*` ||
        pattern === '*'
      )
    );
  }

  private getFallbackSubscribers(eventName: string): Subscriber[] {
    this.logger.warn('Using fallback subscribers (hardcoded)');
    
    const fallback: Subscriber[] = [
      {
        id: 'fallback-logger',
        name: 'webhook-logger',
        webhook_url: this.configService.get('WEBHOOK_LOGGER_URL'),
        secret_key: this.configService.get('WEBHOOK_SECRET'),
        events: ['*'],
        is_active: true,
      },
      {
        id: 'fallback-telegram',
        name: 'telegram-notifier',
        webhook_url: this.configService.get('TELEGRAM_NOTIFIER_URL'),
        secret_key: this.configService.get('WEBHOOK_SECRET'),
        events: ['*'],
        is_active: true,
      },
    ];

    return this.filterByEvent(fallback, eventName);
  }
}
```

#### **Paso 5: Crear SubscribersModule**

**Archivo:** `webhook-publisher-service/src/subscribers/subscribers.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { SubscribersService } from './subscribers.service';

@Module({
  providers: [SubscribersService],
  exports: [SubscribersService],
})
export class SubscribersModule {}
```

#### **Paso 6: Integrar en WebhookModule**

**Archivo:** `webhook-publisher-service/src/webhook/webhook.module.ts`

```typescript
import { SubscribersModule } from '../subscribers/subscribers.module';

@Module({
  imports: [
    BullModule.registerQueue({ /* ... */ }),
    SubscribersModule, // ✅ AGREGAR
  ],
  // ...
})
export class WebhookModule {}
```

#### **Paso 7: Usar en WebhookService**

**Archivo:** `webhook-publisher-service/src/webhook/webhook.service.ts`

```typescript
import { SubscribersService } from '../subscribers/subscribers.service';

@Injectable()
export class WebhookService {
  constructor(
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
    private readonly configService: ConfigService,
    private readonly idempotencyService: IdempotencyService,
    private readonly subscribersService: SubscribersService, // ✅ INYECTAR
  ) {}

  async processEvent(eventName: string, data: any) {
    // ... idempotencia ...

    // ✅ REEMPLAZAR línea de suscriptores hardcoded:
    // const subscribers = this.getActiveSubscribers(eventName);
    
    // ✅ POR consulta dinámica:
    const subscribers = await this.subscribersService.getActiveSubscribers(eventName);

    for (const subscriber of subscribers) {
      await this.enqueueWebhook(subscriber, payload);
    }
  }
}
```

### **Prueba de Verificación:**

```bash
# 1. Reiniciar servicio
docker-compose restart webhook-publisher

# 2. Verificar logs de conexión a Supabase
docker logs webhook-publisher-service | grep "Supabase"
# ✅ "✅ Supabase client initialized"
# ✅ "✅ Loaded 2 subscribers from Supabase"

# 3. Crear orden para disparar evento
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-1","productId":"prod-1","quantity":1}'

# 4. Verificar que consultó suscriptores
docker logs webhook-publisher-service | grep "subscribers"
# ✅ "✅ Loaded 2 subscribers from Supabase"

# 5. Desactivar un suscriptor en Supabase:
# UPDATE webhook_subscribers SET is_active = false WHERE name = 'telegram-notifier';

# 6. Crear otra orden (después de 5 min para refrescar caché)
# 7. Verificar que solo webhook-logger recibe el evento
```

### **Archivos Afectados:**

```
✅ Crear:
   webhook-publisher-service/src/subscribers/subscribers.service.ts
   webhook-publisher-service/src/subscribers/subscribers.module.ts

✅ Modificar:
   webhook-publisher-service/src/webhook/webhook.module.ts
   webhook-publisher-service/src/webhook/webhook.service.ts
   webhook-publisher-service/.env
   webhook-publisher-service/package.json (deps)
```

---

## 🟡 GAP #4: Deduplicación Redundante (MEDIA PRIORIDAD)

### **Problema Detectado:**

**Dos capas hacen lo mismo:**
1. **Webhook Publisher (Redis):** TTL 7 días
2. **Edge Functions (PostgreSQL):** TTL 7 días

**Overhead innecesario:**
- Misma verificación en dos lugares
- Redis con TTL largo desperdicia memoria
- PostgreSQL es la fuente de verdad (auditoría)

### **Solución: Separar Responsabilidades**

#### **Estrategia Recomendada:**

| Capa | Responsabilidad | TTL | Propósito |
|------|-----------------|-----|-----------|
| **Redis (Publisher)** | Evitar encolado duplicado | **1 hora** | Performance, reintentos RabbitMQ |
| **PostgreSQL (Edge)** | Evitar ejecución duplicada | **7 días** | Auditoría, compliance |

#### **Paso 1: Reducir TTL en IdempotencyService**

**Archivo:** `webhook-publisher-service/src/webhook/idempotency.service.ts`

**Buscar línea:**
```typescript
private readonly TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 segundos
```

**Cambiar a:**
```typescript
private readonly TTL_SECONDS = 60 * 60; // 3600 segundos = 1 hora
```

**Justificación:**
- Redis protege contra reintentos inmediatos de RabbitMQ
- 1 hora es suficiente para ventana de procesamiento
- PostgreSQL sigue siendo fuente de verdad con 7 días

#### **Paso 2: Documentar la Estrategia**

**Agregar comentario en el servicio:**
```typescript
/**
 * TTL de 1 hora es suficiente para:
 * - Evitar duplicados de reintentos de RabbitMQ (segundos/minutos)
 * - Evitar race conditions entre workers
 * - Mantener memoria Redis baja
 * 
 * Edge Functions (PostgreSQL) mantienen TTL de 7 días para auditoría.
 */
private readonly TTL_SECONDS = 60 * 60;
```

### **Flujo Final:**

```
1. RabbitMQ entrega evento
   └─> Redis: ¿Ya procesado? (TTL 1h)
       ├─> SÍ → Rechazar (evento reciente duplicado)
       └─> NO → Continuar

2. Encolar en BullMQ
   └─> Job puede reintentar 5 veces

3. Enviar HTTP POST a Edge Function
   └─> PostgreSQL: ¿Ya procesado? (TTL 7d)
       ├─> SÍ → 409 Conflict (auditoría de largo plazo)
       └─> NO → Ejecutar lógica
```

### **Archivos Afectados:**

```
✅ Modificar:
   webhook-publisher-service/src/webhook/idempotency.service.ts (1 línea)
```

---

## 🟢 GAP #5: Bull Dashboard No Instalado (BAJA PRIORIDAD)

### **Problema:**

Sin UI para monitorear colas BullMQ:
- ❌ No se ven jobs pendientes
- ❌ No se ven jobs fallidos
- ❌ No se puede replay manual

### **Solución: Instalar Bull Board**

#### **Paso 1: Instalar Dependencias**

```bash
cd webhook-publisher-service
npm install @bull-board/express @bull-board/api @bull-board/nestjs express
```

#### **Paso 2: Configurar en main.ts**

**Archivo:** `webhook-publisher-service/src/main.ts`

**Agregar después de `await app.listen(port)`:**

```typescript
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';

async function bootstrap() {
  // ... código existente ...

  await app.listen(port);

  // ✅ AGREGAR Bull Board:
  const webhookQueue = app.get<Queue>('BullQueue_webhook-delivery');
  
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [new BullMQAdapter(webhookQueue)],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  logger.log(`📊 Bull Board: http://localhost:${port}/admin/queues`);
}
```

#### **Paso 3: Acceder al Dashboard**

```
http://localhost:3003/admin/queues
```

**Funciones disponibles:**
- Ver jobs: waiting, active, completed, failed
- Retry manual de jobs fallidos
- Clean jobs (limpiar completados)
- Estadísticas en tiempo real

### **Archivos Afectados:**

```
✅ Modificar:
   webhook-publisher-service/src/main.ts
   webhook-publisher-service/package.json (deps)
```

---

## 📋 Checklist de Implementación Completa

### **Antes de empezar:**
- [ ] Docker Desktop corriendo
- [ ] Repositorio actualizado
- [ ] Variables de entorno configuradas

### **Gap #1 - RabbitMQ Exchange:**
- [ ] Script `scripts/setup-rabbitmq.sh` creado
- [ ] Permisos de ejecución dados (`chmod +x`)
- [ ] RabbitMQ levantado (`docker-compose up -d rabbitmq`)
- [ ] Script ejecutado (`./scripts/setup-rabbitmq.sh`)
- [ ] Exchange `microservices.events` verificado en UI
- [ ] Bindings verificados en UI
- [ ] Test: Evento llega a AMBOS servicios (orders + webhook-publisher)

### **Gap #2 - Eventos de Orders:**
- [ ] `orders-service/src/orders/orders.controller.ts` modificado
- [ ] `order.confirmed` se emite cuando stock OK
- [ ] `order.cancelled` se emite cuando sin stock
- [ ] `RABBITMQ_CLIENT` inyectado en constructor
- [ ] Orders Service reiniciado
- [ ] Test: `order.confirmed` llega a webhook-publisher
- [ ] Test: `order.cancelled` llega a webhook-publisher

### **Gap #3 - Suscriptores Dinámicos:**
- [ ] `@supabase/supabase-js` instalado
- [ ] `SUPABASE_URL` y `SUPABASE_SERVICE_KEY` en `.env`
- [ ] `SubscribersService` creado
- [ ] `SubscribersModule` creado
- [ ] Integrado en `WebhookModule`
- [ ] `WebhookService` usa `subscribersService`
- [ ] Webhook Publisher reiniciado
- [ ] Test: Logs muestran "Loaded X subscribers from Supabase"
- [ ] Test: Desactivar suscriptor en DB → No recibe webhooks

### **Gap #4 - Deduplicación:**
- [ ] `TTL_SECONDS` cambiado a 3600 (1 hora)
- [ ] Comentario de justificación agregado
- [ ] Webhook Publisher reiniciado
- [ ] Test: Evento duplicado rechazado por Redis
- [ ] Test: TTL de clave Redis es ~1 hora (no 7 días)

### **Gap #5 - Bull Dashboard (Opcional):**
- [ ] `@bull-board/*` instalado
- [ ] `main.ts` configurado con Bull Board
- [ ] Webhook Publisher reiniciado
- [ ] Test: `http://localhost:3003/admin/queues` accesible
- [ ] UI muestra cola `webhook-delivery`
- [ ] Jobs completados visibles en UI

---

## 🎯 Test End-to-End Completo

### **Escenario: Orden Exitosa con Stock**

```bash
# 1. Levantar todo
docker-compose down
docker-compose up -d
./scripts/setup-rabbitmq.sh

# 2. Crear orden
curl -X POST http://localhost:3001/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"user-123","productId":"product-valid","quantity":2}'

# Respuesta esperada:
# { "id": "order-uuid", "status": "PENDING", "idempotencyKey": "key-uuid" }

# 3. Verificar flujo en logs (en orden):

# A) Products Service:
docker logs products-service | tail -20
# ✅ "Reserving stock for product-valid"
# ✅ "Emitting product.stockReserved"

# B) Orders Service:
docker logs orders-service | tail -20
# ✅ "Received product.stockReserved"
# ✅ "Order confirmed: order-uuid"
# ✅ "Emitting order.confirmed" # ← NUEVO (Gap #2)

# C) Webhook Publisher:
docker logs webhook-publisher-service | tail -30
# ✅ "📬 Received event: product.stockReserved"
# ✅ "✅ Idempotency check passed"
# ✅ "✅ Loaded 2 subscribers from Supabase" # ← NUEVO (Gap #3)
# ✅ "📥 Queued webhook for webhook-logger"
# ✅ "📥 Queued webhook for telegram-notifier"
# ✅ "✅ Webhook delivered | Duration: 300ms"
# ✅ "📬 Received event: order.confirmed" # ← NUEVO (Gap #2)
# ✅ "✅ Webhook delivered | Duration: 250ms"

# 4. Verificar en Supabase (webhook_events_log):
# SELECT * FROM webhook_events_log WHERE idempotency_key = 'key-uuid';
# ✅ 1 registro: product.stockReserved
# ✅ 1 registro: order.confirmed (total: 2)

# 5. Verificar en Telegram:
# ✅ Mensaje: "🎉 Stock Reservado Exitosamente"
# ✅ Mensaje: "✅ Orden Confirmada" (si implementado)

# 6. Verificar en Redis:
docker exec -it microservices_redis redis-cli
> KEYS webhook:idempotency:*
# ✅ 2 claves (product.stockReserved, order.confirmed)

> TTL webhook:idempotency:product.stockReserved:key-uuid
# ✅ ~3500 (segundos, aprox 1 hora) # ← NUEVO (Gap #4)
```

---

## 📊 Métricas de Completitud Final

### **Después de Resolver Gaps:**

| Componente | Antes | Después | Cambio |
|------------|-------|---------|--------|
| **RabbitMQ** | 50% | 100% | +50% ✅ |
| **Eventos** | 33% | 100% | +67% ✅ |
| **Suscriptores** | 50% | 100% | +50% ✅ |
| **Deduplicación** | 70% | 100% | +30% ✅ |
| **Monitoreo** | 60% | 90% | +30% ✅ |
| **TOTAL FASE 4** | **70%** | **98%** | **+28%** ✅ |

---

## 🎓 Conclusión

La **FASE 4** está **funcionalmente completa** en cuanto a código, pero requiere **ajustes arquitecturales críticos** (Gaps #1 y #2) para funcionar correctamente en un flujo end-to-end.

**Priorización:**
1. 🔴 **GAP #1 y #2** → Implementar PRIMERO (bloqueantes)
2. 🟡 **GAP #3 y #4** → Implementar en segunda iteración (mejoras)
3. 🟢 **GAP #5** → Implementar cuando haya tiempo (nice-to-have)

**Tiempo estimado:**
- Gaps críticos: ~2 horas
- Gaps medios: ~1 hora
- Gaps opcionales: ~30 minutos
- **Total: ~3.5 horas**

---

**Última actualización:** 15 de Diciembre, 2025  
**Autor:** GitHub Copilot  
**Proyecto:** Arquitectura Event-Driven con Webhooks y Serverless  
**Estado:** Gaps identificados y documentados
