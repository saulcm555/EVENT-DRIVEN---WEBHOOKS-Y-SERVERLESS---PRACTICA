import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { ProductsService } from './products.service';

@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @MessagePattern('product.reserveStock')
  async reserveStock(data: { productId: string; quantity: number; idempotencyKey: string }) {
    const { productId, quantity, idempotencyKey } = data;
    return this.productsService.reserveStock(productId, quantity, idempotencyKey);
  }
}
