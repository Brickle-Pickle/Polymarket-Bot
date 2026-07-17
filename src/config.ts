export const BASIC_BOT_CONFIG = {
    STRATEGIES: [
        {
            id: 'largeSell',
            buyPrice: 0.2,
            sellPrice: 0.6,
            minTimeLeft: 120, // Minimum seconds left on the period to consider this strategy
            afterStrategyUsedId: 'largeSell',
        },
        {
            id: 'mid',
            buyPrice: 0.3,
            sellPrice: 0.7,
            minTimeLeft: 240,
            usedOnce: false,
        },
        {
            id: 'short',
            buyPrice: 0.1,
            sellPrice: 0.2,
            minTimeLeft: 60,
            usedOnce: false,
        },
        {
            id: 'short2',
            buyPrice: 0.1,
            sellPrice: 0.16,
            minTimeLeft: 60,
            usedOnce: false,
            afterStrategyUsedId: 'short',
        }
    ],

    // API configuration
    BASE_URL: 'https://clob.polymarket.com',

    // Investment configuration
    MAX_INVESTED_PER_15_MINS: 3, // Max $ for each 15 min period
    MAX_INVESTED_SIMULTANEOUSLY: 2, // Max $ invested at the same time
    INVESTMENT_PER_TRADE: 1,
    GENERAL_MIN_TIME_TO_TRADE: 60, // Minimum time for all strategies to trade

    // Out of bounds configuration
    PERIOD_OUT_OF_BOUNDS: 0.08, // If market price is below this value don't buy more in this period
    MAXIMUM_ALLOWED_OUT_OF_BOUNDS_PERIODS: 2, // Maximum allowed periods out of bounds

    // BTC price configuration
    MAXIMUM_ALLOWED_DIFF_BTC_PRICE: 100, // Maximum allowed difference between btc initial price and current market price (absolute value)

    // Performance configuration
    TIME_BETWEEN_REQUESTS: 1000, // Time in milliseconds between requests to the market
} as const;