// Registro global de IndicatorManagers por símbolo
class IndicatorManagerRegistry {
  static managers = new Map(); // symbol -> IndicatorManager

  static register(symbol, manager) {
    this.managers.set(symbol, manager);
    console.log(`[Registry] ✅ Registrado manager para ${symbol} (total: ${this.managers.size})`);
  }

  static unregister(symbol) {
    this.managers.delete(symbol);
    console.log(`[Registry] 🗑️ Desregistrado manager para ${symbol} (total: ${this.managers.size})`);
  }

  static get(symbol) {
    return this.managers.get(symbol);
  }

  static getAll() {
    const entries = Array.from(this.managers.entries());
    console.log(`[Registry] getAll() called - returning ${entries.length} managers:`, entries.map(e => e[0]));
    return entries;
  }

  static getAllSymbols() {
    return Array.from(this.managers.keys());
  }
}

export default IndicatorManagerRegistry;
