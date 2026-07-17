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
                    orderId: order.orderId,
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

        // Check selling
        for (const p of state.positions) {
            if (p.status === 'PENDING_BUY') {
                const order = await this.market.getOrder(p.orderId);
                if (!order || order.status !== 'OPEN') continue;
                p.status = 'PENDING_SELL';
            }

            if (p.status === 'PENDING_SELL') {
                const order = await this.market.getOrder(p.orderId);

                // Selling conditions
                if (!order || order.status === 'OPEN') continue;

                if ((p.token === 'UP' ? prices.upToken : prices.downToken) >= p.targetSellPrice) {
                    // Make sell
                    const sellOrder = await this.market.placeLimitSell(
                        p.token === 'UP' ? marketInfo.upTokenId : marketInfo.downTokenId,
                        p.targetSellPrice,
                        p.amount / p.buyPrice
                    );
                    if (!sellOrder) continue;

                    p.sellOrderId = sellOrder.orderId;
                    p.status = 'CLOSED';
                    state.investedAmount -= BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;

                    this.logger.log(LogType.TRADE, `[STRATEGY] Sold ${p.token} at ${(p.token === 'UP' ? prices.upToken : prices.downToken)}`);
                }
            }
        }
    }

    private async checkStrategyApplicable(buyPrice: number, marketInfo: MarketInfo, prices: MarketData): Promise<Token | null> {
        if (Math.abs(prices.upToken - buyPrice) < 0.01) return 'UP';
        if (Math.abs(prices.downToken - buyPrice) < 0.01) return 'DOWN';
        return null;
    }

    private checkOutOfBounds(state: BotState, prices: MarketData): boolean {
        const isOutOfBoundsToken =
            prices.upToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ? 'UP' :
                prices.downToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ? 'DOWN' : null;

        if (!state.inBounds && isOutOfBoundsToken) {
            state.inBounds = true;
            state.outOfBoundsCountThisPeriod++;
            this.logger.log(LogType.WARNING, `[STRATEGY] Token is out of bounds: ${isOutOfBoundsToken}`);
            return true;
        };

        if (state.inBounds && !isOutOfBoundsToken) {
            state.inBounds = false;
        }

        return false;
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
        state.inBounds = false;
        state.btcInfo.initialPrice = btcPrice;
        state.btcInfo.initialPriceTimestamp = Date.now();
    }
}