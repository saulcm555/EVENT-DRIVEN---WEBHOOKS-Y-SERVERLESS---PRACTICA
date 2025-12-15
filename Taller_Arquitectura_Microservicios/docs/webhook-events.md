# 📬 DOCUMENTACIÓN DE EVENTOS DE NEGOCIO

## Introducción

Este documento describe los eventos de dominio del sistema de gestión de órdenes y productos. Cada evento representa un cambio significativo en el estado del negocio.

**Estado actual**: Los eventos son consumidos internamente entre microservicios vía RabbitMQ.

**Extensión futura**: Un **Webhook Publisher Service** transformará estos eventos al formato estandarizado y los enviará como webhooks HTTP a suscriptores externos.

### Nomenclatura de Campos de Idempotencia

- **`idempotencyKey`** (camelCase): Nombre usado en el código interno de NestJS/TypeScript
- **`idempotency_key`** (snake_case): Nombre en el payload JSON estandarizado de webhooks
- **Son el mismo concepto**: La misma clave UUID generada en Orders Service se propaga con ambos nombres según el contexto

---

## Evento 1: `product.reserveStock`

### Descripción Funcional
Evento emitido cuando una orden es creada y requiere validación de disponibilidad de stock. Representa una solicitud de reserva de inventario que debe ser procesada por el servicio de productos para determinar si hay suficientes unidades disponibles.

### Información del Evento

| Propiedad | Valor |
|-----------|-------|
| **Nombre del evento** | `product.reserveStock` |
| **Servicio emisor** | Orders Service |
| **Servicio consumidor** | Products Service |
| **Tipo de comunicación** | Event-Based (RabbitMQ `emit`) |
| **Cola RabbitMQ** | `products_queue` |

### Momento de Emisión

El evento se dispara en el método `createOrder()` del Orders Service, inmediatamente después de:
1. Generar el `idempotencyKey` único (UUID v4)
2. Crear la entidad Order con estado `PENDING`
3. Persistir la orden en la base de datos `orders.db`

**Archivo**: `orders-service/src/orders/orders.service.ts`

**Código de emisión**:
```typescript
this.productsClient.emit('product.reserveStock', {
  productId: dto.productId,
  quantity: dto.quantity,
  idempotencyKey,
});
```

### Payload Actual (Interno - RabbitMQ)

**Este es el payload REAL que envía el código actual:**

```json
{
  "productId": "6053d96d-9598-42b6-860b-b58af082a071",
  "quantity": 2,
  "idempotencyKey": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
}
```

**Campos presentes en el código actual**:
- ✅ `productId`: Existe en el DTO y se propaga
- ✅ `quantity`: Existe en el DTO y se propaga
- ✅ `idempotencyKey`: Generado en `orders.service.ts` con `uuid.v4()`

### Payload Estandarizado (Webhook - FUTURO)

```json
{
  "event": "product.reserveStock",
  "version": "1.0",
  "id": "b4e9a2f1-7c3d-4e8a-9f2b-1d5c6e7a8b9c",
  "idempotency_key": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d",
  "timestamp": "2025-12-14T10:30:45.123Z",
  "data": {
    "productId": "6053d96d-9598-42b6-860b-b58af082a071",
    "quantity": 2,
    "orderId": "f2c8b1a7-3e4d-5a6b-7c8d-9e0f1a2b3c4d",
    "status": "PENDING"
  },
  "metadata": {
    "source": "orders-service",
    "environment": "development",
    "correlation_id": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
  }
}
```

### Campos del Payload Webhook

| Campo | Tipo | Origen | Descripción |
|-------|------|--------|-------------|
| `event` | string | 🔵 Webhook Publisher | Nombre del evento |
| `version` | string | 🔵 Webhook Publisher | Versión del esquema del evento |
| `id` | string (UUID) | 🔵 Webhook Publisher | Identificador único del mensaje de webhook |
| `idempotency_key` | string (UUID) | ✅ Orders Service | Clave de idempotencia (mapeada desde `idempotencyKey`) |
| `timestamp` | string (ISO-8601) | 🔵 Webhook Publisher | Fecha y hora de emisión del webhook |
| `data.productId` | string (UUID) | ✅ Payload interno | Identificador del producto a reservar |
| `data.quantity` | number | ✅ Payload interno | Cantidad de unidades solicitadas |
| `data.orderId` | string (UUID) | 🔵 **FUTURO** | Identificador de la orden (requiere modificar el emit) |
| `data.status` | string | 🔵 **FUTURO** | Estado de la orden (requiere consultar DB o incluir en emit) |
| `metadata.source` | string | 🔵 Webhook Publisher | Servicio que emite el evento |
| `metadata.environment` | string | 🔵 Webhook Publisher | Entorno de ejecución (de variable de entorno) |
| `metadata.correlation_id` | string | 🔵 API Gateway | Identificador para rastreo distribuido (puede generarse en el Gateway o en headers HTTP) |

**Leyenda**:
- ✅ **Existe en el código actual**
- 🔵 **Enriquecimiento futuro del Webhook Publisher**

---

## Evento 2: `product.stockReserved`

### Descripción Funcional
Evento emitido por el servicio de productos como respuesta a una solicitud de reserva de stock. Indica si la reserva fue aprobada (stock suficiente) o rechazada (producto no encontrado o stock insuficiente). Este evento determina el estado final de la orden.

### Información del Evento

| Propiedad | Valor |
|-----------|-------|
| **Nombre del evento** | `product.stockReserved` |
| **Servicio emisor** | Products Service |
| **Servicio consumidor** | Orders Service |
| **Tipo de comunicación** | Event-Based (RabbitMQ `emit`) |
| **Cola RabbitMQ** | `orders_queue` |

### Momento de Emisión

El evento se dispara en el método `reserveStock()` del Products Service, después de:
1. Buscar el producto en la base de datos
2. Validar la existencia del producto
3. Validar disponibilidad de stock
4. Actualizar el stock (si fue aprobado) en `products.db`

**Archivo**: `products-service/src/products/products.service.ts`

**Código de emisión**:
```typescript
this.ordersClient.emit('product.stockReserved', result);
```

### Payload Actual (Interno - RabbitMQ)

**Este es el payload REAL que envía el código actual:**

**Caso 1: Reserva Aprobada**
```json
{
  "approved": true,
  "productId": "6053d96d-9598-42b6-860b-b58af082a071",
  "quantity": 2,
  "idempotencyKey": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
}
```

**Caso 2: Reserva Rechazada**
```json
{
  "approved": false,
  "reason": "OUT_OF_STOCK",
  "idempotencyKey": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
}
```

**Campos presentes en el código actual**:
- ✅ `approved`: Booleano que indica éxito/fracaso
- ✅ `productId`: Solo en caso aprobado
- ✅ `quantity`: Solo en caso aprobado
- ✅ `reason`: Solo en caso rechazado (`PRODUCT_NOT_FOUND`, `OUT_OF_STOCK`)
- ✅ `idempotencyKey`: Propagado desde el evento `product.reserveStock`

**Posibles valores de `reason`**:
- `PRODUCT_NOT_FOUND`: El producto no existe en la base de datos
- `OUT_OF_STOCK`: Stock insuficiente para la cantidad solicitada

### Payload Estandarizado (Webhook - FUTURO) - Aprobado

**Este payload será generado por el Webhook Publisher Service cuando se implemente:**

```json
{
  "event": "product.stockReserved",
  "version": "1.0",
  "id": "c8d1e9f2-6a4b-3c7d-8e9f-0a1b2c3d4e5f",
  "idempotency_key": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d",
  "timestamp": "2025-12-14T10:30:46.789Z",
  "data": {
    "approved": true,
    "productId": "6053d96d-9598-42b6-860b-b58af082a071",
    "productName": "Laptop",
    "quantity": 2,
    "remainingStock": 8,
    "orderId": "f2c8b1a7-3e4d-5a6b-7c8d-9e0f1a2b3c4d",
    "newOrderStatus": "CONFIRMED"
  },
  "metadata": {
    "source": "products-service",
    "environment": "development",
    "correlation_id": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
  }
}
```

**Enriquecimiento del Webhook Publisher**:
- 🔵 `event`: Agregado por Webhook Publisher
- 🔵 `version`: Agregado por Webhook Publisher
- 🔵 `id`: Generado por Webhook Publisher (UUID único del webhook)
- ✅ `idempotency_key`: Mapeado desde `idempotencyKey` del payload interno
- 🔵 `timestamp`: Generado por Webhook Publisher
- ✅ `data.approved`: Del payload interno
- ✅ `data.productId`: Del payload interno
- 🔵 `data.productName`: **FUTURO** - Requiere consultar la entidad Product en Products Service
- ✅ `data.quantity`: Del payload interno
- 🔵 `data.remainingStock`: **FUTURO** - Requiere consultar el stock actualizado en Products Service
- 🔵 `data.orderId`: **FUTURO** - Requiere que Orders Service lo incluya en el evento `product.reserveStock`
- 🔵 `data.newOrderStatus`: **FUTURO** - Puede inferirse del campo `approved` o consultarse en Orders Service
- 🔵 `metadata.source`: Agregado por Webhook Publisher
- 🔵 `metadata.environment`: Agregado por Webhook Publisher
- 🔵 `metadata.correlation_id`: Propagado desde el flujo inicial (generado en API Gateway)

### Payload Estandarizado (Webhook - FUTURO) - Rechazado

**Este payload será generado por el Webhook Publisher Service cuando se implemente:**

```json
{
  "event": "product.stockReserved",
  "version": "1.0",
  "id": "d9e2f0a3-7b5c-4d8e-9f0a-1b2c3d4e5f6a",
  "idempotency_key": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d",
  "timestamp": "2025-12-14T10:30:46.789Z",
  "data": {
    "approved": false,
    "reason": "OUT_OF_STOCK",
    "productId": "6053d96d-9598-42b6-860b-b58af082a071",
    "productName": "Laptop",
    "requestedQuantity": 2,
    "availableStock": 0,
    "orderId": "f2c8b1a7-3e4d-5a6b-7c8d-9e0f1a2b3c4d",
    "newOrderStatus": "REJECTED"
  },
  "metadata": {
    "source": "products-service",
    "environment": "development",
    "correlation_id": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d"
  }
}
```

**Enriquecimiento del Webhook Publisher**:
- 🔵 `event`: Agregado por Webhook Publisher
- 🔵 `version`: Agregado por Webhook Publisher
- 🔵 `id`: Generado por Webhook Publisher (UUID único del webhook)
- ✅ `idempotency_key`: Mapeado desde `idempotencyKey` del payload interno
- 🔵 `timestamp`: Generado por Webhook Publisher
- ✅ `data.approved`: Del payload interno
- ✅ `data.reason`: Del payload interno
- 🔵 `data.productId`: **FUTURO** - No está en el payload rechazado actual, requiere propagarlo desde `product.reserveStock`
- 🔵 `data.productName`: **FUTURO** - Requiere consultar Product en Products Service
- 🔵 `data.requestedQuantity`: **FUTURO** - Requiere propagarlo desde `product.reserveStock`
- 🔵 `data.availableStock`: **FUTURO** - Requiere consultar stock actual en Products Service
- 🔵 `data.orderId`: **FUTURO** - Requiere propagarlo desde el evento original
- 🔵 `data.newOrderStatus`: **FUTURO** - Puede inferirse del campo `approved` (false → REJECTED)
- 🔵 `metadata.source`: Agregado por Webhook Publisher
- 🔵 `metadata.environment`: Agregado por Webhook Publisher
- 🔵 `metadata.correlation_id`: Propagado desde el flujo inicial (generado en API Gateway)

### Campos del Payload Webhook (Aprobado)

| Campo | Tipo | Origen | Descripción |
|-------|------|--------|-------------|
| `event` | string | 🔵 Webhook Publisher | Nombre del evento |
| `version` | string | 🔵 Webhook Publisher | Versión del esquema del evento |
| `id` | string (UUID) | 🔵 Webhook Publisher | Identificador único del mensaje de webhook |
| `idempotency_key` | string (UUID) | ✅ Products Service | Clave de idempotencia (mapeada desde `idempotencyKey`) |
| `timestamp` | string (ISO-8601) | 🔵 Webhook Publisher | Fecha y hora de emisión del webhook |
| `data.approved` | boolean | ✅ Payload interno | Indica si la reserva fue aprobada (`true`) |
| `data.productId` | string (UUID) | ✅ Payload interno | Identificador del producto |
| `data.productName` | string | 🔵 **FUTURO** | Nombre del producto (requiere consulta a DB) |
| `data.quantity` | number | ✅ Payload interno | Cantidad reservada exitosamente |
| `data.remainingStock` | number | 🔵 **FUTURO** | Stock restante (requiere consulta a DB) |
| `data.orderId` | string (UUID) | 🔵 **FUTURO** | Identificador de la orden (no propagado actualmente) |
| `data.newOrderStatus` | string | 🔵 **FUTURO** | Nuevo estado de la orden (`CONFIRMED`) |
| `metadata.source` | string | 🔵 Webhook Publisher | Servicio que emite el evento |
| `metadata.environment` | string | 🔵 Webhook Publisher | Entorno de ejecución |
| `metadata.correlation_id` | string | 🔵 API Gateway | Identificador para rastreo distribuido |

**Leyenda**:
- ✅ **Existe en el código actual**
- 🔵 **Enriquecimiento futuro del Webhook Publisher**

### Campos del Payload Webhook (Rechazado)

| Campo | Tipo | Origen | Descripción |
|-------|------|--------|-------------|
| `event` | string | 🔵 Webhook Publisher | Nombre del evento |
| `version` | string | 🔵 Webhook Publisher | Versión del esquema del evento |
| `id` | string (UUID) | 🔵 Webhook Publisher | Identificador único del mensaje de webhook |
| `idempotency_key` | string (UUID) | ✅ Products Service | Clave de idempotencia (mapeada desde `idempotencyKey`) |
| `timestamp` | string (ISO-8601) | 🔵 Webhook Publisher | Fecha y hora de emisión del webhook |
| `data.approved` | boolean | ✅ Payload interno | Indica que la reserva fue rechazada (`false`) |
| `data.reason` | string | ✅ Payload interno | Motivo del rechazo (`PRODUCT_NOT_FOUND`, `OUT_OF_STOCK`) |
| `data.productId` | string (UUID) | 🔵 **FUTURO** | Identificador del producto (no propagado en rechazo actual) |
| `data.productName` | string | 🔵 **FUTURO** | Nombre del producto (requiere consulta a DB) |
| `data.requestedQuantity` | number | 🔵 **FUTURO** | Cantidad solicitada (no propagada en rechazo actual) |
| `data.availableStock` | number | 🔵 **FUTURO** | Stock disponible (requiere consulta a DB) |
| `data.orderId` | string (UUID) | 🔵 **FUTURO** | Identificador de la orden (no propagado actualmente) |
| `data.newOrderStatus` | string | 🔵 **FUTURO** | Nuevo estado de la orden (`REJECTED`) |
| `metadata.source` | string | 🔵 Webhook Publisher | Servicio que emite el evento |
| `metadata.environment` | string | 🔵 Webhook Publisher | Entorno de ejecución |
| `metadata.correlation_id` | string | 🔵 API Gateway | Identificador para rastreo distribuido |

**Leyenda**:
- ✅ **Existe en el código actual**
- 🔵 **Enriquecimiento futuro del Webhook Publisher**

---

## Relación con Idempotencia

Ambos eventos utilizan el campo `idempotencyKey` (código interno) / `idempotency_key` (webhook) generado en el Orders Service para garantizar:

### Nomenclatura

- **En el código TypeScript/NestJS**: `idempotencyKey` (camelCase)
- **En payloads JSON de webhooks**: `idempotency_key` (snake_case)
- **Son la misma clave**: UUID v4 generado con `uuid.v4()` en `orders.service.ts`

### Mecanismos de Idempotencia

1. **Procesamiento único**: Redis almacena la clave como `processed:{idempotencyKey}` con TTL de 24 horas
2. **Lock distribuido**: Se crea un lock temporal `lock:{idempotencyKey}` con TTL de 10 segundos
3. **Trazabilidad**: La misma clave se propaga a través de todo el flujo:
   - Generada en Orders Service al crear la orden
   - Enviada en evento `product.reserveStock`
   - Devuelta en evento `product.stockReserved`
   - Verificada en Redis antes de actualizar la orden
   - Convertida a `idempotency_key` en el webhook estandarizado

**Archivo de implementación**: `orders-service/src/orders/orders.service.ts` (método `handleStockReserved()`)

### Correlation ID para Trazabilidad

El campo `correlation_id` en los webhooks sirve para rastreo distribuido end-to-end:

- **Generación**: Puede generarse en el API Gateway al recibir la petición HTTP inicial
- **Propagación**: Se incluye en headers HTTP o en el contexto del evento
- **Propósito**: Rastrear una petición a través de múltiples servicios
- **Relación con idempotency_key**: Pueden ser el mismo valor o valores diferentes:
  - **Opción 1**: Usar el mismo `idempotencyKey` como `correlation_id` (más simple)
  - **Opción 2**: Generar un `correlation_id` separado en el API Gateway (más robusto para múltiples intentos)

---

## Flujo Completo de Eventos

```
1. Cliente HTTP → API Gateway
   POST /orders { productId, quantity }

2. API Gateway → Orders Service
   RabbitMQ: orders.create

3. Orders Service → Products Service
   RabbitMQ emit: product.reserveStock
   ├─ Genera idempotencyKey
   ├─ Persiste orden (PENDING)
   └─ Envía evento

4. Products Service → Orders Service
   RabbitMQ emit: product.stockReserved
   ├─ Valida producto y stock
   ├─ Actualiza stock (si aprobado)
   └─ Envía resultado

5. Orders Service
   ├─ Verifica idempotencia en Redis
   ├─ Adquiere lock distribuido
   ├─ Actualiza orden (CONFIRMED/REJECTED)
   ├─ Persiste cambio
   └─ Marca como procesado en Redis
```

---

## Uso de Eventos para Webhooks (Extensión Futura)

Los eventos documentados en este archivo pueden ser publicados externamente como webhooks mediante un **Webhook Publisher Service** que:

1. Consume eventos de RabbitMQ
2. Transforma payloads internos al formato estandarizado
3. Envía HTTP POST a URLs de suscriptores registrados
4. Implementa reintentos con backoff exponencial
5. Registra el historial de envíos en base de datos

**Eventos candidatos para webhooks externos**:
- `product.stockReserved` → Notificar cuando una orden cambia de estado
- `product.reserveStock` → Auditoría de solicitudes de reserva

**Formato del webhook**: Los payloads estandarizados de este documento serán el cuerpo JSON del HTTP POST.
