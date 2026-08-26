import { buildContractApp } from "../testing/contract-app.js";

const app = await buildContractApp();
try {
  await app.ready();
  process.stdout.write(`${JSON.stringify(app.swagger(), null, 2)}\n`);
} finally {
  await app.close();
}
