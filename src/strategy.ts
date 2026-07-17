import type { Logger } from "./logger.js";
import { MarketService, type MarketInfo } from "./market.js";
import type { BotState, MarketData, Token } from "./types.js";
import { createInitialState } from "./state.js";
import { BASIC_BOT_CONFIG } from "./config.js";
import { abstract } from "viem/chains";

export class StrategyEngine {
    constructor(
        private readonly logger: Logger,
        private readonly market: MarketService,
    ) { }

    public async tick(state: BotState, marketInfo: MarketInfo, btcPrice: number): Promise<void> {
        // If new period reset BotState
        if (marketInfo.conditionId !== state.periodId) return this.resetBotState(state, marketInfo.conditionId, btcPrice);

        // General can buy conditions
        if (
            this.market.getSecondsRemaining(marketInfo) < BASIC_BOT_CONFIG.GENERAL_MIN_TIME_TO_TRADE ||
            state.outOfBoundsCountThisPeriod > BASIC_BOT_CONFIG.MAXIMUM_ALLOWED_OUT_OF_BOUNDS_PERIODS ||
            Math.abs(state.btcInfo.initialPrice - btcPrice) > BASIC_BOT_CONFIG.MAXIMUM_ALLOWED_DIFF_BTC_PRICE ||
            state.totalInvestedThisPeriod >= BASIC_BOT_CONFIG.MAX_INVESTED_PER_15_MINS ||
            state.investedAmount >= BASIC_BOT_CONFIG.MAX_INVESTED_SIMULTANEOUSLY ||
            state.lastMinuteData.filter(
                m => m.upToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS ||
                    m.downToken < BASIC_BOT_CONFIG.PERIOD_OUT_OF_BOUNDS
            ).length > 0
        ) return;

        // Check buying for each strategy
        state.strategies.forEach(async strategy => {
            // Check if strategy meets conditions to buy
            if (
                strategy.usedOnce ||
                this.market.getSecondsRemaining(marketInfo) <= strategy.minTimeLeft
            ) return;

            // Check if strategy is applicable to current price action
            const token = await this.checkStrategyApplicable(strategy.buyPrice, marketInfo);
            if (!token) return;

            // Buy tokens (tokenId, price, amount)
            const order = await this.market.placeLimitBuy(
                token === 'UP' ? marketInfo.upTokenId : marketInfo.downTokenId,
                strategy.buyPrice,
                BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE
            );

            if (!order) return;

            // Save position
            state.positions.push({
                orderId: order.orderId,
                token: token,
                buyPrice: strategy.buyPrice,
                amount: BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE,
                targetSellPrice: strategy.sellPrice,
                timestamp: Date.now(),
                status: 'PENDING_BUY',
            });

            // TODO: implement placing the sell order.
            // TODO: implement handling the case where the sell order is not filled.
            // TODO: Review this code.
            state.totalInvestedThisPeriod += BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;
            state.investedAmount += BASIC_BOT_CONFIG.INVESTMENT_PER_TRADE;
            strategy.usedOnce = true;
        });
    }

    public updatePriceHistory(state: BotState, prices: MarketData): void { }

    private async checkStrategyApplicable(buyPrice: number, marketInfo: MarketInfo): Promise<Token | null> {
        const prices = await this.market.getMarketPrices(marketInfo);
        if (buyPrice == Math.round(prices?.upToken ?? 0)) return 'UP';
        if (buyPrice == Math.round(prices?.downToken ?? 0)) return 'DOWN';
        return null;
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
        state.btcInfo.initialPrice = btcPrice;
        state.btcInfo.initialPriceTimestamp = Date.now();
    }
}