import React, { useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import Timeline from './Timeline.jsx';
import { Team, Users, Devices } from './Admin.jsx';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [page, setPage] = useState('time');
  const [viewUser, setViewUser] = useState(null); // admin looking at one person's timeline
  const [pending, setPending] = useState(0);

  const signOut = () => { setToken(null); setUser(null); setPage('time'); setViewUser(null); };

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken()) return;
    api('/me').then(d => setUser(d.user)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const isAdmin = user?.role === 'admin';
  const refreshPending = () => {
    if (isAdmin) api('/admin/devices').then(d => setPending(d.devices.filter(x => x.status === 'pending').length)).catch(() => {});
  };
  useEffect(() => {
    if (!isAdmin) return;
    refreshPending();
    const id = setInterval(refreshPending, 30000);
    return () => clearInterval(id);
  }, [isAdmin]);

  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Login onLogin={u => { setUser(u); setPage(u.role === 'admin' ? 'team' : 'time'); }} />;

  const tabs = isAdmin
    ? [['team', 'Team'], ['users', 'Users'], ['devices', 'Devices'], ['time', 'My time']]
    : [['time', 'My time'], ['mydevices', 'My devices']];
  const go = p => { setPage(p); setViewUser(null); };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden="true" />Time Tracker</div>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab ${page === id ? 'active' : ''}`} onClick={() => go(id)}>
              {label}
              {id === 'devices' && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <div className="who">
          <button className={`tab ${page === 'account' ? 'active' : ''}`} onClick={() => go('account')} title="Account settings">
            {user.name}
          </button>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <main>
        {page === 'time' && <Timeline title="My time" />}
        {page === 'mydevices' && <MyDevices />}
        {page === 'account' && <Account user={user} />}
        {isAdmin && page === 'team' && (viewUser
          ? <Timeline title={viewUser.name} subtitle={viewUser.email} userId={viewUser.id} onBack={() => setViewUser(null)} />
          : <Team onOpen={setViewUser} />)}
        {isAdmin && page === 'users' && <Users me={user} onDevicesChanged={refreshPending} />}
        {isAdmin && page === 'devices' && <Devices onChanged={refreshPending} />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const d = await api('/auth/login', { method: 'POST', body: { email, password } });
      setToken(d.token);
      onLogin(d.user);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big"><span className="logo" aria-hidden="true" />Time Tracker</div>
        <p className="muted">Sign in with the account your admin gave you.</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function MyDevices() {
  const [devices, setDevices] = useState(null);
  useEffect(() => { api('/devices').then(d => setDevices(d.devices)).catch(() => setDevices([])); }, []);
  return (
    <section>
      <div className="pagehead"><h1>My devices</h1></div>
      <p className="muted">The desktop app only works on devices your admin has approved. Sign in from a new computer to request approval.</p>
      <div className="card table-wrap">
        <table>
          <thead><tr><th>Computer</th><th>MAC address</th><th>Status</th><th>Last used</th></tr></thead>
          <tbody>
            {devices?.map(d => (
              <tr key={d.id}>
                <td>{d.label || d.hostname || 'Not connected yet'}<div className="sub">{d.os}</div></td>
                <td className="mono">{d.mac}</td>
                <td><span className={`pill ${d.status}`}>{d.status}</span></td>
                <td>{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
            {devices && devices.length === 0 && <tr><td colSpan="4" className="empty">No devices yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Account({ user }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [msg, setMsg] = useState(null);
  const submit = async e => {
    e.preventDefault();
    try {
      await api('/me/password', { method: 'POST', body: { current, next } });
      setMsg({ ok: true, text: 'Password changed.' }); setCurrent(''); setNext('');
    } catch (err) { setMsg({ ok: false, text: err.message }); }
  };
  return (
    <section className="narrow">
      <div className="pagehead"><h1>Account</h1></div>
      <div className="card pad">
        <div className="kv"><span>Name</span><b>{user.name}</b></div>
        <div className="kv"><span>Email</span><b>{user.email}</b></div>
        <div className="kv"><span>Role</span><b>{user.role}</b></div>
      </div>
      <form className="card pad form" onSubmit={submit}>
        <h2>Change password</h2>
        <label>Current password<input type="password" value={current} onChange={e => setCurrent(e.target.value)} required /></label>
        <label>New password<input type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} required /></label>
        {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
        <button className="btn primary">Change password</button>
      </form>
    </section>
  );
}
