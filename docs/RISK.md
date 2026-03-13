# Risk Disclosure

## IMPORTANT: Live Trading is DISABLED

This is a **V1 paper trading** system. No real orders are placed on any exchange.
No real money is at risk.

## Risks of Prediction Market Arbitrage

### Execution Risk
- **Legging risk**: One leg fills, the other doesn't — you're left with directional exposure
- **Latency**: Price can move between identifying an opportunity and execution
- **Partial fills**: Insufficient liquidity to fill the full intended size
- **Slippage**: Actual fill prices worse than quoted orderbook prices

### Market Risk
- **Resolution ambiguity**: Markets may resolve differently across venues for the "same" event
- **Market manipulation**: Thin orderbooks can be spoofed
- **Correlation risk**: Markets that appear identical may have subtle differences in resolution criteria

### Platform Risk
- **API rate limits**: Excessive polling may result in temporary bans
- **API downtime**: Venues may go offline without notice
- **Settlement delays**: Funds may be locked for extended periods after resolution
- **Regulatory risk**: Prediction market regulations vary by jurisdiction

### Technical Risk
- **Data staleness**: Orderbook snapshots may be outdated by the time of execution
- **Matching errors**: Manual market mapping may incorrectly pair non-equivalent markets
- **Software bugs**: The arb detection algorithm may have edge cases

## Before Enabling Live Trading (V2+)

1. Extensive paper trading validation with statistical analysis
2. Implement circuit breakers and position limits
3. Add real-time monitoring and alerting
4. Review and audit all matching mappings
5. Start with minimal size and scale gradually
6. Consult legal counsel regarding prediction market regulations in your jurisdiction
7. Never risk more than you can afford to lose
