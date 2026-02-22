// ZoneVisualizerIndicator.js
// Visualiza zonas detectadas por el Zone Detector 2.0 backend

import IndicatorBase from "./IndicatorBase";
import { API_BASE_URL } from "../../config.js";

class ZoneVisualizerIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Zone Visualizer";
    this.height = 0; // No ocupa espacio (overlay en chart)

    // Zonas a renderizar (combinacion de manuales + realtime)
    this.zones = [];
    this._manualZones = [];   // Zonas de "Detectar zonas" (boton manual)
    this._realtimeZones = []; // Zonas del servicio realtime (V2 engine)
    this._vpZones = [];       // Zonas del VP Zone Scanner (Volume Profile)
    this._strategyZones = []; // Zonas del Strategy Builder (modular backtest)

    // Metricas por candle para barras horizontales (v2: 6 barras diagnosticas)
    this._metricsMap = new Map(); // timestamp -> {atr_range, count_outside, body_ratio, range_pct, min_bars, ttm_squeeze}
    this._activeLayers = {};     // Que capas estan activas
    this._useTtm = false;        // Si TTM esta habilitado en el servicio v2
    this._lastMetricsFetch = 0;
    this._metricsFetchInterval = 15000; // Polling cada 15s (sincronizado con zonas)
    this._isFetchingMetrics = false;
    this.metricsBarHeight = 8;
    this._detectionParams = {};  // Params del ZoneDetectorSettings para enviar al endpoint
    this._useV2 = true;          // Usar endpoints v2 (nuevo detector incremental)

    // VP Profiles para visualizacion (perfiles VP Periodic y VP Zones)
    this._vpProfiles = [];
    this._showVPProfiles = false;
    this._vpProfilesLogged = false;

    // Gaussian Channel para visualizacion
    this._gcChannel = null;   // {points: [{ts, f, h, l}]}
    this._gcChannelLogged = false;

    // Strategy Builder diagnostics (semaforo de debugging)
    this._sbDiagnosticsMap = new Map(); // timestamp -> {has_level, entry_signal, direction_ok, confluence_ok, context_ok, sl_valid, tp_valid, trade_opened}
    this._sbDiagRenderLogged = false;
    this._sbDiagKeys = ['has_level', 'entry_signal', 'direction_ok', 'confluence_ok', 'context_ok', 'sl_valid', 'tp_valid', 'trade_opened'];
    this._sbDiagLabels = {
      'has_level': 'LVL',
      'entry_signal': 'SIG',
      'direction_ok': 'DIR',
      'confluence_ok': 'CONF',
      'context_ok': 'CTX',
      'sl_valid': 'SL',
      'tp_valid': 'TP',
      'trade_opened': 'TRADE',
    };
    this._sbDiagColors = {
      pass: 'rgba(0, 200, 100, 0.85)',    // Verde brillante
      fail: 'rgba(80, 80, 80, 0.25)',      // Gris oscuro
      trade: 'rgba(255, 215, 0, 0.95)',    // Dorado para trade abierto
    };

    // Configuracion visual
    this.config = {
      showZones: true,
      showLabels: true,
      showScores: true,
      highlightTradeable: true,
      opacity: 0.15,
      borderWidth: 1,
      // Colores por metodo
      colors: {
        pivot_cluster: { fill: 'rgba(74, 111, 165, 0.15)', border: '#4a6fa5' },
        atr_based: { fill: 'rgba(165, 74, 74, 0.15)', border: '#a54a4a' },
        volume_profile: { fill: 'rgba(74, 165, 74, 0.15)', border: '#4aa54a' },
        price_action: { fill: 'rgba(165, 165, 74, 0.15)', border: '#a5a54a' },
        consolidation: { fill: 'rgba(255, 152, 0, 0.20)', border: '#FF9800' }, // Naranja para consolidation
        trading_zones: { fill: 'rgba(100, 100, 255, 0.15)', border: '#6464FF' }, // Azul para trading zones
        // Colores especiales por resultado de trading
        trading_win: { fill: 'rgba(0, 200, 100, 0.25)', border: '#00C864' },
        trading_loss: { fill: 'rgba(255, 50, 50, 0.25)', border: '#FF3232' },
        trading_open: { fill: 'rgba(255, 200, 0, 0.20)', border: '#FFC800' },
        // VP Zone Scanner colores
        vp_zone: { fill: 'rgba(0, 86, 210, 0.20)', border: '#0056D2' },
        vp_win: { fill: 'rgba(0, 180, 100, 0.25)', border: '#00B464' },
        vp_loss: { fill: 'rgba(210, 50, 50, 0.25)', border: '#D23232' },
        vp_open: { fill: 'rgba(0, 86, 210, 0.15)', border: '#0056D2' },
        // Strategy Builder colores
        sb_zone: { fill: 'rgba(128, 0, 200, 0.18)', border: '#8000C8' },
        sb_win: { fill: 'rgba(0, 180, 100, 0.25)', border: '#00B464' },
        sb_loss: { fill: 'rgba(210, 50, 50, 0.25)', border: '#D23232' },
        sb_open: { fill: 'rgba(128, 0, 200, 0.12)', border: '#8000C8' },
        default: { fill: 'rgba(128, 128, 128, 0.15)', border: '#808080' }
      },
      tradeableHighlight: { fill: 'rgba(74, 165, 74, 0.25)', border: '#4aa54a' }
    };

    console.log(`[${this.symbol}] ZoneVisualizerIndicator: Inicializado`);
  }

  /**
   * Combina zonas manuales + realtime + VP, deduplicando por start_timestamp + end_timestamp
   */
  _mergeZones() {
    this._skipLogged = false;
    this._renderLogged = false;
    this._noRenderLogged = false;

    // Manuales tienen prioridad (incluyen volume profile)
    const allKeys = new Set();
    const merged = [];

    for (const z of this._manualZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      allKeys.add(key);
      merged.push({ ...z, _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
    }

    // Agregar realtime que no esten ya en manuales
    for (const z of this._realtimeZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      if (!allKeys.has(key)) {
        allKeys.add(key);
        merged.push({ ...z, _source: 'realtime', _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
      }
    }

    // Agregar VP zones que no esten ya
    for (const z of this._vpZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      if (!allKeys.has(key)) {
        allKeys.add(key);
        merged.push({ ...z, _source: 'vp', _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
      }
    }

    // Agregar Strategy Builder zones que no esten ya
    for (const z of this._strategyZones) {
      const key = `${z.start_timestamp}_${z.end_timestamp}`;
      if (!allKeys.has(key)) {
        allKeys.add(key);
        merged.push({ ...z, _source: 'strategy', _debugLogged: false, _skippedLogged: false, _priceCheckLogged: false, _yErrorLogged: false, _yRangeLogged: false });
      }
    }

    this.zones = merged;
  }

  /**
   * Establece zonas de deteccion manual (boton "Detectar zonas")
   * @param {Array} zones - Array de zonas del backend
   */
  setZones(zones) {
    this._manualZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._manualZones.length} zonas manuales (total: ${this.zones.length})`);
  }

  /**
   * Establece zonas del servicio realtime (polling)
   * @param {Array} zones - Array de zonas realtime
   */
  setRealtimeZones(zones) {
    this._realtimeZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._realtimeZones.length} zonas realtime (total: ${this.zones.length})`);
  }

  /**
   * Establece zonas del VP Zone Scanner (Volume Profile)
   * @param {Array} zones - Array de zonas VP
   */
  setVPZones(zones) {
    this._vpZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._vpZones.length} zonas VP (total: ${this.zones.length})`);
  }

  /**
   * Establece zonas del Strategy Builder (modular backtest)
   * @param {Array} zones - Array de zonas del strategy builder
   */
  setStrategyZones(zones) {
    this._strategyZones = zones || [];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${this._strategyZones.length} zonas Strategy Builder (total: ${this.zones.length})`);
  }

  /**
   * Agrega zonas sin reemplazar las existentes
   * @param {Array} zones - Array de zonas a agregar
   */
  addZones(zones) {
    this._manualZones = [...this._manualZones, ...(zones || [])];
    this._mergeZones();
    console.log(`[${this.symbol}] ZoneVisualizer: ${zones.length} zonas agregadas (total: ${this.zones.length})`);
  }

  /**
   * Limpia todas las zonas (manuales y realtime)
   */
  clearZones() {
    this._manualZones = [];
    this._realtimeZones = [];
    this._vpZones = [];
    this._strategyZones = [];
    this._vpProfiles = [];
    this._vpProfilesLogged = false;
    this.zones = [];
    console.log(`[${this.symbol}] ZoneVisualizer: Zonas limpiadas`);
  }

  /**
   * Actualiza configuracion visual
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    console.log(`[${this.symbol}] ZoneVisualizer: Config actualizada`);
  }

  /**
   * Renderiza las zonas en el canvas del chart (metodo standard)
   */
  render(ctx, candles, chartDimensions, transform) {
    // No-op: usamos renderOverlay para overlay en el chart de precios
  }

  /**
   * Renderiza las zonas como overlay en el chart de precios
   * Este metodo es llamado por IndicatorManager.renderOverlays()
   */
  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext = null) {
    // Skip si no hay zonas o está deshabilitado
    if (!this.enabled || !this.config.showZones || this.zones.length === 0) {
      if (!this._skipLogged) {
        console.log(`[${this.symbol}] ZoneVisualizer.renderOverlay SKIP: enabled=${this.enabled}, showZones=${this.config.showZones}, zones=${this.zones.length}`);
        this._skipLogged = true;
      }
      return;
    }

    // Necesitamos priceToY (función) para convertir precios a coordenadas Y
    if (!priceContext || !priceContext.priceToY) {
      console.log(`[${this.symbol}] ZoneVisualizer.renderOverlay SKIP: no priceContext or priceToY`);
      return;
    }

    // 🔍 DEBUG: Log una vez por sesión
    if (!this._renderLogged) {
      console.log(`[${this.symbol}] 🎯 ZoneVisualizer.renderOverlay: Renderizando ${this.zones.length} zonas`);
      console.log(`[${this.symbol}] 🎯 priceContext:`, {
        minPrice: priceContext.minPrice,
        maxPrice: priceContext.maxPrice,
        hasTimeToX: !!priceContext.timeToX
      });
      if (visibleCandles && visibleCandles.length > 0) {
        console.log(`[${this.symbol}] 🎯 visibleCandles range:`, {
          firstTs: visibleCandles[0].timestamp,
          lastTs: visibleCandles[visibleCandles.length - 1].timestamp,
          firstDate: new Date(visibleCandles[0].timestamp).toISOString(),
          lastDate: new Date(visibleCandles[visibleCandles.length - 1].timestamp).toISOString()
        });
      }
      // Log primera zona para comparar
      if (this.zones.length > 0) {
        const z = this.zones[0];
        console.log(`[${this.symbol}] 🎯 Primera zona:`, {
          min_price: z.min_price,
          max_price: z.max_price,
          start_ts: z.start_timestamp,
          end_ts: z.end_timestamp,
          start_date: new Date(z.start_timestamp).toISOString(),
          end_date: new Date(z.end_timestamp).toISOString()
        });
      }
      this._renderLogged = true;
    }

    ctx.save();

    // Renderizar cada zona
    let renderedCount = 0;
    for (const zone of this.zones) {
      const rendered = this._renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext);
      if (rendered) renderedCount++;
    }

    // Log si no se renderizaron todas las zonas
    if (!this._noRenderLogged && this.zones.length > 0) {
      if (renderedCount < this.zones.length) {
        const visRange = visibleCandles && visibleCandles.length > 0
          ? `visible: ${new Date(visibleCandles[0].timestamp).toLocaleString()} - ${new Date(visibleCandles[visibleCandles.length - 1].timestamp).toLocaleString()}`
          : 'no visible candles';
        console.warn(`[${this.symbol}] ZoneVisualizer: ${renderedCount}/${this.zones.length} zonas renderizadas (${visRange}). Haga scroll/zoom para ver las demas.`);
      }
      this._noRenderLogged = true;
    }

    // Renderizar perfiles VP si estan habilitados
    if (this._showVPProfiles && this._vpProfiles.length > 0) {
      this._renderVPProfiles(ctx, visibleCandles, bounds, priceContext);
    }

    // Renderizar Gaussian Channel si hay datos
    if (this._gcChannel && this._gcChannel.points && this._gcChannel.points.length > 0) {
      this._renderGCChannel(ctx, visibleCandles, bounds, priceContext);
    }

    ctx.restore();
  }

  /**
   * Renderiza perfiles VP como rectangulos VAL-VAH con lineas POC/VAH/VAL.
   * VP Periodic = azul, VP Zones = verde.
   */
  _renderVPProfiles(ctx, visibleCandles, bounds, priceContext) {
    const { priceToY, timeToX } = priceContext;
    if (!timeToX || !priceToY) return;

    const visFirstTs = visibleCandles && visibleCandles.length > 0 ? visibleCandles[0].timestamp : 0;
    const visLastTs = visibleCandles && visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1].timestamp : Infinity;

    let profilesRendered = 0;

    for (const p of this._vpProfiles) {
      // Verificar interseccion temporal con velas visibles
      if (p.end_ts < visFirstTs || p.start_ts > visLastTs) continue;

      const x1 = timeToX(p.start_ts);
      const x2 = timeToX(p.end_ts);
      if (x1 === undefined || x2 === undefined) continue;

      const xLeft = Math.min(x1, x2);
      const xRight = Math.max(x1, x2);
      const rectW = Math.max(xRight - xLeft, 2);

      const yVAH = priceToY(p.vah);
      const yVAL = priceToY(p.val);
      const yPOC = priceToY(p.poc);
      if (yVAH === undefined || yVAL === undefined || yPOC === undefined) continue;

      const yTop = Math.min(yVAH, yVAL);
      const yBot = Math.max(yVAH, yVAL);
      const rectH = Math.max(yBot - yTop, 1);

      const isVPZones = p.source === 'vp_zones';

      // Colores: VP Periodic = azul, VP Zones = verde
      const fillColor = isVPZones ? 'rgba(0, 180, 100, 0.08)' : 'rgba(50, 120, 220, 0.08)';
      const borderColor = isVPZones ? 'rgba(0, 180, 100, 0.35)' : 'rgba(50, 120, 220, 0.35)';
      const pocColor = isVPZones ? 'rgba(0, 220, 120, 0.80)' : 'rgba(70, 150, 255, 0.80)';
      const vahValColor = isVPZones ? 'rgba(0, 180, 100, 0.45)' : 'rgba(50, 120, 220, 0.45)';

      // Rectangulo fill VAL-VAH
      ctx.fillStyle = fillColor;
      ctx.fillRect(xLeft, yTop, rectW, rectH);

      // Borde del rectangulo
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(xLeft, yTop, rectW, rectH);
      ctx.setLineDash([]);

      // Linea POC (mas gruesa y solida)
      ctx.strokeStyle = pocColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(xLeft, yPOC);
      ctx.lineTo(xLeft + rectW, yPOC);
      ctx.stroke();

      // Lineas VAH y VAL (mas finas, discontinuas)
      ctx.strokeStyle = vahValColor;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 3]);

      ctx.beginPath();
      ctx.moveTo(xLeft, yVAH);
      ctx.lineTo(xLeft + rectW, yVAH);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(xLeft, yVAL);
      ctx.lineTo(xLeft + rectW, yVAL);
      ctx.stroke();

      ctx.setLineDash([]);

      // Labels en el borde izquierdo
      ctx.font = '9px monospace';
      ctx.textAlign = 'left';
      const labelX = xLeft + 3;

      // Label POC
      ctx.fillStyle = pocColor;
      ctx.fillText(`POC ${p.poc.toFixed(0)}`, labelX, yPOC - 3);

      // Label VAH
      ctx.fillStyle = vahValColor;
      ctx.fillText(`VAH ${p.vah.toFixed(0)}`, labelX, yVAH - 3);

      // Label VAL
      ctx.fillText(`VAL ${p.val.toFixed(0)}`, labelX, yVAL + 11);

      // Label de source + shape para VP Zones
      if (isVPZones && p.shape_type) {
        const shapeLabel = `${p.shape_type} (D:${p.d_score || 0})`;
        ctx.fillStyle = 'rgba(0, 180, 100, 0.6)';
        ctx.fillText(shapeLabel, labelX, yTop - 3);
      }

      profilesRendered++;
    }

    if (profilesRendered > 0 && !this._vpProfilesLogged) {
      console.log(`[${this.symbol}] VP Profiles: ${profilesRendered}/${this._vpProfiles.length} perfiles renderizados`);
      this._vpProfilesLogged = true;
    }
  }

  /**
   * Renderiza el Gaussian Channel como 3 lineas sobre el chart de precios.
   * - Linea central (filt): naranja, solida
   * - Banda superior (hband): cyan, discontinua
   * - Banda inferior (lband): cyan, discontinua
   * - Fill entre bandas: cyan semitransparente
   */
  _renderGCChannel(ctx, visibleCandles, bounds, priceContext) {
    const { priceToY, timeToX } = priceContext;
    if (!timeToX || !priceToY) return;

    const points = this._gcChannel.points;
    if (!points || points.length < 2) return;

    const visFirstTs = visibleCandles && visibleCandles.length > 0 ? visibleCandles[0].timestamp : 0;
    const visLastTs = visibleCandles && visibleCandles.length > 0 ? visibleCandles[visibleCandles.length - 1].timestamp : Infinity;

    // Filtrar puntos que estan en el rango visible (con 1 punto extra a cada lado para continuidad)
    let startIdx = 0;
    let endIdx = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      if (points[i].ts >= visFirstTs) { startIdx = Math.max(0, i - 1); break; }
    }
    for (let i = points.length - 1; i >= 0; i--) {
      if (points[i].ts <= visLastTs) { endIdx = Math.min(points.length - 1, i + 1); break; }
    }

    if (startIdx >= endIdx) return;

    // Convertir a coordenadas de pantalla
    const screenPoints = [];
    for (let i = startIdx; i <= endIdx; i++) {
      const p = points[i];
      const x = timeToX(p.ts);
      if (x === undefined) continue;
      const yF = priceToY(p.f);
      const yH = priceToY(p.h);
      const yL = priceToY(p.l);
      if (yF === undefined || yH === undefined || yL === undefined) continue;
      screenPoints.push({ x, yF, yH, yL });
    }

    if (screenPoints.length < 2) return;

    // 1. Fill entre bandas (area semitransparente)
    ctx.fillStyle = 'rgba(0, 200, 220, 0.06)';
    ctx.beginPath();
    // Linea superior (hband) de izquierda a derecha
    ctx.moveTo(screenPoints[0].x, screenPoints[0].yH);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].yH);
    }
    // Linea inferior (lband) de derecha a izquierda
    for (let i = screenPoints.length - 1; i >= 0; i--) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].yL);
    }
    ctx.closePath();
    ctx.fill();

    // 2. Banda superior (hband) - linea cyan discontinua
    ctx.strokeStyle = 'rgba(0, 200, 220, 0.55)';
    ctx.lineWidth = 1.0;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].yH);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].yH);
    }
    ctx.stroke();

    // 3. Banda inferior (lband) - linea cyan discontinua
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].yL);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].yL);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Linea central (filt) - naranja solida, mas gruesa
    ctx.strokeStyle = 'rgba(255, 160, 0, 0.80)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].yF);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].yF);
    }
    ctx.stroke();

    // Log una vez
    if (!this._gcChannelLogged) {
      console.log(`[${this.symbol}] GC Channel: ${screenPoints.length} puntos renderizados de ${points.length} totales`);
      this._gcChannelLogged = true;
    }
  }

  /**
   * Renderiza una zona individual como overlay
   * Dibuja 2 rectangulos: consolidacion + trade (entry -> TP/SL)
   * @returns {boolean} true si se renderizo, false si se salto
   */
  _renderZoneOverlay(ctx, zone, visibleCandles, allCandles, bounds, priceContext) {
    const isNoTrade = zone.trade_result === 'SKIPPED' || zone.trade_result === 'NO_ENTRY'
      || zone.trade_result === 'NO_BREAKOUT';

    const { x: boundsX, y: boundsY, width: boundsWidth, height: boundsHeight } = bounds;
    const { priceToY, timeToX, minPrice, maxPrice } = priceContext;
    // Usar timeline_index del backend (orden cronologico) si existe
    const zoneIndex = zone.timeline_index || (this.zones.indexOf(zone) + 1);

    // --- RECTANGULO 1: Zona de consolidacion ---
    // VP zones: usar full_range para el rectangulo principal
    const isVP = zone._source === 'vp';
    const hasFullRange = isVP && zone.full_range_min != null && zone.full_range_max != null;
    const rectTop = hasFullRange ? zone.full_range_max : zone.max_price;
    const rectBot = hasFullRange ? zone.full_range_min : zone.min_price;
    const yZoneTop = priceToY(rectTop);
    const yZoneBottom = priceToY(rectBot);

    if (yZoneTop === undefined || yZoneBottom === undefined || isNaN(yZoneTop) || isNaN(yZoneBottom)) {
      return false;
    }

    const isPending = zone.trade_result === 'PENDING' || zone.trade_result === 'BUILDING';

    // Verificar interseccion temporal con velas visibles ANTES de calcular X
    const isOpenOrPending = isPending || zone.trade_result === 'OPEN';
    if (visibleCandles && visibleCandles.length > 0 && zone.start_timestamp && zone.end_timestamp) {
      const visFirstTs = visibleCandles[0].timestamp;
      const visLastTs = visibleCandles[visibleCandles.length - 1].timestamp;
      // Considerar el rango extendido: consolidacion + trade(s)
      // Para zonas OPEN/PENDING, se extienden hasta el presente
      let zoneLatestTs = isOpenOrPending
        ? Infinity
        : (zone.trade_close_timestamp || zone.entry_timestamp || zone.end_timestamp);
      // Para mean reversion con multiples trades, buscar el timestamp mas lejano
      if (zone.mr_trades && zone.mr_trades.length > 0) {
        for (const t of zone.mr_trades) {
          const tEnd = t.trade_close_timestamp || t.entry_timestamp || 0;
          if (tEnd > zoneLatestTs) zoneLatestTs = tEnd;
          if (t.trade_result === 'OPEN') { zoneLatestTs = Infinity; break; }
        }
      }
      // Si la zona termina antes del rango visible o comienza despues, skip
      if (zoneLatestTs < visFirstTs || zone.start_timestamp > visLastTs) {
        return false;
      }
    }

    // Calcular X de la consolidacion
    let xZoneStart = boundsX;
    let xZoneEnd = boundsX + boundsWidth;

    if (timeToX && zone.start_timestamp && zone.end_timestamp) {
      const cx1 = timeToX(zone.start_timestamp);
      const cx2 = timeToX(zone.end_timestamp);
      if (cx1 !== null && cx1 !== undefined) xZoneStart = Math.max(boundsX, cx1);
      if (cx2 !== null && cx2 !== undefined) xZoneEnd = Math.max(xZoneStart + 1, Math.min(boundsX + boundsWidth, cx2));
    }

    // Clamp Y a area visible
    const yTop = Math.max(Math.min(yZoneTop, yZoneBottom), boundsY);
    const yBot = Math.min(Math.max(yZoneTop, yZoneBottom), boundsY + boundsHeight);

    // Consolidacion visible verticalmente? (si no, los trades aun pueden serlo)
    const consolVisibleV = yTop < yBot;

    // Si la consolidacion esta fuera del area visible horizontal, NO salir
    // porque los trades pueden estar en el area visible
    const consolVisible = xZoneStart < xZoneEnd && consolVisibleV;

    // Colores de consolidacion: gris para sin trade, cyan para PENDING, azul VP, purpura SB, azul gris V2
    const isStrategy = zone._source === 'strategy';
    const consolFill = isNoTrade ? 'rgba(130, 130, 130, 0.10)'
      : isPending ? 'rgba(0, 200, 220, 0.15)'
      : isVP ? 'rgba(0, 86, 210, 0.15)'
      : isStrategy ? 'rgba(128, 0, 200, 0.15)' : 'rgba(100, 140, 200, 0.12)';
    const consolBorder = isNoTrade ? 'rgba(130, 130, 130, 0.45)'
      : isPending ? 'rgba(0, 200, 220, 0.7)'
      : isVP ? 'rgba(0, 86, 210, 0.6)'
      : isStrategy ? 'rgba(128, 0, 200, 0.6)' : 'rgba(100, 140, 200, 0.5)';
    const consolVert = isNoTrade ? 'rgba(130, 130, 130, 0.35)'
      : isPending ? 'rgba(0, 200, 220, 0.5)'
      : isVP ? 'rgba(0, 86, 210, 0.4)'
      : isStrategy ? 'rgba(128, 0, 200, 0.4)' : 'rgba(100, 140, 200, 0.4)';

    // Dibujar consolidacion (solo si visible horizontalmente)
    if (consolVisible) {
    ctx.fillStyle = consolFill;
    ctx.fillRect(xZoneStart, yTop, xZoneEnd - xZoneStart, yBot - yTop);

    // Para PENDING: extender zona a la derecha hasta el borde del chart (zona "viva")
    if (isPending && xZoneEnd < boundsX + boundsWidth) {
      ctx.fillStyle = 'rgba(0, 200, 220, 0.06)';
      ctx.fillRect(xZoneEnd, yTop, (boundsX + boundsWidth) - xZoneEnd, yBot - yTop);

      // Lineas horizontales extendidas (punteadas finas)
      ctx.strokeStyle = 'rgba(0, 200, 220, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(xZoneEnd, yTop);
      ctx.lineTo(boundsX + boundsWidth, yTop);
      ctx.moveTo(xZoneEnd, yBot);
      ctx.lineTo(boundsX + boundsWidth, yBot);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Bordes punteados de la consolidacion
    ctx.strokeStyle = consolBorder;
    ctx.lineWidth = isPending ? 1.5 : 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xZoneStart, yTop);
    ctx.lineTo(xZoneEnd, yTop);
    ctx.moveTo(xZoneStart, yBot);
    ctx.lineTo(xZoneEnd, yBot);
    ctx.stroke();
    ctx.setLineDash([]);

    // Lineas verticales de la consolidacion
    ctx.strokeStyle = consolVert;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(xZoneStart, yTop);
    ctx.lineTo(xZoneStart, yBot);
    ctx.moveTo(xZoneEnd, yTop);
    ctx.lineTo(xZoneEnd, yBot);
    ctx.stroke();

    // --- OVERLAY VALUE AREA (naranja translucido dentro del rect azul) ---
    if (isVP && hasFullRange) {
      const yVATop = priceToY(zone.max_price);
      const yVABot = priceToY(zone.min_price);
      if (yVATop !== undefined && yVABot !== undefined && !isNaN(yVATop) && !isNaN(yVABot)) {
        const vaTop = Math.max(Math.min(yVATop, yVABot), boundsY);
        const vaBot = Math.min(Math.max(yVATop, yVABot), boundsY + boundsHeight);
        if (vaTop < vaBot) {
          ctx.fillStyle = 'rgba(255, 160, 40, 0.18)';
          ctx.fillRect(xZoneStart, vaTop, xZoneEnd - xZoneStart, vaBot - vaTop);
          // Bordes naranja finos del VA
          ctx.strokeStyle = 'rgba(255, 160, 40, 0.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.beginPath();
          ctx.moveTo(xZoneStart, vaTop);
          ctx.lineTo(xZoneEnd, vaTop);
          ctx.moveTo(xZoneStart, vaBot);
          ctx.lineTo(xZoneEnd, vaBot);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }

    // --- VOLUME PROFILE dentro de la zona ---
    if (zone.volume_profile && zone.volume_profile.bins && zone.volume_profile.bins.length > 0) {
      const vp = zone.volume_profile;
      const vpBins = vp.bins;
      const vpPriceLow = vp.price_low;
      const vpPriceHigh = vp.price_high;
      const pocPrice = vp.poc_price;
      const vahPrice = vp.vah_price;
      const valPrice = vp.val_price;

      if (vpPriceHigh > vpPriceLow) {
        const vpMaxWidth = (xZoneEnd - xZoneStart) * 0.4; // Max 40% del ancho de la zona

        // Dibujar cada bin como barra horizontal
        const binHeight = (yBot - yTop) / vpBins.length;

        for (let i = 0; i < vpBins.length; i++) {
          const bin = vpBins[i];
          if (bin.volume_norm <= 0) continue;

          const binY = priceToY(bin.price);
          if (binY === undefined || isNaN(binY)) continue;

          const barWidth = bin.volume_norm * vpMaxWidth;
          const barY = binY - binHeight / 2;
          const clampedBarY = Math.max(barY, boundsY);
          const clampedHeight = Math.min(binHeight, boundsY + boundsHeight - clampedBarY);

          if (clampedHeight <= 0) continue;

          // Color: VA bins en azul, fuera de VA en gris, POC bin en amarillo
          const isPocBin = Math.abs(bin.price - pocPrice) < (vpPriceHigh - vpPriceLow) / vpBins.length;
          if (isPocBin) {
            ctx.fillStyle = 'rgba(255, 220, 50, 0.45)';
          } else if (bin.in_va) {
            ctx.fillStyle = 'rgba(70, 130, 230, 0.30)';
          } else {
            ctx.fillStyle = 'rgba(120, 120, 140, 0.20)';
          }

          // Dibujar desde el borde izquierdo de la zona hacia la derecha
          ctx.fillRect(xZoneStart, clampedBarY, barWidth, clampedHeight);
        }

        // Linea POC: amarilla punteada
        const yPOC = priceToY(pocPrice);
        if (yPOC !== undefined && !isNaN(yPOC) && yPOC >= boundsY && yPOC <= boundsY + boundsHeight) {
          ctx.strokeStyle = 'rgba(255, 220, 50, 0.9)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(xZoneStart, yPOC);
          ctx.lineTo(xZoneEnd, yPOC);
          ctx.stroke();
          ctx.setLineDash([]);

          // Label POC
          ctx.font = 'bold 9px Arial';
          ctx.fillStyle = 'rgba(255, 220, 50, 1)';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText('POC', xZoneEnd - 2, yPOC);
        }

        // Lineas VAH/VAL: azul claro punteadas
        const yVAH = priceToY(vahPrice);
        const yVAL = priceToY(valPrice);

        ctx.strokeStyle = 'rgba(70, 130, 230, 0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);

        if (yVAH !== undefined && !isNaN(yVAH) && yVAH >= boundsY && yVAH <= boundsY + boundsHeight) {
          ctx.beginPath();
          ctx.moveTo(xZoneStart, yVAH);
          ctx.lineTo(xZoneEnd, yVAH);
          ctx.stroke();

          ctx.font = '8px Arial';
          ctx.fillStyle = 'rgba(70, 130, 230, 0.8)';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText('VAH', xZoneEnd - 2, yVAH);
        }

        if (yVAL !== undefined && !isNaN(yVAL) && yVAL >= boundsY && yVAL <= boundsY + boundsHeight) {
          ctx.beginPath();
          ctx.moveTo(xZoneStart, yVAL);
          ctx.lineTo(xZoneEnd, yVAL);
          ctx.stroke();

          ctx.font = '8px Arial';
          ctx.fillStyle = 'rgba(70, 130, 230, 0.8)';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          ctx.fillText('VAL', xZoneEnd - 2, yVAL);
        }

        ctx.setLineDash([]);
      }
    }
    } // end if (consolVisible)

    // --- LINEA VERTICAL: Vela de deteccion (donde la zona se confirmo) ---
    if (zone.detection_timestamp && timeToX) {
      const xDetection = timeToX(zone.detection_timestamp);
      if (xDetection >= boundsX && xDetection <= boundsX + boundsWidth) {
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(xDetection, yZoneTop);
        ctx.lineTo(xDetection, yZoneBottom);
        ctx.stroke();
        ctx.setLineDash([]);

        // Label
        ctx.font = 'bold 9px Arial';
        ctx.fillStyle = 'rgba(255, 165, 0, 0.9)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('D', xDetection, yZoneTop - 2);
      }
    }

    // --- RECTANGULO 2: Trade(s) (entry -> TP/SL) ---
    // Mean reversion puede tener multiples sub-trades (mr_trades)
    const tradesToDraw = (zone.mr_trades && zone.mr_trades.length > 0)
      ? zone.mr_trades
      : (zone.entry_price && zone.sl_price && zone.tp_price && zone.entry_timestamp)
        ? [zone]
        : [];

    for (let tIdx = 0; tIdx < tradesToDraw.length; tIdx++) {
      const trade = tradesToDraw[tIdx];
      if (!trade.entry_price || !trade.sl_price || !trade.tp_price || !trade.entry_timestamp) continue;

      const isWin = trade.trade_result === 'WIN';
      const isOpen = trade.trade_result === 'OPEN';

      // Colores segun estado
      const tradeColors = isOpen
        ? { fill: 'rgba(255, 180, 0, 0.08)', border: 'rgba(255, 180, 0, 0.4)' }
        : isWin
          ? { fill: 'rgba(0, 180, 80, 0.10)', border: 'rgba(0, 180, 80, 0.4)' }
          : { fill: 'rgba(220, 40, 40, 0.10)', border: 'rgba(220, 40, 40, 0.4)' };

      // X del trade: desde entry hasta cierre (o borde derecho si OPEN)
      let xTradeStart = boundsX;
      let xTradeEnd = boundsX + boundsWidth;

      if (timeToX) {
        const tx1 = timeToX(trade.entry_timestamp);
        if (tx1 !== null && tx1 !== undefined) xTradeStart = Math.max(boundsX, tx1);

        if (!isOpen && trade.trade_close_timestamp) {
          const tx2 = timeToX(trade.trade_close_timestamp);
          if (tx2 !== null && tx2 !== undefined) xTradeEnd = Math.min(boundsX + boundsWidth, tx2);
        }
      }

      if (xTradeStart < xTradeEnd) {
        const yEntry = priceToY(trade.entry_price);
        const ySL = priceToY(trade.sl_price);
        const yTP = priceToY(trade.tp_price);

        if (yEntry !== undefined && ySL !== undefined && yTP !== undefined) {
          const yTradeTop = Math.max(Math.min(ySL, yTP), boundsY);
          const yTradeBot = Math.min(Math.max(ySL, yTP), boundsY + boundsHeight);
          const tradeWidth = xTradeEnd - xTradeStart;
          const tradeHeight = yTradeBot - yTradeTop;

          if (tradeHeight > 0 && tradeWidth > 0) {
            ctx.fillStyle = tradeColors.fill;
            ctx.fillRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);

            ctx.strokeStyle = tradeColors.border;
            ctx.lineWidth = 1;
            ctx.setLineDash(isOpen ? [4, 4] : []);
            ctx.strokeRect(xTradeStart, yTradeTop, tradeWidth, tradeHeight);
            ctx.setLineDash([]);

            // Linea de ENTRY: negra punteada
            const yEntryClamp = Math.max(Math.min(yEntry, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, yEntryClamp);
            ctx.lineTo(xTradeEnd, yEntryClamp);
            ctx.stroke();

            // Linea de TP: verde solida
            const yTPClamp = Math.max(Math.min(yTP, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(0, 200, 80, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, yTPClamp);
            ctx.lineTo(xTradeEnd, yTPClamp);
            ctx.stroke();

            // Linea de SL: roja solida
            const ySLClamp = Math.max(Math.min(ySL, boundsY + boundsHeight), boundsY);
            ctx.strokeStyle = 'rgba(220, 40, 40, 0.9)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(xTradeStart, ySLClamp);
            ctx.lineTo(xTradeEnd, ySLClamp);
            ctx.stroke();

            // --- Linea de NIVEL ORIGEN (debug): cyan, 10 barras antes del entry ---
            if (zone.level_price && timeToX) {
              const yLevel = priceToY(zone.level_price);
              if (yLevel !== undefined) {
                const yLevelClamp = Math.max(Math.min(yLevel, boundsY + boundsHeight), boundsY);
                // Calcular ancho de 10 barras segun interval
                const intervalMinutes = { '1': 1, '3': 3, '5': 5, '15': 15, '30': 30, '60': 60, '120': 120, '240': 240, '360': 360, '720': 720, 'D': 1440, 'W': 10080 };
                const barMs = (intervalMinutes[this.interval] || 1) * 60000;
                const levelLineStart = timeToX(trade.entry_timestamp - barMs * 10);
                const xLevelStart = (levelLineStart !== null && levelLineStart !== undefined)
                  ? Math.max(boundsX, levelLineStart)
                  : Math.max(boundsX, xTradeStart - 80);

                ctx.strokeStyle = 'rgba(0, 200, 255, 0.95)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 3]);
                ctx.beginPath();
                ctx.moveTo(xLevelStart, yLevelClamp);
                ctx.lineTo(xTradeStart + 20, yLevelClamp);
                ctx.stroke();
                ctx.setLineDash([]);

                // Label del nivel origen
                const srcLabel = (zone.level_source || '').replace('vp_periodic', 'VP').replace('sr_v2', 'SR').replace('vwap_bands', 'VWAP').replace('swing_levels', 'SW').replace('dtb_neckline', 'DTB').replace('vp_zones', 'VPZ');
                ctx.font = 'bold 9px Arial';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'bottom';
                ctx.fillStyle = 'rgba(0, 200, 255, 1)';
                ctx.fillText(`${srcLabel} ${zone.level_price.toFixed(1)}`, xLevelStart + 2, yLevelClamp - 2);
              }
            }

            // Labels de TP y SL
            ctx.font = 'bold 10px Arial';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';

            const tradeLabel = tradesToDraw.length > 1 ? `#${zoneIndex}.${tIdx + 1}` : `#${zoneIndex}`;
            ctx.fillStyle = 'rgba(0, 200, 80, 1)';
            ctx.fillText(`${tradeLabel} TP`, xTradeEnd - 3, yTPClamp);

            ctx.fillStyle = 'rgba(220, 40, 40, 1)';
            ctx.fillText(`${tradeLabel} SL`, xTradeEnd - 3, ySLClamp);
          }
        }
      }
    }

    // --- LABEL de la zona ---
    if (this.config.showLabels) {
      const isWin = zone.trade_result === 'WIN';
      const isOpen = zone.trade_result === 'OPEN';
      const isBuilding = zone.trade_result === 'BUILDING';
      let labelColor, resultText;
      if (isNoTrade) {
        labelColor = '#888888';
        resultText = '-';
      } else if (isBuilding) {
        labelColor = '#00BCD4';
        resultText = 'B';
      } else if (isPending) {
        labelColor = '#00D4E0';
        resultText = 'P';
      } else if (isOpen) {
        labelColor = '#FFB300';
        resultText = 'O';
      } else if (isWin) {
        labelColor = '#00C864';
        resultText = 'W';
      } else {
        labelColor = '#FF3232';
        resultText = 'L';
      }
      const labelText = `#${zoneIndex} ${resultText}`;

      ctx.font = 'bold 13px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      const padding = 4;
      const textMetrics = ctx.measureText(labelText);
      const labelWidth = textMetrics.width + padding * 2;
      const labelHeight = 19;

      // Usar yTop clampeado si la consolidacion esta fuera del viewport vertical
      const labelY = consolVisibleV ? yTop : Math.max(boundsY, Math.min(boundsY + boundsHeight - labelHeight - 4, Math.min(yZoneTop, yZoneBottom)));

      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.fillRect(xZoneStart + 2, labelY + 2, labelWidth, labelHeight);

      ctx.fillStyle = labelColor;
      ctx.fillText(labelText, xZoneStart + 2 + padding, labelY + 5);
    }

    return true;
  }

  /**
   * Retorna las zonas para uso externo
   */
  getZones() {
    return this.zones;
  }

  /**
   * Retorna zonas que contienen un precio especifico
   */
  getZonesAtPrice(price) {
    return this.zones.filter(z =>
      price >= z.min_price && price <= z.max_price
    );
  }

  /**
   * Retorna zonas activas (no han tenido breakout)
   */
  getActiveZones() {
    return this.zones.filter(z => !z.breakout);
  }

  /**
   * Retorna las mejores zonas por score
   */
  getTopZones(count = 5) {
    return [...this.zones]
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, count);
  }

  /**
   * No necesita fetch de datos - las zonas vienen del ZoneDetectorTester
   */
  async fetchData() {
    // No-op: las zonas se establecen via setZones()
    return true;
  }

  /**
   * Metodo analyze para compatibilidad con IndicatorManager
   */
  analyze(candles) {
    // No-op: las zonas ya vienen calculadas del backend
    return this.zones;
  }

  // ==========================================================
  // Barras horizontales de metricas (similar a VWAP volatility bars)
  // ==========================================================

  /**
   * Establece los parametros de deteccion (desde ZoneDetectorSettings)
   * para que fetchMetrics los envie al endpoint.
   */
  setDetectionParams(params) {
    this._detectionParams = params || {};
  }

  /**
   * Obtiene diagnosticos por candle del backend v2 (6 condiciones).
   * Endpoint: GET /api/zones/v2/diagnostics/{symbol}
   */
  async fetchMetrics() {
    if (this._isFetchingMetrics) return;
    this._isFetchingMetrics = true;

    try {
      const url = `${API_BASE_URL}/api/zones/v2/diagnostics/${this.symbol}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = await res.json();
      if (!data.success || !data.timestamps) return;

      // Construir mapa por timestamp con las 6 condiciones diagnosticas
      this._metricsMap.clear();
      const ts = data.timestamps;
      for (let i = 0; i < ts.length; i++) {
        this._metricsMap.set(ts[i], {
          atr_range: data.atr_range ? data.atr_range[i] || false : false,
          count_outside: data.count_outside ? data.count_outside[i] || false : false,
          body_ratio: data.body_ratio ? data.body_ratio[i] || false : false,
          range_pct: data.range_pct ? data.range_pct[i] || false : false,
          min_bars: data.min_bars ? data.min_bars[i] || false : false,
          ttm_squeeze: data.ttm_squeeze ? data.ttm_squeeze[i] || false : false,
        });
      }
      this._useTtm = data.use_ttm || false;

      // Construir activeLayers basado en los datos recibidos
      this._activeLayers = {
        atr_range: true,
        count_outside: true,
        body_ratio: true,
        range_pct: true,
        min_bars: true,
        ttm_squeeze: this._useTtm,
      };
      this._lastMetricsFetch = Date.now();
    } catch (err) {
      // Silencioso - el servicio v2 puede no estar corriendo
    } finally {
      this._isFetchingMetrics = false;
    }
  }

  /**
   * Retorna cuantas barras activas hay (para calcular altura total)
   * v2: 5 barras fijas + 1 opcional (TTM)
   */
  getActiveMetricsBarCount() {
    let count = 0;
    const l = this._activeLayers;
    if (l.atr_range) count++;
    if (l.count_outside) count++;
    if (l.body_ratio) count++;
    if (l.range_pct) count++;
    if (l.min_bars) count++;
    if (l.ttm_squeeze) count++;
    return count;
  }

  /**
   * Retorna la altura total que ocupan las barras de metricas
   */
  getMetricsBarsHeight() {
    const count = this.getActiveMetricsBarCount();
    if (count === 0) return 0;
    const barGap = 2;
    return (this.metricsBarHeight * count) + (barGap * (count - 1));
  }

  /**
   * Renderiza las barras horizontales de metricas debajo del VWAP.
   * Patron identico a VWAPIndicator.renderVolatilityBars().
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Posicion X inicial (marginLeft)
   * @param {number} startY - Posicion Y donde comienzan las barras
   * @param {number} width - Ancho disponible
   * @param {number} candleWidth - Ancho de cada vela
   * @param {Array} visibleCandles
   * @returns {number} Altura total ocupada
   */
  renderMetricsBars(ctx, x, startY, width, candleWidth, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return 0;
    if (this._metricsMap.size === 0) return 0;

    const barHeight = this.metricsBarHeight;
    const barGap = 2;
    const layers = this._activeLayers;

    // v2: 6 barras diagnosticas en orden logico
    const layerOrder = [];
    if (layers.atr_range)     layerOrder.push({ key: 'atr_range',     label: 'ATR' });
    if (layers.count_outside) layerOrder.push({ key: 'count_outside', label: 'OUT' });
    if (layers.body_ratio)    layerOrder.push({ key: 'body_ratio',    label: 'BODY' });
    if (layers.range_pct)     layerOrder.push({ key: 'range_pct',     label: 'RNG' });
    if (layers.min_bars)      layerOrder.push({ key: 'min_bars',      label: 'BARS' });
    if (layers.ttm_squeeze)   layerOrder.push({ key: 'ttm_squeeze',   label: 'TTM' });

    if (layerOrder.length === 0) return 0;

    let currentY = startY;

    for (const layer of layerOrder) {
      this._drawSingleMetricsBar(ctx, visibleCandles, x, currentY, width, candleWidth, barHeight, layer.key, layer.label);
      currentY += barHeight + barGap;
    }

    return (barHeight * layerOrder.length) + (barGap * (layerOrder.length - 1));
  }

  /**
   * Dibuja una barra horizontal para una metrica.
   * Azul = condicion cumplida, gris = no cumplida.
   */
  _drawSingleMetricsBar(ctx, visibleCandles, x, barY, width, candleWidth, barHeight, metricKey, label) {
    const passColor = 'rgba(30, 136, 229, 0.85)';   // Azul cuando pasa
    const failColor = 'rgba(128, 128, 128, 0.25)';   // Gris cuando no pasa

    visibleCandles.forEach((candle, i) => {
      const metrics = this._metricsMap.get(candle.timestamp);
      const candleX = x + (i * candleWidth);

      const pass = metrics ? metrics[metricKey] : false;
      ctx.fillStyle = pass ? passColor : failColor;
      ctx.fillRect(candleX, barY, candleWidth, barHeight);

      // Separador vertical entre velas
      if (i > 0) {
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(candleX, barY);
        ctx.lineTo(candleX, barY + barHeight);
        ctx.stroke();
      }
    });

    // Label sobre el inicio de la barra (dentro del area visible)
    const fontSize = Math.max(7, Math.min(10, barHeight));
    ctx.font = `bold ${fontSize}px monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const labelY = barY + (barHeight / 2);
    const labelX = x + 3;
    const textW = ctx.measureText(label).width;

    // Fondo semitransparente para legibilidad
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(labelX - 1, barY, textW + 4, barHeight);

    // Texto blanco con outline negro
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.lineWidth = 2;
    ctx.strokeText(label, labelX, labelY);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.fillText(label, labelX, labelY);
  }

  // ==========================================================
  // Strategy Builder - Semaforo de debugging
  // ==========================================================

  /**
   * Establece los diagnosticos del Strategy Builder.
   * @param {Object} diagData - {timestamps: [], flags: {key: [bool]}, keys: [string]}
   */
  setSBDiagnostics(diagData) {
    this._sbDiagnosticsMap.clear();
    this._sbDiagRenderLogged = false;
    if (!diagData || !diagData.timestamps || !diagData.flags) return;

    const ts = diagData.timestamps;
    const flags = diagData.flags;
    const keys = diagData.keys || this._sbDiagKeys;

    for (let i = 0; i < ts.length; i++) {
      const entry = {};
      for (const k of keys) {
        entry[k] = flags[k] ? (flags[k][i] || false) : false;
      }
      this._sbDiagnosticsMap.set(ts[i], entry);
    }
    // Contar cuantas velas tienen al menos 1 flag true
    let withTrue = 0;
    for (let j = 0; j < ts.length; j++) {
      for (const k of keys) {
        if (flags[k] && flags[k][j]) { withTrue++; break; }
      }
    }
    console.log(`[${this.symbol}] SB DIAGNOSTICS LOADED: ${ts.length} velas con datos, ${withTrue} con al menos 1 TRUE. Map size=${this._sbDiagnosticsMap.size}`);
  }

  /**
   * Limpia los diagnosticos del Strategy Builder.
   */
  clearSBDiagnostics() {
    this._sbDiagnosticsMap.clear();
  }

  // ==========================================================
  // VP Profiles visualization
  // ==========================================================

  /**
   * Establece perfiles VP para visualizacion en el chart.
   * @param {Array} profiles - [{source, start_ts, end_ts, poc, vah, val, shape_type?, d_score?}]
   */
  setVPProfiles(profiles) {
    this._vpProfiles = profiles || [];
    console.log(`[${this.symbol}] VP Profiles: ${this._vpProfiles.length} perfiles cargados`);
  }

  /**
   * Toggle visibilidad de perfiles VP.
   */
  setShowVPProfiles(show) {
    this._showVPProfiles = !!show;
  }

  /**
   * Establece datos del Gaussian Channel para visualizacion.
   * @param {Object|null} gcData - {points: [{ts, f, h, l}]} o null para limpiar
   */
  setGCChannel(gcData) {
    this._gcChannel = gcData;
    this._gcChannelLogged = false;
    if (gcData && gcData.points) {
      console.log(`[${this.symbol}] GC Channel: ${gcData.points.length} puntos cargados`);
    }
  }

  /**
   * Limpia perfiles VP.
   */
  clearVPProfiles() {
    this._vpProfiles = [];
  }

  /**
   * Retorna cuantas barras de diagnostico SB hay activas (8 fijas).
   */
  getSBDiagnosticsBarCount() {
    if (this._sbDiagnosticsMap.size === 0) return 0;
    return this._sbDiagKeys.length; // 8 barras
  }

  /**
   * Retorna la altura total de las barras de diagnostico SB.
   */
  getSBDiagnosticsHeight() {
    const count = this.getSBDiagnosticsBarCount();
    if (count === 0) return 0;
    const barHeight = 20;
    const barGap = 2;
    const titleH = 18;
    return titleH + (barHeight * count) + (barGap * (count - 1));
  }

  /**
   * Renderiza las barras de diagnostico del Strategy Builder.
   * Patron identico a renderMetricsBars() pero con colores verdes/grises.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x - Posicion X (marginLeft)
   * @param {number} startY - Posicion Y donde comienzan
   * @param {number} width - Ancho disponible
   * @param {number} candleWidth - Ancho de cada vela
   * @param {Array} visibleCandles
   * @returns {number} Altura total ocupada
   */
  renderSBDiagnosticsBars(ctx, x, startY, width, candleWidth, visibleCandles) {
    if (!visibleCandles || visibleCandles.length === 0) return 0;
    if (this._sbDiagnosticsMap.size === 0) return 0;

    const barHeight = 20;
    const barGap = 2;
    const passColor = this._sbDiagColors.pass;
    const failColor = this._sbDiagColors.fail;
    const tradeColor = this._sbDiagColors.trade;

    // Fondo semitransparente para separar visualmente del chart
    const titleH = 18;
    const totalH = titleH + (barHeight * this._sbDiagKeys.length) + (barGap * (this._sbDiagKeys.length - 1));

    ctx.fillStyle = 'rgba(10, 8, 30, 0.92)';
    ctx.fillRect(x, startY, width, totalH);

    // Linea separadora superior purpura
    ctx.strokeStyle = 'rgba(180, 130, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, startY);
    ctx.lineTo(x + width, startY);
    ctx.stroke();

    // Titulo del bloque
    ctx.font = 'bold 12px monospace';
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(180, 130, 255, 0.95)';
    ctx.fillText('SB DIAGNOSTICS', x + 5, startY + 3);

    let currentY = startY + titleH;

    // Ancho minimo para que velas con datos sean visibles
    const minBlockPx = Math.max(4, candleWidth * 2);

    // Contar matches para debug (solo una vez)
    let matchCount = 0;
    let firstMatch = false;

    for (let ki = 0; ki < this._sbDiagKeys.length; ki++) {
      const key = this._sbDiagKeys[ki];
      const label = this._sbDiagLabels[key] || key;

      // Fondo de la fila
      ctx.fillStyle = ki % 2 === 0 ? 'rgba(30, 25, 50, 0.5)' : 'rgba(45, 38, 65, 0.5)';
      ctx.fillRect(x, currentY, width, barHeight);

      // Pintar solo velas que TIENEN datos diagnosticos
      visibleCandles.forEach((candle, i) => {
        const diag = this._sbDiagnosticsMap.get(candle.timestamp);
        if (!diag) return;

        if (ki === 0) matchCount++;

        const candleX = x + (i * candleWidth);
        let color;
        if (key === 'trade_opened' && diag[key]) {
          color = tradeColor;
        } else if (diag[key]) {
          color = passColor;
        } else {
          color = failColor;
        }

        ctx.fillStyle = color;
        const blockW = Math.max(candleWidth, minBlockPx);
        ctx.fillRect(candleX, currentY, blockW, barHeight);
      });

      // Label a la izquierda con contraste
      ctx.font = 'bold 11px monospace';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';

      const labelY = currentY + (barHeight / 2);
      const labelX = x + 4;
      const textW = ctx.measureText(label).width;

      // Fondo del label
      ctx.fillStyle = 'rgba(10, 8, 30, 0.92)';
      ctx.fillRect(labelX - 2, currentY + 1, textW + 8, barHeight - 2);

      // Texto con borde
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, labelX, labelY);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, labelX, labelY);

      currentY += barHeight + barGap;
    }

    // Debug: log una sola vez si hay matches (evitar spam)
    if (!this._sbDiagRenderLogged && matchCount > 0) {
      console.log(`[${this.symbol}] SB DIAG RENDER: startY=${startY}, totalH=${totalH}, matchedCandles=${matchCount}/${visibleCandles.length}, barHeight=${barHeight}`);
      this._sbDiagRenderLogged = true;
    }

    return totalH;
  }
}

export default ZoneVisualizerIndicator;
