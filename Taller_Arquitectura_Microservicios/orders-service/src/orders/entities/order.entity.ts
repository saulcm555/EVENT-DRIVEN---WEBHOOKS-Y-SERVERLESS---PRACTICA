import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  productId: string;

  @Column('integer')
  quantity: number;

  @Column()
  status: string; // PENDING, CONFIRMED, REJECTED

  @Column({ unique: true })
  idempotencyKey: string;
}
