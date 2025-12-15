import { IsString, IsInt, Min, IsOptional } from 'class-validator';

export class CreateProductDto {
  @IsString({ message: 'name debe ser un string' })
  name: string;

  @IsInt({ message: 'price debe ser un número entero' })
  @Min(0, { message: 'price debe ser mayor o igual a 0' })
  price: number;

  @IsInt({ message: 'stock debe ser un número entero' })
  @Min(0, { message: 'stock debe ser mayor o igual a 0' })
  stock: number;
}

export class ReserveStockDto {
  @IsString()
  productId: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsString()
  idempotencyKey: string;
}
