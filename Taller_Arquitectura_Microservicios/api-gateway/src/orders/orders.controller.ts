import { Controller, Post, Body, Inject, ValidationPipe } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CreateOrderDto } from './dto/create-order.dto';

@Controller('orders')
export class OrdersController {
  constructor(
    @Inject('ORDERS_CLIENT') private readonly ordersClient: ClientProxy,
  ) {}

  @Post()
  async createOrder(@Body(new ValidationPipe()) dto: CreateOrderDto) {
    return this.ordersClient.send('orders.create', dto);
  }
}
