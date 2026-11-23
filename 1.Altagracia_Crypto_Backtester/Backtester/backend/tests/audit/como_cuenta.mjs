// Protocolo (22/11/2026), etapa 4: "Como cuenta" tal como lo calcula la página (accountStats de ruleTester.js).
// Uso: node como_cuenta.mjs <archivo.json con {"trades": [[entrada, salida, r], ...], "riskPct": 1}>
import { readFileSync } from 'node:fs';
import { accountStats } from '../../../frontend/src/components/backtesting/ruleTester.js';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = accountStats(input.trades, input.riskPct);
process.stdout.write(JSON.stringify(out));
