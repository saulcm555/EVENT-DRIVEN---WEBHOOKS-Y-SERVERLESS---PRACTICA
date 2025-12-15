import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Servicio de idempotencia usando Redis
 * Garantiza que un evento con el mismo idempotency_key no se procese dos veces
 */
@Injectable()
export class IdempotencyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IdempotencyService.name);
  private redis: Redis;
  
  // TTL de 7 días para las claves de idempotencia (en segundos)
  private readonly TTL_SECONDS = 7 * 24 * 60 * 60; // 604800 segundos
  
  // Prefijo para las claves en Redis
  private readonly PREFIX = 'webhook:idempotency:';

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('REDIS_HOST') || 'localhost';
    const port = parseInt(this.configService.get<string>('REDIS_PORT') || '6379');

    this.redis = new Redis({
      host,
      port,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.redis.on('connect', () => {
      this.logger.log(`✅ Connected to Redis at ${host}:${port}`);
    });

    this.redis.on('error', (error) => {
      this.logger.error(`❌ Redis error: ${error.message}`);
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    }
  }

  /**
   * Genera la clave de Redis para un evento
   */
  private getKey(eventName: string, idempotencyKey: string): string {
    return `${this.PREFIX}${eventName}:${idempotencyKey}`;
  }

  /**
   * Verifica si un evento ya fue procesado
   */
  async isProcessed(eventName: string, idempotencyKey: string): Promise<boolean> {
    try {
      const key = this.getKey(eventName, idempotencyKey);
      const exists = await this.redis.exists(key);
      return exists === 1;
    } catch (error) {
      this.logger.error(`Error checking idempotency: ${error.message}`);
      // En caso de error de Redis, permitir el procesamiento
      // (fail-open para no bloquear el sistema)
      return false;
    }
  }

  /**
   * Marca un evento como procesado
   */
  async markAsProcessed(eventName: string, idempotencyKey: string): Promise<void> {
    try {
      const key = this.getKey(eventName, idempotencyKey);
      const value = JSON.stringify({
        processedAt: new Date().toISOString(),
        eventName,
        idempotencyKey,
      });

      // SET con TTL de 7 días
      await this.redis.setex(key, this.TTL_SECONDS, value);

      this.logger.debug(`✅ Marked as processed: ${eventName} | Key: ${idempotencyKey}`);
    } catch (error) {
      this.logger.error(`Error marking as processed: ${error.message}`);
      // No lanzar error para no bloquear el procesamiento
    }
  }

  /**
   * Intenta procesar un evento de forma atómica (SET NX)
   * Retorna true si es la primera vez, false si ya existe
   */
  async tryProcess(eventName: string, idempotencyKey: string): Promise<boolean> {
    try {
      const key = this.getKey(eventName, idempotencyKey);
      const value = JSON.stringify({
        processedAt: new Date().toISOString(),
        eventName,
        idempotencyKey,
      });

      // SETNX (SET if Not eXists) + EX (TTL)
      const result = await this.redis.set(key, value, 'EX', this.TTL_SECONDS, 'NX');

      if (result === 'OK') {
        this.logger.debug(`✅ First processing: ${eventName} | Key: ${idempotencyKey}`);
        return true;
      } else {
        this.logger.warn(`⚠️ Already processed: ${eventName} | Key: ${idempotencyKey}`);
        return false;
      }
    } catch (error) {
      this.logger.error(`Error in tryProcess: ${error.message}`);
      // Fail-open: permitir procesamiento en caso de error de Redis
      return true;
    }
  }

  /**
   * Elimina una clave de idempotencia (para testing o rollback)
   */
  async remove(eventName: string, idempotencyKey: string): Promise<void> {
    try {
      const key = this.getKey(eventName, idempotencyKey);
      await this.redis.del(key);
      this.logger.debug(`🗑️ Removed: ${eventName} | Key: ${idempotencyKey}`);
    } catch (error) {
      this.logger.error(`Error removing idempotency key: ${error.message}`);
    }
  }

  /**
   * Obtiene estadísticas de claves de idempotencia
   */
  async getStats(): Promise<{ totalKeys: number }> {
    try {
      const keys = await this.redis.keys(`${this.PREFIX}*`);
      return { totalKeys: keys.length };
    } catch (error) {
      this.logger.error(`Error getting stats: ${error.message}`);
      return { totalKeys: 0 };
    }
  }
}
