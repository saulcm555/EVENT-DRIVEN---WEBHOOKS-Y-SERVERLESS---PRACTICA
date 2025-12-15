import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { WebhookModule } from './webhook/webhook.module';
import { HealthController } from './health/health.controller';
import { SubscribersService } from './webhook/subscribers.service';

@Module({
  imports: [
    // Configuración de variables de entorno
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // BullMQ para colas y reintentos
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
      },
    }),

    // Módulo de Webhooks
    WebhookModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
