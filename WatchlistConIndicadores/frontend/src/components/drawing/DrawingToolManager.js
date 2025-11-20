// src/components/drawing/DrawingToolManager.js
// Manager central para herramientas de dibujo

import TrendLine from './shapes/TrendLine';
import HorizontalLine from './shapes/HorizontalLine';
import Rectangle from './shapes/Rectangle';
import FibonacciRetracement from './shapes/FibonacciRetracement';

class DrawingToolManager {
  constructor(symbol, interval) {
    this.symbol = symbol;
    this.interval = interval;
    this.shapes = [];
    this.selectedShape = null;
    this.hoveredShape = null;
    this.currentTool = 'select';
    this.drawingInProgress = null;
    this.tempPoints = [];

    // Undo/Redo system
    this.history = [];
    this.historyIndex = -1;
    this.maxHistory = 50;
  }

  setTool(tool) {
    this.currentTool = tool;
    this.selectedShape = null;
    this.drawingInProgress = null;
    this.tempPoints = [];
  }

  handleMouseDown(x, y, scaleConverter, tool) {
    if (!scaleConverter) return false;

    // Modo selección
    if (this.currentTool === 'select') {
      // Detectar click en shape existente
      const clickedShape = this.findShapeAt(x, y, scaleConverter);

      if (clickedShape) {
        this.selectedShape = clickedShape;

        // Detectar si clickeó un handle
        const handle = clickedShape.hitTestHandle(x, y, scaleConverter);
        if (handle) {
          clickedShape.startResize(handle, x, y, scaleConverter);
        } else {
          clickedShape.startDrag(x, y, scaleConverter);
        }

        return true;
      } else {
        this.selectedShape = null;
        return false;
      }
    }

    // Modo dibujo
    const price = scaleConverter.yToPrice(y);
    const time = scaleConverter.xToTime(x);

    if (!time) return false;

    if (this.currentTool === 'trendline') {
      if (!this.drawingInProgress) {
        this.drawingInProgress = new TrendLine(price, time, price, time);
        this.tempPoints = [{ x, y, price, time }];
      } else {
        this.drawingInProgress.setEnd(price, time);
        this.addShape(this.drawingInProgress);
        this.drawingInProgress = null;
        this.tempPoints = [];
        this.saveToHistory();
      }
      return true;
    }

    if (this.currentTool === 'horizontal') {
      const line = new HorizontalLine(price, time);
      this.addShape(line);
      this.saveToHistory();
      // NO cambiar tool, permitir dibujar múltiples líneas
      return true;
    }

    if (this.currentTool === 'rectangle') {
      if (!this.drawingInProgress) {
        this.drawingInProgress = new Rectangle(price, time, price, time);
        this.tempPoints = [{ x, y, price, time }];
      } else {
        this.drawingInProgress.setEnd(price, time);
        this.addShape(this.drawingInProgress);
        this.drawingInProgress = null;
        this.tempPoints = [];
        this.saveToHistory();
      }
      return true;
    }

    if (this.currentTool === 'fibonacci') {
      if (!this.drawingInProgress) {
        this.drawingInProgress = new FibonacciRetracement(price, time, price, time);
        this.tempPoints = [{ x, y, price, time }];
      } else {
        this.drawingInProgress.setEnd(price, time);
        this.addShape(this.drawingInProgress);
        this.drawingInProgress = null;
        this.tempPoints = [];
        this.saveToHistory();
      }
      return true;
    }

    return false;
  }

  handleMouseMove(x, y, scaleConverter) {
    if (!scaleConverter) return false;

    const price = scaleConverter.yToPrice(y);
    const time = scaleConverter.xToTime(x);

    // Actualizar hover
    this.hoveredShape = this.findShapeAt(x, y, scaleConverter);

    // Arrastre de shape existente
    if (this.selectedShape && (this.selectedShape.isDragging || this.selectedShape.isResizing)) {
      this.selectedShape.updateDrag(x, y, scaleConverter);
      return true;
    }

    // Preview de dibujo en progreso
    if (this.drawingInProgress && time) {
      this.drawingInProgress.setEnd(price, time);
      return true;
    }

    return this.hoveredShape !== null;
  }

  handleMouseUp(scaleConverter) {
    if (this.selectedShape) {
      if (this.selectedShape.isDragging || this.selectedShape.isResizing) {
        this.selectedShape.endDrag();
        this.saveToHistory();
      }
    }
  }

  findShapeAt(x, y, scaleConverter) {
    // Buscar de atrás hacia adelante (shapes más recientes primero)
    for (let i = this.shapes.length - 1; i >= 0; i--) {
      if (this.shapes[i].hitTest(x, y, scaleConverter)) {
        return this.shapes[i];
      }
    }
    return null;
  }

  addShape(shape) {
    this.shapes.push(shape);
  }

  deleteSelected() {
    if (this.selectedShape) {
      const index = this.shapes.indexOf(this.selectedShape);
      if (index !== -1) {
        this.shapes.splice(index, 1);
        this.selectedShape = null;
        this.saveToHistory();
      }
    }
  }

  clearAll() {
    this.shapes = [];
    this.selectedShape = null;
    this.drawingInProgress = null;
    this.saveToHistory();
  }

  isDrawing() {
    return this.drawingInProgress !== null;
  }

  cancelDrawing() {
    this.drawingInProgress = null;
    this.tempPoints = [];
  }

  // Undo/Redo system
  saveToHistory() {
    // Serializar estado actual
    const state = this.shapes.map(shape => shape.serialize());

    // Eliminar estados futuros si estamos en medio del history
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }

    // Añadir nuevo estado
    this.history.push(state);

    // Limitar tamaño del history
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreFromHistory();
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreFromHistory();
    }
  }

  restoreFromHistory() {
    if (this.historyIndex >= 0 && this.historyIndex < this.history.length) {
      const state = this.history[this.historyIndex];
      this.shapes = state.map(data => this.deserializeShape(data));
      this.selectedShape = null;
    }
  }

  deserializeShape(data) {
    switch (data.type) {
      case 'trendline':
        return TrendLine.deserialize(data);
      case 'horizontal':
        return HorizontalLine.deserialize(data);
      case 'rectangle':
        return Rectangle.deserialize(data);
      case 'fibonacci':
        return FibonacciRetracement.deserialize(data);
      default:
        console.warn('Unknown shape type:', data.type);
        return null;
    }
  }

  // Persistencia
  getShapes() {
    return this.shapes.map(shape => shape.serialize());
  }

  loadShapes(shapesData) {
    this.shapes = shapesData
      .map(data => this.deserializeShape(data))
      .filter(shape => shape !== null);

    // Inicializar history con estado cargado
    this.history = [this.shapes.map(s => s.serialize())];
    this.historyIndex = 0;
  }

  // Renderizado
  render(ctx, scaleConverter) {
    if (!scaleConverter) return;

    // Renderizar todos los shapes (excepto el que se está dibujando)
    this.shapes.forEach(shape => {
      const isSelected = shape === this.selectedShape;
      const isHovered = shape === this.hoveredShape;
      shape.render(ctx, scaleConverter, isSelected, isHovered);
    });

    // Renderizar shape en progreso
    if (this.drawingInProgress) {
      this.drawingInProgress.render(ctx, scaleConverter, false, false, true);
    }
  }
}

export default DrawingToolManager;
