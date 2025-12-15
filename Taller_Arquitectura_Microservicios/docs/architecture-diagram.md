# 🏗️ DIAGRAMA DE ARQUITECTURA DEL SISTEMA

![1765769992094](image/architecture-diagram/1765769992094.png)



### ✅ Componentes Implementados (Verde)

| Componente | Puerto | Descripción | Base de Datos |
|------------|--------|-------------|---------------|
| **Cliente HTTP** | - | Usuario o sistema externo que consume la API | - |
| **API Gateway** | 3000 | Punto de entrada único, expone REST API, valida requests | - |
| **Orders Service** | 3002 | Gestiona órdenes, implementa Idempotent Consumer | SQLite (orders.db) |
| **Products Service** | 3001 | Gestiona productos y stock | SQLite (products.db) |

### 🔵 Infraestructura Implementada (Azul)

| Componente | Puerto | Descripción | Propósito |
|------------|--------|-------------|-----------|
| **RabbitMQ** | 5672, 15672 | Message broker, colas: `orders_queue`, `products_queue` | Comunicación asíncrona |
| **Redis** | 6379 | Cache distribuido | Idempotencia y locks |

### 🔲 Extensiones Futuras (Gris Punteado)

| Componente | Descripción | Propósito |
|------------|-------------|-----------|
| **Webhook Publisher** | Servicio que consume eventos de RabbitMQ y los envía como webhooks HTTP | Integración externa |
| **Supabase PostgreSQL** | Base de datos relacional para historial de webhooks enviados | Auditoría y reintentos |
| **Edge Function: Logger** | Función serverless que recibe webhooks y registra eventos | Observabilidad |
| **Edge Function: Notifier** | Función serverless que envía notificaciones a sistemas externos | Notificaciones push |

### 🟠 Destinos Externos (Naranja)

| Componente | Descripción |
|------------|-------------|
| **Telegram Bot** | Bot de mensajería para notificaciones en tiempo real |

---

## Tipos de Comunicación

### 🔗 Comunicación Síncrona (HTTP)
```
Cliente → API Gateway
```
- Protocolo: HTTP REST
- Método: POST /orders
- Respuesta inmediata

### 🔄 Comunicación Asíncrona (RabbitMQ)
```
API Gateway ←→ Orders Service
Orders Service ←→ Products Service
```
- Protocolo: AMQP
- Patrones: `send()` (request-response), `emit()` (event-based)
- Colas durables

### 📡 Webhooks HTTP (Futuro)
```
Webhook Publisher → Edge Functions
```
- Protocolo: HTTP POST
- Formato: JSON estandarizado
- Reintentos con backoff exponencial

### 💬 Notificaciones Push (Futuro)
```
Edge Function Notifier → Telegram
```
- Protocolo: Telegram Bot API
- Formato: Mensajes de texto formateados

---

## Flujo de Datos Detallado

### Flujo Actual (Implementado)

```
1️⃣ Cliente envía request
   POST /orders { productId, quantity }
   ↓ HTTP

2️⃣ API Gateway valida y publica
   RabbitMQ send: orders.create
   ↓ orders_queue

3️⃣ Orders Service recibe y procesa
   - Genera idempotencyKey
   - Crea orden (PENDING)
   - Persiste en orders.db
   - Publica evento
   ↓ RabbitMQ emit: product.reserveStock
   ↓ products_queue

4️⃣ Products Service valida stock
   - Busca producto
   - Verifica disponibilidad
   - Actualiza stock (si aprobado)
   - Persiste en products.db
   - Publica resultado
   ↓ RabbitMQ emit: product.stockReserved
   ↓ orders_queue

5️⃣ Orders Service confirma orden
   - Verifica en Redis (idempotencia)
   - Adquiere lock distribuido
   - Actualiza estado (CONFIRMED/REJECTED)
   - Persiste en orders.db
   - Marca como procesado en Redis
```

### Flujo Extendido con Webhooks (Conceptual)

```
6️⃣ Webhook Publisher detecta evento
   - Consume product.stockReserved
   - Transforma a formato estandarizado
   - Consulta suscriptores en PostgreSQL
   ↓ HTTP POST

7️⃣ Edge Function Logger recibe webhook
   - Valida firma
   - Extrae datos del evento
   - Persiste en Supabase
   ↓ Registro almacenado

8️⃣ Edge Function Notifier recibe webhook
   - Valida firma
   - Determina destinatarios
   - Formatea mensaje
   ↓ Telegram Bot API

9️⃣ Telegram entrega notificación
   - Usuario recibe mensaje
   - "Tu orden ha sido confirmada"
```

---

## Patrones de Resiliencia Implementados

### 🛡️ Idempotent Consumer
- **Ubicación**: Orders Service
- **Mecanismo**: Redis con claves `processed:{idempotencyKey}`
- **TTL**: 24 horas
- **Propósito**: Evitar procesamiento duplicado de mensajes

### 🔒 Lock Distribuido
- **Ubicación**: Orders Service
- **Mecanismo**: Redis `SETNX` con claves `lock:{idempotencyKey}`
- **TTL**: 10 segundos
- **Propósito**: Prevenir race conditions entre instancias

### 🔄 Reconexión Automática
- **Componente**: RabbitMQ clients
- **Librería**: `amqp-connection-manager`
- **Estrategia**: Reintentos cada ~3 segundos
- **Propósito**: Recuperación automática ante fallos de broker

### ♻️ Reintentos con Backoff (Futuro)
- **Componente**: Webhook Publisher
- **Estrategia**: Exponencial backoff (1s, 2s, 4s, 8s, 16s)
- **Máximo**: 5 intentos
- **Propósito**: Entrega confiable de webhooks

---

## Escalabilidad y Extensibilidad

### Escalabilidad Horizontal
✅ **Orders Service**: Múltiples instancias con Redis compartido
✅ **Products Service**: Múltiples instancias
✅ **API Gateway**: Balanceo de carga con nginx/ALB

### Puntos de Extensión
🔲 **Webhook Publisher**: Agregar nuevos eventos a publicar
🔲 **Edge Functions**: Crear nuevas funciones serverless
🔲 **Destinos**: Integrar Slack, Email, SMS, etc.
🔲 **Eventos**: Agregar `order.cancelled`, `order.updated`, etc.

---

## Tecnologías

### Backend (Implementado)
- **Framework**: NestJS 11.x
- **Lenguaje**: TypeScript
- **ORM**: TypeORM
- **Message Broker**: RabbitMQ 3
- **Cache**: Redis 7

### Frontend/Webhooks (Futuro)
- **Serverless**: Supabase Edge Functions (Deno)
- **Base de Datos**: PostgreSQL (Supabase)
- **Notificaciones**: Telegram Bot API

### Infraestructura
- **Contenedores**: Docker + Docker Compose
- **Red**: Bridge network (microservices-network)
- **Volúmenes**: redis-data (persistencia)

---

## Referencias

- **Código fuente**: Ver carpetas `api-gateway/`, `orders-service/`, `products-service/`
- **Eventos documentados**: Ver `docs/webhook-events.md`
- **Estado actual**: Ver `Estado_Actual_Proyecto.md`
- **Guía de presentación**: Ver `RESUMEN.md`

