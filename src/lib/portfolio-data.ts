import type {
  PortfolioAccountSnapshot,
  PortfolioOptionLegSnapshot,
  PortfolioOptionStrategySnapshot,
  PortfolioSnapshot,
  PortfolioStockPositionSnapshot
} from "../types";

export interface PortfolioSnapshotImport {
  snapshotDate: string;
  snapshotTime: string;
  broker: string;
  currency: string;
  account: PortfolioAccountSnapshot;
  stocks: PortfolioStockPositionSnapshot[];
  optionStrategies: PortfolioOptionStrategySnapshot[];
  note?: string;
}

const strategyTypes = ["single_call", "single_put", "bull_call_vertical", "bear_call_vertical", "bull_put_vertical", "bear_put_vertical", "covered_call", "cash_secured_put", "custom"] as const;
const strategyLabels: Record<(typeof strategyTypes)[number], string> = {
  single_call: "单腿 Call",
  single_put: "单腿 Put",
  bull_call_vertical: "看涨 Call 价差",
  bear_call_vertical: "看跌 Call 价差",
  bull_put_vertical: "看涨 Put 价差",
  bear_put_vertical: "看跌 Put 价差",
  covered_call: "备兑 Call",
  cash_secured_put: "现金担保 Put",
  custom: "自定义策略"
};

const fail = (path: string, expected: string): never => { throw new Error(`${path} ${expected}`); };
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const readRecord = (value: unknown, path: string) => isRecord(value) ? value : fail(path, "必须是对象");
const readString = (value: unknown, path: string, nonempty = false): string =>
  typeof value === "string" && (!nonempty || Boolean(value.trim())) ? value.trim() : fail(path, nonempty ? "必须是非空字符串" : "必须是字符串");
const readNumber = (value: unknown, path: string): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fail(path, "必须是有效数字");
const readArray = (value: unknown, path: string): unknown[] => Array.isArray(value) ? value : fail(path, "必须是数组");
const readDate = (value: unknown, path: string): string => {
  const date = readString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(path, "必须使用 YYYY-MM-DD 格式");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return fail(path, "不是有效日期");
  return date;
};
const readTime = (value: unknown, path: string): string => {
  const time = readString(value, path);
  const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) return fail(path, "必须使用 HH:mm:ss 格式");
  return time;
};
const optionalNumber = (record: Record<string, unknown>, key: string, path: string) =>
  record[key] === undefined || record[key] === null ? undefined : readNumber(record[key], `${path}.${key}`);

const readAccount = (value: unknown, path: string): PortfolioAccountSnapshot => {
  const account = readRecord(value, path);
  const buyingPower = optionalNumber(account, "buying_power", path);
  const availableFunds = optionalNumber(account, "available_funds", path);
  return {
    nav: readNumber(account.nav, `${path}.nav`),
    cash: readNumber(account.cash, `${path}.cash`),
    leverage: readNumber(account.leverage, `${path}.leverage`),
    ...(buyingPower !== undefined ? { buyingPower } : {}),
    ...(availableFunds !== undefined ? { availableFunds } : {})
  };
};

const readStock = (value: unknown, path: string): PortfolioStockPositionSnapshot => {
  const stock = readRecord(value, path);
  const dailyPnl = optionalNumber(stock, "daily_pnl", path);
  return {
    symbol: readString(stock.symbol, `${path}.symbol`, true).toUpperCase(),
    quantity: readNumber(stock.quantity, `${path}.quantity`),
    averageCost: readNumber(stock.average_cost, `${path}.average_cost`),
    marketPrice: readNumber(stock.market_price, `${path}.market_price`),
    marketValue: readNumber(stock.market_value, `${path}.market_value`),
    portfolioWeightPct: readNumber(stock.portfolio_weight_pct, `${path}.portfolio_weight_pct`),
    unrealizedPnl: readNumber(stock.unrealized_pnl, `${path}.unrealized_pnl`),
    ...(dailyPnl !== undefined ? { dailyPnl } : {})
  };
};

const readLeg = (value: unknown, path: string): PortfolioOptionLegSnapshot => {
  const leg = readRecord(value, path);
  if (leg.option_type !== "CALL" && leg.option_type !== "PUT") fail(`${path}.option_type`, "必须是 CALL 或 PUT");
  if (leg.side !== "LONG" && leg.side !== "SHORT") fail(`${path}.side`, "必须是 LONG 或 SHORT");
  return {
    optionType: leg.option_type as PortfolioOptionLegSnapshot["optionType"],
    side: leg.side as PortfolioOptionLegSnapshot["side"],
    strike: readNumber(leg.strike, `${path}.strike`),
    quantity: readNumber(leg.quantity, `${path}.quantity`),
    averagePrice: readNumber(leg.average_price, `${path}.average_price`),
    marketPrice: readNumber(leg.market_price, `${path}.market_price`),
    marketValue: readNumber(leg.market_value, `${path}.market_value`)
  };
};

const readOptionStrategy = (value: unknown, index: number): PortfolioOptionStrategySnapshot => {
  const path = `option_strategies[${index}]`;
  const strategy = readRecord(value, path);
  if (!strategyTypes.includes(strategy.strategy as (typeof strategyTypes)[number])) fail(`${path}.strategy`, "不是支持的策略类型");
  return {
    id: readString(strategy.id, `${path}.id`, true),
    symbol: readString(strategy.symbol, `${path}.symbol`, true).toUpperCase(),
    strategy: strategy.strategy as PortfolioOptionStrategySnapshot["strategy"],
    expiration: readDate(strategy.expiration, `${path}.expiration`),
    quantity: readNumber(strategy.quantity, `${path}.quantity`),
    averageNetDebit: readNumber(strategy.average_net_debit, `${path}.average_net_debit`),
    totalCostBasis: readNumber(strategy.total_cost_basis, `${path}.total_cost_basis`),
    marketValue: readNumber(strategy.market_value, `${path}.market_value`),
    portfolioWeightPct: readNumber(strategy.portfolio_weight_pct, `${path}.portfolio_weight_pct`),
    unrealizedPnl: readNumber(strategy.unrealized_pnl, `${path}.unrealized_pnl`),
    legs: readArray(strategy.legs, `${path}.legs`).map((leg, legIndex) => readLeg(leg, `${path}.legs[${legIndex}]`))
  };
};

export function parsePortfolioSnapshotJson(source: string): PortfolioSnapshotImport {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error("无法解析 JSON，请检查格式"); }
  const data = readRecord(parsed, "根节点");
  if (data.schema_version !== 1) fail("schema_version", "必须为 1");
  const account = readAccount(data.account, "account");
  const stocks = readArray(data.stocks, "stocks").map((stock, index) => readStock(stock, `stocks[${index}]`));
  const optionStrategies = readArray(data.option_strategies, "option_strategies").map(readOptionStrategy);
  const note = data.note === undefined ? undefined : readString(data.note, "note");
  return {
    snapshotDate: readDate(data.snapshot_date, "snapshot_date"),
    snapshotTime: readTime(data.snapshot_time, "snapshot_time"),
    broker: readString(data.broker, "broker", true),
    currency: readString(data.currency, "currency", true).toUpperCase(),
    account,
    stocks,
    optionStrategies,
    ...(note !== undefined ? { note } : {})
  };
}

export function validateStoredPortfolioSnapshot(value: unknown): asserts value is PortfolioSnapshot {
  const snapshot = readRecord(value, "portfolioSnapshots");
  readString(snapshot.id, "portfolioSnapshots.id", true);
  readDate(snapshot.snapshotDate, "portfolioSnapshots.snapshotDate");
  readTime(snapshot.snapshotTime, "portfolioSnapshots.snapshotTime");
  readString(snapshot.broker, "portfolioSnapshots.broker", true);
  readString(snapshot.currency, "portfolioSnapshots.currency", true);
  readString(snapshot.createdAt, "portfolioSnapshots.createdAt", true);
  readString(snapshot.updatedAt, "portfolioSnapshots.updatedAt", true);
  const account = readRecord(snapshot.account, "portfolioSnapshots.account");
  readNumber(account.nav, "portfolioSnapshots.account.nav");
  readNumber(account.cash, "portfolioSnapshots.account.cash");
  readNumber(account.leverage, "portfolioSnapshots.account.leverage");
  optionalNumber(account, "buyingPower", "portfolioSnapshots.account");
  optionalNumber(account, "availableFunds", "portfolioSnapshots.account");
  for (const [index, stockValue] of readArray(snapshot.stocks, "portfolioSnapshots.stocks").entries()) {
    const stock = readRecord(stockValue, `portfolioSnapshots.stocks[${index}]`);
    readString(stock.symbol, `portfolioSnapshots.stocks[${index}].symbol`, true);
    for (const field of ["quantity", "averageCost", "marketPrice", "marketValue", "portfolioWeightPct", "unrealizedPnl"]) readNumber(stock[field], `portfolioSnapshots.stocks[${index}].${field}`);
    optionalNumber(stock, "dailyPnl", `portfolioSnapshots.stocks[${index}]`);
  }
  for (const [index, strategyValue] of readArray(snapshot.optionStrategies, "portfolioSnapshots.optionStrategies").entries()) {
    const strategy = readRecord(strategyValue, `portfolioSnapshots.optionStrategies[${index}]`);
    readString(strategy.id, `portfolioSnapshots.optionStrategies[${index}].id`, true);
    readString(strategy.symbol, `portfolioSnapshots.optionStrategies[${index}].symbol`, true);
    if (!strategyTypes.includes(strategy.strategy as (typeof strategyTypes)[number])) fail(`portfolioSnapshots.optionStrategies[${index}].strategy`, "不是支持的策略类型");
    readDate(strategy.expiration, `portfolioSnapshots.optionStrategies[${index}].expiration`);
    for (const field of ["quantity", "averageNetDebit", "totalCostBasis", "marketValue", "portfolioWeightPct", "unrealizedPnl"]) readNumber(strategy[field], `portfolioSnapshots.optionStrategies[${index}].${field}`);
    for (const [legIndex, legValue] of readArray(strategy.legs, `portfolioSnapshots.optionStrategies[${index}].legs`).entries()) {
      const leg = readRecord(legValue, `portfolioSnapshots.optionStrategies[${index}].legs[${legIndex}]`);
      if (leg.optionType !== "CALL" && leg.optionType !== "PUT") fail("期权类型", "必须是 CALL 或 PUT");
      if (leg.side !== "LONG" && leg.side !== "SHORT") fail("期权方向", "必须是 LONG 或 SHORT");
      for (const field of ["strike", "quantity", "averagePrice", "marketPrice", "marketValue"]) readNumber(leg[field], `portfolioSnapshots.optionStrategies[${index}].legs[${legIndex}].${field}`);
    }
  }
  if (snapshot.note !== undefined) readString(snapshot.note, "portfolioSnapshots.note");
}

export const formatPortfolioMoney = (amount: number, currency: string): string => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`; }
};
export const formatPortfolioMoneyExact = (amount: number, currency: string): string => {
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount); }
  catch { return `${currency} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`; }
};
export const formatPortfolioPct = (value: number): string => `${value.toFixed(1)}%`;
export const portfolioCashPct = (snapshot: PortfolioSnapshot): number => snapshot.account.nav === 0 ? 0 : snapshot.account.cash / snapshot.account.nav * 100;
export const portfolioStrategyLabel = (strategy: PortfolioOptionStrategySnapshot["strategy"]): string => strategyLabels[strategy];

export interface PortfolioTickerExposure {
  symbol: string;
  stockValue: number;
  optionValue: number;
  totalValue: number;
  weightPct: number;
}

export const portfolioTickerExposure = (snapshot: PortfolioSnapshot): PortfolioTickerExposure[] => {
  const bySymbol = new Map<string, PortfolioTickerExposure>();
  for (const stock of snapshot.stocks) {
    const symbol = stock.symbol.toUpperCase();
    const exposure = bySymbol.get(symbol) ?? { symbol, stockValue: 0, optionValue: 0, totalValue: 0, weightPct: 0 };
    exposure.stockValue += stock.marketValue;
    bySymbol.set(symbol, exposure);
  }
  for (const strategy of snapshot.optionStrategies) {
    const symbol = strategy.symbol.toUpperCase();
    const exposure = bySymbol.get(symbol) ?? { symbol, stockValue: 0, optionValue: 0, totalValue: 0, weightPct: 0 };
    exposure.optionValue += strategy.marketValue;
    bySymbol.set(symbol, exposure);
  }
  return Array.from(bySymbol.values()).map(exposure => {
    const totalValue = exposure.stockValue + exposure.optionValue;
    return { ...exposure, totalValue, weightPct: snapshot.account.nav === 0 ? 0 : totalValue / snapshot.account.nav * 100 };
  }).sort((a, b) => b.weightPct - a.weightPct || a.symbol.localeCompare(b.symbol));
};

export const concentrationLabel = (weightPct: number): string =>
  weightPct < 5 ? "小仓" : weightPct < 15 ? "正常" : weightPct < 20 ? "较重" : weightPct < 25 ? "重仓" : "超重仓";
