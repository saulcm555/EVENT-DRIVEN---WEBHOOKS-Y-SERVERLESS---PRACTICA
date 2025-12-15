import { Injectable, Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    @InjectRepository(Product)
    private productRepository: Repository<Product>,
    @Inject('ORDERS_SERVICE') private ordersClient: ClientProxy,
  ) {}

  async reserveStock(productId: string, quantity: number, idempotencyKey: string) {
    this.logger.log(`Reserve stock request for product ${productId}, quantity: ${quantity}, key: ${idempotencyKey}`);

    const product = await this.productRepository.findOne({ where: { id: productId } });

    let result;

    if (!product) {
      this.logger.warn(`Product ${productId} not found`);
      result = {
        approved: false,
        reason: 'PRODUCT_NOT_FOUND',
        idempotencyKey,
      };
    } else if (product.stock < quantity) {
      this.logger.warn(`Insufficient stock for product ${productId}. Available: ${product.stock}, Requested: ${quantity}`);
      result = {
        approved: false,
        reason: 'OUT_OF_STOCK',
        idempotencyKey,
      };
    } else {
      product.stock -= quantity;
      await this.productRepository.save(product);
      this.logger.log(`Stock reserved for product ${productId}. New stock: ${product.stock}`);

      result = {
        approved: true,
        productId,
        quantity,
        idempotencyKey,
      };
    }

    // Enviar evento de respuesta al Orders Service
    this.ordersClient.emit('product.stockReserved', result);

    return result;
  }
}
