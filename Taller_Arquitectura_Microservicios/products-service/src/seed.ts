import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Product } from './products/entities/product.entity';
import { Repository } from 'typeorm';

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const productRepository: Repository<Product> = app.get(getRepositoryToken(Product));

  const products = [
    { name: 'Laptop', price: 1200, stock: 10 },
    { name: 'Mouse', price: 25, stock: 50 },
    { name: 'Teclado', price: 45, stock: 30 },
    { name: 'Monitor', price: 300, stock: 15 },
    { name: 'Webcam', price: 80, stock: 20 },
  ];

  for (const productData of products) {
    const existing = await productRepository.findOne({ where: { name: productData.name } });
    if (!existing) {
      const product = productRepository.create(productData);
      await productRepository.save(product);
      console.log(`✓ Producto creado: ${product.name} (ID: ${product.id})`);
    } else {
      console.log(`○ Producto ya existe: ${existing.name} (ID: ${existing.id})`);
    }
  }

  console.log('\n🎉 Seed completado!');
  await app.close();
}

seed().catch((error) => {
  console.error('Error en seed:', error);
  process.exit(1);
});
