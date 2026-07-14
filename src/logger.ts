import type { Trade, TradeResult, Token } from './types.js';
import { LogType } from './types.js'
import fs from 'node:fs';
import { appendFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class Logger {
    private logFilePath: string;
    private resultsFilePath: string;

    constructor(filename: string = 'trades.log', resultsLogFile: string = 'results.log') {
        const logFolder = path.join(process.cwd(), 'data');
        if (!fs.existsSync(logFolder)) {
            fs.mkdirSync(logFolder);
        }
        this.logFilePath = path.join(process.cwd(), 'data', filename);
        this.resultsFilePath = path.join(process.cwd(), resultsLogFile);
    }

    public async logBuy(token: Token, price: number, amount: number): Promise<void> {
        const message = `${new Date().toISOString()} [BUY] ${token} ${amount} @ ${price}\n`;
        try {
            await appendFile(this.logFilePath, message);
        } catch (error) {
            console.error('Failed to write to log file:', error);
            throw error;
        }
    }

    public async logSell(trade: Trade, result: TradeResult): Promise<void> {
        const message = `${new Date().toISOString()} [SELL] ${trade.token} ${trade.amount} @ ${trade.sellPrice} \n[RESULT] ${result.profit} ${result.win ? 'WIN' : 'LOSE'}\n`;
        try {
            await appendFile(this.logFilePath, message);
        } catch (error) {
            console.error('Failed to write to log file:', error);
            throw error;
        }
    }

    public async updateResults(totalProfit: number, trades: Trade[]): Promise<void> {
        const wins = trades.filter(t => t.sellPrice > t.buyPrice).length;
        const losses = trades.length - wins;
        const profitSign = totalProfit >= 0 ? '+' : '';

        const lines = [
            '--------------------------------------------------',
            `Periodo: ${new Date().toISOString()}`,
            `Operaciones: ${trades.length}`,
            `   - Ganadoras: ${wins}`,
            `   - Perdedoras: ${losses}`,
            `P&L Total: ${profitSign}${totalProfit.toFixed(4)}$`,
            '--------------------------------------------------',
        ];

        try {
            await writeFile(this.resultsFilePath, lines.join('\n'));
        } catch (error) {
            console.error('Failed to write results file:', error);
            throw error;
        }
    }

    public async log(level: LogType, message: string): Promise<void> {
        const logMessage = `${new Date().toISOString()} [${level}] ${message}\n`;
        try {
            await appendFile(this.logFilePath, logMessage);
            console.log(logMessage);
        } catch (error) {
            console.error('Failed to write to log file:', error);
            throw error;
        }
    }
}