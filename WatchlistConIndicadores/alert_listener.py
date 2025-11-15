"""
Alert Listener Service

Listens for rejection pattern alerts on port 5000 and displays them.
Can be extended to send notifications via Telegram, email, etc.

Author: Claude Code
Date: 2025-11-11
Usage: python alert_listener.py
"""

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
import uvicorn
from datetime import datetime
from typing import List, Dict
import json

app = FastAPI(title="Alert Listener Service", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Store recent alerts in memory
recent_alerts: List[Dict] = []
MAX_ALERTS = 100


@app.get("/")
async def root():
    """Serve a simple HTML dashboard"""
    return HTMLResponse(content=get_dashboard_html())


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "Alert Listener",
        "port": 5000,
        "timestamp": datetime.now().isoformat()
    }


@app.post("/api/alerts")
async def receive_alert(request: Request):
    """
    Receive an alert from the trading backend

    Expected format:
    {
      "type": "REJECTION_PATTERN_ALERT",
      "timestamp": 1699123456000,
      "symbol": "BTCUSDT",
      "interval": "4h",
      "severity": "HIGH",
      "title": "🔨 BTCUSDT | 4h - Hammer",
      "description": "...",
      "data": { ... }
    }
    """
    try:
        alert = await request.json()

        # Add received timestamp
        alert['receivedAt'] = datetime.now().isoformat()

        # Add to recent alerts
        recent_alerts.insert(0, alert)

        # Keep only last MAX_ALERTS
        if len(recent_alerts) > MAX_ALERTS:
            recent_alerts.pop()

        # Log to console
        print(f"\n{'='*60}")
        print(f"🔔 NEW ALERT RECEIVED")
        print(f"{'='*60}")
        print(f"Time: {alert.get('formattedTime', alert.get('receivedAt'))}")
        print(f"Title: {alert.get('title', 'No title')}")
        print(f"Severity: {alert.get('severity', 'UNKNOWN')}")
        print(f"\n{alert.get('description', '')}")
        print(f"{'='*60}\n")

        return {
            "success": True,
            "message": "Alert received successfully",
            "alertId": alert.get('timestamp')
        }

    except Exception as e:
        print(f"❌ Error processing alert: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/alerts")
async def get_recent_alerts():
    """Get list of recent alerts"""
    return {
        "success": True,
        "alerts": recent_alerts,
        "count": len(recent_alerts)
    }


@app.post("/api/alerts/clear")
async def clear_alerts():
    """Clear all stored alerts"""
    global recent_alerts
    count = len(recent_alerts)
    recent_alerts = []
    return {
        "success": True,
        "message": f"Cleared {count} alerts"
    }


def get_dashboard_html():
    """Generate HTML dashboard for viewing alerts"""
    return """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Alert Listener Dashboard</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: #1e1e1e;
            color: #fff;
            padding: 20px;
        }
        .header {
            margin-bottom: 30px;
            padding: 20px;
            background: #252525;
            border-radius: 8px;
            border: 1px solid #333;
        }
        .header h1 {
            font-size: 24px;
            margin-bottom: 10px;
        }
        .header .status {
            color: #4CAF50;
            font-size: 14px;
        }
        .controls {
            margin-bottom: 20px;
            display: flex;
            gap: 10px;
        }
        .btn {
            padding: 10px 20px;
            background: #333;
            border: 1px solid #555;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .btn:hover {
            background: #444;
        }
        .btn.danger {
            background: #f44336;
            border-color: #f44336;
        }
        .btn.danger:hover {
            background: #d32f2f;
        }
        .alerts-container {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        .alert-card {
            background: #252525;
            border: 1px solid #333;
            border-radius: 8px;
            padding: 16px;
            transition: all 0.2s;
        }
        .alert-card:hover {
            border-color: #4a9eff;
            box-shadow: 0 0 10px rgba(74, 158, 255, 0.2);
        }
        .alert-card.HIGH {
            border-left: 4px solid #f44336;
        }
        .alert-card.MEDIUM {
            border-left: 4px solid #ff9800;
        }
        .alert-card.LOW {
            border-left: 4px solid #4CAF50;
        }
        .alert-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 12px;
        }
        .alert-title {
            font-size: 16px;
            font-weight: 500;
            color: #4a9eff;
        }
        .alert-time {
            color: #888;
            font-size: 12px;
        }
        .alert-description {
            color: #ccc;
            font-size: 14px;
            line-height: 1.6;
            white-space: pre-wrap;
            margin-bottom: 12px;
        }
        .alert-meta {
            display: flex;
            gap: 15px;
            font-size: 12px;
            color: #888;
        }
        .no-alerts {
            text-align: center;
            padding: 40px;
            color: #666;
        }
        .badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
        }
        .badge.HIGH {
            background: rgba(244, 67, 54, 0.2);
            color: #f44336;
        }
        .badge.MEDIUM {
            background: rgba(255, 152, 0, 0.2);
            color: #ff9800;
        }
        .badge.LOW {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🔔 Alert Listener Dashboard</h1>
        <div class="status">✅ Service is running on port 5000</div>
    </div>

    <div class="controls">
        <button class="btn" onclick="refreshAlerts()">🔄 Refresh</button>
        <button class="btn danger" onclick="clearAlerts()">🗑️ Clear All</button>
        <span style="margin-left: auto; color: #888; align-self: center;">
            <span id="alert-count">0</span> alerts
        </span>
    </div>

    <div class="alerts-container" id="alerts-container">
        <div class="no-alerts">No alerts yet. Waiting for notifications...</div>
    </div>

    <script>
        let autoRefresh = true;

        async function refreshAlerts() {
            try {
                const response = await fetch('/api/alerts');
                const data = await response.json();

                if (data.success) {
                    renderAlerts(data.alerts);
                    document.getElementById('alert-count').textContent = data.count;
                }
            } catch (error) {
                console.error('Error fetching alerts:', error);
            }
        }

        function renderAlerts(alerts) {
            const container = document.getElementById('alerts-container');

            if (alerts.length === 0) {
                container.innerHTML = '<div class="no-alerts">No alerts yet. Waiting for notifications...</div>';
                return;
            }

            container.innerHTML = alerts.map(alert => {
                const time = new Date(alert.receivedAt).toLocaleString();
                const severity = alert.severity || 'LOW';

                return `
                    <div class="alert-card ${severity}">
                        <div class="alert-header">
                            <div class="alert-title">${alert.title || 'Alert'}</div>
                            <div class="alert-time">${time}</div>
                        </div>
                        <div class="alert-description">${alert.description || 'No description'}</div>
                        <div class="alert-meta">
                            <span class="badge ${severity}">${severity}</span>
                            <span>${alert.symbol || 'Unknown'}</span>
                            <span>${alert.interval || 'Unknown'}</span>
                            ${alert.data && alert.data.confidence ?
                                `<span>Confidence: ${alert.data.confidence.toFixed(1)}%</span>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

        async function clearAlerts() {
            if (!confirm('Are you sure you want to clear all alerts?')) {
                return;
            }

            try {
                const response = await fetch('/api/alerts/clear', { method: 'POST' });
                const data = await response.json();

                if (data.success) {
                    refreshAlerts();
                }
            } catch (error) {
                console.error('Error clearing alerts:', error);
            }
        }

        // Auto-refresh every 5 seconds
        setInterval(() => {
            if (autoRefresh) {
                refreshAlerts();
            }
        }, 5000);

        // Initial load
        refreshAlerts();

        // Listen for visibility changes to pause auto-refresh
        document.addEventListener('visibilitychange', () => {
            autoRefresh = !document.hidden;
        });
    </script>
</body>
</html>
    """


if __name__ == "__main__":
    print("🚀 Starting Alert Listener Service on port 5000...")
    print("📡 Dashboard: http://localhost:5000")
    print("💡 Press Ctrl+C to stop\n")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5000,
        log_level="info"
    )
