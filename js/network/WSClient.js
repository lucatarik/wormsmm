/**
 * WebSocket client for multiplayer communication.
 * Handles connection, message routing, and reconnection.
 */
export class WSClient {
  /**
   * @param {string} serverUrl - WebSocket server URL (ws:// or wss://)
   */
  constructor(serverUrl) {
    this.url = serverUrl;
    this.ws = null;
    this.handlers = {};
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this._reconnectTimer = null;
  }

  /**
   * Connect to the WebSocket server.
   * @returns {Promise<WSClient>} Resolves when connected
   */
  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        const timeout = setTimeout(() => {
          if (this.ws.readyState !== WebSocket.OPEN) {
            this.ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

        this.ws.onopen = () => {
          clearTimeout(timeout);
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('[WSClient] Connected to', this.url);
          resolve(this);
        };

        this.ws.onerror = (err) => {
          clearTimeout(timeout);
          this.connected = false;
          console.error('[WSClient] Error:', err);
          reject(err);
        };

        this.ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (this.handlers[msg.type]) {
              this.handlers[msg.type](msg);
            } else if (this.handlers['*']) {
              this.handlers['*'](msg);
            }
          } catch (parseErr) {
            console.warn('[WSClient] Failed to parse message:', e.data, parseErr);
          }
        };

        this.ws.onclose = (event) => {
          this.connected = false;
          console.log('[WSClient] Disconnected. Code:', event.code, 'Reason:', event.reason);
          if (this.handlers['disconnect']) {
            this.handlers['disconnect']({ code: event.code, reason: event.reason });
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Register a message handler for a given message type.
   * @param {string} type - Message type or '*' for all
   * @param {function} fn - Handler function
   */
  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }

  /**
   * Remove a handler for a given type.
   * @param {string} type
   */
  off(type) {
    delete this.handlers[type];
    return this;
  }

  /**
   * Send a message to the server.
   * @param {object} msg - Message object (will be JSON stringified)
   * @returns {boolean} True if sent successfully
   */
  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    console.warn('[WSClient] Cannot send: not connected. Message:', msg);
    return false;
  }

  /**
   * Close the WebSocket connection.
   */
  disconnect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.connected = false;
  }

  /**
   * Check if the connection is active.
   * @returns {boolean}
   */
  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
