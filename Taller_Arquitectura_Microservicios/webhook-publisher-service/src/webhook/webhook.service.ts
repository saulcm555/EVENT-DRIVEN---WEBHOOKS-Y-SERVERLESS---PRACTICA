import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import {
  WebhookPayload,
  WebhookJob,
  WebhookDeliveryResult,
} from './dto/webhook.dto';
import { NormalizedSubscriber } from './dto/subscriber.dto';
import { IdempotencyService } from './idempotency.service';
import { SubscribersService } from './subscribers.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly webhookSecret: string;

  constructor(
    @InjectQueue('webhook-delivery') private webhookQueue: Queue,
    private configService: ConfigService,
    private idempotencyService: IdempotencyService,
    private subscribersService: SubscribersService,
  ) {
    this.webhookSecret =
      this.configService.get<string>('WEBHOOK_SECRET') || 'dev_secret_key_123456';

    this.logger.log('🔌 WebhookService initialized with dynamic subscribers from Supabase');
  }

  /**
   * Genera firma HMAC-SHA256 para el payload
   */
  generateHMAC(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Obtiene el timestamp Unix actual
   */
  getUnixTimestamp(): number {
    return Math.floor(Date.now() / 1000);
  }

  /**
   * Transforma un evento interno a payload estandarizado
   */
  transformPayload(eventName: string, data: any): WebhookPayload {
    // Extraer idempotencyKey del evento (puede venir como idempotencyKey o idempotency_key)
    const idempotencyKey = data.idempotencyKey || data.idempotency_key || crypto.randomUUID();

    return {
      event: eventName,
      idempotency_key: idempotencyKey,
      timestamp: new Date().toISOString(),
      data: {
        ...data,
        // Remover campos duplicados
        idempotencyKey: undefined,
        idempotency_key: undefined,
      },
      metadata: {
        source: 'webhook-publisher-service',
        version: '1.0',
        correlationId: idempotencyKey,
      },
    };
  }

  /**
   * Obtiene suscriptores activos para un evento específico
   * Ahora usa SubscribersService que lee desde Supabase con caché
   */
  async getActiveSubscribers(eventName: string): Promise<NormalizedSubscriber[]> {
    return this.subscribersService.getSubscribersForEvent(eventName);
  }

  /**
   * Envía webhook HTTP con firma HMAC
   */
  async sendWebhook(
    url: string,
    payload: WebhookPayload,
    secret: string,
  ): Promise<WebhookDeliveryResult> {
    const startTime = Date.now();
    const payloadString = JSON.stringify(payload);
    const signature = this.generateHMAC(payloadString, secret);
    const timestamp = this.getUnixTimestamp();

    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': timestamp.toString(),
        },
        timeout: 10000, // 10 segundos timeout
      });

      const duration = Date.now() - startTime;

      this.logger.log(
        `✅ Webhook sent successfully to ${url} | Status: ${response.status} | Duration: ${duration}ms`,
      );

      return {
        success: true,
        statusCode: response.status,
        response: response.data,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const axiosError = error as AxiosError;

      this.logger.error(
        `❌ Webhook failed to ${url} | Status: ${axiosError.response?.status || 'N/A'} | Error: ${axiosError.message}`,
      );

      return {
        success: false,
        statusCode: axiosError.response?.status,
        error: axiosError.message,
        duration,
      };
    }
  }

  /**
   * Procesa un evento y encola webhooks para todos los suscriptores
   */
  async processEvent(eventName: string, eventData: any): Promise<void> {
    const payload = this.transformPayload(eventName, eventData);
    const idempotencyKey = payload.idempotency_key;

    this.logger.log(`📬 Processing event: ${eventName} | Key: ${idempotencyKey}`);

    // Verificar idempotencia
    const alreadyProcessed = await this.idempotencyService.isProcessed(
      eventName,
      idempotencyKey,
    );

    if (alreadyProcessed) {
      this.logger.warn(
        `⚠️ Event already processed (idempotent): ${eventName} | Key: ${idempotencyKey}`,
      );
      return;
    }

    // Marcar como procesado
    await this.idempotencyService.markAsProcessed(eventName, idempotencyKey);

    // Obtener suscriptores activos desde Supabase (con caché)
    const subscribers = await this.getActiveSubscribers(eventName);

    if (subscribers.length === 0) {
      this.logger.warn(`⚠️ No active subscribers for event: ${eventName}`);
      return;
    }

    this.logger.log(
      `📤 Sending webhooks to ${subscribers.length} subscribers for event: ${eventName}`,
    );

    // Encolar webhooks para cada suscriptor
    for (const subscriber of subscribers) {
      const job: WebhookJob = {
        url: subscriber.url,
        payload,
        subscriberName: subscriber.name,
      };

      await this.webhookQueue.add(`webhook-${subscriber.name}`, job, {
        jobId: `${idempotencyKey}-${subscriber.name}`, // ID único para idempotencia en cola
      });

      this.logger.log(
        `📥 Queued webhook for ${subscriber.name} | Event: ${eventName}`,
      );
    }
  }

  /**
   * Envío directo de webhook (usado por el processor)
   */
  async deliverWebhook(job: WebhookJob): Promise<WebhookDeliveryResult> {
    // Buscar suscriptor para obtener su secretKey
    const subscriber = await this.subscribersService.getSubscriberByName(
      job.subscriberName,
    );
    const secret = subscriber?.secretKey || this.webhookSecret;

    return this.sendWebhook(job.url, job.payload, secret);
  }

  /**
   * Fuerza refresco de suscriptores desde Supabase
   */
  async refreshSubscribers(): Promise<NormalizedSubscriber[]> {
    return this.subscribersService.forceRefresh();
  }

  /**
   * Obtiene estadísticas de los suscriptores (para health checks)
   */
  getSubscribersStats() {
    return this.subscribersService.getCacheStats();
  }
}
