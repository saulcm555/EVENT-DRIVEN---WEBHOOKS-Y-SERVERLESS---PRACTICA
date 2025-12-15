# 🚀 Supabase Edge Functions

Este directorio contiene las Edge Functions serverless que procesan webhooks del sistema.

## 📁 Estructura

```
supabase/
├── functions/
│   ├── telegram-notifier/   # Envía notificaciones a Telegram
│   │   └── index.ts
│   └── webhook-logger/       # Registra webhooks en PostgreSQL
│       └── index.ts
├── schema.sql               # Schema de base de datos
└── config.toml              # Configuración de Supabase CLI
```

## 🤖 Edge Functions Disponibles

### 1. **telegram-notifier**
Recibe webhooks y envía notificaciones formateadas a Telegram.

**Endpoint:** `https://YOUR_PROJECT.supabase.co/functions/v1/telegram-notifier`

**Payload de ejemplo:**
```json
{
  "event": "product.stockReserved",
  "idempotency_key": "uuid",
  "timestamp": "2025-12-15T10:30:00Z",
  "data": {
    "approved": true,
    "productId": "uuid",
    "quantity": 2
  }
}
```

**Secrets requeridos:**
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

---

### 2. **webhook-logger**
Registra todos los webhooks recibidos en la base de datos `webhook_events_log`.

**Endpoint:** `https://YOUR_PROJECT.supabase.co/functions/v1/webhook-logger`

**Secrets requeridos:**
- `SUPABASE_URL` (automático)
- `SUPABASE_SERVICE_ROLE_KEY` (automático)

---

## 🛠️ Desarrollo Local

### Requisitos previos:
1. **Instalar Supabase CLI:**
   ```bash
   npm install -g supabase
   ```

2. **Verificar instalación:**
   ```bash
   supabase --version
   ```

### Comandos útiles:

```bash
# Iniciar Edge Functions localmente
supabase functions serve

# Servir una función específica
supabase functions serve telegram-notifier

# Probar función localmente (con curl)
curl -i --location --request POST 'http://localhost:54321/functions/v1/telegram-notifier' \
  --header 'Content-Type: application/json' \
  --data '{
    "event": "product.stockReserved",
    "idempotency_key": "test-123",
    "timestamp": "2025-12-15T10:30:00Z",
    "data": {
      "approved": true,
      "productId": "test-product-id",
      "quantity": 2
    }
  }'
```

---

## 🚀 Desplegar a Producción

### 1. Login en Supabase
```bash
supabase login
```

### 2. Vincular proyecto
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

### 3. Configurar secrets
```bash
supabase secrets set TELEGRAM_BOT_TOKEN=your_token
supabase secrets set TELEGRAM_CHAT_ID=your_chat_id
```

### 4. Desplegar todas las funciones
```bash
supabase functions deploy
```

### 5. Desplegar función específica
```bash
supabase functions deploy telegram-notifier
supabase functions deploy webhook-logger
```

---

## 📊 Verificar Deployment

Después del deploy, obtendrás las URLs:
```
https://YOUR_PROJECT.supabase.co/functions/v1/telegram-notifier
https://YOUR_PROJECT.supabase.co/functions/v1/webhook-logger
```

### Probar en producción:
```bash
curl -i --location --request POST \
  'https://YOUR_PROJECT.supabase.co/functions/v1/telegram-notifier' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "event": "product.stockReserved",
    "idempotency_key": "test-uuid",
    "timestamp": "2025-12-15T10:30:00Z",
    "data": {
      "approved": true,
      "productId": "test-id",
      "quantity": 2
    }
  }'
```

---

## 🔐 Secrets Configurados en Supabase

Ir a: **Project Settings → Edge Functions → Secrets**

- ✅ `TELEGRAM_BOT_TOKEN` (configurado)
- ✅ `TELEGRAM_CHAT_ID` (configurado)
- ✅ `SUPABASE_URL` (automático)
- ✅ `SUPABASE_SERVICE_ROLE_KEY` (automático)

---

## 📝 Logs y Debugging

### Ver logs en tiempo real:
```bash
supabase functions logs telegram-notifier
supabase functions logs webhook-logger
```

### Ver logs en Dashboard:
**Functions → [Nombre función] → Logs**

---

## 🧪 Testing

### Probar con Postman/Thunder Client:

**URL:** `https://YOUR_PROJECT.supabase.co/functions/v1/telegram-notifier`

**Headers:**
```
Authorization: Bearer YOUR_ANON_KEY
Content-Type: application/json
```

**Body:**
```json
{
  "event": "product.stockReserved",
  "idempotency_key": "a7f3e8c2-4b9d-4e1a-8c7f-9d2e4b5a6c3d",
  "timestamp": "2025-12-15T10:30:45.123Z",
  "data": {
    "approved": true,
    "productId": "6053d96d-9598-42b6-860b-b58af082a071",
    "quantity": 2
  },
  "metadata": {
    "source": "products-service"
  }
}
```

---

## 🔗 Próximos Pasos

1. ✅ Edge Functions creadas
2. ⏭️ Crear Webhook Publisher Service (FASE 3)
3. ⏭️ Integrar con RabbitMQ
4. ⏭️ Implementar reintentos con backoff exponencial

---

## 📚 Recursos

- [Supabase Edge Functions Docs](https://supabase.com/docs/guides/functions)
- [Deno Deploy](https://deno.com/deploy)
- [Telegram Bot API](https://core.telegram.org/bots/api)
