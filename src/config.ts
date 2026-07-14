export const BASIC_BOT_CONFIG = {
    STRATEGIES: [
        {
            id: 'largeSell',
            buyPrice: 0.2,
            sellPrice: 0.6,
            minTimeLeft: 120, // Minimum seconds left on the period to consider this strategy
        },
        {
            id: 'short',
            buyPrice: 0.1,
            sellPrice: 0.2,
            minTimeLeft: 60,
        },
        {
            id: 'short2',
            buyPrice: 0.1,
            sellPrice: 0.15,
            minTimeLeft: 60,
        }
    ],

    // API configuration
    BASE_URL: 'https://clob.polymarket.com',

    // Investment configuration
    MAX_INVESTED_PER_15_MINS: 3, // Max $ for each 15 min period
    MAX_INVESTED_SIMULTANEOUSLY: 2, // Max $ invested at the same time
    INVESTMENT_PER_TRADE: 1,

    // Out of bounds configuration
    PERIOD_OUT_OF_BOUNDS: 0.08, // If market price is below this value don't buy more in this period
    MAXIMUM_ALLOWED_OUT_OF_BOUNDS_PERIODS: 2, // Maximum allowed periods out of bounds

    // BTC price configuration
    MAXIMUM_ALLOWED_DIFF_BTC_PRICE: 300, // Maximum allowed difference between btc initial price and current market price (absolute value)

    // Performance configuration
    TIME_BETWEEN_REQUESTS: 1000, // Time in milliseconds between requests to the market
} as const;