#!/usr/bin/env python3
"""
import-etf-yahoo.py
从雅虎财经下载中国 ETF/指数历史日线数据，写入 prices.db

用法: python3 scripts/import-etf-yahoo.py

目标 ETF（雅虎财经代码）：
  510300.SS  沪深300ETF（华泰柏瑞）
  510500.SS  中证500ETF（南方）
  159915.SZ  创业板ETF（易方达）
"""

import sqlite3
import json
import time
import urllib.request
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'prices.db')

ETF_LIST = [
    {'code': '510300.SH', 'yahoo': '510300.SS', 'name': '沪深300ETF', 'industry': 'ETF', 'market': 'ETF'},
    {'code': '510500.SH', 'yahoo': '510500.SS', 'name': '中证500ETF', 'industry': 'ETF', 'market': 'ETF'},
    {'code': '159915.SZ', 'yahoo': '159915.SZ', 'name': '创业板ETF',  'industry': 'ETF', 'market': 'ETF'},
]

START_TS = int(time.mktime(time.strptime('2015-01-01', '%Y-%m-%d')))
END_TS   = int(time.time())
VOL_RATIO_DAYS = 5


def fetch_yahoo(yahoo_code: str) -> list[dict]:
    url = (
        f'https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_code}'
        f'?interval=1d&period1={START_TS}&period2={END_TS}&includePrePost=false'
    )
    req = urllib.request.Request(url, headers={
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    })
    resp = urllib.request.urlopen(req, timeout=15)
    data = json.loads(resp.read())
    result = data['chart']['result'][0]
    timestamps = result.get('timestamp', [])
    quotes     = result['indicators']['quote'][0]

    rows = []
    for i, ts in enumerate(timestamps):
        o = quotes['open'][i]
        h = quotes['high'][i]
        l = quotes['low'][i]
        c = quotes['close'][i]
        v = quotes['volume'][i]
        if c is None or c == 0:
            continue
        date_str = datetime.utcfromtimestamp(ts).strftime('%Y-%m-%d')
        rows.append({
            'date': date_str,
            'open':  round(o, 4) if o else None,
            'high':  round(h, 4) if h else None,
            'low':   round(l, 4) if l else None,
            'close': round(c, 4),
            'volume': int(v) if v else None,
        })
    # 按日期升序排列
    rows.sort(key=lambda r: r['date'])
    return rows


def main():
    conn = sqlite3.connect(DB_PATH)
    cur  = conn.cursor()

    insert_sql = """
        INSERT OR IGNORE INTO prices
          (code, date, open, high, low, close, prev_close, quote_rate, volume, turnover,
           high_limit, low_limit, turnover_rate, turnover_rate_f, volume_ratio,
           pe, pe_ttm, pb, ps, ps_ttm, total_mv, circ_mv, name, industry, market)
        VALUES
          (?,?,?,?,?,?,NULL,NULL,?,NULL,0,0,NULL,NULL,?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,?,?,?)
    """

    for etf in ETF_LIST:
        print(f'\n📥 {etf["code"]} ({etf["name"]}) ← Yahoo: {etf["yahoo"]}')

        # 查 DB 已有的最新日期，实现增量更新
        cur.execute('SELECT MAX(date) FROM prices WHERE code=?', (etf['code'],))
        last_date = cur.fetchone()[0]
        if last_date:
            print(f'   已有数据至 {last_date}，增量更新')
        else:
            print(f'   首次导入，全量拉取')

        try:
            rows = fetch_yahoo(etf['yahoo'])
        except Exception as e:
            print(f'   ❌ 下载失败: {e}')
            continue

        # 过滤出 last_date 之后的数据
        if last_date:
            rows = [r for r in rows if r['date'] > last_date]

        if not rows:
            print('   ✅ 无新数据')
            continue

        print(f'   📦 准备写入 {len(rows)} 条...')

        # 查最近 N 日量，用于计算量比起点
        cur.execute(
            f'SELECT volume FROM prices WHERE code=? AND volume IS NOT NULL ORDER BY date DESC LIMIT {VOL_RATIO_DAYS}',
            (etf['code'],)
        )
        recent_vols = [r[0] for r in cur.fetchall()][::-1]  # 升序
        vol_window = list(recent_vols)

        inserted = 0
        for i, row in enumerate(rows):
            # 计算量比
            if vol_window and row['volume']:
                avg_vol = sum(vol_window) / len(vol_window)
                vol_ratio = round(row['volume'] / avg_vol, 4) if avg_vol > 0 else None
            else:
                vol_ratio = None

            # 更新滑动窗口
            if row['volume']:
                vol_window.append(row['volume'])
                if len(vol_window) > VOL_RATIO_DAYS:
                    vol_window.pop(0)

            cur.execute(insert_sql, (
                etf['code'], row['date'],
                row['open'], row['high'], row['low'], row['close'],
                row['volume'],
                vol_ratio,
                etf['name'], etf['industry'], etf['market'],
            ))
            inserted += cur.rowcount

        conn.commit()
        print(f'   ✅ 写入 {inserted} 条')
        time.sleep(0.5)  # 避免请求过快

    # 汇总
    print('\n\n── 写入后 ETF 数据概览 ──')
    for etf in ETF_LIST:
        cur.execute('SELECT COUNT(*), MIN(date), MAX(date) FROM prices WHERE code=?', (etf['code'],))
        cnt, s, e = cur.fetchone()
        print(f'  {etf["code"]:12s} {etf["name"]:12s}: {cnt:5d} 条  {s} ~ {e}')

    conn.close()
    print('\n✅ ETF 数据导入完成')


if __name__ == '__main__':
    main()
