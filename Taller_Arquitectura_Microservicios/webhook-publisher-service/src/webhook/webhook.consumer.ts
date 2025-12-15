import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';
import { WebhookService } from './webhook.service';
import type {
  StockReservedEvent,
  OrderConfirmedEvent,
  OrderCancelledEvent,
} from './dto/webhook.dto';

/**
 * Consumidor de eventos de RabbitMQ
 * Escucha eventos de negocio y los procesa para enviar webhooks
 */
@Controller()
export class WebhookConsumer {
  private readonly logger = new Logger(WebhookConsumer.name);

  constructor(private readonly webhookService: WebhookService) {}

  /**
   * Listener para evento: product.stockReserved
   * Emitido por Products Service cuando se reserva stock
   */
  @EventPattern('product.stockReserved')
  async handleProductStockReserved(
    @Payload() data: StockReservedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`📦 Received event: product.stockReserved`);
    this.logger.debug(`Data: ${JSON.stringify(data)}`);

    try {
      await this.webhookService.processEvent('product.stockReserved', data);
      
      // Acknowledge message
      channel.ack(originalMsg);
      this.logger.log(`✅ Event processed: product.stockReserved`);
    } catch (error) {
      this.logger.error(
        `❌ Error processing product.stockReserved: ${error.message}`,
      );
      // Reject message and requeue
      channel.nack(originalMsg, false, true);
    }
  }

  /**
   * Listener para evento: order.confirmed
   * Emitido por Orders Service cuando una orden es confirmada
   */
  @EventPattern('order.confirmed')
  async handleOrderConfirmed(
    @Payload() data: OrderConfirmedEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`🛒 Received event: order.confirmed`);
    this.logger.debug(`Data: ${JSON.stringify(data)}`);

    try {
      await this.webhookService.processEvent('order.confirmed', data);
      
      channel.ack(originalMsg);
      this.logger.log(`✅ Event processed: order.confirmed`);
    } catch (error) {
      this.logger.error(`❌ Error processing order.confirmed: ${error.message}`);
      channel.nack(originalMsg, false, true);
    }
  }

  /**
   * Listener para evento: order.cancelled
   * Emitido por Orders Service cuando una orden es cancelada
   */
  @EventPattern('order.cancelled')
  async handleOrderCancelled(
    @Payload() data: OrderCancelledEvent,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`❌ Received event: order.cancelled`);
    this.logger.debug(`Data: ${JSON.stringify(data)}`);

    try {
      await this.webhookService.processEvent('order.cancelled', data);
      
      channel.ack(originalMsg);
      this.logger.log(`✅ Event processed: order.cancelled`);
    } catch (error) {
      this.logger.error(
        `❌ Error processing order.cancelled: ${error.message}`,
      );
      channel.nack(originalMsg, false, true);
    }
  }

  /**
   * Listener para evento: product.stockReleased (futuro)
   * Emitido por Products Service cuando se libera stock
   */
  @EventPattern('product.stockReleased')
  async handleProductStockReleased(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();

    this.logger.log(`📦 Received event: product.stockReleased`);

    try {
      await this.webhookService.processEvent('product.stockReleased', data);
      channel.ack(originalMsg);
    } catch (error) {
      this.logger.error(
        `❌ Error processing product.stockReleased: ${error.message}`,
      );
      channel.nack(originalMsg, false, true);
    }
  }
}
