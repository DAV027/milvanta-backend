// Guarded integration entrypoint: isolated PostgreSQL, injected Meta transports only.
import { assertTestDatabaseConfigured } from '../tests/helpers/testDbGuard.js';
import { spawnSync } from 'node:child_process';
assertTestDatabaseConfigured();
const result=spawnSync(process.execPath,['--test','tests/stage-c-customer-acceptance.test.js','tests/calendar-delivery-postgresql-integration.test.js','tests/whatsapp-postgresql.test.js'],{stdio:'inherit',env:{...process.env,NODE_ENV:'test'}});
if(result.error) throw result.error;
process.exitCode=result.status ?? 1;
