const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/src/app.module');
const { ImportService } = require('./dist/src/import/import.service');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log("Booting NestJS application context...");
  const app = await NestFactory.createApplicationContext(AppModule);
  const importService = app.get(ImportService);

  console.log("Reading CSV file...");
  const csvPath = path.join(__dirname, '../../draft/all products.csv');
  if (!fs.existsSync(csvPath)) {
    console.error("CSV file not found at:", csvPath);
    process.exit(1);
  }
  const csvContent = fs.readFileSync(csvPath, 'utf8');

  console.log("Running ImportService.importFromCsv (dryRun: false, mode: 'create')...");
  try {
    const result = await importService.importFromCsv(csvContent, {
      mode: 'create',
      dryRun: false,
      onProgress: (p) => {
        if (p % 100 === 0) {
          console.log(`Progress: processed ${p} product groups...`);
        }
      }
    });
    console.log("IMPORT COMPLETED!");
    console.log("Summary:", result.summary);
    console.log("Total Errors:", result.errors.length);
    if (result.errors.length > 0) {
      console.log("First 5 Errors:", result.errors.slice(0, 5));
    }
  } catch (err) {
    console.error("IMPORT FAILED WITH ERROR:", err);
  } finally {
    await app.close();
  }
}

main().catch(console.error);
