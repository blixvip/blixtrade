"""One-off, reversible repair for the October 11 UTC non-SOL quote incident.
Run on the VM with blix stopped; requires the captured on-chain pool audit.
Archives suspect backfilled trades, affected derived candles and cache entries first.
"""
import sys, json, sqlite3, pathlib, gzip, time, subprocess, os

root = pathlib.Path('/opt/blix/data')
assert root.resolve() == root
audit = json.loads(pathlib.Path(sys.argv[1]).read_text())
alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
def b58(b):
    n = int.from_bytes(b, 'big'); s = ''
    while n: n, r = divmod(n, 58); s = alphabet[r] + s
    return '1' * (len(b) - len(b.lstrip(b'\0'))) + s
import base64
targets = []
for row in audit:
    if row['supported']: continue
    a = row['account']; data = base64.b64decode(a['data'][0])
    assert a['owner'] == 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA'
    assert len(data) == 64 and b58(data[:32]) == row['mint']
    assert b58(data[32:]) != 'So11111111111111111111111111111111111111112'
    targets.append(row)
assert targets and len(targets) <= 100
if '--apply' in sys.argv:
    assert subprocess.run(['systemctl', 'is-active', '--quiet', 'blix']).returncode != 0, 'Stop blix first'
c = sqlite3.connect(root / 'radar.db', timeout=10); c.row_factory = sqlite3.Row
c.execute("ATTACH DATABASE ? AS candles", (str(root / 'candles.db'),))
records = []
for item in targets:
    mid = c.execute('SELECT id FROM j_mints WHERE mint=?', (item['mint'],)).fetchone()[0]
    suspect = [dict(r) for r in c.execute('SELECT * FROM j_trades WHERE mid=? AND src=1 AND venue=2 ORDER BY t,k', (mid,))]
    if not suspect: continue
    cm = c.execute('SELECT * FROM candles.c_mints WHERE mint=?', (item['mint'],)).fetchone()
    cut = min(r['t'] for r in suspect) // 1000
    bars = [] if not cm else [dict(r) for r in c.execute('SELECT * FROM candles.c_candles WHERE mid=? AND t>=?', (cm['id'], cut // 3600 * 3600))]
    records.append(dict(mint=item['mint'], mid=mid, cut=cut, trades=suspect, candleMint=dict(cm) if cm else None, candles=bars))
print(json.dumps({'coins':len(records),'quarantinedTrades':sum(len(r['trades']) for r in records)}), flush=True)
if '--apply' not in sys.argv: sys.exit(0)
state_path = root / 'candles-state.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {}
mints = {r['mint'] for r in records}
saved = {k:[r for r in state.get(k,[]) if r[0] in mints] for k in ['book','ticks']}
archive = root / 'reports' / ('quote-history-' + str(int(time.time())) + '.json.gz')
archive.parent.mkdir(exist_ok=True)
with gzip.open(archive, 'wt') as f: json.dump({'audit':targets,'records':records,'cache':saved}, f)
with gzip.open(archive, 'rt') as f: assert len(json.load(f)['records']) == len(records)
with c:
    for r in records:
        c.execute('DELETE FROM j_trades WHERE mid=? AND src=1 AND venue=2', (r['mid'],))
        c.execute('INSERT OR REPLACE INTO meta(k,v) VALUES(?,?)',('quote_history_v1:'+r['mint'],str(r['cut'])))
        c.execute('UPDATE j_mints SET last=(SELECT MAX(t) FROM j_trades WHERE mid=?) WHERE id=?', (r['mid'],r['mid']))
        if not r['candleMint']: continue
        cid = r['candleMint']['id']
        for tf in [1,5,60,300,900,3600]:
            start = r['cut'] // tf * tf
            prev = c.execute('SELECT c FROM candles.c_candles WHERE mid=? AND tf=? AND t<? ORDER BY t DESC LIMIT 1', (cid,tf,start)).fetchone()
            close = prev[0] if prev else None
            c.execute('DELETE FROM candles.c_candles WHERE mid=? AND tf=? AND t>=?', (cid,tf,start))
            buckets = {}
            for x in c.execute('SELECT t,mc,usd,buy FROM j_trades WHERE mid=? AND t>=? ORDER BY t,k',(r['mid'],start*1000)):
                t = x['t']//(tf*1000)*tf; mc=x['mc']
                if t not in buckets:
                    o = close if close is not None else mc
                    buckets[t]=[cid,tf,t,o,max(o,mc),min(o,mc),mc,0,0,0]
                b=buckets[t]; b[4]=max(b[4],mc); b[5]=min(b[5],mc); b[6]=mc; b[7]+=x['usd']; b[8 if x['buy'] else 9]+=1; close=mc
            c.executemany('INSERT INTO candles.c_candles(mid,tf,t,o,h,l,c,v,buys,sells) VALUES(?,?,?,?,?,?,?,?,?,?)',buckets.values())
        c.execute('UPDATE candles.c_mints SET last=(SELECT MAX(t)*1000 FROM candles.c_candles WHERE mid=?) WHERE id=?',(cid,cid))
for key in ['book','ticks']: state[key] = [r for r in state.get(key,[]) if r[0] not in mints]
tmp=state_path.with_suffix('.repair-tmp'); tmp.write_text(json.dumps(state)); os.replace(tmp,state_path)
for r in records:
    assert c.execute('SELECT COUNT(*) FROM j_trades WHERE mid=? AND src=1 AND venue=2',(r['mid'],)).fetchone()[0] == 0
c.close()
print('Repair complete; recoverable archive:',archive,flush=True)
