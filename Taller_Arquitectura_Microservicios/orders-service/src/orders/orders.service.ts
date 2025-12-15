import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';
import { RedisService } from '../redis/redis.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    @Inject('PRODUCTS_SERVICE') private productsClient: ClientProxy,
    private redisService: RedisService,
  ) {}

  async createOrder(dto: { productId: string; quantity: number }) {
    const idempotencyKey = uuidv4();

    this.logger.log(`Creating order for product ${dto.productId} with key ${idempotencyKey}`);

    const order = this.orderRepository.create({
      productId: dto.productId,
      quantity: dto.quantity,
      status: 'PENDING',
      idempotencyKey,
    });

    await this.orderRepository.save(order);

    this.productsClient.emit('product.reserveStock', {
      productId: dto.productId,
      quantity: dto.quantity,
      idempotencyKey,
    });

    return order;
  }

  async handleStockReserved(data: {
    approved: boolean;
    productId: string;
    quantity: number;
    idempotencyKey: string;
    reason?: string;
  }) {
    const cacheKey = `processed:${data.idempotencyKey}`;
    const lockKey = `lock:${data.idempotencyKey}`;

    // Verificar si el mensaje ya fue procesado
    const alreadyProcessed = await this.redisService.exists(cacheKey);
    if (alreadyProcessed) {
      this.logger.warn(`Duplicate message detected for key ${data.idempotencyKey}, ignoring`);
      return { status: 'duplicate', message: 'Message already processed' };
    }

    // Intentar adquirir lock distribuido (expira en 10 segundos)
    const lockAcquired = await this.redisService.setNX(lockKey, '1', 10);
    if (!lockAcquired) {
      this.logger.warn(`Lock already held for key ${data.idempotencyKey}, another instance processing`);
      return { status: 'locked', message: 'Another instance is processing this message' };
    }

    try {
      // Buscar la orden
      const order = await this.orderRepository.findOne({
        where: { idempotencyKey: data.idempotencyKey },
      });

      if (!order) {
        this.logger.warn(`Order not found for idempotency key ${data.idempotencyKey}`);
        return { status: 'not_found', message: 'Order not found' };
      }

      // Actualizar estado
      if (data.approved) {
        order.status = 'CONFIRMED';
        this.logger.log(`Order ${order.id} CONFIRMED`);
      } else {
        order.status = 'REJECTED';
        this.logger.log(`Order ${order.id} REJECTED - Reason: ${data.reason}`);
      }

      await this.orderRepository.save(order);

      // Marcar mensaje como procesado (TTL 24 horas)
      await this.redisService.set(cacheKey, 'true', 86400);

      return { status: 'processed', order };
    } catch (error) {
      this.logger.error(`Error processing stock reserved message: ${error.message}`, error.stack);
      throw error;
    } finally {
      // Liberar lock
      await this.redisService.del(lockKey);
    }
  }
}
