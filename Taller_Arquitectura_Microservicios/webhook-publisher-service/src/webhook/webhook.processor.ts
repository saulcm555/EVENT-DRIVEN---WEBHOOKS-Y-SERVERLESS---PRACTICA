import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhookService } from './webhook.service';
import { WebhookJob } from './dto/webhook.dto';

/**
 * Procesador de la cola de webhooks
 * Maneja el envío real de webhooks con reintentos automáticos
 */
@Processor('webhook-delivery', {
  concurrency: 5, // Máximo 5 webhooks en paralelo
  limiter: {
    max: 5, // Máximo 5 jobs
    duration: 1000, // Por segundo (rate limiting)
  },
})
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly webhookService: WebhookService) {
    super();
  }

  /**
   * Procesa cada job de la cola
   */
  async process(job: Job<WebhookJob>): Promise<any> {
    const { url, payload, subscriberName } = job.data;
    const attempt = job.attemptsMade + 1;

    this.logger.log(
      `🚀 Processing webhook job | Subscriber: ${subscriberName} | Attempt: ${attempt}/${job.opts.attempts}`,
    );

    const result = await this.webhookService.deliverWebhook(job.data);

    if (!result.success) {
      // Si falla, lanzar error para que BullMQ reintente
      throw new Error(
        `Webhook delivery failed: ${result.error} | Status: ${result.statusCode}`,
      );
    }

    // Log de éxito
    this.logger.log(
      `✅ Webhook delivered | Subscriber: ${subscriberName} | Event: ${payload.event} | Duration: ${result.duration}ms`,
    );

    return result;
  }

  /**
   * Evento: Job completado exitosamente
   */
  @OnWorkerEvent('completed')
  onCompleted(job: Job<WebhookJob>) {
    this.logger.log(
      `✅ Job completed | ID: ${job.id} | Subscriber: ${job.data.subscriberName}`,
    );
  }

  /**
   * Evento: Job falló (agotó reintentos)
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<WebhookJob>, error: Error) {
    this.logger.error(
      `❌ Job failed permanently | ID: ${job.id} | Subscriber: ${job.data.subscriberName} | Attempts: ${job.attemptsMade} | Error: ${error.message}`,
    );

    // Aquí podrías:
    // 1. Guardar en tabla webhook_deliveries con status='failed'
    // 2. Enviar alerta al equipo
    // 3. Mover a Dead Letter Queue
  }

  /**
   * Evento: Job va a ser reintentado
   */
  @OnWorkerEvent('error')
  onError(error: Error) {
    this.logger.error(`⚠️ Worker error: ${error.message}`);
  }

  /**
   * Evento: Worker activo
   */
  @OnWorkerEvent('active')
  onActive(job: Job<WebhookJob>) {
    this.logger.debug(
      `▶️ Job active | ID: ${job.id} | Subscriber: ${job.data.subscriberName}`,
    );
  }

  /**
   * Evento: Job reintentando
   */
  @OnWorkerEvent('stalled')
  onStalled(jobId: string) {
    this.logger.warn(`⚠️ Job stalled | ID: ${jobId}`);
  }
}
