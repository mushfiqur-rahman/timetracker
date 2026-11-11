import React, { useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler, fmtDateTime } from './api.js';
import Timeline from './Timeline.jsx';
import { Team, Users, Devices, Organization } from './Admin.jsx';

const setupTokenFromUrl = () => new URLSearchParams(window.location.search).get('setup');

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(!!getToken());
  const [page, setPage] = useState('time');
  const [viewUser, setViewUser] = useState(null); // admin or manager looking at one person's timeline
  const [pending, setPending] = useState(0);            // devices waiting for approval
  const [pendingUsers, setPendingUsers] = useState(0);  // self sign-ups waiting for approval
  const [setupToken, setSetupToken] = useState(setupTokenFromUrl);

  const signOut = () => { setToken(null); setUser(null); setPage('time'); setViewUser(null); };
  const home = u => (u.role === 'user' ? 'time' : 'team');

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    if (!getToken() || setupToken) { setLoading(false); return; }
    api('/me').then(d => { setUser(d.user); setPage(home(d.user)); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const isAdmin = user?.role === 'admin';
  const isManager = user?.role === 'manager';
  const refreshPending = () => {
    if (!isAdmin) return;
    api('/admin/devices').then(d => setPending(d.devices.filter(x => x.status === 'pending').length)).catch(() => {});
    api('/admin/users').then(d => setPendingUsers(d.users.filter(x => !x.approved).length)).catch(() => {});
  };
  useEffect(() => {
    if (!isAdmin) return;
    refreshPending();
    const id = setInterval(refreshPending, 30000);
    return () => clearInterval(id);
  }, [isAdmin]);

  if (loading) return <div className="center muted">Loading…</div>;

  if (setupToken) {
    const done = u => {
      window.history.replaceState(null, '', window.location.pathname);
      setSetupToken(null);
      if (u) { setUser(u); setPage(home(u)); }
    };
    return <SetPassword token={setupToken} onDone={done} />;
  }

  if (!user) return <Login onLogin={u => { setUser(u); setPage(home(u)); }} />;

  const tabs = isAdmin
    ? [['team', 'Team'], ['users', 'Users'], ['devices', 'Devices'], ['org', 'Roles & departments'], ['time', 'My time']]
    : isManager
      ? [['team', 'Team'], ['time', 'My time'], ['mydevices', 'My devices']]
      : [['time', 'My time'], ['mydevices', 'My devices']];
  const go = p => { setPage(p); setViewUser(null); };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand"><span className="logo" aria-hidden="true" />Time Tracker</div>
        <div className="who">
          <button className={`tab ${page === 'account' ? 'active' : ''}`} onClick={() => go('account')} title="Account settings">
            {user.name}
          </button>
          <button className="btn ghost" onClick={signOut}>Sign out</button>
        </div>
        <nav>
          {tabs.map(([id, label]) => (
            <button key={id} className={`tab ${page === id ? 'active' : ''}`} onClick={() => go(id)}>
              {label}
              {id === 'devices' && pending > 0 && <span className="badge">{pending}</span>}
              {id === 'users' && pendingUsers > 0 && <span className="badge">{pendingUsers}</span>}
            </button>
          ))}
        </nav>
      </header>

      <main>
        {page === 'time' && <Timeline title="My time" />}
        {page === 'mydevices' && <MyDevices />}
        {page === 'account' && <Account user={user} />}
        {(isAdmin || isManager) && page === 'team' && (viewUser
          ? <Timeline title={viewUser.name} subtitle={viewUser.email} userId={viewUser.id} onBack={() => setViewUser(null)} />
          : <Team user={user} onOpen={setViewUser} />)}
        {isAdmin && page === 'users' && <Users me={user} onChanged={refreshPending} />}
        {isAdmin && page === 'devices' && <Devices onChanged={refreshPending} />}
        {isAdmin && page === 'org' && <Organization />}
      </main>
    </div>
  );
}

function Login({ onLogin }) {
  const [mode, setMode] = useState('login');
  const [canSignUp, setCanSignUp] = useState(false);
  useEffect(() => { api('/auth/config').then(d => setCanSignUp(!!d.signup)).catch(() => {}); }, []);
  if (mode === 'signup') return <SignUp onBack={() => setMode('login')} />;
  return <LoginForm onLogin={onLogin} onSignUp={canSignUp ? () => setMode('signup') : null} />;
}

function LoginForm({ onLogin, onSignUp }) {
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
        <p className="muted">Sign in with your email and the password you chose.</p>
        <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus required autoComplete="username" /></label>
        <label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {error && <div className="error">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {onSignUp && <p className="hint">New here? <button type="button" className="link" onClick={onSignUp}>Create an account</button></p>}
        <p className="muted small hint">Forgot your password? Ask your admin for a password link.</p>
      </form>
    </div>
  );
}

// People create their own account with their own password. An admin approves it before the first sign-in.
function SignUp({ onBack }) {
  const [f, setF] = useState({ name: '', email: '', password: '', again: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    if (f.password !== f.again) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError('');
    try {
      await api('/auth/signup', { method: 'POST', body: { name: f.name, email: f.email, password: f.password } });
      setDone(true);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big"><span className="logo" aria-hidden="true" />Time Tracker</div>
        {done ? (
          <>
            <div className="success">Your account was created.</div>
            <p>An admin now needs to approve it. After that you can sign in here and in the desktop app with <b>{f.email}</b> and the password you just chose.</p>
            <button type="button" className="btn primary wide" onClick={onBack}>Back to sign in</button>
          </>
        ) : (
          <>
            <p className="muted">Create your account. Only you know your password; it is stored encrypted and admins cannot see it.</p>
            <label>Full name<input value={f.name} onChange={set('name')} required autoFocus autoComplete="name" /></label>
            <label>Email<input type="email" value={f.email} onChange={set('email')} required autoComplete="username" /></label>
            <label>Password<input type="password" value={f.password} onChange={set('password')} minLength={8} required autoComplete="new-password" /></label>
            <label>Repeat password<input type="password" value={f.again} onChange={set('again')} minLength={8} required autoComplete="new-password" /></label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary wide" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
            <p className="hint">Already have an account? <button type="button" className="link" onClick={onBack}>Sign in</button></p>
          </>
        )}
      </form>
    </div>
  );
}

// Opened from the one-time link an admin sends: the user chooses their own password.
function SetPassword({ token, onDone }) {
  const [who, setWho] = useState(null);
  const [invalid, setInvalid] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/auth/setup/${encodeURIComponent(token)}`).then(setWho).catch(e => setInvalid(e.message));
  }, [token]);

  const submit = async e => {
    e.preventDefault();
    if (password !== again) { setError('The two passwords are not the same.'); return; }
    setBusy(true); setError('');
    try {
      const d = await api('/auth/setup', { method: 'POST', body: { token, password } });
      setToken(d.token);
      onDone(d.user);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big"><span className="logo" aria-hidden="true" />Time Tracker</div>
        {invalid ? (
          <>
            <div className="error">{invalid}</div>
            <button type="button" className="btn wide" onClick={() => onDone(null)}>Go to sign in</button>
          </>
        ) : !who ? <p className="muted">Checking your link…</p> : (
          <>
            <p className="muted">Welcome, <b>{who.name}</b>. Choose a password for <b>{who.email}</b>. You will use it on this website and in the desktop app.</p>
            <label>New password<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required autoFocus autoComplete="new-password" /></label>
            <label>Repeat password<input type="password" value={again} onChange={e => setAgain(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
            {error && <div className="error">{error}</div>}
            <button className="btn primary wide" disabled={busy}>{busy ? 'Saving…' : 'Save password and sign in'}</button>
            <p className="muted small hint">At least 8 characters.</p>
          </>
        )}
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
        <table className="stack">
          <thead><tr><th>Computer</th><th>MAC address</th><th>Status</th><th>Last used</th></tr></thead>
          <tbody>
            {devices?.map(d => (
              <tr key={d.id}>
                <td data-label="Computer"><div>{d.label || d.hostname || 'Not connected yet'}<div className="sub">{d.os}</div></div></td>
                <td data-label="MAC address" className="mono">{d.mac}</td>
                <td data-label="Status"><span className={`pill ${d.status}`}>{d.status}</span></td>
                <td data-label="Last used">{fmtDateTime(d.last_seen_at)}</td>
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
        <div className="kv"><span>Role</span><b>{user.roleName}</b></div>
        <div className="kv"><span>Department</span><b>{user.departmentName || '—'}</b></div>
      </div>
      <form className="card pad form" onSubmit={submit}>
        <h2>Change password</h2>
        <label>Current password<input type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoComplete="current-password" /></label>
        <label>New password<input type="password" value={next} onChange={e => setNext(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
        {msg && <div className={msg.ok ? 'success' : 'error'}>{msg.text}</div>}
        <button className="btn primary">Change password</button>
      </form>
    </section>
  );
}
