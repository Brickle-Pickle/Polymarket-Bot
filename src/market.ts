import { ClobClient, type ApiKeyCreds, type OpenOrder, type UserOrder, type OrderBookSummary, Side, OrderType, Chain } from '@polymarket/clob-client';
import { createWalletClient, http, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { polygon } from 'viem/chains';
import { Logger } from './logger.js';
import { LogType } from './types.js';
import type { Token, MarketData } from './types.js';

// Types specific to the Gamma API (market discovery)

interface GammaMarket {
    condition_id: string;
    question: string;
    slug: string;
    outcomes: string; // JSON string: '["Up", "Down"]'
    clobTokenIds: string; // JSON string: '["token1", "token2"]'
    outcomePrices: string; // JSON string: '["0.035", "0.965"]'
    endDate: string; // ISO date string
    active: boolean;
    closed: boolean;
    acceptingOrders: boolean;
    negRisk: boolean;
    orderPriceMinTickSize: number;
    orderMinSize: number;
}

// The market info we care about once resolved

export interface MarketInfo {
    conditionId: string;
    upTokenId: string;
    downTokenId: string;
    slug: string;
    endDate: Date;
}

// MarketService — wraps all Polymarket interaction

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

export class MarketService {
    private client: ClobClient | null = null;
    private readonly logger: Logger;
    private readonly host: string;
    private readonly chainId: Chain;
    private walletClient: WalletClient | null = null;

    constructor(logger: Logger) {
        this.logger = logger;
        this.host = process.env['CLOB_API_URL'] ?? 'https://clob.polymarket.com';
        const envChainId = process.env['CHAIN_ID'];
        this.chainId = envChainId === '80002' ? Chain.AMOY : Chain.POLYGON;
    }

    // create wallet + derive API creds + build ClobClient
    public async initialize(): Promise<void> {
        const privateKey = process.env['PRIVATE_KEY'];
        if (!privateKey) {
            throw new Error('PRIVATE_KEY not set in .env');
        }

        // 1. Create a viem WalletClient from the private key
        const account = privateKeyToAccount(privateKey as `0x${string}`);
        this.walletClient = createWalletClient({
            account,
            chain: polygon,
            transport: http(),
        });

        await this.logger.log(LogType.INFO, `[MARKET] Wallet address: ${account.address}`);

        // 2. Create an unauthenticated ClobClient to derive API creds
        const tempClient = new ClobClient(
            this.host,
            this.chainId,
            this.walletClient, // signer
            undefined, // creds — not yet
        );

        await this.logger.log(LogType.INFO, '[MARKET] Deriving API credentials...');
        const creds: ApiKeyCreds = await tempClient.createOrDeriveApiKey();
        await this.logger.log(LogType.INFO, '[MARKET] API credentials obtained.');

        // 3. Build the fully authenticated client
        this.client = new ClobClient(
            this.host,
            this.chainId,
            this.walletClient,
            creds,
        );

        // 4. Verify connectivity
        const ok = await this.client.getOk();
        await this.logger.log(LogType.INFO, `[MARKET] Connected to CLOB API — ${JSON.stringify(ok)}`);
    }

    // Finds the active "BTC UP DOWN 15min" market from the Gamma API.
    public async findCurrentBtcMarket(): Promise<MarketInfo | null> {
        // Calculate the current 15-minute window start timestamp
        const now = Math.floor(Date.now() / 1000);
        const windowStart = Math.floor(now / 900) * 900;
        const slug = `btc-updown-15m-${windowStart}`;

        await this.logger.log(LogType.INFO, `[MARKET] Looking for market slug: ${slug}`);

        try {
            const response = await fetch(`${GAMMA_API_URL}/markets?slug=${slug}`);
            const markets: GammaMarket[] = await response.json() as GammaMarket[];

            if (!markets || markets.length === 0) {
                // Try the next window — the current one might not exist yet
                const nextSlug = `btc-updown-15m-${windowStart + 900}`;
                await this.logger.log(LogType.INFO, `[MARKET] Current window not found, trying next: ${nextSlug}`);

                const nextResponse = await fetch(`${GAMMA_API_URL}/markets?slug=${nextSlug}`);
                const nextMarkets: GammaMarket[] = await nextResponse.json() as GammaMarket[];

                if (!nextMarkets || nextMarkets.length === 0) {
                    await this.logger.log(LogType.WARNING, '[MARKET] No BTC UP/DOWN 15min market found.');
                    return null;
                }

                return this.parseGammaMarket(nextMarkets[0]!);
            }

            return this.parseGammaMarket(markets[0]!);
        } catch (error) {
            await this.logger.log(LogType.ERROR, `[MARKET] Failed to fetch market from Gamma API: ${error}`);
            return null;
        }
    }

    private parseGammaMarket(market: GammaMarket): MarketInfo {
        // outcomes and clobTokenIds are JSON strings — parse them
        const outcomes: string[] = JSON.parse(market.outcomes);
        const tokenIds: string[] = JSON.parse(market.clobTokenIds);

        // Match each outcome to its tokenId by index
        const upIdx = outcomes.findIndex(o => o.toLowerCase() === 'up');
        const downIdx = outcomes.findIndex(o => o.toLowerCase() === 'down');

        if (upIdx === -1 || downIdx === -1 || !tokenIds[upIdx] || !tokenIds[downIdx]) {
            throw new Error(`[MARKET] Could not find UP/DOWN tokens. outcomes=${market.outcomes}, tokenIds=${market.clobTokenIds}`);
        }

        return {
            conditionId: market.condition_id,
            upTokenId: tokenIds[upIdx],
            downTokenId: tokenIds[downIdx],
            slug: market.slug,
            endDate: new Date(market.endDate),
        };
    }

    // Gets the current prices for both UP and DOWN tokens from the order book.
    // Returns the last trade price / midpoint for each.
    public async getMarketPrices(marketInfo: MarketInfo): Promise<MarketData> {
        this.ensureClient();

        const [upBook, downBook] = await this.client!.getOrderBooks([
            { token_id: marketInfo.upTokenId, side: Side.BUY },
            { token_id: marketInfo.downTokenId, side: Side.BUY },
        ]);

        return {
            upToken: parseFloat(upBook?.last_trade_price ?? '0'),
            downToken: parseFloat(downBook?.last_trade_price ?? '0'),
            timestamp: Date.now(),
        };
    }

    // Gets the full order book for a specific token.
    public async getOrderBook(tokenId: string): Promise<OrderBookSummary> {
        this.ensureClient();
        return this.client!.getOrderBook(tokenId);
    }

    /**
     * Places a GTC limit buy order for a specific token.
     *
     * @param tokenId - The token ID (UP or DOWN) to buy
     * @param price - The price per share (e.g. 0.20 means 20 cents)
     * @param amount - The dollar amount to spend (e.g. 1 = $1 worth)
     * @returns The order response including orderId
     */
    public async placeLimitBuy(tokenId: string, price: number, amount: number): Promise<any> {
        this.ensureClient();

        // size = how many shares you get for your dollar amount at this price
        // e.g. $1 at $0.20/share = 5 shares
        const size = amount / price;

        const userOrder: UserOrder = {
            tokenID: tokenId,
            price,
            size,
            side: Side.BUY,
        };

        await this.logger.log(LogType.INFO,
            `[MARKET] Placing limit BUY: tokenId=${tokenId.slice(0, 10)}... price=${price} size=${size.toFixed(2)} ($${amount})`
        );

        const response = await this.client!.createAndPostOrder(userOrder, undefined, OrderType.GTC);

        await this.logger.log(LogType.INFO, `[MARKET] Buy order placed: ${JSON.stringify(response)}`);
        return response;
    }

    /**
     * Places a GTC limit sell order for a specific token.
     *
     * @param tokenId - The token ID (UP or DOWN) to sell
     * @param price - The price per share to sell at (e.g. 0.60)
     * @param size - The number of shares to sell
     * @returns The order response including orderId
     */
    public async placeLimitSell(tokenId: string, price: number, size: number): Promise<any> {
        this.ensureClient();

        const userOrder: UserOrder = {
            tokenID: tokenId,
            price,
            size,
            side: Side.SELL,
        };

        await this.logger.log(LogType.INFO,
            `[MARKET] Placing limit SELL: tokenId=${tokenId.slice(0, 10)}... price=${price} size=${size.toFixed(2)}`
        );

        const response = await this.client!.createAndPostOrder(userOrder, undefined, OrderType.GTC);

        await this.logger.log(LogType.INFO, `[MARKET] Sell order placed: ${JSON.stringify(response)}`);
        return response;
    }

    // Gets the current status of a specific order.
    public async getOrder(orderId: string): Promise<OpenOrder> {
        this.ensureClient();
        return this.client!.getOrder(orderId);
    }

    // Gets all open orders, optionally filtered by market or asset.
    public async getOpenOrders(marketConditionId?: string): Promise<OpenOrder[]> {
        this.ensureClient();
        const params = marketConditionId ? { market: marketConditionId } : undefined;
        return this.client!.getOpenOrders(params);
    }

    // Cancels a specific order by ID.
    public async cancelOrder(orderId: string): Promise<any> {
        this.ensureClient();
        await this.logger.log(LogType.INFO, `[MARKET] Cancelling order: ${orderId}`);
        return this.client!.cancelOrder({ orderID: orderId });
    }

    // Cancels all open orders.
    public async cancelAllOrders(): Promise<any> {
        this.ensureClient();
        await this.logger.log(LogType.WARNING, '[MARKET] Cancelling ALL open orders.');
        return this.client!.cancelAll();
    }

    /**
     * Resolves which token (UP or DOWN) to buy given a target price.
     * Returns the tokenId whose price is closest to the target.
     */
    public resolveToken(prices: MarketData, targetPrice: number): { tokenId: string; token: Token; price: number } | null {
        // This will be called with actual market info, so we need to know tokenIds
        // The caller should pass them separately. This is a convenience for the strategy layer.
        return null; // Implemented in strategy.ts using MarketInfo
    }

    // Returns the number of seconds remaining until the market's end date.
    public getSecondsRemaining(marketInfo: MarketInfo): number {
        return Math.max(0, Math.floor((marketInfo.endDate.getTime() - Date.now()) / 1000));
    }

    private ensureClient(): void {
        if (!this.client) {
            throw new Error('[MARKET] ClobClient not initialized. Call initialize() first.');
        }
    }
}
