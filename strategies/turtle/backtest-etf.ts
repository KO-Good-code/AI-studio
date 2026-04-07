/**
 * 海龟策略 × 指数ETF 回测
 * 数据来源：Tushare fund_daily 接口
 * 回测区间：2023-04-01 ~ 2026-03-31（约3年）
 *
 * System 1：20日新高买入 / 10日新低离场
 * System 2：55日新高买入 / 20日新低离场
 * 买入持有对比：全程持有ETF
 */

// 目标ETF（东方财富接口格式：沪市1.代码，深市0.代码）
const TARGETS = [
  { code: '510300', market: '1', name: '沪深300ETF（华泰）' },
  { code: '510500', market: '1', name: '中证500ETF（南方）' },
  { code: '159915', market: '0', name: '创业板ETF（易方达）' },
  { code: '510050', market: '1', name: '上证50ETF（华夏）'   },
  { code: '512880', market: '1', name: '证券ETF（国泰）'     },
  { code: '159919', market: '0', name: '沪深300ETF（嘉实）'  },
];

const START   = '20230401';
const PRELOAD = '20220101'; // 预载区间（用于计算55日新高）

// ─── 东方财富 K线接口 ─────────────────────────────────────────────────────
// kline格式: "日期,开,收,高,低,成交量,成交额,振幅,涨跌幅,涨跌额,换手率"

interface Bar {
  date: string;   // YYYYMMDD
  open: number;
  high: number;
  low: number;
  close: number;
  vol: number;
}

async function fetchEtfDaily(code: string, market: string): Promise<Bar[]> {
  const url =
    `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${market}.${code}` +
    `&ut=fa5fd1943c7b386f172d6893dbfba10b` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=101&fqt=1` +
    `&beg=${PRELOAD.replace(/-/g, '')}` +
    `&end=20260331` +
    `&smplmt=2000&lmt=2000`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const json = await res.json() as { data?: { klines?: string[] } };
  const klines = json?.data?.klines ?? [];

  return klines.map(line => {
    // 格式: "2023-04-03,3.882,3.893,3.920,3.876,18562290,7227948968.000,..."
    const parts = line.split(',');
    return {
      date:  parts[0].replace(/-/g, ''),  // YYYYMMDD
      open:  parseFloat(parts[1]),
      close: parseFloat(parts[2]),
      high:  parseFloat(parts[3]),
      low:   parseFloat(parts[4]),
      vol:   parseFloat(parts[5]),
    };
  });
}

// ─── 海龟策略核心 ─────────────────────────────────────────────────────────

interface TradeLog {
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  ret: number; // 单笔收益率%
}

interface BacktestResult {
  name: string;
  system: string;
  totalReturn: number;   // %
  buyHoldReturn: number; // %
  alpha: number;         // 超额收益%
  maxDrawdown: number;   // %
  winRate: number;       // %
  trades: number;
  finalCapital: number;
  equityCurve: { date: string; value: number }[];
  tradeLog: TradeLog[];
}

function turtleBacktest(
  bars: Bar[],
  startDate: string,
  entryN: number,  // 突破N日新高
  exitN: number,   // 跌破N日新低
  systemName: string,
  etfName: string,
): BacktestResult {
  // 过滤回测区间（保留预载数据用于计算指标）
  const tradeBars = bars.filter(b => b.date >= startDate);

  let capital = 100000;
  const initCap = capital;
  let inPosition = false;
  let entryPrice = 0;
  let entryDate = '';
  let peakCap = capital;
  let maxDD = 0;

  const equity: { date: string; value: number }[] = [];
  const tradeLog: TradeLog[] = [];
  let totalW = 0;

  for (let i = 0; i < tradeBars.length; i++) {
    const bar = tradeBars[i];
    // 找到在完整bars中的索引（含预载）
    const fullIdx = bars.findIndex(b => b.date === bar.date);

    // 计算N日高低点（用当日之前的bars）
    const lookbackBars = bars.slice(Math.max(0, fullIdx - entryN), fullIdx);
    const lookbackExitBars = bars.slice(Math.max(0, fullIdx - exitN), fullIdx);

    if (lookbackBars.length < entryN) {
      equity.push({ date: bar.date, value: capital / initCap });
      continue;
    }

    const entryHighN = Math.max(...lookbackBars.map(b => b.close));
    const exitLowN   = Math.min(...lookbackExitBars.map(b => b.close));

    if (!inPosition) {
      // 突破N日新高 → 买入（用下一日开盘价，这里简化用收盘价）
      if (bar.close > entryHighN) {
        inPosition = true;
        entryPrice = bar.close;
        entryDate = bar.date;
      }
    } else {
      // 跌破N日新低 → 卖出
      if (bar.close < exitLowN) {
        const ret = (bar.close - entryPrice) / entryPrice * 100;
        capital *= (1 + ret / 100);
        if (ret > 0) totalW++;
        tradeLog.push({
          entryDate, entryPrice,
          exitDate: bar.date, exitPrice: bar.close,
          ret,
        });
        inPosition = false;
      } else {
        // 持仓期间按持仓市值更新权益
        const unrealized = (bar.close - entryPrice) / entryPrice;
        const curCap = capital * (1 + unrealized);
        if (curCap > peakCap) peakCap = curCap;
        const dd = (peakCap - curCap) / peakCap * 100;
        if (dd > maxDD) maxDD = dd;
      }
    }

    // 记录权益曲线
    const curVal = inPosition
      ? capital * (1 + (bar.close - entryPrice) / entryPrice)
      : capital;
    if (curVal > peakCap) peakCap = curVal;
    const dd2 = (peakCap - curVal) / peakCap * 100;
    if (dd2 > maxDD) maxDD = dd2;
    equity.push({ date: bar.date, value: curVal / initCap });
  }

  // 若仍持仓，按最后收盘价平仓
  if (inPosition && tradeBars.length > 0) {
    const lastBar = tradeBars[tradeBars.length - 1];
    const ret = (lastBar.close - entryPrice) / entryPrice * 100;
    capital *= (1 + ret / 100);
    if (ret > 0) totalW++;
    tradeLog.push({
      entryDate, entryPrice,
      exitDate: lastBar.date, exitPrice: lastBar.close,
      ret,
    });
  }

  // 买入持有回报
  const firstTrade = tradeBars[entryN] ?? tradeBars[0];
  const lastBar = tradeBars[tradeBars.length - 1];
  const buyHold = firstTrade ? (lastBar.close - firstTrade.close) / firstTrade.close * 100 : 0;

  const totalReturn = (capital - initCap) / initCap * 100;

  return {
    name: etfName,
    system: systemName,
    totalReturn,
    buyHoldReturn: buyHold,
    alpha: totalReturn - buyHold,
    maxDrawdown: maxDD,
    winRate: tradeLog.length > 0 ? totalW / tradeLog.length * 100 : 0,
    trades: tradeLog.length,
    finalCapital: capital,
    equityCurve: equity,
    tradeLog,
  };
}

// ─── 主程序 ───────────────────────────────────────────────────────────────

function fmt(v: number, pad = 8): string {
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  return s.padStart(pad);
}

async function main() {
  console.log('\n海龟策略 × 指数ETF 回测（2023-04 ~ 2026-03，约3年）');
  console.log('使用 Tushare fund_daily 实时数据');
  console.log('='.repeat(100));

  const allResults: BacktestResult[] = [];

  for (const etf of TARGETS) {
    process.stderr.write(`\n▶ 拉取 ${etf.name} (${etf.code}) 数据...\n`);
    let bars: Bar[];
    try {
      bars = await fetchEtfDaily(etf.code, etf.market);
    } catch (e) {
      process.stderr.write(`  ⚠ 获取失败: ${e}\n`);
      continue;
    }

    if (bars.length < 60) {
      process.stderr.write(`  ⚠ 数据不足 ${bars.length} 条，跳过\n`);
      continue;
    }

    process.stderr.write(`  ✓ 获取 ${bars.length} 条，${bars[0].date} ~ ${bars[bars.length-1].date}\n`);

    // 三种策略
    const s1 = turtleBacktest(bars, START, 20, 10, 'System1 20/10', etf.name);
    const s2 = turtleBacktest(bars, START, 55, 20, 'System2 55/20', etf.name);
    // 改进版：55日新高 / 20日新低 + 更宽退出（宽松持仓）
    const s3 = turtleBacktest(bars, START, 20, 20, 'System3 20/20', etf.name);

    allResults.push(s1, s2, s3);
  }

  if (!allResults.length) {
    console.log('\n❌ 没有有效数据，请检查 Tushare Token 或网络');
    return;
  }

  // ─── 打印汇总表 ───────────────────────────────────────────────────────
  console.log(
    '\n' +
    'ETF'.padEnd(20) +
    '策略'.padEnd(16) +
    '总收益'.padStart(9) +
    '买持收益'.padStart(9) +
    '超额α'.padStart(8) +
    '最大回撤'.padStart(9) +
    '胜率'.padStart(7) +
    '笔数'.padStart(5) +
    '最终资金'.padStart(12)
  );
  console.log('-'.repeat(100));

  for (const r of allResults) {
    const dd = ('-' + r.maxDrawdown.toFixed(1) + '%').padStart(9);
    console.log(
      r.name.padEnd(20),
      r.system.padEnd(16),
      fmt(r.totalReturn),
      fmt(r.buyHoldReturn),
      fmt(r.alpha),
      dd,
      (r.winRate.toFixed(1) + '%').padStart(7),
      String(r.trades).padStart(5),
      ('¥' + Math.round(r.finalCapital).toLocaleString()).padStart(12),
    );
  }

  console.log('='.repeat(110));

  // ─── 各ETF：最优策略 + 逐年交易明细 ─────────────────────────────────
  const etfNames = [...new Set(allResults.map(r => r.name))];
  const YEARS = ['2023', '2024', '2025', '2026'];

  // 辅助：把 YYYYMMDD 转 Date
  const toDate = (d: string) =>
    new Date(`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`);
  const diffDays = (a: string, b: string) =>
    Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);
  const fmtDate = (d: string) => `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;

  for (const etfName of etfNames) {
    const group = allResults.filter(r => r.name === etfName);
    // 取该ETF总收益最高的策略
    const best = group.reduce((a, b) => a.totalReturn > b.totalReturn ? a : b);
    const bh = best.buyHoldReturn;
    const vs = best.totalReturn >= bh ? '✅ 跑赢买持' : '❌ 跑输买持';

    console.log(`\n${'═'.repeat(110)}`);
    console.log(
      `  📈 ${etfName}   最优系统：${best.system}` +
      `   3年总收益 ${fmt(best.totalReturn, 7)}   买持收益 ${fmt(bh, 7)}   ${vs}`
    );
    console.log(`${'─'.repeat(110)}`);

    // 按年分组输出
    for (const yr of YEARS) {
      // 属于本年的交易：以买入日期归年（或以卖出日期归年皆可，这里以卖出日期）
      const trades = best.tradeLog.filter(t => t.exitDate.startsWith(yr));
      if (!trades.length) continue;

      // 计算本年复利收益
      const yrReturn = trades.reduce((acc, t) => acc * (1 + t.ret / 100), 1) - 1;
      const wins = trades.filter(t => t.ret >= 0).length;

      console.log(
        `\n  ── ${yr}年  共${trades.length}笔  胜率${(wins/trades.length*100).toFixed(0)}%` +
        `  年度复利收益 ${fmt(yrReturn * 100, 7)} ──`
      );
      console.log(
        '  ' +
        '买入日期'.padEnd(12) +
        '买入价'.padStart(8) +
        '  ' +
        '卖出日期'.padEnd(12) +
        '卖出价'.padStart(8) +
        '  ' +
        '单笔收益'.padStart(10) +
        '  持仓天数'.padStart(9) +
        '  盈亏'
      );
      console.log('  ' + '·'.repeat(85));

      let runCap = 100;
      for (const t of trades) {
        runCap *= (1 + t.ret / 100);
        const days = diffDays(t.entryDate, t.exitDate);
        const flag = t.ret >= 0 ? '盈 🟢' : '亏 🔴';
        const retStr = ((t.ret >= 0 ? '+' : '') + t.ret.toFixed(2) + '%').padStart(8);
        console.log(
          '  ' +
          fmtDate(t.entryDate).padEnd(12) +
          t.entryPrice.toFixed(3).padStart(8) +
          '  ' +
          fmtDate(t.exitDate).padEnd(12) +
          t.exitPrice.toFixed(3).padStart(8) +
          '  ' +
          retStr.padStart(10) +
          `  ${String(days)+'天'}`.padStart(9) +
          `  ${flag}`
        );
      }

      // 年底累计资金提示
      console.log(
        `  ${'·'.repeat(85)}\n` +
        `  ${yr}年合计：${fmt(yrReturn * 100, 7)}  (本年¥10万→¥${Math.round(100000*(1+yrReturn)).toLocaleString()})`
      );
    }
  }

  // ─── 策略横向汇总 ─────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(110)}`);
  console.log('  📊 三种系统横向对比（6个ETF平均）');
  console.log(`${'─'.repeat(110)}`);
  const systems = ['System1 20/10', 'System2 55/20', 'System3 20/20'];
  const sysLabels: Record<string, string> = {
    'System1 20/10': '短线系统1  入:20日新高 / 出:10日新低',
    'System2 55/20': '长线系统2  入:55日新高 / 出:20日新低',
    'System3 20/20': '改良系统3  入:20日新高 / 出:20日新低',
  };
  for (const sys of systems) {
    const g = allResults.filter(r => r.system === sys);
    if (!g.length) continue;
    const avgRet = g.reduce((s, r) => s + r.totalReturn, 0) / g.length;
    const avgBH  = g.reduce((s, r) => s + r.buyHoldReturn, 0) / g.length;
    const avgDD  = g.reduce((s, r) => s + r.maxDrawdown, 0) / g.length;
    const avgWR  = g.reduce((s, r) => s + r.winRate, 0) / g.length;
    const avgT   = g.reduce((s, r) => s + r.trades, 0) / g.length;
    console.log(
      `  ${sysLabels[sys].padEnd(36)}` +
      `均收益${fmt(avgRet, 7)}  买持${fmt(avgBH, 7)}  超额${fmt(avgRet-avgBH, 6)}` +
      `  回撤-${avgDD.toFixed(1)}%  胜率${avgWR.toFixed(1)}%  均${avgT.toFixed(1)}笔/ETF`
    );
  }
  console.log(`${'═'.repeat(110)}\n`);
}

main().catch(e => {
  console.error('运行出错:', e);
  process.exit(1);
});
