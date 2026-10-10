#!/bin/sh
# Probes the busiest coin's 1s chart against the local radar and appends the one-line verdict to data/probe.log.
# Run by the blix-probe systemd timer on the VM; read the log with: grep PROBE data/probe.log | tail
cd "$(dirname "$0")/.." || exit 1
M=$(curl -s --max-time 10 "http://127.0.0.1:4421/api/pulse" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const a=[...(j.stretch||[]),...(j.running||[]),...(j.migrated||[]),...(j.newPairs||[])];const c=a.filter(x=>x.mint).sort((p,q)=>(q.vol5m||0)-(p.vol5m||0))[0];console.log(c?c.mint:"")})')
[ -n "$M" ] || { echo "PROBE SKIP $(date -u +%FT%TZ) no coin" >> data/probe.log; exit 0; }
timeout 200 node scripts/chart-probe.mjs "$M" 1 90 2>&1 | grep -E "^(PROBE|chart newest|jumps|trade ->|poll errors|page errors)" >> data/probe.log
