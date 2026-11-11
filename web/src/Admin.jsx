import React, { useEffect, useState } from 'react';
import { api, startOfDay, addDays, startOfWeek, startOfMonth, fmtDur, pct, fmtDateTime } from './api.js';

const ACCESS = {
  admin: 'Full access — manages users, devices, roles and departments',
  manager: "Manager — sees the time of people in their own department",
  user: 'User — tracks time and sees only their own timeline',
};
const ACCESS_SHORT = { admin: 'Full access', manager: 'Manager', user: 'User' };

// ---------- Team report ----------

export function Team({ user, onOpen }) {
  const [range, setRange] = useState('today');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const isAdmin = user.role === 'admin';

  useEffect(() => { api('/team/departments').then(d => setDepartments(d.departments)).catch(() => {}); }, []);

  useEffect(() => {
    let live = true;
    const load = () => {
      const now = new Date();
      const from = range === 'today' ? startOfDay(now) : range === 'week' ? startOfWeek(now) : startOfMonth(now);
      const dep = isAdmin && department ? `&departmentId=${department}` : '';
      api(`/team/summary?from=${from.toISOString()}&to=${addDays(now, 1).toISOString()}${dep}`)
        .then(d => { if (live) { setUsers(d.users); setError(''); } })
        .catch(e => { if (live) setError(e.message); });
    };
    load();
    const id = setInterval(load, 60000);
    return () => { live = false; clearInterval(id); };
  }, [range, department]);

  return (
    <section>
      <div className="pagehead">
        <div>
          <h1>Team</h1>
          {!isAdmin && <div className="muted">{user.departmentName ? `${user.departmentName} department` : 'You are not in a department yet, so there is nobody to show.'}</div>}
        </div>
        <div className="filters">
          {isAdmin && departments.length > 0 && (
            <select value={department} onChange={e => setDepartment(e.target.value)} aria-label="Department">
              <option value="">All departments</option>
              {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}
          <div className="segmented">
            {[['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([id, label]) => (
              <button key={id} className={range === id ? 'on' : ''} onClick={() => setRange(id)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Person</th><th>Department</th><th className="num">Worked</th><th className="num">Active</th><th className="num">Idle</th><th>Activity</th><th>Last tracked</th><th /></tr></thead>
          <tbody>
            {users?.map(u => (
              <tr key={u.id} className="clickable" onClick={() => onOpen(u)}>
                <td data-label="Person"><div>{u.name}{!u.active && <span className="pill revoked">disabled</span>}<div className="sub">{u.email}</div></div></td>
                <td data-label="Department"><div>{u.departmentName || '—'}<div className="sub">{u.roleName}</div></div></td>
                <td data-label="Worked" className="num"><b>{fmtDur(u.total)}</b></td>
                <td data-label="Active" className="num">{fmtDur(u.total - u.idle)}</td>
                <td data-label="Idle" className="num idletext">{fmtDur(u.idle)}</td>
                <td data-label="Activity">
                  <div>
                    <div className="meter" title={`${pct(u.total - u.idle, u.total)}% active`}>
                      <span style={{ width: `${pct(u.total - u.idle, u.total)}%` }} />
                    </div>
                    <span className="sub">{u.total ? `${pct(u.total - u.idle, u.total)}% active` : 'No time'}</span>
                  </div>
                </td>
                <td data-label="Last tracked">{fmtDateTime(u.last_activity)}</td>
                <td className="num rowlink"><span className="link">Timeline →</span></td>
              </tr>
            ))}
            {users === null && <tr><td colSpan="8" className="empty">Loading…</td></tr>}
            {users && users.length === 0 && <tr><td colSpan="8" className="empty">Nobody to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Users ----------

export function Users({ me, onDevicesChanged }) {
  const [users, setUsers] = useState(null);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [editing, setEditing] = useState(null);     // user object, or {} for new
  const [devicesFor, setDevicesFor] = useState(null);
  const [link, setLink] = useState(null);           // { user, token, days, isNew }
  const [error, setError] = useState('');

  const load = () => api('/admin/users').then(d => setUsers(d.users)).catch(e => setError(e.message));
  useEffect(() => {
    load();
    api('/admin/roles').then(d => setRoles(d.roles)).catch(() => {});
    api('/admin/departments').then(d => setDepartments(d.departments)).catch(() => {});
  }, []);

  const toggle = async u => {
    try { await api(`/admin/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } }); load(); }
    catch (e) { setError(e.message); }
  };
  const remove = async u => {
    if (!confirm(`Delete ${u.name}? This permanently removes the account, its devices and all tracked time.`)) return;
    try { await api(`/admin/users/${u.id}`, { method: 'DELETE' }); load(); onDevicesChanged?.(); }
    catch (e) { setError(e.message); }
  };
  const newLink = async u => {
    if (u.has_password && !confirm(`Create a password link for ${u.name}? They can use it to choose a new password. Their current password keeps working until they do.`)) return;
    try {
      const d = await api(`/admin/users/${u.id}/setup-link`, { method: 'POST' });
      setLink({ user: u, token: d.setupToken, days: d.setupDays, isNew: false });
    } catch (e) { setError(e.message); }
  };

  return (
    <section>
      <div className="pagehead">
        <h1>Users</h1>
        <button className="btn primary" onClick={() => setEditing({})}>+ Add user</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card table-wrap">
        <table className="stack">
          <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Devices</th><th>Status</th><th>Last seen</th><th /></tr></thead>
          <tbody>
            {users?.map(u => (
              <tr key={u.id}>
                <td data-label="Name"><div>{u.name}<div className="sub">{u.email}</div></div></td>
                <td data-label="Role">{u.role_name}</td>
                <td data-label="Department">{u.department_name || '—'}</td>
                <td data-label="Devices">
                  <button className="link" onClick={() => setDevicesFor(u)}>
                    {u.approved_devices} approved{u.pending_devices > 0 && <span className="badge">{u.pending_devices} pending</span>}
                  </button>
                </td>
                <td data-label="Status">
                  {!u.active ? <span className="pill revoked">disabled</span>
                    : u.has_password ? <span className="pill approved">active</span>
                      : <span className="pill pending" title="This person has not chosen a password yet">invited</span>}
                </td>
                <td data-label="Last seen">{fmtDateTime(u.last_seen_at)}</td>
                <td className="actions">
                  <button className="btn small" onClick={() => setEditing(u)}>Edit</button>
                  <button className="btn small" onClick={() => setDevicesFor(u)}>Devices</button>
                  {u.active && <button className="btn small" onClick={() => newLink(u)}>Password link</button>}
                  {u.id !== me.id && <button className="btn small" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button>}
                  {u.id !== me.id && <button className="btn small danger" onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            ))}
            {users === null && <tr><td colSpan="7" className="empty">Loading…</td></tr>}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserDialog user={editing} isSelf={editing.id === me.id} roles={roles} departments={departments}
          onClose={() => setEditing(null)}
          onSaved={created => { setEditing(null); load(); if (created) setLink(created); }} />
      )}
      {devicesFor && <UserDevicesDialog user={devicesFor} onClose={() => { setDevicesFor(null); load(); onDevicesChanged?.(); }} />}
      {link && <SetupLinkDialog link={link} onClose={() => setLink(null)} />}
    </section>
  );
}

function UserDialog({ user, isSelf, roles, departments, onClose, onSaved }) {
  const isNew = !user.id;
  const defaultRole = roles.find(r => r.access === 'user' && r.system)?.id || roles[0]?.id || '';
  const [f, setF] = useState({
    name: user.name || '', email: user.email || '',
    roleId: user.role_id || defaultRole, departmentId: user.department_id || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const body = { name: f.name, email: f.email, departmentId: f.departmentId ? Number(f.departmentId) : null };
      if (!isSelf && f.roleId) body.roleId = Number(f.roleId);
      const d = await api(isNew ? '/admin/users' : `/admin/users/${user.id}`, { method: isNew ? 'POST' : 'PATCH', body });
      onSaved(isNew ? { user: d.user, token: d.setupToken, days: d.setupDays, isNew: true } : null);
    } catch (err) { setError(err.message); setBusy(false); }
  };

  return (
    <Modal title={isNew ? 'Add user' : `Edit ${user.name}`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Full name<input value={f.name} onChange={set('name')} required autoFocus /></label>
        <label>Email<input type="email" value={f.email} onChange={set('email')} required /></label>
        {!isSelf && (
          <label>Role
            <select value={f.roleId} onChange={set('roleId')} required>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name} — {ACCESS_SHORT[r.access]}</option>)}
            </select>
          </label>
        )}
        <label>Department
          <select value={f.departmentId} onChange={set('departmentId')}>
            <option value="">No department</option>
            {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {isNew && <p className="muted small">You do not set a password. After saving you get a link to send to this person, and they choose their own password.</p>}
        {error && <div className="error">{error}</div>}
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{isNew ? 'Create user' : 'Save'}</button>
        </div>
      </form>
    </Modal>
  );
}

function SetupLinkDialog({ link, onClose }) {
  const url = `${window.location.origin}/?setup=${link.token}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* the field is selectable, the user can copy by hand */ }
  };
  return (
    <Modal title={link.isNew ? `${link.user.name} was added` : `Password link for ${link.user.name}`} onClose={onClose}>
      <p>Send this link to <b>{link.user.email}</b>. They open it and choose their own password.</p>
      <div className="row">
        <input className="mono" readOnly value={url} onFocus={e => e.target.select()} aria-label="Setup link" />
        <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
      </div>
      <p className="muted small linknote">The link works once and expires after {link.days} days. It is shown only now; if it gets lost, use "Password link" in the user list to make a new one.</p>
      <div className="row end"><button className="btn" onClick={onClose}>Done</button></div>
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
          ? <div className="empty">Nothing waiting.</div>
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
    <table className="stack">
      <thead>
        <tr>{showUser && <th>User</th>}<th>Computer</th><th>MAC address</th><th>Status</th><th>Last used</th><th /></tr>
      </thead>
      <tbody>
        {devices?.map(d => {
          const macChanged = d.last_macs?.length > 0 && !d.last_macs.includes(d.mac);
          return (
            <tr key={d.id}>
              {showUser && <td data-label="User"><div>{d.user_name}<div className="sub">{d.user_email}</div></div></td>}
              <td data-label="Computer">
                <div>{d.label || d.hostname || <span className="muted">Not connected yet</span>}
                  <div className="sub">{[d.label && d.hostname, d.os].filter(Boolean).join(' · ')}</div>
                </div>
              </td>
              <td data-label="MAC address" className="mono">
                <div>{d.mac}
                  {macChanged && <div className="sub warn" title={`Now reporting: ${d.last_macs.join(', ')}`}>⚠ MAC changed since approval</div>}
                </div>
              </td>
              <td data-label="Status"><span className={`pill ${d.status}`}>{d.status}</span></td>
              <td data-label="Last used">{fmtDateTime(d.last_seen_at)}</td>
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

// ---------- Roles & departments ----------

export function Organization() {
  const [roles, setRoles] = useState(null);
  const [departments, setDepartments] = useState(null);
  const [error, setError] = useState('');
  const [depName, setDepName] = useState('');
  const [role, setRole] = useState({ name: '', access: 'user' });

  const load = () => {
    api('/admin/roles').then(d => setRoles(d.roles)).catch(e => setError(e.message));
    api('/admin/departments').then(d => setDepartments(d.departments)).catch(e => setError(e.message));
  };
  useEffect(load, []);

  const run = async (path, method, body) => {
    setError('');
    try { await api(path, { method, body }); load(); return true; }
    catch (e) { setError(e.message); return false; }
  };
  const addDepartment = async e => { e.preventDefault(); if (await run('/admin/departments', 'POST', { name: depName })) setDepName(''); };
  const addRole = async e => { e.preventDefault(); if (await run('/admin/roles', 'POST', role)) setRole({ name: '', access: 'user' }); };
  const rename = (kind, item) => {
    const name = prompt(`New name for "${item.name}"`, item.name);
    if (name && name.trim() && name.trim() !== item.name) run(`/admin/${kind}/${item.id}`, 'PATCH', { name: name.trim() });
  };

  return (
    <section>
      <div className="pagehead"><h1>Roles &amp; departments</h1></div>
      {error && <div className="error">{error}</div>}

      <div className="twocol">
        <div>
          <h2 className="section first">Departments</h2>
          <p className="muted">Group people by team. A manager sees the time of everyone in their own department.</p>
          <div className="card table-wrap">
            <table className="stack">
              <thead><tr><th>Department</th><th className="num">People</th><th /></tr></thead>
              <tbody>
                {departments?.map(d => (
                  <tr key={d.id}>
                    <td data-label="Department">{d.name}</td>
                    <td data-label="People" className="num">{d.users}</td>
                    <td className="actions">
                      <button className="btn small" onClick={() => rename('departments', d)}>Rename</button>
                      <button className="btn small danger" onClick={() => { if (confirm(`Delete the ${d.name} department? Its ${d.users} people stay, without a department.`)) run(`/admin/departments/${d.id}`, 'DELETE'); }}>Delete</button>
                    </td>
                  </tr>
                ))}
                {departments && departments.length === 0 && <tr><td colSpan="3" className="empty">No departments yet. Add your first one below.</td></tr>}
                {departments === null && <tr><td colSpan="3" className="empty">Loading…</td></tr>}
              </tbody>
            </table>
            <form className="addrow" onSubmit={addDepartment}>
              <input placeholder="New department, e.g. Design" value={depName} onChange={e => setDepName(e.target.value)} required maxLength={100} aria-label="New department name" />
              <button className="btn primary">Add department</button>
            </form>
          </div>
        </div>

        <div>
          <h2 className="section first">Roles</h2>
          <p className="muted">Name roles the way your company does. Each role gets one of three access levels.</p>
          <div className="card table-wrap">
            <table className="stack">
              <thead><tr><th>Role</th><th>Access</th><th className="num">People</th><th /></tr></thead>
              <tbody>
                {roles?.map(r => (
                  <tr key={r.id}>
                    <td data-label="Role">{r.name}{r.system && <span className="pill neutral">built-in</span>}</td>
                    <td data-label="Access">
                      {r.system ? ACCESS_SHORT[r.access] : (
                        <select value={r.access} onChange={e => run(`/admin/roles/${r.id}`, 'PATCH', { access: e.target.value })} aria-label={`Access for ${r.name}`}>
                          {Object.keys(ACCESS_SHORT).map(a => <option key={a} value={a}>{ACCESS_SHORT[a]}</option>)}
                        </select>
                      )}
                    </td>
                    <td data-label="People" className="num">{r.users}</td>
                    <td className="actions">
                      {!r.system && <button className="btn small" onClick={() => rename('roles', r)}>Rename</button>}
                      {!r.system && <button className="btn small danger" onClick={() => { if (confirm(`Delete the role ${r.name}?`)) run(`/admin/roles/${r.id}`, 'DELETE'); }}>Delete</button>}
                    </td>
                  </tr>
                ))}
                {roles === null && <tr><td colSpan="4" className="empty">Loading…</td></tr>}
              </tbody>
            </table>
            <form className="addrow" onSubmit={addRole}>
              <input placeholder="New role, e.g. Team Lead" value={role.name} onChange={e => setRole({ ...role, name: e.target.value })} required maxLength={100} aria-label="New role name" />
              <select value={role.access} onChange={e => setRole({ ...role, access: e.target.value })} aria-label="Access level">
                {Object.keys(ACCESS_SHORT).map(a => <option key={a} value={a}>{ACCESS_SHORT[a]}</option>)}
              </select>
              <button className="btn primary">Add role</button>
            </form>
          </div>
          <ul className="muted small accesslist">
            {Object.keys(ACCESS).map(a => <li key={a}>{ACCESS[a]}</li>)}
          </ul>
        </div>
      </div>
    </section>
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
