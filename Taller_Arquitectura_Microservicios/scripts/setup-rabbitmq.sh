#!/bin/bash

# ============================================
# RabbitMQ Setup Script
# Configura Exchange, Colas y Bindings
# ============================================

set -e  # Exit on error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuración
RABBITMQ_HOST="localhost"
RABBITMQ_PORT="15672"
RABBITMQ_USER="guest"
RABBITMQ_PASSWORD="guest"
RABBITMQ_CONTAINER="microservices_rabbitmq"

# Base URL para RabbitMQ Management API
BASE_URL="http://${RABBITMQ_USER}:${RABBITMQ_PASSWORD}@${RABBITMQ_HOST}:${RABBITMQ_PORT}/api"

echo -e "${YELLOW}🐰 Configurando RabbitMQ para arquitectura event-driven...${NC}"
echo ""

# ============================================
# 1. Esperar a que RabbitMQ esté listo
# ============================================
echo -e "${YELLOW}⏳ Esperando a que RabbitMQ esté disponible...${NC}"
MAX_RETRIES=30
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} http://${RABBITMQ_HOST}:${RABBITMQ_PORT}/api/overview > /dev/null 2>&1; then
        echo -e "${GREEN}✅ RabbitMQ está listo${NC}"
        break
    fi
    RETRY_COUNT=$((RETRY_COUNT+1))
    echo -e "${YELLOW}   Intento ${RETRY_COUNT}/${MAX_RETRIES}...${NC}"
    sleep 2
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    echo -e "${RED}❌ Error: RabbitMQ no está disponible después de ${MAX_RETRIES} intentos${NC}"
    exit 1
fi

echo ""

# ============================================
# 2. Crear Exchange tipo Topic
# ============================================
echo -e "${YELLOW}📢 Creando exchange 'microservices.events' (tipo: topic)...${NC}"

curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X PUT \
    -H "content-type:application/json" \
    "${BASE_URL}/exchanges/%2F/microservices.events" \
    -d '{
        "type": "topic",
        "durable": true,
        "auto_delete": false,
        "internal": false,
        "arguments": {}
    }'

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Exchange 'microservices.events' creado${NC}"
else
    echo -e "${RED}❌ Error creando exchange${NC}"
    exit 1
fi

echo ""

# ============================================
# 3. Crear Colas
# ============================================
echo -e "${YELLOW}📦 Creando colas...${NC}"

# Cola para Orders Service
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X PUT \
    -H "content-type:application/json" \
    "${BASE_URL}/queues/%2F/orders_queue" \
    -d '{
        "durable": true,
        "auto_delete": false,
        "arguments": {}
    }'
echo -e "${GREEN}✅ Cola 'orders_queue' creada${NC}"

# Cola para Products Service
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X PUT \
    -H "content-type:application/json" \
    "${BASE_URL}/queues/%2F/products_queue" \
    -d '{
        "durable": true,
        "auto_delete": false,
        "arguments": {}
    }'
echo -e "${GREEN}✅ Cola 'products_queue' creada${NC}"

# Cola para Webhook Publisher Service
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X PUT \
    -H "content-type:application/json" \
    "${BASE_URL}/queues/%2F/webhook_publisher_queue" \
    -d '{
        "durable": true,
        "auto_delete": false,
        "arguments": {}
    }'
echo -e "${GREEN}✅ Cola 'webhook_publisher_queue' creada${NC}"

echo ""

# ============================================
# 4. Crear Bindings
# ============================================
echo -e "${YELLOW}🔗 Creando bindings (exchange → colas)...${NC}"

# Bindings para orders_queue
# Recibe: product.* (ej. product.stockReserved)
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X POST \
    -H "content-type:application/json" \
    "${BASE_URL}/bindings/%2F/e/microservices.events/q/orders_queue" \
    -d '{
        "routing_key": "product.*",
        "arguments": {}
    }'
echo -e "${GREEN}✅ Binding: microservices.events → orders_queue (routing_key: product.*)${NC}"

# Recibe: order.* (ej. order.confirmed, order.cancelled) - futuro
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X POST \
    -H "content-type:application/json" \
    "${BASE_URL}/bindings/%2F/e/microservices.events/q/orders_queue" \
    -d '{
        "routing_key": "order.*",
        "arguments": {}
    }'
echo -e "${GREEN}✅ Binding: microservices.events → orders_queue (routing_key: order.*)${NC}"

# Bindings para products_queue
# Recibe: product.* (para comandos internos si aplica)
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X POST \
    -H "content-type:application/json" \
    "${BASE_URL}/bindings/%2F/e/microservices.events/q/products_queue" \
    -d '{
        "routing_key": "product.*",
        "arguments": {}
    }'
echo -e "${GREEN}✅ Binding: microservices.events → products_queue (routing_key: product.*)${NC}"

# Bindings para webhook_publisher_queue
# Recibe: product.* (ej. product.stockReserved, product.created)
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X POST \
    -H "content-type:application/json" \
    "${BASE_URL}/bindings/%2F/e/microservices.events/q/webhook_publisher_queue" \
    -d '{
        "routing_key": "product.*",
        "arguments": {}
    }'
echo -e "${GREEN}✅ Binding: microservices.events → webhook_publisher_queue (routing_key: product.*)${NC}"

# Recibe: order.* (ej. order.confirmed, order.cancelled)
curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} \
    -X POST \
    -H "content-type:application/json" \
    "${BASE_URL}/bindings/%2F/e/microservices.events/q/webhook_publisher_queue" \
    -d '{
        "routing_key": "order.*",
        "arguments": {}
    }'
echo -e "${GREEN}✅ Binding: microservices.events → webhook_publisher_queue (routing_key: order.*)${NC}"

echo ""

# ============================================
# 5. Verificar configuración
# ============================================
echo -e "${YELLOW}🔍 Verificando configuración...${NC}"
echo ""

# Verificar exchange
EXCHANGE_EXISTS=$(curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} "${BASE_URL}/exchanges/%2F/microservices.events" | grep -c "microservices.events" || true)
if [ $EXCHANGE_EXISTS -gt 0 ]; then
    echo -e "${GREEN}✅ Exchange 'microservices.events' existe${NC}"
else
    echo -e "${RED}❌ Exchange no encontrado${NC}"
fi

# Verificar colas
for queue in "orders_queue" "products_queue" "webhook_publisher_queue"; do
    QUEUE_EXISTS=$(curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} "${BASE_URL}/queues/%2F/${queue}" | grep -c "\"name\":\"${queue}\"" || true)
    if [ $QUEUE_EXISTS -gt 0 ]; then
        echo -e "${GREEN}✅ Cola '${queue}' existe${NC}"
    else
        echo -e "${RED}❌ Cola '${queue}' no encontrada${NC}"
    fi
done

# Verificar bindings
BINDINGS_COUNT=$(curl -s -u ${RABBITMQ_USER}:${RABBITMQ_PASSWORD} "${BASE_URL}/exchanges/%2F/microservices.events/bindings/source" | grep -c "routing_key" || true)
echo -e "${GREEN}✅ Total de bindings creados: ${BINDINGS_COUNT}${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}✅ Configuración de RabbitMQ completada${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}📊 Acceder a RabbitMQ Management:${NC}"
echo -e "   URL: http://localhost:15672"
echo -e "   Usuario: guest"
echo -e "   Contraseña: guest"
echo ""
echo -e "${YELLOW}🔍 Verificar en UI:${NC}"
echo -e "   1. Exchanges → 'microservices.events' (tipo: topic)"
echo -e "   2. Queues → 3 colas creadas"
echo -e "   3. Exchange 'microservices.events' → Bindings → Ver 5 bindings"
echo ""
