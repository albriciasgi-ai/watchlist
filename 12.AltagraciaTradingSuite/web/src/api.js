// Pedidos al servidor de la suite (misma direccion de la pagina).
// Un error lleva `status` (el codigo HTTP; sin respuesta, ninguno): quien llama distingue un "no" del servidor o el
// bot (4xx) de no saber que paso (red, 5xx)
function failure(r, data) {
  const error = new Error(data.detail || data.error || `HTTP ${r.status}`);
  error.status = r.status;
  return error;
}

export async function getJson(path) {
  const r = await fetch(path);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw failure(r, data);
  return data;
}

export async function postJson(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw failure(r, data);
  return data;
}
