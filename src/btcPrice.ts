import WebSocket from 'ws';
import { Logger } from './logger.js';
import { LogType } from './types.js';

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws/btcusdt@miniTicker';
const RECONNECT_DELAY_MS = 3000;

export class BtcPriceService {
    private currentPrice: number = 0;
    private ws: WebSocket | null = null;
    private isConnected: boolean = false;
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private readonly logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Opens the WebSocket connection to Binance and sets up event handlers.
     * Safe to call multiple times - cleans up any existing connection first.
    */
    public connect(): void {
        // Clean up any existing connection before opening a new one
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
        }

        void this.logger.log(LogType.INFO, `[BTC] Connecting to Binance WebSocket...`);
        this.ws = new WebSocket(BINANCE_WS_URL);

        this.ws.on('open', () => {
            this.isConnected = true;
            void this.logger.log(LogType.INFO, '[BTC] Connected to Binance WebSocket.');
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const parsed = JSON.parse(data.toString()) as { c: string };
                const price = parseFloat(parsed.c);
                if (!isNaN(price) && price > 0) {
                    this.currentPrice = price;
                }
            } catch (err) {
                void this.logger.log(LogType.ERROR, `[BTC] Failed to parse message: ${err}`);
            }
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            this.isConnected = false;
            void this.logger.log(
                LogType.WARNING,
                `[BTC] WebSocket closed (code=${code}, reason=${reason.toString() || 'none'}). Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`
            );
            this.scheduleReconnect();
        });

        this.ws.on('error', (err: Error) => {
            // Log the error; the 'close' event will fire immediately after and handle reconnect
            void this.logger.log(LogType.ERROR, `[BTC] WebSocket error: ${err.message}`);
        });
    }

    // Returns the latest BTC/USDT price received from Binance. 0 if no price has been received yet.
    public getCurrentPrice(): number {
        return this.currentPrice;
    }

    // Returns true once the first price has been received and the connection is live.
    public isReady(): boolean {
        return this.isConnected && this.currentPrice > 0;
    }

    // Gracefully closes the WebSocket and cancels any pending reconnect. Call this when shutting down the bot.
    public disconnect(): void {
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.terminate();
            this.ws = null;
        }
        this.isConnected = false;
        void this.logger.log(LogType.INFO, '[BTC] WebSocket disconnected cleanly.');
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimeout) return; // already scheduled
        this.reconnectTimeout = setTimeout(() => {
            this.reconnectTimeout = null;
            this.connect();
        }, RECONNECT_DELAY_MS);
    }
}
