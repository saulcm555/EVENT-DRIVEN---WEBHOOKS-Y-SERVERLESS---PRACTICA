import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('WebhookPublisher');

  // Crear aplicación híbrida (HTTP + Microservicio)
  const app = await NestFactory.create(AppModule);

  // Configurar microservicio RabbitMQ
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672'],
      queue: 'webhook_publisher_queue',
      queueOptions: {
        durable: true,
      },
      noAck: false, // Requiere ACK manual para control
    },
  });

  // Iniciar microservicios
  await app.startAllMicroservices();
  
  // Iniciar servidor HTTP (para health checks)
  const port = process.env.PORT || 3003;
  await app.listen(port);

  logger.log(`🚀 Webhook Publisher Service running on port ${port}`);
  logger.log(`📡 Connected to RabbitMQ`);
  logger.log(`📬 Listening for events: product.stockReserved, order.confirmed, order.cancelled`);
}

bootstrap();
