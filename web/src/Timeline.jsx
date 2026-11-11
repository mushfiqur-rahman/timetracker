import React, { useEffect, useMemo, useState } from 'react';
import { api, startOfDay, addDays, startOfWeek, sameDay, fmtDur, pct } from './api.js';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

// One person's work diary: week overview + the selected day in 10-minute blocks.
export default function Timeline({ title, subtitle, userId, onBack }) {
  const [day, setDay] = useState(() => startOfDay(new Date()));
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const weekStart = useMemo(() => startOfWeek(day), [day]);
  const weekKey = weekStart.getTime();

  useEffect(() => {
    let live = true;
    const load = () => {
      const qs = `from=${weekStart.toISOString()}&to=${addDays(weekStart, 7).toISOString()}${userId ? `&userId=${userId}` : ''}`;
      api(`/activity?${qs}`)
        .then(d => { if (live) { setRows(d.minutes); setError(''); } })
        .catch(e => { if (live) setError(e.message); });
    };
    setRows(null);
    load();
    const id = setInterval(load, 60000); // keep today fresh while the desktop app is running
    return () => { live = false; clearInterval(id); };
  }, [weekKey, userId]);

  // Per-day totals for the week chart.
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(weekStart, i), total: 0, idle: 0 }));
    for (const [m, s, mouse, keys] of rows || []) {
      const d = new Date(m * 60000);
      const i = Math.round((startOfDay(d) - weekStart) / 86400000);
      if (!days[i]) continue;
      days[i].total += s;
      if (mouse + keys === 0) days[i].idle += s;
    }
    return days;
  }, [rows, weekKey]);

  // Selected day -> hours -> six 10-minute blocks -> ten minutes each.
  const hours = useMemo(() => {
    const map = new Map();
    for (const [m, s, mouse, keys] of rows || []) {
      const d = new Date(m * 60000);
      if (!sameDay(d, day)) continue;
      const h = d.getHours();
      if (!map.has(h)) map.set(h, Array.from({ length: 6 }, () => ({ total: 0, idle: 0, mouse: 0, keys: 0, mins: Array(10).fill(null) })));
      const b = map.get(h)[Math.floor(d.getMinutes() / 10)];
      const isIdle = mouse + keys === 0;
      b.total += s; b.mouse += mouse; b.keys += keys;
      if (isIdle) b.idle += s;
      b.mins[d.getMinutes() % 10] = isIdle ? 'idle' : 'active';
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows, day]);

  const today = week.find(w => sameDay(w.date, day)) || { total: 0, idle: 0 };
  const weekTotal = week.reduce((a, w) => a + w.total, 0);
  const weekMax = Math.max(3600, ...week.map(w => w.total));
  const isToday = sameDay(day, new Date());

  return (
    <section>
      <div className="pagehead">
        <div>
          {onBack && <button className="btn ghost back" onClick={onBack}>← Team</button>}
          <h1>{title}</h1>
          {subtitle && <div className="muted">{subtitle}</div>}
        </div>
        <div className="datenav">
          <button className="btn" onClick={() => setDay(addDays(day, -1))} aria-label="Previous day">‹</button>
          <input type="date" value={`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`}
            onChange={e => { if (e.target.value) { const [y, m, d] = e.target.value.split('-').map(Number); setDay(new Date(y, m - 1, d)); } }} />
          <button className="btn" onClick={() => setDay(addDays(day, 1))} disabled={isToday} aria-label="Next day">›</button>
          {!isToday && <button className="btn" onClick={() => setDay(startOfDay(new Date()))}>Today</button>}
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="stats">
        <Stat label="Worked" value={fmtDur(today.total)} hint={day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })} />
        <Stat label="Active" value={fmtDur(today.total - today.idle)} hint={`${pct(today.total - today.idle, today.total)}% of worked time`} tone="active" />
        <Stat label="Idle" value={fmtDur(today.idle)} hint={`${pct(today.idle, today.total)}% of worked time`} tone="idle" />
        <Stat label="This week" value={fmtDur(weekTotal)} hint={`${weekStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${addDays(weekStart, 6).toLocaleDateString([], { month: 'short', day: 'numeric' })}`} />
      </div>

      <div className="card pad">
        <div className="cardhead">
          <h2>Week</h2>
          <Legend />
        </div>
        <div className="weekchart">
          {week.map((w, i) => (
            <button key={i} className={`weekday ${sameDay(w.date, day) ? 'sel' : ''}`} onClick={() => setDay(w.date)}
              disabled={w.date > new Date()} title={`${fmtDur(w.total)} worked, ${fmtDur(w.idle)} idle`}>
              <span className="wval">{w.total ? fmtDur(w.total) : ''}</span>
              <span className="wbar">
                <span className="seg idle" style={{ height: `${(w.idle / weekMax) * 100}%` }} />
                <span className="seg active" style={{ height: `${((w.total - w.idle) / weekMax) * 100}%` }} />
              </span>
              <span className="wlabel">{DAY_NAMES[i]} {w.date.getDate()}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="card pad">
        <div className="cardhead">
          <h2>Timeline <span className="muted small">10-minute blocks</span></h2>
          <span className="muted small">Each small bar is one minute</span>
        </div>
        {rows === null && !error && <div className="empty">Loading…</div>}
        {rows !== null && hours.length === 0 && <div className="empty">No time tracked on this day.</div>}
        {hours.map(([h, blocks]) => (
          <div className="hour" key={h}>
            <div className="hourlabel">{hhmm(h, 0)}</div>
            <div className="blocks">
              {blocks.map((b, i) => (
                <div key={i} className={`block ${b.total ? '' : 'none'}`}
                  title={b.total ? `${hhmm(h, i * 10)} – ${i === 5 ? hhmm(h + 1, 0) : hhmm(h, i * 10 + 10)}\n${b.mouse} mouse clicks, ${b.keys} key presses` : 'Not tracked'}>
                  <div className="btime">{hhmm(h, i * 10)}</div>
                  <div className="mins">
                    {b.mins.map((m, k) => <span key={k} className={`min ${m || ''}`} />)}
                  </div>
                  {b.total > 0 ? (
                    <div className="bnums">
                      <span><b>{Math.round(b.total / 60)}m</b> worked</span>
                      <span className={b.idle ? 'idletext' : 'muted'}>{Math.round(b.idle / 60)}m idle</span>
                    </div>
                  ) : <div className="bnums muted">—</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }) {
  return (
    <div className={`card stat ${tone || ''}`}>
      <div className="slabel">{label}</div>
      <div className="svalue">{value}</div>
      <div className="shint">{hint}</div>
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="dot active" />Active</span>
      <span><i className="dot idle" />Idle</span>
      <span><i className="dot none" />Not tracked</span>
    </div>
  );
}
