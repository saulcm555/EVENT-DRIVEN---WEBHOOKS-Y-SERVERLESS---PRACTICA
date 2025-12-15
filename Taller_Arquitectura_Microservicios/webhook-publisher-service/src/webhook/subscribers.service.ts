import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  SupabaseSubscriber,
  NormalizedSubscriber,
  SubscribersCacheConfig,
} from './dto/subscriber.dto';

/**
 * Servicio para gestionar suscriptores de webhooks
 * - Lee suscriptores desde Supabase
 * - Implementa caché en memoria (30-60s)
 * - Fallback a lista de emergencia desde env vars
 * - Filtrado por patrones de eventos (wildcards)
 */
@Injectable()
export class SubscribersService implements OnModuleInit {
  private readonly logger = new Logger(SubscribersService.name);

  // Configuración de Supabase
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly tableName = 'webhook_subscribers';

  // Configuración de caché
  private readonly cacheTtlMs: number;
  private cache: SubscribersCacheConfig = {
    ttlMs: 0,
    lastUpdated: 0,
    subscribers: [],
  };

  // Fallback de emergencia desde env vars
  private readonly fallbackSubscribers: NormalizedSubscriber[];

  constructor(private readonly configService: ConfigService) {
    // Configurar Supabase
    this.supabaseUrl = this.configService.get<string>('SUPABASE_URL') || '';
    this.supabaseAnonKey = this.configService.get<string>('SUPABASE_ANON_KEY') || '';

    // TTL del caché (default 45 segundos)
    this.cacheTtlMs = parseInt(
      this.configService.get<string>('SUBSCRIBERS_CACHE_TTL_MS') || '45000',
      10,
    );
    this.cache.ttlMs = this.cacheTtlMs;

    // Configurar fallback desde env vars
    const webhookSecret = this.configService.get<string>('WEBHOOK_SECRET') || 'dev_secret_key_123456';
    const webhookLoggerUrl = this.configService.get<string>('WEBHOOK_LOGGER_URL') || '';
    const telegramNotifierUrl = this.configService.get<string>('TELEGRAM_NOTIFIER_URL') || '';

    this.fallbackSubscribers = [];

    if (webhookLoggerUrl) {
      this.fallbackSubscribers.push({
        id: 'fallback-logger',
        name: 'webhook-logger',
        url: webhookLoggerUrl,
        secretKey: webhookSecret,
        eventPatterns: ['*'], // Todos los eventos
        isActive: true,
      });
    }

    if (telegramNotifierUrl) {
      this.fallbackSubscribers.push({
        id: 'fallback-telegram',
        name: 'telegram-notifier',
        url: telegramNotifierUrl,
        secretKey: webhookSecret,
        eventPatterns: ['*'], // Todos los eventos
        isActive: true,
      });
    }

    this.logger.log(`📋 SubscribersService initialized`);
    this.logger.log(`   Supabase URL: ${this.supabaseUrl ? 'Configured' : 'NOT CONFIGURED'}`);
    this.logger.log(`   Cache TTL: ${this.cacheTtlMs}ms`);
    this.logger.log(`   Fallback subscribers: ${this.fallbackSubscribers.length}`);
  }

  /**
   * Inicialización del módulo: cargar suscriptores
   */
  async onModuleInit(): Promise<void> {
    this.logger.log('🚀 Loading initial subscribers from Supabase...');
    await this.refreshCache();
  }

  /**
   * Verifica si el caché es válido (no expirado)
   */
  private isCacheValid(): boolean {
    if (this.cache.subscribers.length === 0) return false;
    const now = Date.now();
    const age = now - this.cache.lastUpdated;
    return age < this.cache.ttlMs;
  }

  /**
   * Consulta suscriptores activos desde Supabase
   */
  private async fetchFromSupabase(): Promise<SupabaseSubscriber[]> {
    if (!this.supabaseUrl || !this.supabaseAnonKey) {
      this.logger.warn('⚠️ Supabase not configured, skipping fetch');
      return [];
    }

    const url = `${this.supabaseUrl}/rest/v1/${this.tableName}?is_active=eq.true&select=*`;

    try {
      this.logger.debug(`🔍 Fetching subscribers from: ${url}`);

      const response = await axios.get<SupabaseSubscriber[]>(url, {
        headers: {
          apikey: this.supabaseAnonKey,
          Authorization: `Bearer ${this.supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000, // 5 segundos timeout
      });

      this.logger.log(`✅ Fetched ${response.data.length} subscribers from Supabase`);
      return response.data;
    } catch (error) {
      this.logger.error(`❌ Failed to fetch from Supabase: ${error.message}`);
      throw error;
    }
  }

  /**
   * Normaliza event_patterns de Supabase a array
   * Soporta: array, string CSV, string JSON
   */
  private normalizeEventPatterns(patterns: string[] | string): string[] {
    if (Array.isArray(patterns)) {
      return patterns;
    }

    if (typeof patterns === 'string') {
      // Intentar parsear como JSON
      if (patterns.startsWith('[')) {
        try {
          return JSON.parse(patterns);
        } catch {
          // Continuar con CSV
        }
      }
      // Parsear como CSV
      return patterns.split(',').map((p) => p.trim()).filter(Boolean);
    }

    return ['*']; // Default: todos los eventos
  }

  /**
   * Convierte SupabaseSubscriber a NormalizedSubscriber
   */
  private normalizeSubscriber(sub: SupabaseSubscriber): NormalizedSubscriber {
    const webhookSecret = this.configService.get<string>('WEBHOOK_SECRET') || 'dev_secret_key_123456';

    return {
      id: sub.id,
      name: sub.name,
      url: sub.target_url,
      secretKey: sub.secret_key || webhookSecret,
      eventPatterns: this.normalizeEventPatterns(sub.event_patterns),
      isActive: sub.is_active,
    };
  }

  /**
   * Refresca el caché con datos de Supabase
   */
  async refreshCache(): Promise<void> {
    try {
      const supabaseSubscribers = await this.fetchFromSupabase();

      if (supabaseSubscribers.length > 0) {
        this.cache.subscribers = supabaseSubscribers.map((s) =>
          this.normalizeSubscriber(s),
        );
        this.cache.lastUpdated = Date.now();
        this.logger.log(
          `🔄 Cache refreshed with ${this.cache.subscribers.length} subscribers`,
        );
      } else {
        // Sin datos de Supabase, usar fallback
        this.logger.warn('⚠️ No subscribers from Supabase, using fallback');
        this.cache.subscribers = this.fallbackSubscribers;
        this.cache.lastUpdated = Date.now();
      }
    } catch (error) {
      this.logger.error(`❌ Cache refresh failed: ${error.message}`);

      // Si el caché está vacío, usar fallback
      if (this.cache.subscribers.length === 0) {
        this.logger.warn('⚠️ Using fallback subscribers due to Supabase error');
        this.cache.subscribers = this.fallbackSubscribers;
        this.cache.lastUpdated = Date.now();
      }
      // Si hay caché existente, mantenerlo aunque haya expirado
    }
  }

  /**
   * Verifica si un evento coincide con un patrón
   * Patrones soportados:
   * - "*" -> todos los eventos
   * - "product.*" -> eventos que empiezan con "product."
   * - "product.stockReserved" -> evento exacto
   */
  private eventMatchesPattern(eventName: string, pattern: string): boolean {
    // Wildcard total
    if (pattern === '*') return true;

    // Wildcard parcial: "product.*"
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -1); // "product."
      return eventName.startsWith(prefix);
    }

    // Match exacto
    return eventName === pattern;
  }

  /**
   * Obtiene suscriptores activos que coinciden con un evento
   */
  async getSubscribersForEvent(eventName: string): Promise<NormalizedSubscriber[]> {
    // Refrescar caché si es necesario
    if (!this.isCacheValid()) {
      this.logger.debug('🔄 Cache expired, refreshing...');
      await this.refreshCache();
    }

    // Filtrar por patrones de eventos
    const matchingSubscribers = this.cache.subscribers.filter((sub) => {
      if (!sub.isActive) return false;

      return sub.eventPatterns.some((pattern) =>
        this.eventMatchesPattern(eventName, pattern),
      );
    });

    this.logger.debug(
      `🎯 Found ${matchingSubscribers.length} subscribers for event: ${eventName}`,
    );

    return matchingSubscribers;
  }

  /**
   * Obtiene todos los suscriptores activos (sin filtrar por evento)
   */
  async getAllActiveSubscribers(): Promise<NormalizedSubscriber[]> {
    if (!this.isCacheValid()) {
      await this.refreshCache();
    }
    return this.cache.subscribers.filter((s) => s.isActive);
  }

  /**
   * Fuerza refresco del caché (útil para testing o admin)
   */
  async forceRefresh(): Promise<NormalizedSubscriber[]> {
    await this.refreshCache();
    return this.cache.subscribers;
  }

  /**
   * Obtiene un suscriptor por nombre
   */
  async getSubscriberByName(name: string): Promise<NormalizedSubscriber | undefined> {
    if (!this.isCacheValid()) {
      await this.refreshCache();
    }
    return this.cache.subscribers.find((s) => s.name === name);
  }

  /**
   * Obtiene estadísticas del caché (para health checks)
   */
  getCacheStats(): {
    subscriberCount: number;
    lastUpdated: Date | null;
    ageMs: number;
    isValid: boolean;
    usingFallback: boolean;
  } {
    const now = Date.now();
    return {
      subscriberCount: this.cache.subscribers.length,
      lastUpdated: this.cache.lastUpdated
        ? new Date(this.cache.lastUpdated)
        : null,
      ageMs: this.cache.lastUpdated ? now - this.cache.lastUpdated : 0,
      isValid: this.isCacheValid(),
      usingFallback:
        this.cache.subscribers.length > 0 &&
        this.cache.subscribers[0].id.startsWith('fallback-'),
    };
  }
}
