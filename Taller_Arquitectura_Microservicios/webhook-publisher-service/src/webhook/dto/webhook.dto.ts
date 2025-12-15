/**
 * Payload estandarizado para webhooks
 * Este es el formato que se envía a las Edge Functions
 */
export interface WebhookPayload {
  /** Nombre del evento (e.g., product.stockReserved) */
  event: string;
  
  /** Clave única para idempotencia */
  idempotency_key: string;
  
  /** Timestamp ISO 8601 */
  timestamp: string;
  
  /** Datos específicos del evento */
  data: Record<string, any>;
  
  /** Metadata adicional */
  metadata?: {
    source: string;
    version?: string;
    correlationId?: string;
  };
}

/**
 * Evento de stock reservado desde Products Service
 */
export interface StockReservedEvent {
  productId: string;
  quantity: number;
  orderId: string;
  approved: boolean;
  remainingStock?: number;
  idempotencyKey: string;
  timestamp?: string;
}

/**
 * Evento de orden confirmada desde Orders Service
 */
export interface OrderConfirmedEvent {
  orderId: string;
  productId: string;
  quantity: number;
  status: string;
  idempotencyKey: string;
  timestamp?: string;
}

/**
 * Evento de orden cancelada desde Orders Service
 */
export interface OrderCancelledEvent {
  orderId: string;
  reason: string;
  idempotencyKey: string;
  timestamp?: string;
}

/**
 * Job para la cola de BullMQ
 */
export interface WebhookJob {
  /** URL destino del webhook */
  url: string;
  
  /** Payload a enviar */
  payload: WebhookPayload;
  
  /** Nombre del suscriptor (para logs) */
  subscriberName: string;
  
  /** Intento actual */
  attempt?: number;
}

/**
 * Resultado de envío de webhook
 */
export interface WebhookDeliveryResult {
  success: boolean;
  statusCode?: number;
  response?: any;
  error?: string;
  duration?: number;
}

/**
 * Configuración de un suscriptor de webhooks
 */
export interface WebhookSubscriber {
  name: string;
  url: string;
  secretKey: string;
  events: string[];
  isActive: boolean;
}
