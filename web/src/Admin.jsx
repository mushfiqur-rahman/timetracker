import React, { useEffect, useState } from 'react';
import { api, startOfDay, addDays, startOfWeek, startOfMonth, fmtDur, pct, fmtDateTime } from './api.js';

// ---------- Team report ----------

export function Team({ onOpen }) {
  const [range, setRange] = useState('today');
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const load = () => {
      const now = new Date();
      const from = range === 'today' ? startOfDay(now) : range === 'week' ? startOfWeek(now) : startOfMonth(now);
      api(`/admin/summary?from=${from.toISOString()}&to=${addDays(now, 1).toISOString()}`)
        .then(d => { if (live) { setUsers(d.users); setError(''); } })
        .catch(e => { if (live) setError(e.message); });
    };
    load();
    const id = setInterval(load, 60000);
    return () => { live = false; clearInterval(id); };
  }, [range]);

  return (
    <section>
      <div className="pagehead">
        <h1>Team</h1>
        <div className="segmented">
          {[['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([id, label]) => (
            <button key={id} className={range === id ? 'on' : ''} onClick={() => setRange(id)}>{label}</button>
          ))}
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Person</th><th className="num">Worked</th><th className="num">Active</th><th className="num">Idle</th><th>Activity</th><th>Last tracked</th><th /></tr></thead>
          <tbody>
            {users?.map(u => (
              <tr key={u.id} className="clickable" onClick={() => onOpen(u)}>
                <td>{u.name}{!u.active && <span className="pill revoked">disabled</span>}<div className="sub">{u.email}</div></td>
                <td className="num"><b>{fmtDur(u.total)}</b></td>
                <td className="num">{fmtDur(u.total - u.idle)}</td>
                <td className="num idletext">{fmtDur(u.idle)}</td>
                <td>
                  <div className="meter" title={`${pct(u.total - u.idle, u.total)}% active`}>
                    <span style={{ width: `${pct(u.total - u.idle, u.total)}%` }} />
                  </div>
                  <span className="sub">{u.total ? `${pct(u.total - u.idle, u.total)}% active` : 'No time'}</span>
                </td>
                <td>{fmtDateTime(u.last_activity)}</td>
                <td className="num"><span className="link">Timeline →</span></td>
              </tr>
            ))}
            {users === null && <tr><td colSpan="7" className="empty">Loading…</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Users ----------

export function Users({ me, onDevicesChanged }) {
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null); // user object, or {} for new
  const [devicesFor, setDevicesFor] = useState(null);
  const [error, setError] = useState('');

  const load = () => api('/admin/users').then(d => setUsers(d.users)).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const toggle = async u => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); load(); }
    catch (e) { setError(e.message); }
  };
  const remove = async u => {
    if (!confirm(`Delete ${u.name}? This permanently removes the account, its devices and all tracked time.`)) return;
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); load(); onDevicesChanged?.(); }
    catch (e) { setError(e.message); }
  };

  return (
    <section>
      <div className="pagehead">
        <h1>Users</h1>
        <button className="btn primary" onClick={() => setEditing({})}>+ Add user</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>Devices</th><th>Status</th><th>Last seen</th><th /></tr></thead>
          <tbody>
            {users?.map(u => (
              <tr key={u.id}>
                <td>{u.name}<div className="sub">{u.email}</div></td>
                <td>{u.role}</td>
                <td>
                  <button className="link" onClick={() => setDevicesFor(u)}>
                    {u.approved_devices} approved{u.pending_devices > 0 && <span className="badge">{u.pending_devices} pending</span>}
                  </button>
                </td>
                <td><span className={`pill ${u.active ? 'approved' : 'revoked'}`}>{u.active ? 'active' : 'disabled'}</span></td>
                <td>{fmtDateTime(u.last_seen_at)}</td>
                <td className="actions">
                  <button className="btn small" onClick={() => setEditing(u)}>Edit</button>
                  <button className="btn small" onClick={() => setDevicesFor(u)}>Devices</button>
                  {u.id !== me.id && <button className="btn small" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
                  {u.id !== me.id && <button className="btn small danger" onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            ))}
            {users === null && <tr><td colSpan="6" className="empty">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && <UserDialog user={editing} isSelf={editing.id === me.id} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {devicesFor && <UserDevicesDialog user={devicesFor} onClose={() => { setDevicesFor(null); load(); onDevicesChanged?.(); }} />}
    </section>
  );
}

function UserDialog({ user, isSelf, onClose, onSaved }) {
  const isNew = !user.id;
  const [f, setF] = useState({ name: user.name || '', email: user.email || '', password: '', role: user.role || 'user' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { name: f.name, email: f.email };
      if (f.password) body.password = f.password;
      if (!isSelf) body.role = f.role;
      await api(isNew ? '/admin/users' : `/admin/users/${user.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      onSaved();
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'Add user' : `Edit ${user.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Full name<input value={f.name} onChange={set('name')} required autoFocus /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        <label>{isNew ? 'Password' : 'New password'}
          <input type="text" value={f.password} onChange={set('password')} minLength={8} required={isNew}
            placeholder={isNew ? 'At least 8 characters' : 'Leave empty to keep the current one'} autoComplete="off" />
        </label>
        {!isSelf && (
          <label>Role
            <select value={f.role} onChange={set('role')}>
              <option value="user">User — tracks time, sees own timeline</option>
              <option value="admin">Admin — manages users and devices</option>
            </select>
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{isNew ? 'Create user' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function UserDevicesDialog({ user, onClose }) {
  const [devices, setDevices] = useState(null);
  const [mac, setMac] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const load = () => api('/admin/devices').then(d => setDevices(d.devices.filter(x => x.user_id === user.id))).catch(e => setError(e.message));
  useEffect(() => { load(); }, []);

  const add = async e => {
    e.preventDefault(); setError('');
    try {
      await api(`/admin/users/${user.id}/devices`, { method: 'POST', body: { mac, label } });
      setMac(''); setLabel(''); load();
    } catch (err) { setError(err.message); }
  };

  return (
    <Modal title={`Devices — ${user.name}`} onClose={onClose} wide>
      <DeviceTable devices={devices} onChanged={load} onError={setError} />
      <form className="addmac" onSubmit={add}>
        <h3>Assign a device by MAC address</h3>
        <p className="muted small">The device is approved in advance. The user can then sign in from that computer straight away.</p>
        <div className="row">
          <input className="mono" placeholder="3C:52:82:1A:9F:10" value={mac} onChange={e => setMac(e.target.value)} required />
          <input placeholder="Label (optional), e.g. Office laptop" value={label} onChange={e => setLabel(e.target.value)} />
          <button className="btn primary">Assign</button>
        </div>
      </form>
      {error && <div className="error">{error}</div>}
    </Modal>
  );
}

// ---------- Devices ----------

export function Devices({ onChanged }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/admin/devices').then(d => { setDevices(d.devices); onChanged?.(); }).catch(e => setError(e.message));
  useEffect(() => {
    load();
    const id = setInterval(load, 30000);
    return () => clearInterval(id);
  }, []);

  const pending = devices?.filter(d => d.status === 'pending') || [];
  const others = devices?.filter(d => d.status !== 'pending') || [];

  return (
    <section>
      <div className="pagehead"><h1>Devices</h1></div>
      <p className="muted">A user can only run the desktop app on a device you have approved. New sign-ins from unknown computers show up here.</p>
      {error && <div className="error">{error}</div>}

      <h2 className="section">Waiting for approval {pending.length > 0 && <span className="badge">{pending.length}</span>}</h2>
      <div className="card table-wrap">
        {devices && pending.length === 0
          ? <div className="empty">Nothing waiting. </div>
          : <DeviceTable devices={devices && pending} showUser onChanged={load} onError={setError} />}
      </div>

      <h2 className="section">All devices</h2>
      <div className="card table-wrap">
        <DeviceTable devices={devices && others} showUser onChanged={load} onError={setError} />
      </div>
    </section>
  );
}

function DeviceTable({ devices, showUser, onChanged, onError }) {
  const act = async (d, body, method = 'PATCH') => {
    try { await api(`/admin/devices/${d.id}`, { method, body }); onChanged(); }
    catch (e) { onError(e.message); }
  };
  const cols = showUser ? 6 : 5;
  return (
    <table>
      <thead>
        <tr>{showUser && <th>User</th>}<th>Computer</th><th>MAC address</th><th>Status</th><th>Last used</th><th /></tr>
      </thead>
      <tbody>
        {devices?.map(d => {
          const macChanged = d.last_macs?.length > 0 && !d.last_macs.includes(d.mac);
          return (
            <tr key={d.id}>
              {showUser && <td>{d.user_name}<div className="sub">{d.user_email}</div></td>}
              <td>{d.label || d.hostname || <span className="muted">Not connected yet</span>}
                <div className="sub">{[d.label && d.hostname, d.os].filter(Boolean).join(' · ')}</div>
              </td>
              <td className="mono">{d.mac}
                {macChanged && <div className="sub warn" title={`Now reporting: ${d.last_macs.join(', ')}`}>⚠ MAC changed since approval</div>}
              </td>
              <td><span className={`pill ${d.status}`}>{d.status}</span></td>
              <td>{fmtDateTime(d.last_seen_at)}</td>
              <td className="actions">
                {d.status !== 'approved' && <button className="btn small primary" onClick={() => act(d, { status: 'approved' })}>Approve</button>}
                {d.status === 'pending' && <button className="btn small" onClick={() => act(d, { status: 'revoked' })}>Reject</button>}
                {d.status === 'approved' && <button className="btn small" onClick={() => act(d, { status: 'revoked' })}>Block</button>}
                <button className="btn small danger" onClick={() => { if (confirm('Remove this device? The user will need approval again to use it.')) act(d, undefined, 'DELETE'); }}>Remove</button>
              </td>
            </tr>
          );
        })}
        {devices === null && <tr><td colSpan={cols} className="empty">Loading…</td></tr>}
        {devices && devices.length === 0 && <tr><td colSpan={cols} className="empty">No devices.</td></tr>}
      </tbody>
    </table>
  );
}

function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`card modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modalhead"><h2>{title}</h2><button className="btn ghost" onClick={onClose} aria-label="Close">✕</button></div>
        {children}
      </div>
    </div>
  );
}
