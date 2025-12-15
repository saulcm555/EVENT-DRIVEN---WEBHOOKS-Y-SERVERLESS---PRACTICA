# 📋 ESTADO ACTUAL DEL PROYECTO - ARQUITECTURA DE MICROSERVICIOS

## 🎯 Resumen General

Este proyecto implementa una **arquitectura de microservicios basada en eventos** para un sistema de gestión de órdenes y productos. Los servicios se comunican de manera asíncrona a través de **RabbitMQ** y utiliza **Redis** para garantizar idempotencia en el procesamiento de mensajes.

---

## 🏗️ 1. ARQUITECTURA GENERAL

### 1.1 Microservicios Existentes

El sistema está compuesto por **3 servicios principales**:

1. **API Gateway** (Puerto 3000)
   - Punto de entrada único para las peticiones HTTP del cliente
   - Expone endpoints REST públicos
   - Valida datos de entrada usando `class-validator`
   - Publica eventos a través de RabbitMQ (productor)
   - **NO consume mensajes**, solo envía

2. **Products Service** (Puerto 3001)
   - Gestiona el catálogo de productos y su inventario
   - Controla y actualiza el stock disponible
   - Actúa como **productor y consumidor** de eventos RabbitMQ
   - Base de datos SQLite: `products.db`
   - Expone API HTTP para consultas directas (opcional)

3. **Orders Service** (Puerto 3002)
   - Gestiona el ciclo de vida de las órdenes
   - Persiste órdenes en base de datos
   - Implementa **Idempotent Consumer Pattern** con Redis
   - Actúa como **consumidor** de eventos RabbitMQ
   - Base de datos SQLite: `orders.db`

### 1.2 API Gateway - Rol y Funcionalidad

**Ubicación**: `api-gateway/src/orders/orders.controller.ts`

**Responsabilidades**:
- Recibir peticiones HTTP POST para crear órdenes
- Validar el DTO `CreateOrderDto` (productId como UUID, quantity >= 1)
- Enviar mensaje síncrono (`send`) al patrón `orders.create` vía RabbitMQ
- Retornar la respuesta al cliente HTTP

**Código clave**:
```typescript
@Controller('orders')
export class OrdersController {
  @Post()
  async createOrder(@Body(new ValidationPipe()) dto: CreateOrderDto) {
    return this.ordersClient.send('orders.create', dto);
  }
}
```

### 1.3 Comunicación entre Servicios

**Modelo de comunicación**:
- **Síncrona**: Cliente → API Gateway (HTTP REST)
- **Asíncrona**: Entre microservicios (RabbitMQ)

**Tecnologías**:
- **RabbitMQ**: Message broker para comunicación asíncrona
- **NestJS Microservices**: Abstracción sobre RabbitMQ
- **amqp-connection-manager**: Reconexión automática en caso de fallo

---

## 📬 2. RABBITMQ - CONFIGURACIÓN Y USO

### 2.1 Exchanges y Colas

**Configuración actual**:
- **NO se definen exchanges personalizados** (se usa el exchange por defecto de RabbitMQ)
- **Routing**: Se utiliza el patrón de colas directas con nombres de patrones

**Colas existentes**:

1. **`orders_queue`**
   - **Durable**: true
   - **Consumidor**: Orders Service
   - **Productores**: API Gateway, Products Service
   - **Propósito**: Recibir solicitudes de creación de órdenes y notificaciones de stock

2. **`products_queue`**
   - **Durable**: false
   - **Consumidor**: Products Service
   - **Productores**: Orders Service
   - **Propósito**: Recibir solicitudes de reserva de stock

### 2.2 Patrones de Mensajería

El sistema utiliza dos tipos de patrones de NestJS Microservices:

1. **`send()` - Request-Response (síncrono)**
   - Espera respuesta del consumidor
   - Usado por: API Gateway → Orders Service
   - Patrón: `orders.create`

2. **`emit()` - Event-Based (asíncrono)**
   - Fire-and-forget, no espera respuesta
   - Usado para eventos de dominio
   - Patrones:
     - `product.reserveStock`
     - `product.stockReserved`

### 2.3 Eventos/Mensajes Publicados

#### Evento 1: `orders.create`
**Tipo**: Request-Response (send)  
**Publicado por**: API Gateway  
**Consumido por**: Orders Service  
**Payload**:
```typescript
{
  productId: string;  // UUID del producto
  quantity: number;   // Cantidad solicitada (>= 1)
}
```

#### Evento 2: `product.reserveStock`
**Tipo**: Event-Based (emit)  
**Publicado por**: Orders Service  
**Consumido por**: Products Service  
**Payload**:
```typescript
{
  productId: string;
  quantity: number;
  idempotencyKey: string;  // UUID único generado en Orders Service
}
```

#### Evento 3: `product.stockReserved`
**Tipo**: Event-Based (emit)  
**Publicado por**: Products Service  
**Consumido por**: Orders Service  
**Payload aprobado**:
```typescript
{
  approved: true;
  productId: string;
  quantity: number;
  idempotencyKey: string;
}
```
**Payload rechazado**:
```typescript
{
  approved: false;
  reason: 'PRODUCT_NOT_FOUND' | 'OUT_OF_STOCK';
  idempotencyKey: string;
}
```

### 2.4 Productores y Consumidores

| Servicio | Rol | Patrones que Publica | Patrones que Consume |
|----------|-----|----------------------|----------------------|
| **API Gateway** | Productor | `orders.create` | Ninguno |
| **Orders Service** | Productor + Consumidor | `product.reserveStock` | `orders.create`, `product.stockReserved` |
| **Products Service** | Productor + Consumidor | `product.stockReserved` | `product.reserveStock` |

### 2.5 Configuración de Conexión

**Orders Service** (`orders-service/src/main.ts`):
```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://localhost:5672'],
    queue: 'orders_queue',
    queueOptions: {
      durable: true,
    },
  },
});
```

**Products Service** (`products-service/src/main.ts`):
```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://localhost:5672'],
    queue: 'products_queue',
    queueOptions: {
      durable: false,
    },
  },
});
```

**Reconexión automática**:
- Se utiliza `amqp-connection-manager` (instalado en `package.json`)
- Reintentos automáticos cada ~3 segundos en caso de pérdida de conexión
- Los servicios se recuperan automáticamente cuando RabbitMQ vuelve a estar disponible

---

## 📦 3. EVENTOS DE DOMINIO

### 3.1 Flujo de Eventos de Negocio

```
1. Cliente → API Gateway
   POST /orders { productId, quantity }

2. API Gateway → Orders Service
   Mensaje: orders.create
   
3. Orders Service:
   - Crea orden con estado PENDING
   - Genera idempotencyKey (UUID)
   - Persiste en base de datos
   - Publica evento: product.reserveStock

4. Products Service:
   - Recibe: product.reserveStock
   - Valida producto y stock
   - Actualiza stock (si aprobado)
   - Publica evento: product.stockReserved

5. Orders Service:
   - Recibe: product.stockReserved
   - Verifica idempotencia en Redis
   - Actualiza estado orden (CONFIRMED o REJECTED)
   - Persiste cambio en base de datos
   - Marca mensaje como procesado en Redis
```

### 3.2 Eventos por Fase del Negocio

#### **Fase 1: Creación de Orden**
- **Evento**: `orders.create`
- **Punto de emisión**: API Gateway, tras validar el DTO
- **Información**: `{ productId, quantity }`
- **Resultado**: Orden con estado `PENDING` y `idempotencyKey` generado

#### **Fase 2: Reserva de Stock**
- **Evento**: `product.reserveStock`
- **Punto de emisión**: Orders Service, tras persistir la orden
- **Información**: `{ productId, quantity, idempotencyKey }`
- **Propósito**: Solicitar validación y actualización de inventario

#### **Fase 3: Confirmación de Stock**
- **Evento**: `product.stockReserved`
- **Punto de emisión**: Products Service, tras validar y actualizar stock
- **Información aprobada**: `{ approved: true, productId, quantity, idempotencyKey }`
- **Información rechazada**: `{ approved: false, reason, idempotencyKey }`
- **Resultado**: Orden actualizada a `CONFIRMED` o `REJECTED`

### 3.3 Estados de Orden

| Estado | Descripción | Cuándo se asigna |
|--------|-------------|------------------|
| **PENDING** | Orden creada, esperando confirmación de stock | Al crear la orden |
| **CONFIRMED** | Stock reservado correctamente | Al recibir `approved: true` |
| **REJECTED** | Stock insuficiente o producto no encontrado | Al recibir `approved: false` |

---

## 💾 4. PERSISTENCIA

### 4.1 Bases de Datos Utilizadas

1. **SQLite - products.db** (Products Service)
   - Tabla: `products`
   - ORM: TypeORM
   - Ubicación: Raíz del servicio

2. **SQLite - orders.db** (Orders Service)
   - Tabla: `orders`
   - ORM: TypeORM
   - Ubicación: Raíz del servicio

3. **Redis** (Orders Service)
   - Propósito: Almacenar claves de idempotencia
   - Puerto: 6379
   - Comandos utilizados: `SET`, `GET`, `EXISTS`, `DEL`, `SETEX`, `SETNX`

### 4.2 Entidades Principales

#### **Product Entity** (`products-service/src/products/entities/product.entity.ts`)
```typescript
@Entity('products')
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column('real')
  price: number;

  @Column('integer')
  stock: number;
}
```

**Atributos**:
- `id`: UUID generado automáticamente
- `name`: Nombre del producto (ej: "Laptop")
- `price`: Precio en formato decimal
- `stock`: Cantidad disponible en inventario

#### **Order Entity** (`orders-service/src/orders/entities/order.entity.ts`)
```typescript
@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @Column('integer')
  quantity: number;

  @Column()
  status: string;  // PENDING, CONFIRMED, REJECTED

  @Column({ unique: true })
  idempotencyKey: string;
}
```

**Atributos**:
- `id`: UUID de la orden
- `productId`: Referencia al producto (no es FK formal)
- `quantity`: Cantidad solicitada
- `status`: Estado actual de la orden
- `idempotencyKey`: Clave única para idempotencia (UNIQUE constraint)

### 4.3 Momentos de Persistencia

**Orders Service**:
1. **Primera persistencia**: Al crear la orden (`status: PENDING`)
   - Archivo: `orders-service/src/orders/orders.service.ts`
   - Método: `createOrder()`
   
2. **Segunda persistencia**: Al recibir respuesta de stock
   - Archivo: `orders-service/src/orders/orders.service.ts`
   - Método: `handleStockReserved()`
   - Actualiza `status` a `CONFIRMED` o `REJECTED`

**Products Service**:
1. **Actualización de stock**: Al reservar inventario (si aprobado)
   - Archivo: `products-service/src/products/products.service.ts`
   - Método: `reserveStock()`
   - Operación: `product.stock -= quantity`

**Redis (Orders Service)**:
1. **Escritura de clave**: Tras procesar el evento `product.stockReserved`
   - Clave: `processed:{idempotencyKey}`
   - Valor: `'true'`
   - TTL: 86400 segundos (24 horas)

2. **Escritura de lock**: Antes de procesar el mensaje (lock distribuido)
   - Clave: `lock:{idempotencyKey}`
   - Valor: `'1'`
   - TTL: 10 segundos
   - Comando: `SETNX` (solo si no existe)

---

## 🛡️ 5. ESTRATEGIAS DE RESILIENCIA

### 5.1 Patrón Implementado: Idempotent Consumer

**Ubicación**: `orders-service/src/orders/orders.service.ts`

**Descripción**:
El sistema implementa el patrón **Idempotent Consumer** para garantizar que los mensajes duplicados no se procesen múltiples veces, evitando inconsistencias en el estado del sistema.

### 5.2 Mecanismo de Prevención de Duplicados

**Flujo de verificación** (método `handleStockReserved()`):

```typescript
// 1. Verificar si el mensaje ya fue procesado
const cacheKey = `processed:${data.idempotencyKey}`;
const alreadyProcessed = await this.redisService.exists(cacheKey);
if (alreadyProcessed) {
  this.logger.warn(`Duplicate message detected for key ${data.idempotencyKey}, ignoring`);
  return { status: 'duplicate', message: 'Message already processed' };
}

// 2. Adquirir lock distribuido (previene race conditions)
const lockKey = `lock:${data.idempotencyKey}`;
const lockAcquired = await this.redisService.setNX(lockKey, '1', 10);
if (!lockAcquired) {
  this.logger.warn(`Lock already held for key ${data.idempotencyKey}, another instance processing`);
  return { status: 'locked', message: 'Another instance is processing this message' };
}

try {
  // 3. Procesar el mensaje (actualizar orden)
  order.status = data.approved ? 'CONFIRMED' : 'REJECTED';
  await this.orderRepository.save(order);

  // 4. Marcar mensaje como procesado (TTL 24 horas)
  await this.redisService.set(cacheKey, 'true', 86400);
} finally {
  // 5. Liberar lock
  await this.redisService.del(lockKey);
}
```

**Componentes clave**:
1. **Clave de idempotencia**: `idempotencyKey` (UUID) generado en Orders Service
2. **Redis como cache**: Almacena claves de mensajes procesados
3. **Lock distribuido**: Previene condiciones de carrera con múltiples instancias
4. **TTL de 24 horas**: Evita crecimiento infinito de claves en Redis

### 5.3 Manejo de ACK en RabbitMQ

**Configuración por defecto de NestJS Microservices**:
- **ACK automático**: Los mensajes se marcan como procesados cuando el handler retorna sin error
- **NACK automático**: Si el handler lanza una excepción, el mensaje se reenvía o va a dead letter queue

**Comportamiento actual**:
- No hay configuración explícita de `noAck: false`
- Se confía en el comportamiento por defecto de NestJS
- Los mensajes duplicados se ignoran en la lógica de negocio (no a nivel de broker)

### 5.4 Reconexión Automática

**Librería**: `amqp-connection-manager` (incluida en `@nestjs/microservices`)

**Características**:
- Reintentos automáticos cada ~3 segundos
- Reconexión transparente sin reiniciar el servicio
- Gestión automática de canales y consumidores

**Configuración Redis** (`orders-service/src/redis/redis.service.ts`):
```typescript
this.client = new Redis({
  host: this.configService.get('REDIS_HOST', 'localhost'),
  port: this.configService.get('REDIS_PORT', 6379),
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});
```

---

## 🔄 6. FLUJO COMPLETO (HAPPY PATH)

### Paso 1: Cliente envía petición HTTP
```
POST http://localhost:3000/orders
Content-Type: application/json

{
  "productId": "6053d96d-9598-42b6-860b-b58af082a071",
  "quantity": 2
}
```

### Paso 2: API Gateway valida y envía mensaje
- **Archivo**: `api-gateway/src/orders/orders.controller.ts`
- **Validación**: `CreateOrderDto` (UUID válido, quantity >= 1)
- **Acción**: `this.ordersClient.send('orders.create', dto)`
- **Espera respuesta**: Sí (patrón request-response)

### Paso 3: Orders Service crea la orden
- **Archivo**: `orders-service/src/orders/orders.controller.ts` → método `createOrder()`
- **Acción**:
  1. Genera `idempotencyKey` único (UUID v4)
  2. Crea entidad Order con estado `PENDING`
  3. Persiste en `orders.db`
  4. Publica evento: `this.productsClient.emit('product.reserveStock', { productId, quantity, idempotencyKey })`
  5. Retorna orden al API Gateway (que la devuelve al cliente HTTP)

**Estado en este punto**:
- Orden persistida con estado `PENDING`
- Cliente HTTP recibe respuesta inmediata con los datos de la orden

### Paso 4: Products Service reserva stock
- **Archivo**: `products-service/src/products/products.controller.ts` → patrón `product.reserveStock`
- **Acción**:
  1. Busca producto por `productId`
  2. **Validación 1**: ¿Existe el producto?
     - Si NO → `approved: false, reason: 'PRODUCT_NOT_FOUND'`
  3. **Validación 2**: ¿Hay suficiente stock?
     - Si NO → `approved: false, reason: 'OUT_OF_STOCK'`
  4. **Si ambas validaciones pasan**:
     - Actualiza: `product.stock -= quantity`
     - Persiste en `products.db`
  5. Publica evento: `this.ordersClient.emit('product.stockReserved', result)`

### Paso 5: Orders Service confirma la orden
- **Archivo**: `orders-service/src/orders/orders.controller.ts` → patrón `product.stockReserved`
- **Acción** (método `handleStockReserved()`):
  1. **Verificación idempotencia**: `await this.redisService.exists(`processed:${idempotencyKey}`)`
     - Si existe → Retorna sin procesar (mensaje duplicado)
  2. **Adquirir lock**: `await this.redisService.setNX(`lock:${idempotencyKey}`, '1', 10)`
     - Si NO adquiere → Retorna (otra instancia procesando)
  3. **Buscar orden**: `await this.orderRepository.findOne({ where: { idempotencyKey } })`
  4. **Actualizar estado**:
     - Si `approved: true` → `order.status = 'CONFIRMED'`
     - Si `approved: false` → `order.status = 'REJECTED'`
  5. **Persistir**: `await this.orderRepository.save(order)`
  6. **Marcar como procesado**: `await this.redisService.set(`processed:${idempotencyKey}`, 'true', 86400)`
  7. **Liberar lock**: `await this.redisService.del(`lock:${idempotencyKey}`)`

### Estado Final
- **Base de datos orders.db**: Orden con estado `CONFIRMED`
- **Base de datos products.db**: Stock reducido en la cantidad solicitada
- **Redis**: Clave `processed:{idempotencyKey}` almacenada con TTL de 24 horas
- **Cliente**: Ya recibió la respuesta en el Paso 3 (con estado `PENDING`)

---

## ♻️ 7. PUNTOS REUTILIZABLES PARA EXTENSIÓN

### 7.1 Infraestructura Completa
✅ **Reutilizable sin cambios**:
- Configuración de RabbitMQ en `docker-compose.yml`
- Configuración de Redis en `docker-compose.yml`
- Healthchecks de servicios
- Red Docker `microservices-network`

### 7.2 Entidades y DTOs
✅ **Reutilizable sin cambios**:
- `Product` entity (`products-service/src/products/entities/product.entity.ts`)
- `Order` entity (`orders-service/src/orders/entities/order.entity.ts`)
- `CreateOrderDto` (`api-gateway/src/orders/dto/create-order.dto.ts`)
- Validaciones con `class-validator` en DTOs

### 7.3 Servicios de Soporte
✅ **Reutilizable sin cambios**:
- **RedisService completo** (`orders-service/src/redis/redis.service.ts`)
  - Métodos: `get()`, `set()`, `setNX()`, `del()`, `exists()`
  - Estrategia de reintentos
  - Gestión de conexión y desconexión
- **RedisModule** (`orders-service/src/redis/redis.module.ts`)

### 7.4 Lógica de Negocio
✅ **Reutilizable con adaptaciones menores**:
- **Lógica de reserva de stock** (`products-service/src/products/products.service.ts`)
  - Validaciones de producto y stock
  - Actualización de inventario
- **Patrón de idempotencia** (`orders-service/src/orders/orders.service.ts`)
  - Verificación de duplicados
  - Lock distribuido
  - Marcado de mensajes procesados

### 7.5 Configuración de RabbitMQ
✅ **Reutilizable parcialmente** (requiere agregar nuevas colas):
- Estructura de configuración con `ClientsModule.register()`
- Uso de `Transport.RMQ`
- Patrones `@MessagePattern()` para consumidores
- Métodos `emit()` y `send()` para productores

**Extensión necesaria**:
- Agregar nuevas colas para webhooks (ej: `webhooks_queue`, `notifications_queue`)
- Configurar exchanges personalizados si se requiere enrutamiento complejo

### 7.6 Eventos de Dominio Existentes
✅ **Reutilizables como base**:
- **Evento `orders.create`**: Puede extenderse para incluir metadata adicional
- **Evento `product.reserveStock`**: Patrón aplicable a otros recursos
- **Evento `product.stockReserved`**: Modelo de respuesta aprobado/rechazado

**Nuevos eventos sugeridos**:
- `order.confirmed` → Notificar a servicios externos vía webhook
- `order.rejected` → Disparar compensación o notificaciones
- `webhook.sent` → Auditoría de webhooks enviados
- `webhook.failed` → Manejo de reintentos

### 7.7 Patrones de Comunicación
✅ **Reutilizables**:
- **Request-Response** (`send()`): Para operaciones síncronas entre servicios
- **Event-Driven** (`emit()`): Para notificaciones asíncronas
- **Hybrid Model**: API Gateway HTTP + Microservicios RabbitMQ

### 7.8 Estrategias de Resiliencia
✅ **Reutilizables en nuevos servicios**:
- **Idempotent Consumer Pattern**
- **Lock distribuido con Redis**
- **TTL para limpieza automática**
- **Reconexión automática de RabbitMQ**
- **Estrategia de reintentos en Redis**

### 7.9 Configuración de TypeORM
✅ **Reutilizable sin cambios**:
- Configuración con SQLite
- Sincronización automática de esquemas (`synchronize: true`)
- Inyección de repositorios con `@InjectRepository()`

### 7.10 Dockerización
✅ **Reutilizable sin cambios**:
- Dockerfiles de cada servicio
- Volúmenes para desarrollo (`./service:/app`)
- Políticas de reinicio (`restart: unless-stopped`)
- Dependencias entre servicios con healthchecks

---

## 📊 8. RESUMEN DE DEPENDENCIAS TÉCNICAS

### Dependencias Principales (package.json)
```json
{
  "@nestjs/common": "^11.0.1",
  "@nestjs/config": "^4.0.2",
  "@nestjs/core": "^11.0.1",
  "@nestjs/microservices": "^11.1.9",
  "@nestjs/typeorm": "^11.0.0",
  "amqp-connection-manager": "^5.0.0",
  "amqplib": "^0.10.9",
  "class-validator": "^0.14.3",
  "ioredis": "^5.x",  // En orders-service
  "typeorm": "^0.3.28",
  "sqlite3": "^5.1.7",
  "uuid": "^9.x"
}
```

### Versiones de Infraestructura (docker-compose.yml)
- RabbitMQ: `3-management`
- Redis: `7-alpine`
- Node.js: (implícito en Dockerfiles, verificar)

---

## 🔍 9. PUNTOS DE ATENCIÓN PARA EXTENSIÓN

### 9.1 Limitaciones Actuales
- **No hay auditoría**: No se registran los eventos enviados/recibidos
- **No hay reintentos**: Si un mensaje falla, no se reintenta automáticamente
- **No hay dead letter queue**: Mensajes fallidos se pierden
- **No hay monitoreo**: Falta observabilidad de colas y métricas

### 9.2 Oportunidades de Extensión
- **Agregar Webhooks Service**: Consumir eventos de `order.confirmed` y enviar webhooks
- **Agregar Notifications Service**: Enviar emails/SMS cuando cambia el estado de una orden
- **Agregar API de consulta**: Endpoints GET para listar órdenes y productos
- **Agregar compensación**: Liberar stock si una orden se cancela

### 9.3 Elementos NO Implementados (para futuro)
- Autenticación/Autorización
- Paginación en consultas
- Versionado de API
- Manejo de transacciones distribuidas (Saga Pattern)
- Circuit Breaker
- Rate Limiting
- Logging estructurado
- Métricas con Prometheus
- Tracing distribuido

---

## 📝 10. CONCLUSIÓN

Este proyecto implementa una **arquitectura de microservicios basada en eventos** sólida y funcional, con énfasis en:

✅ **Comunicación asíncrona** vía RabbitMQ  
✅ **Idempotencia** con Redis para prevenir duplicados  
✅ **Resiliencia** con reconexión automática  
✅ **Separación de responsabilidades** clara entre servicios  
✅ **Validación de datos** en el API Gateway  
✅ **Persistencia** con TypeORM y SQLite  

**El sistema está preparado para**:
- Extender con nuevos servicios (Webhooks, Notificaciones)
- Agregar nuevas colas y eventos
- Escalar horizontalmente (gracias a Redis para estado compartido)
- Implementar patrones adicionales de resiliencia

**Base de código limpia y bien estructurada**, con patrones de diseño claros y fácil de entender para nuevos desarrolladores.
