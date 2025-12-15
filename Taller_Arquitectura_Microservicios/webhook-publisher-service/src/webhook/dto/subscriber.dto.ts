/**
 * DTOs para Webhook Subscribers
 * Representa la estructura de la tabla webhook_subscribers en Supabase
 */

/**
 * Suscriptor como viene de Supabase
 * Mapea directamente a la tabla webhook_subscribers
 */
export interface SupabaseSubscriber {
  id: string;
  name: string;
  target_url: string;
  /** 
   * Patrones de eventos (puede ser array o string JSON)
   * Ejemplo: ["product.*", "order.confirmed"] 
   * O: "product.stockReserved,order.confirmed"
   */
  event_patterns: string[] | string;
  is_active: boolean;
  secret_key?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Suscriptor normalizado para uso interno
 */
export interface NormalizedSubscriber {
  id: string;
  name: string;
  url: string;
  secretKey: string;
  /** Patrones de eventos normalizados como array */
  eventPatterns: string[];
  isActive: boolean;
}

/**
 * Respuesta de Supabase al consultar suscriptores
 */
export interface SupabaseSubscribersResponse {
  data: SupabaseSubscriber[] | null;
  error: {
    message: string;
    code?: string;
  } | null;
}

/**
 * Configuración de caché para suscriptores
 */
export interface SubscribersCacheConfig {
  /** Tiempo de vida del caché en milisegundos */
  ttlMs: number;
  /** Timestamp de última actualización */
  lastUpdated: number;
  /** Lista de suscriptores cacheados */
  subscribers: NormalizedSubscriber[];
}

/**
 * Resultado de matching de evento con patrón
 */
export interface EventMatchResult {
  subscriber: NormalizedSubscriber;
  matchedPattern: string;
}

/**
 * Ejemplo de respuesta de Supabase:
 * 
 * ```json
 * {
 *   "data": [
 *     {
 *       "id": "uuid-1",
 *       "name": "webhook-logger",
 *       "target_url": "https://xxx.supabase.co/functions/v1/webhook-logger",
 *       "event_patterns": ["product.*", "order.*"],
 *       "is_active": true,
 *       "secret_key": "shared_secret_123",
 *       "created_at": "2025-12-15T00:00:00Z"
 *     },
 *     {
 *       "id": "uuid-2", 
 *       "name": "telegram-notifier",
 *       "target_url": "https://xxx.supabase.co/functions/v1/telegram-notifier",
 *       "event_patterns": ["order.confirmed", "order.cancelled"],
 *       "is_active": true,
 *       "secret_key": "shared_secret_123"
 *     }
 *   ],
 *   "error": null
 * }
 * ```
 * 
 * Patrones de eventos soportados:
 * - Exacto: "product.stockReserved" -> solo ese evento
 * - Wildcard: "product.*" -> cualquier evento que empiece con "product."
 * - Todo: "*" -> todos los eventos
 */
