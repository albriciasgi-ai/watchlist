// LiquidationClustersIndicator.js
// Indicador de clusters de liquidacion con "fuerza magnetica"
// Usa MarginPad API (100% gratis, sin autenticacion)

import IndicatorBase from './IndicatorBase.js';
import { API_BASE_URL } from '../../config.js';
import pollingCoordinator from '../../utils/PollingCoordinator.js';

class LiquidationClustersIndicator extends IndicatorBase {
  constructor(symbol, interval, chartManager) {
    super(symbol, interval, 30); // Llamar constructor de IndicatorBase
    this.chartManager = chartManager;
    this.name = "Liquidation Clusters";
    this.height = 0; // Overlay (no ocupa espacio adicional)

    // Datos
    this.clusters = [];          // Array de clusters raw desde backend
    this.enrichedClusters = [];  // Clusters con magnetic strength calculado
    this.lastFetch = 0;          // Timestamp de ultima carga exitosa
    this.currentPrice = 0;       // Precio actual para calcular distancia
    this.maxNotional = 0;        // Volumen maximo (para normalizar)

    // Configuracion
    this.CACHE_TTL_MS = 60 * 1000;  // Cache 60 segundos (datos cambian lento)
    this.POLLING_INTERVAL_MS = 2 * 60 * 1000;  // Polling cada 2 minutos
    this.FETCH_TIMEOUT_MS = 30 * 1000;  // Timeout 30 segundos (MarginPad puede ser lento)

    // 🎨 Configuracion visual (Opcion 4: Top 3 + Fondo Sutil)
    this.labelPosition = 'right';  // 'left' o 'right'
    this.showTop3Lines = true;     // Mostrar lineas completas para Top 3
    this.showMid7Markers = true;   // Mostrar marcadores para clusters 4-10
    this.showRestShading = true;   // Mostrar sombreado sutil para 11-50

    // IDs de polling
    this.pollingId = null;

    // Flag para saber si chartManager está listo
    this._chartManagerReady = false;

    // Flag para saber si el componente está destruido
    this._isDestroyed = false;

    // AbortController para cancelar fetches
    this._abortController = null;

    // Flags de logging para evitar spam
    this._hasLoggedRender = false;

    console.log(`[LiquidationClusters] Inicializado para ${symbol}`);
  }

  /**
   * Método llamado cuando chartManager está completamente inicializado
   * Esto es importante porque necesitamos acceso a candles para calcular precio actual
   */
  onChartManagerReady() {
    console.log(`[LiquidationClusters] 🎯 chartManager ready - puede iniciar operaciones`);
    this._chartManagerReady = true;

    // Si el indicador ya estaba habilitado pero esperando chartManager, cargar ahora
    if (this.enabled && this.clusters.length === 0) {
      console.log(`[LiquidationClusters] Cargando datos post-ready...`);
      this.fetchData();
    }

    // Si ya tenemos clusters pero no pudimos enriquecer (currentPrice era 0), reintentar ahora
    if (this.enabled && this.clusters.length > 0 && this.enrichedClusters.length === 0) {
      console.log(`[LiquidationClusters] 🔄 Re-enriqueciendo ${this.clusters.length} clusters con chartManager listo...`);
      this._enrichClusters();  // chartManager.candles debería estar disponible ahora
      if (this.enrichedClusters.length > 0 && this.indicatorManager && typeof this.indicatorManager.requestRedraw === 'function') {
        console.log(`[LiquidationClusters] ✅ Enriquecimiento desde onChartManagerReady exitoso`);
        this.indicatorManager.requestRedraw();
      }
    }
  }

  /**
   * Actualiza la configuracion visual del indicador
   * @param {Object} config - { labelPosition: 'left'|'right', showTop3Lines: bool, showMid7Markers: bool, showRestShading: bool }
   */
  updateConfig(config) {
    if (config.labelPosition !== undefined) {
      this.labelPosition = config.labelPosition;
    }
    if (config.showTop3Lines !== undefined) {
      this.showTop3Lines = config.showTop3Lines;
    }
    if (config.showMid7Markers !== undefined) {
      this.showMid7Markers = config.showMid7Markers;
    }
    if (config.showRestShading !== undefined) {
      this.showRestShading = config.showRestShading;
    }
    console.log(`[LiquidationClusters] Config actualizada:`, {
      labelPosition: this.labelPosition,
      showTop3Lines: this.showTop3Lines,
      showMid7Markers: this.showMid7Markers,
      showRestShading: this.showRestShading
    });
  }

  /**
   * Override de setEnabled de IndicatorBase
   */
  setEnabled(enabled) {
    console.log(`[LiquidationClusters] setEnabled(${enabled}) para ${this.symbol}`);

    const wasEnabled = this.enabled;
    this.enabled = enabled;

    if (enabled && !wasEnabled) {
      // Habilitar: cargar datos y setup polling
      console.log(`[LiquidationClusters] Habilitando indicador...`);
      this.fetchData().then(() => {
        this.setupPolling();
        console.log(`[LiquidationClusters] ${this.symbol} habilitado - ${this.clusters.length} clusters`);
      }).catch(err => {
        console.error(`[LiquidationClusters] Error al habilitar:`, err);
      });
    } else if (!enabled && wasEnabled) {
      // Deshabilitar: detener polling y limpiar datos
      console.log(`[LiquidationClusters] Deshabilitando indicador...`);
      if (this.pollingId) {
        pollingCoordinator.unregister(this.pollingId);
        this.pollingId = null;
      }
      this.clusters = [];
      this.enrichedClusters = [];
      this.lastFetch = 0;
      this._loggedNoData = false;
      console.log(`[LiquidationClusters] ${this.symbol} deshabilitado`);
    }
  }

  /**
   * Metodo render() requerido por IndicatorBase (no usado - usamos renderOverlay)
   */
  render(ctx, bounds) {
    // No usado - este indicador usa renderOverlay() en su lugar
  }

  /**
   * Configura polling periodico de datos
   */
  setupPolling() {
    if (this.pollingId) {
      console.log(`[LiquidationClusters] Polling ya configurado (${this.pollingId})`);
      return;
    }

    // Registrar callback en PollingCoordinator
    // Prioridad 4: Medio-baja (menos critico que precio real-time)
    this.pollingId = pollingCoordinator.register(
      `LiquidationClusters_${this.symbol}`,
      () => this.fetchData(),
      this.POLLING_INTERVAL_MS,
      4  // priority
    );

    console.log(`[LiquidationClusters] Polling configurado: cada ${this.POLLING_INTERVAL_MS / 1000}s (ID: ${this.pollingId})`);
  }

  /**
   * Obtiene datos desde el backend (con cache)
   */
  async fetchData() {
    // Si el componente está destruido, no hacer nada
    if (this._isDestroyed) {
      console.log(`[LiquidationClusters] ⚠️ fetchData abortado - componente destruido`);
      return;
    }

    // Verificar cache
    const now = Date.now();
    const cacheAge = now - this.lastFetch;

    if (cacheAge < this.CACHE_TTL_MS && this.clusters.length > 0) {
      console.log(`[LiquidationClusters] ${this.symbol} usando cache (edad: ${Math.round(cacheAge / 1000)}s)`);
      return;
    }

    try {
      // Cancelar fetch anterior si existe
      if (this._abortController) {
        this._abortController.abort();
      }

      // Crear nuevo AbortController
      this._abortController = new AbortController();
      const timeoutId = setTimeout(() => this._abortController.abort(), this.FETCH_TIMEOUT_MS);

      const url = `${API_BASE_URL}/api/liquidations/clusters/${this.symbol}`;
      console.log(`[LiquidationClusters] 📡 Fetching: ${url}`);

      const fetchStart = Date.now();
      const response = await fetch(url, { signal: this._abortController.signal });
      const fetchDuration = Date.now() - fetchStart;
      clearTimeout(timeoutId);

      // Verificar si el componente fue destruido durante el fetch
      if (this._isDestroyed) {
        console.log(`[LiquidationClusters] ⚠️ Componente destruido durante fetch - ignorando respuesta`);
        return;
      }

      console.log(`[LiquidationClusters] ✅ Response received in ${fetchDuration}ms (status: ${response.status})`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      console.log(`[LiquidationClusters] 📦 Data parsed:`, data);

      if (!data.success) {
        throw new Error(data.error || 'Backend error');
      }

      // Actualizar datos
      this.clusters = data.clusters || [];
      this.lastFetch = now;

      console.log(`[LiquidationClusters] ✅ ${this.symbol}: ${this.clusters.length} clusters cargados`);

      // Enriquecer clusters (calcular magnetic strength)
      if (this.clusters.length > 0) {
        this._enrichClusters();
        console.log(`[LiquidationClusters] 🧲 Enriched ${this.enrichedClusters.length} clusters with magnetic strength`);

        // ✅ CRITICO: SOLO forzar redibujado si el enriquecimiento fue exitoso
        if (this.enrichedClusters.length > 0 && !this._isDestroyed && this.indicatorManager && typeof this.indicatorManager.requestRedraw === 'function') {
          this.indicatorManager.requestRedraw();
          console.log(`[LiquidationClusters] 🔄 Redraw requested (${this.enrichedClusters.length} clusters listos)`);
        } else if (this.enrichedClusters.length === 0) {
          console.log(`[LiquidationClusters] ⚠️ No redraw - enriquecimiento falló (0 clusters)`);
        } else if (this._isDestroyed) {
          console.log(`[LiquidationClusters] ⚠️ No redraw - componente destruido`);
        } else {
          console.warn(`[LiquidationClusters] ⚠️ indicatorManager.requestRedraw not available`);
        }
      } else {
        console.log(`[LiquidationClusters] ⚠️ No clusters returned from API`);
      }

    } catch (err) {
      // No loguear errores si el componente fue destruido
      if (this._isDestroyed) {
        return;
      }

      if (err.name === 'AbortError') {
        console.error(`[LiquidationClusters] ⏱️ Timeout fetching ${this.symbol} (>${this.FETCH_TIMEOUT_MS}ms)`);
      } else {
        console.error(`[LiquidationClusters] ❌ Error fetching ${this.symbol}:`, err);
      }
    } finally {
      this._abortController = null;
    }
  }

  /**
   * Enriquece clusters con magnetic strength
   * Formula: magneticStrength = (volumeScore × 0.7) + (distanceFactor × 0.3)
   * @param {Array} candles - Array de velas opcional (si no se pasa, usa chartManager.candles)
   */
  _enrichClusters(candles = null) {
    if (!this.clusters || this.clusters.length === 0) {
      console.log(`[LiquidationClusters] ⚠️ _enrichClusters: no hay clusters para enriquecer`);
      this.enrichedClusters = [];
      return;
    }

    console.log(`[LiquidationClusters] 🧲 Iniciando enriquecimiento de ${this.clusters.length} clusters...`);

    // Calcular volumen maximo para normalizar
    this.maxNotional = Math.max(...this.clusters.map(c => c.volume || 0));

    if (this.maxNotional === 0) {
      console.warn(`[LiquidationClusters] ⚠️ Todos los clusters tienen volumen 0`);
      console.log(`[LiquidationClusters] Sample cluster:`, this.clusters[0]);
      this.enrichedClusters = [];
      return;
    }

    console.log(`[LiquidationClusters] maxVolume: $${(this.maxNotional / 1e6).toFixed(2)}M`);

    // Obtener precio actual (desde ultima vela)
    this.currentPrice = this._getCurrentPrice(candles);

    if (this.currentPrice === 0) {
      console.warn(`[LiquidationClusters] ⚠️ No se pudo obtener precio actual`);
      console.log(`[LiquidationClusters] chartManager exists:`, !!this.chartManager);
      console.log(`[LiquidationClusters] chartManager.candles exists:`, !!(this.chartManager && this.chartManager.candles));
      console.log(`[LiquidationClusters] chartManager.candles length:`, this.chartManager && this.chartManager.candles ? this.chartManager.candles.length : 0);
      console.log(`[LiquidationClusters] candles param passed:`, !!candles);
      console.log(`[LiquidationClusters] candles param length:`, candles ? candles.length : 0);
      // NO vaciar enrichedClusters, simplemente no enriquecer por ahora
      // Esto evita crashes cuando chartManager aún no está inicializado
      return;
    }

    console.log(`[LiquidationClusters] currentPrice: $${this.currentPrice.toFixed(2)}`);

    // Enriquecer cada cluster
    this.enrichedClusters = this.clusters.map(cluster => {
      const price = cluster.price || 0;
      const volume = cluster.volume || 0;

      // 1. Volume Score (0 a 1)
      const volumeScore = volume / this.maxNotional;

      // 2. Distance Factor (0 a 1, mayor cuando mas cercano)
      const distancePercent = Math.abs(price - this.currentPrice) / this.currentPrice;
      const distanceFactor = 1 / (1 + Math.log10(1 + distancePercent * 100));

      // 3. Magnetic Strength (formula hibrida: 70% volume + 30% proximity)
      const magneticStrength = (volumeScore * 0.7) + (distanceFactor * 0.3);

      return {
        ...cluster,
        volumeScore,
        distanceFactor,
        magneticStrength,
        distancePercent
      };
    });

    // Ordenar por magnetic strength descendente
    this.enrichedClusters.sort((a, b) => b.magneticStrength - a.magneticStrength);

    // Log top 5
    console.log(`[LiquidationClusters] Top 5 por fuerza magnetica:`);
    this.enrichedClusters.slice(0, 5).forEach((c, i) => {
      console.log(
        `  ${i + 1}. $${c.price.toFixed(2)} | ` +
        `${c.side.toUpperCase()} | ` +
        `Vol: $${(c.volume / 1e6).toFixed(2)}M | ` +
        `Dist: ${(c.distancePercent * 100).toFixed(1)}% | ` +
        `Mag: ${(c.magneticStrength * 100).toFixed(1)}%`
      );
    });
  }

  /**
   * Obtiene el precio actual desde las velas
   * @param {Array} candles - Array de velas opcional (prioridad sobre chartManager.candles)
   */
  _getCurrentPrice(candles = null) {
    try {
      // Prioridad 1: Usar candles pasadas como parámetro
      if (candles && Array.isArray(candles) && candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        if (lastCandle && typeof lastCandle.close === 'number') {
          console.log(`[LiquidationClusters] ✅ Precio desde candles param: $${lastCandle.close.toFixed(2)}`);
          return lastCandle.close;
        }
      }

      // Prioridad 2: Usar chartManager.candles
      if (!this.chartManager) {
        console.warn('[LiquidationClusters] chartManager no disponible');
        return 0;
      }

      if (!this.chartManager.candles || !Array.isArray(this.chartManager.candles)) {
        console.warn('[LiquidationClusters] chartManager.candles no es array');
        return 0;
      }

      if (this.chartManager.candles.length === 0) {
        console.warn('[LiquidationClusters] chartManager.candles está vacío');
        return 0;
      }

      const lastCandle = this.chartManager.candles[this.chartManager.candles.length - 1];
      if (!lastCandle || typeof lastCandle.close !== 'number') {
        console.warn('[LiquidationClusters] lastCandle inválido:', lastCandle);
        return 0;
      }

      console.log(`[LiquidationClusters] ✅ Precio desde chartManager: $${lastCandle.close.toFixed(2)}`);
      return lastCandle.close;
    } catch (err) {
      console.error('[LiquidationClusters] Error obteniendo precio actual:', err);
      return 0;
    }
  }

  /**
   * Renderiza los clusters en el overlay del grafico
   * @param {CanvasRenderingContext2D} ctx - Contexto del canvas
   * @param {Object} bounds - Bounds del overlay {x, y, width, height}
   * @param {Array} visibleCandles - Velas visibles en el viewport
   * @param {Array} allCandles - Todas las velas cargadas
   * @param {Object} priceContext - Contexto de precio {minPrice, maxPrice, priceToY, etc.}
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) {
      return;
    }

    if (!this.enrichedClusters || this.enrichedClusters.length === 0) {
      // Solo loguear una vez para no spamear
      if (!this._loggedNoData) {
        console.log(`[LiquidationClusters] 📊 renderOverlay called but no clusters to render (enabled=${this.enabled})`);
        this._loggedNoData = true;
      }
      return;
    }

    // Resetear flag si ahora tenemos datos
    this._loggedNoData = false;

    // Solo loguear el primer render para evitar spam
    if (!this._hasLoggedRender) {
      console.log(`[LiquidationClusters] 🎨 Rendering ${this.enrichedClusters.length} clusters`);
      this._hasLoggedRender = true;
    }

    // ✅ FIX 2: Crear helper priceToY con validación correcta de priceContext
    const priceToY = (price) => {
      if (!priceContext) return bounds.y;
      if (priceContext.priceToY) {
        return priceContext.priceToY(price);
      }
      // Fallback calculation
      const { minPrice, maxPrice } = priceContext;
      return bounds.y + ((maxPrice - price) / (maxPrice - minPrice)) * bounds.height;
    };

    // ✅ FIX 3: Guardar estado del canvas UNA SOLA VEZ
    try {
      ctx.save();

      // ⚠️ NO re-enriquecer en cada frame - los clusters ya están enriquecidos
      // Re-enriquecimiento solo se hace en updateCandles() cuando el precio cambia

      const top3 = this.enrichedClusters.slice(0, 3);
      const mid7 = this.enrichedClusters.slice(3, 10);
      const rest = this.enrichedClusters.slice(10);

      // 🎨 OPCION 4: Renderizado en 3 capas

      // Capa 1: Clusters 11-50 (sombreado muy sutil - FONDO)
      if (this.showRestShading && rest.length > 0) {
        rest.forEach(cluster => {
          this._renderShading(ctx, cluster, bounds, priceToY);
        });
      }

      // Capa 2: Clusters 4-10 (marcadores en eje Y - MEDIO)
      if (this.showMid7Markers && mid7.length > 0) {
        mid7.forEach((cluster, index) => {
          this._renderMarker(ctx, cluster, bounds, priceToY, index + 3);
        });
      }

      // Capa 3: Top 3 (lineas completas + labels - FRENTE)
      if (this.showTop3Lines && top3.length > 0) {
        top3.forEach((cluster, index) => {
          this._renderTop3Line(ctx, cluster, bounds, priceToY, index);
          this._renderTop3Label(ctx, cluster, bounds, priceToY, index);
        });
      }

    } finally {
      // ✅ FIX 3: Restaurar estado UNA SOLA VEZ (siempre se ejecuta)
      ctx.restore();
    }
  }

  /**
   * 🎨 OPCION 4 - CAPA 1: Renderiza sombreado sutil para clusters 11-50
   */
  _renderShading(ctx, cluster, bounds, priceToY) {
    const y = priceToY(cluster.price);

    // Verificar si esta dentro del viewport
    if (y < bounds.y - 50 || y > bounds.y + bounds.height + 50) {
      return;
    }

    // Color segun lado (muy transparente)
    const baseColor = cluster.side === 'long' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(34, 197, 94, 0.05)';

    // Zona sombreada (altura proporcional al volumen, minimo 2px)
    const zoneHeight = Math.max(2, cluster.magneticStrength * 8);

    ctx.fillStyle = baseColor;
    ctx.fillRect(bounds.x, y - zoneHeight / 2, bounds.width, zoneHeight);
  }

  /**
   * 🎨 OPCION 4 - CAPA 2: Renderiza marcador en eje Y para clusters 4-10
   */
  _renderMarker(ctx, cluster, bounds, priceToY, rank) {
    const y = priceToY(cluster.price);

    // Verificar si esta dentro del viewport
    if (y < bounds.y - 50 || y > bounds.y + bounds.height + 50) {
      return;
    }

    // Color segun lado
    const baseColor = cluster.side === 'long' ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';
    const opacity = 0.5;

    // Posicion del marcador (en el eje Y derecho)
    const markerX = bounds.x + bounds.width;
    const markerSize = 6;

    // Triangulo apuntando hacia adentro
    ctx.fillStyle = baseColor.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
    ctx.beginPath();
    if (cluster.side === 'long') {
      // Triangulo apuntando hacia abajo (liquidaciones LONG empujan precio abajo)
      ctx.moveTo(markerX - markerSize, y - markerSize);
      ctx.lineTo(markerX, y);
      ctx.lineTo(markerX - markerSize, y + markerSize);
    } else {
      // Triangulo apuntando hacia arriba (liquidaciones SHORT empujan precio arriba)
      ctx.moveTo(markerX - markerSize, y + markerSize);
      ctx.lineTo(markerX, y);
      ctx.lineTo(markerX - markerSize, y - markerSize);
    }
    ctx.closePath();
    ctx.fill();

    // Linea punteada muy sutil hacia el grafico
    ctx.strokeStyle = baseColor.replace('rgb', 'rgba').replace(')', `, 0.2)`);
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(bounds.x, y);
    ctx.lineTo(bounds.x + bounds.width, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /**
   * 🎨 OPCION 4 - CAPA 3: Renderiza linea completa para Top 3
   */
  _renderTop3Line(ctx, cluster, bounds, priceToY, rank) {
    const y = priceToY(cluster.price);

    // Verificar si esta dentro del viewport
    if (y < bounds.y - 50 || y > bounds.y + bounds.height + 50) {
      return;
    }

    // Color segun lado
    const baseColor = cluster.side === 'long' ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';

    // Opacidad mas alta para top 3
    const opacity = rank === 0 ? 0.7 : (rank === 1 ? 0.6 : 0.5);
    const lineWidth = rank === 0 ? 2.5 : (rank === 1 ? 2 : 1.5);

    // Linea principal
    ctx.strokeStyle = baseColor.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(bounds.x, y);
    ctx.lineTo(bounds.x + bounds.width, y);
    ctx.stroke();

    // Borde exterior sutil (efecto glow)
    if (rank === 0) {
      ctx.strokeStyle = baseColor.replace('rgb', 'rgba').replace(')', `, 0.2)`);
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(bounds.x, y);
      ctx.lineTo(bounds.x + bounds.width, y);
      ctx.stroke();
    }
  }

  /**
   * 🎨 OPCION 4 - CAPA 3: Renderiza label para Top 3 (con posicion configurable)
   */
  _renderTop3Label(ctx, cluster, bounds, priceToY, rank) {
    const y = priceToY(cluster.price);

    // Verificar si esta dentro del viewport
    if (y < bounds.y - 50 || y > bounds.y + bounds.height + 50) {
      return;
    }

    // Icono segun ranking
    const icon = rank === 0 ? '🔥' : (rank === 1 ? '🔥' : '⚡');

    // Texto del label (mas compacto que antes)
    const volumeM = (cluster.volume / 1e6).toFixed(1);
    const magPct = (cluster.magneticStrength * 100).toFixed(0);
    const sideIcon = cluster.side === 'long' ? '🔻' : '🔺';

    // Formato compacto: "🔥 $2.5M 85%"
    const label = `${icon} ${sideIcon}$${volumeM}M ${magPct}%`;

    // Estilo de texto
    ctx.font = rank === 0 ? 'bold 11px monospace' : '11px monospace';
    ctx.textBaseline = 'middle';

    // Calcular posicion segun configuracion
    const textWidth = ctx.measureText(label).width;
    const padding = 5;
    const boxHeight = 18;
    const margin = 5;

    let boxX, textAlign;
    if (this.labelPosition === 'left') {
      boxX = bounds.x + margin;
      textAlign = 'left';
      ctx.textAlign = 'left';
    } else {
      boxX = bounds.x + bounds.width - textWidth - padding * 2 - margin;
      textAlign = 'left';
      ctx.textAlign = 'left';
    }

    const boxY = y - boxHeight / 2;

    // Fondo con opacidad mas alta
    const bgOpacity = rank === 0 ? 0.3 : (rank === 1 ? 0.25 : 0.2);
    ctx.fillStyle = cluster.side === 'long'
      ? `rgba(239, 68, 68, ${bgOpacity})`
      : `rgba(34, 197, 94, ${bgOpacity})`;
    ctx.fillRect(boxX, boxY, textWidth + padding * 2, boxHeight);

    // Borde del box (mas grueso para #1)
    ctx.strokeStyle = cluster.side === 'long' ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';
    ctx.lineWidth = rank === 0 ? 1.5 : 1;
    ctx.strokeRect(boxX, boxY, textWidth + padding * 2, boxHeight);

    // Texto
    ctx.fillStyle = cluster.side === 'long' ? 'rgb(239, 68, 68)' : 'rgb(34, 197, 94)';
    ctx.fillText(label, boxX + padding, y);
  }

  /**
   * Actualiza cuando cambian las velas (recalcular magnetic strength)
   */
  updateCandles(candles) {
    if (!this.enabled) return;

    // Si tenemos clusters pero no enriched (porque currentPrice era 0), reintentar
    if (this.clusters.length > 0 && this.enrichedClusters.length === 0) {
      console.log(`[LiquidationClusters] 🔄 Primera actualización de velas - enriqueciendo ${this.clusters.length} clusters...`);
      this._enrichClusters(candles);  // ✅ Pasar las velas como parámetro
      if (this.enrichedClusters.length > 0 && this.indicatorManager && typeof this.indicatorManager.requestRedraw === 'function') {
        console.log(`[LiquidationClusters] ✅ Enriquecimiento exitoso (${this.enrichedClusters.length} clusters) - forzando redraw`);
        this.indicatorManager.requestRedraw();
      }
      return;
    }

    // Solo re-enriquecer (el precio pudo cambiar)
    this._enrichClusters(candles);  // ✅ Pasar las velas como parámetro
  }

  /**
   * Limpieza al destruir el indicador
   */
  destroy() {
    console.log(`[LiquidationClusters] Destruyendo ${this.symbol}...`);

    // Marcar como destruido PRIMERO
    this._isDestroyed = true;

    // Cancelar fetch en progreso
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }

    // Deshabilitar (detener polling y limpiar)
    this.setEnabled(false);

    console.log(`[LiquidationClusters] ✅ ${this.symbol} destruido completamente`);
  }
}

export default LiquidationClustersIndicator;
