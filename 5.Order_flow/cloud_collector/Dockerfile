# Dockerfile para Cloud Footprint Collector
# Optimizado para Northflank

FROM python:3.11-slim

# Variables de entorno
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV DATA_DIR=/data
# Menos memoria retenida por glibc entre hilos (13/11/2026): el servicio tiene 512 MB y escribe en hilos
ENV MALLOC_ARENA_MAX=2

# Crear directorio de datos
RUN mkdir -p /data

# Directorio de trabajo
WORKDIR /app

# Copiar requirements primero (para cache de Docker)
COPY requirements.txt .

# Instalar dependencias
RUN pip install --no-cache-dir -r requirements.txt

# Copiar codigo
COPY main.py .
COPY footprint_collector.py .
COPY tape_format.py .
COPY tape_recorder.py .
COPY book_recorder.py .
COPY book_store.py .

# Puerto (Northflank usa variable PORT)
ENV PORT=8000
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Comando de inicio
CMD ["python", "main.py"]
