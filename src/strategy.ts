import type { Logger } from "./logger.js";
import { MarketService, type MarketInfo } from "./market.js";
import { LogType, type BotState, type MarketData, type Token } from "./types.js";
import { BASIC_BOT_CONFIG } from "./config.js";

export class StrategyEngine {
    constructor(
        private readonly logger: Logger,
        private readonly market: MarketService,
    ) { }

    public async tick(state: BotState, marketInfo: MarketInfo, btcPrice: number): Promise<void> {
        const prices = await this.market.getMarketPrices(marketInfo);
        if (!prices) return;
        let canBuy: boolean = true;

        this.updateMinutesData(state, prices);

        // If new period reset BotState
        if (
            state.periodId === '' ||
            marketInfo.conditionId !== state.periodId
        ) this.resetBotState(state, marketInfo.conditionId, btcPrice);

        if (canBuy) canBuy = this.checkOutOfBounds(state, prices);
        else this.checkOutOfBounds(state, prices);

        // General can buy conditions
        if (
            this.market.getSecondsRemaining(marketInfo) < BASIC_BOT_CONFIG.GENERAL_MIN_TIME_TO_TRADE ||
            state.outOfBoundsCountThisPeriod >= BASIC_BOT_CONFIG.MAXIMUM_ALLOWED_OUT_OF_BOUNDS_PERIODS ||
            Math.abs(state.btcInfo.initialPrice - btcPrice) > BASIC_BOT_CONFIG.MAXIMUM_ALLOWED_DIFF_BTC_PRICE ||
            state.totalInvestedThisPeriod >= BASIC_BOT_CONFIG.MAX_INVESTED_PER_15_MINS ||
            state.investedAmount >= BASIC_BOT_CONFIG.MAX_INVESTED_SIMULTANEOUSLY ||
            state.lastMinuteData.filter(
                m => m.upToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ||
                    m.downToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS
            ).length > 0
        ) canBuy = false;

        // Check buying for each strategy
        if (canBuy) {
            for (const strategy of state.strategies) {
                // Check if strategy meets conditions to buy
                if (
                    strategy.usedOnce ||
                    this.market.getSecondsRemaining(marketInfo) <= strategy.minTimeLeft ||
                    (strategy.afterStrategyUsedId && !state.strategies.find(s => s.id === strategy.afterStrategyUsedId)?.usedOnce)
                ) continue;

                // Check if strategy is applicable to current price action
                const token = await this.checkStrategyApplicable(strategy.buyPrice, marketInfo, prices);
                if (!token) continue;

                // Check if it's in use
                if (state.positions.filter(p => p.strategyId === strategy.id).length > 0) continue;

                // Buy tokens (tokenId, price, amount)
                const order = await this.market.placeLimitBuy(
                    token === 'UP' ? marketInfo.upTokenId : marketInfo.downTokenId,
                    strategy.buyPrice,
                    BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE
                );

                if (!order) continue;

                // Save position
                state.positions.push({
                    orderId: order.orderID,
                    token: token,
                    buyPrice: strategy.buyPrice,
                    amount: BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE,
                    targetSellPrice: strategy.sellPrice,
                    timestamp: Date.now(),
                    status: 'PENDING_BUY',
                    strategyId: strategy.id,
                });

                // Update data
                state.totalInvestedThisPeriod += BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;
                state.investedAmount += BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;
                if (strategy.usedOnce !== undefined && !strategy.usedOnce) strategy.usedOnce = true;
                this.logger.log(LogType.TRADE, `[STRATEGY] Bought ${token} at ${strategy.buyPrice}`);
            }
        }

        for (const p of state.positions) {
            // Step 1: PENDING_BUY - waiting for our buy limit order to fill
            if (p.status === 'PENDING_BUY') {
                const order = await this.market.getOrder(p.orderId);
                if (!order) continue;

                if (order.size_matched === order.original_size) {
                    p.status = 'BUY_FILLED';
                    await this.logger.log(LogType.TRADE, `[STRATEGY] Buy FILLED: ${p.token} at ${p.buyPrice}`);
                } else {
                    continue; // still waiting for fill
                }
            }

            // Step 2: BUY_FILLED - we own the shares, wait for price to reach target then place sell order
            if (p.status === 'BUY_FILLED') {
                const currentPrice = p.token === 'UP' ? prices.upToken : prices.downToken;

                if (currentPrice >= p.targetSellPrice) {
                    const sellOrder = await this.market.placeLimitSell(
                        p.token === 'UP' ? marketInfo.upTokenId : marketInfo.downTokenId,
                        p.targetSellPrice,
                        p.amount / p.buyPrice
                    );
                    if (!sellOrder) continue;

                    p.sellOrderId = sellOrder.orderID;
                    p.status = 'PENDING_SELL';
                    await this.logger.log(LogType.TRADE, `[STRATEGY] Sell order placed: ${p.token} at ${p.targetSellPrice}`);
                }
                continue;
            }

            // Step 3: PENDING_SELL - waiting for our sell limit order to fill
            if (p.status === 'PENDING_SELL') {
                if (!p.sellOrderId) continue;

                const sellOrder = await this.market.getOrder(p.sellOrderId);
                if (!sellOrder) continue;

                if (sellOrder.size_matched === sellOrder.original_size) {
                    p.status = 'CLOSED';
                    state.investedAmount -= BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;
                    await this.logger.log(LogType.TRADE, `[STRATEGY] Sell FILLED: ${p.token} — position closed`);
                }
            }
        }
    }

    private async checkStrategyApplicable(buyPrice: number, marketInfo: MarketInfo, prices: MarketData): Promise<Token | null> {
        if (Math.abs(prices.upToken - buyPrice) < 0.01) return 'UP';
        if (Math.abs(prices.downToken - buyPrice) < 0.01) return 'DOWN';
        return null;
    }

    // Returns true if we can buy
    private checkOutOfBounds(state: BotState, prices: MarketData): boolean {
        const isOutOfBoundsToken =
            prices.upToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ? 'UP' :
                prices.downToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ? 'DOWN' : null;

        if (!state.outBounds && isOutOfBoundsToken) {
            state.outBounds = true;
            state.outOfBoundsCountThisPeriod++;
            this.logger.log(LogType.WARNING, `[STRATEGY] Token is out of bounds: ${isOutOfBoundsToken}`);
            return false;
        };

        if (state.outBounds && !isOutOfBoundsToken) {
            state.outBounds = false;
        }

        return true;
    }

    private updateMinutesData(state: BotState, prices: MarketData): void {
        // Update last minutes data
        state.lastMinuteData.push({
            upToken: prices.upToken,
            downToken: prices.downToken,
            timestamp: Date.now(),
        });
        // TODO: repeat for 5 and 10 minutes

        // Remove oldest data if older than x minutes
        state.lastMinuteData = state.lastMinuteData.filter(m => m.timestamp > Date.now() - 1 * 60 * 1000);
        // TODO: repeat for 5 and 10 minutes
    }

    private resetBotState(state: BotState, _id: string, btcPrice: number): void {
        state.periodId = _id;
        state.periodStartTime = Date.now();
        state.investedAmount = 0;
        state.totalInvestedThisPeriod = 0;
        state.outOfBoundsCountThisPeriod = 0;
        state.strategies = BASIC_BOT_CONFIG.STRATEGIES.map(s => ({ ...s }));
        state.positions = [];
        state.lastMinuteData = [];
        state.last5MinutesData = [];
        state.last10MinutesData = [];
        state.outBounds = false;
        state.btcInfo.initialPrice = btcPrice;
        state.btcInfo.initialPriceTimestamp = Date.now();
    }
}