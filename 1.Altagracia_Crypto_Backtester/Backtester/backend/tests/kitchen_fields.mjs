// Los campos que la página deja cambiar en cada bloque de la cocina, para compararlos con los del motor
// (test_kitchen.py, test_los_campos_de_cada_evento_son_los_mismos_en_la_pagina_y_en_el_motor).
// Uso: node tests/kitchen_fields.mjs  → JSON { código: { p, nums: { campo: [mínimo, máximo] }, opts: { campo: [opciones] } } }
import { allBlocks } from '../../frontend/src/components/kitchen/kitchenCatalog.js';

const out = {};
for (const def of allBlocks()) {
  if (!def.code) continue; // Solo los eventos del probador y los Elementos OF
  const nums = Object.fromEntries((def.fields || []).map(([key, , min, max]) => [key, [min, max]]));
  const opts = Object.fromEntries([...(def.selects || []), ...(def.selectsAfter || [])].map(([key, , options]) => [key, options.map(option => option[0])]));
  const p = { ...def.p };
  delete p.dir;
  out[def.code] = { p, nums, opts };
}
console.log(JSON.stringify(out));
