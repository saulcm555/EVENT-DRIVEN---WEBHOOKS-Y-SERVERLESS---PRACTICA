import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { WebhookService } from './webhook.service';
import { WebhookConsumer } from './webhook.consumer';
import { WebhookProcessor } from './webhook.processor';
import { IdempotencyService } from './idempotency.service';
import { SubscribersService } from './subscribers.service';

@Module({
  imports: [
    // Cola de webhooks para reintentos
    BullModule.registerQueue({
      name: 'webhook-delivery',
      defaultJobOptions: {
        attempts: 5, // Máximo 5 reintentos
        backoff: {
          type: 'exponential',
          delay: 1000, // Empezar con 1 segundo
        },
        removeOnComplete: 100, // Mantener últimos 100 completados
        removeOnFail: 500, // Mantener últimos 500 fallidos
      },
    }),
  ],
  controllers: [WebhookConsumer],
  providers: [
    SubscribersService,
    WebhookService,
    WebhookProcessor,
    IdempotencyService,
  ],
  exports: [WebhookService, SubscribersService],
})
export class WebhookModule {}
