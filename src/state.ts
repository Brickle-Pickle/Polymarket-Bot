// Implement logic to persist bot state and load it on startup.
import type { BotState } from './types.js';
import { BASIC_BOT_CONFIG } from './config.js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Logger } from './logger.js';
import { LogType } from './types.js';

export function createInitialState(): BotState {
    return {
        periodId: '',
        periodStartTime: 0,
        investedAmount: 0,
        totalInvestedThisPeriod: 0,
        outOfBoundsCountThisPeriod: 0,
        strategies: BASIC_BOT_CONFIG.STRATEGIES.map(strategy => ({ ...strategy })),
        btcInfo: {
            initialPrice: 0,
            initialPriceTimestamp: 0,
        },
        positions: [],
        lastMinuteData: [],
        last5MinutesData: [],
        last10MinutesData: [],
        outBounds: false,
    };
}

export async function loadState(): Promise<BotState> {
    try {
        const stateString = await readFile(path.join(process.cwd(), 'data', 'state.json'), 'utf8');
        return JSON.parse(stateString);
    } catch (error) {
        if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
            await new Logger().log(LogType.INFO, 'No state file found, starting fresh.');
            return createInitialState();
        }
        await new Logger().log(LogType.ERROR, `Failed to read state file: ${error}`);
        throw error;
    }
}

export function saveState(state: BotState): Promise<void> {
    try {
        const stateString = JSON.stringify(state, null, 2);
        // Use absolute path consistent with loadState
        return writeFile(path.join(process.cwd(), 'data', 'state.json'), stateString);
    } catch (error) {
        new Logger().log(LogType.ERROR, `Failed to write state file: ${error}`);
        throw error;
    }
}