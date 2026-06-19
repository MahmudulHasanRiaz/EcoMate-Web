const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');
const { ProductsService } = require('./dist/src/products/products.service');

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const service = app.get(ProductsService);
  const result = await service.findAll({});
  console.log("findAll result total:", result.meta.total);
  console.log("findAll data length:", result.data.length);
  await app.close();
}
main().catch(console.error);
