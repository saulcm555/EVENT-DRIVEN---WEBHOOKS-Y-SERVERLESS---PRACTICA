import { Controller } from '@nestjs/common';
import { MessagePattern } from '@nestjs/microservices';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller()
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @MessagePattern('orders.create')
  async createOrder(dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  @MessagePattern('product.stockReserved')
  async handleStockReserved(data: {
    approved: boolean;
    productId: string;
    quantity: number;
    idempotencyKey: string;
    reason?: string;
  }) {
    return this.ordersService.handleStockReserved(data);
  }
}
