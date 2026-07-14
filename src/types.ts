export type Token = 'UP' | 'DOWN';
export enum LogType {
    INFO = 'INFO',
    ERROR = 'ERROR',
    DEBUG = 'DEBUG',
    TRADE = 'TRADE',
    CRITICAL = 'CRITICAL',
    WARNING = 'WARNING',
    TRACE = 'TRACE',
}

export type BTCInfo = {
    initialPrice: number;
    initialPriceTimestamp: number;
}

export interface Position {
    orderId: string;
    token: Token;
    buyPrice: number;
    amount: number;
    targetSellPrice: number;
    timestamp: number;
    sellOrderId?: string;
    status: 'PENDING_BUY' | 'BUY_FILLED' | 'PENDING_SELL' | 'CLOSED';
}

export interface MarketData {
    upToken: number;
    downToken: number;
    timestamp: number;
}

// This allows us to have different strategies with different parameters.
export interface Strategy {
    id: string;
    buyPrice: number;
    sellPrice: number;
    minTimeLeft: number; // Minimum seconds left on the period to consider this strategy
    activePositionId?: string;
    usedOnce?: boolean;
}

export interface BotState {
    periodId: string;
    periodStartTime: number;
    investedAmount: number;
    totalInvestedThisPeriod: number;
    outOfBoundsCountThisPeriod: number;
    strategies: Strategy[];
    btcInfo: BTCInfo;
    positions: Position[];
    lastMinuteData: MarketData[];
    last5MinutesData: MarketData[]; // For now does nothing. Will be used for future strategies.
    last10MinutesData: MarketData[]; // For now does nothing. Will be used for future strategies.
}

export interface Trade {
    token: Token;
    buyPrice: number;
    sellPrice: number;
    amount: number;
    buyTime: number;
    sellTime: number;
}

export interface TradeResult {
    token: Token;
    profit: number;
    win: boolean;
}