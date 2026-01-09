// src/components/indicators/IndicatorBase.js

class IndicatorBase {
  constructor(symbol, interval, days = 30) {
    this.symbol = symbol;
    this.interval = interval;
    this.days = days;
    this.name = "Base Indicator";
    this.data = [];
    this.enabled = true;
    this.height = 100; // Altura en píxeles
    this.loading = false;
  }

  async fetchData() {
    throw new Error("fetchData() debe ser implementado");
  }

  processRealtimeData(wsData) {
    // Override en subclases si necesitan WebSocket
  }

  render(ctx, bounds) {
    throw new Error("render() debe ser implementado");
  }

  setEnabled(enabled) {
    this.enabled = enabled;
  }

  getHeight() {
    return this.enabled ? this.height : 0;
  }

  // ✅ NUEVO: Método applyConfig que delega a updateConfig si existe
  applyConfig(config) {
    if (this.updateConfig && typeof this.updateConfig === 'function') {
      this.updateConfig(config);
    }
  }
}

export default IndicatorBase;
