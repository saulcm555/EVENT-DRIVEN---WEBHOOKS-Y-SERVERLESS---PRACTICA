import { IsUUID, IsInt, Min } from 'class-validator';

export class CreateOrderDto {
  @IsUUID('4', { message: 'productId debe ser un UUID válido' })
  productId: string;

  @IsInt({ message: 'quantity debe ser un número entero' })
  @Min(1, { message: 'quantity debe ser al menos 1' })
  quantity: number;
}
