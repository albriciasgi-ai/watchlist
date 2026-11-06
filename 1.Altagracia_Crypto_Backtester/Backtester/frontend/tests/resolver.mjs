// Vite acepta imports sin extensión y Node no: esto deja probar IndicatorManager sin navegador.
export async function resolve(specifier, context, next) {
  const relative = specifier.startsWith('./') || specifier.startsWith('../');
  return next(relative && !/\.[a-z]+$/i.test(specifier) ? `${specifier}.js` : specifier, context);
}
