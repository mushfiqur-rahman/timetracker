import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const mb = bytes => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

// Download buttons for the desktop app. Used on the sign-in page and on the guide page.
export function DownloadButtons() {
  const [files, setFiles] = useState(null);
  useEffect(() => { api('/downloads').then(setFiles).catch(() => setFiles({})); }, []);
  if (files && !files.windows && !files.mac) return <p className="muted small">Ask your admin for the desktop app.</p>;
  return (
    <div className="downloads">
      {files?.windows && (
        <a className="btn primary dl" href={files.windows.url} download>
          <b>Download for Windows</b><span>Windows 10 and 11 · {mb(files.windows.size)}</span>
        </a>
      )}
      {files?.mac && (
        <a className="btn dl" href={files.mac.url} download>
          <b>Download for Mac</b><span>macOS 12 or newer · {mb(files.mac.size)}</span>
        </a>
      )}
    </div>
  );
}

function ServerAddress() {
  const address = window.location.origin;
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* selectable by hand */ }
  };
  return (
    <span className="addr">
      <code>{address}</code>
      <button type="button" className="btn small" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </span>
  );
}

// Shown next to the sign-in form: what this is, where to get the app, how to start.
export function HomeGuide({ canSignUp }) {
  return (
    <div className="card pad homeguide">
      <h2>Get the desktop app</h2>
      <p className="muted">The app runs the timer on your computer. This website shows your tracked time.</p>
      <DownloadButtons />
      <h3>How to start</h3>
      <ol className="steps">
        <li>{canSignUp ? <>Click <b>Create an account</b> and choose your own password. An admin approves your account.</> : <>Ask your admin for an account. You choose your own password.</>}</li>
        <li>Download the app above and open it.</li>
        <li>In the app, enter the server address <ServerAddress />, then your email and password.</li>
        <li>The first time on a computer, an admin has to approve that computer. Then sign in again.</li>
        <li>Switch the timer on when you start working and off when you stop.</li>
      </ol>
      <p className="muted small">The app counts mouse and keyboard activity, never what you type. A pause of 3 minutes or longer is marked idle. You can be signed in on one computer at a time.</p>
    </div>
  );
}

function Step({ n, title, children, action }) {
  return (
    <div className="gstep">
      <div className="gnum">{n}</div>
      <div className="gbody">
        <h3>{title}</h3>
        <div className="gtext">{children}</div>
        {action}
      </div>
    </div>
  );
}

// The "Guide" page. Everyone gets the user guide; admins and managers get their part on top.
export default function Guide({ user, go }) {
  const isAdmin = user.role === 'admin';
  const isManager = user.role === 'manager';
  const [tab, setTab] = useState(isAdmin ? 'admin' : 'user');
  const jump = (page, label) => <button className="btn small" onClick={() => go(page)}>{label} →</button>;

  return (
    <section className="guide">
      <div className="pagehead">
        <h1>Guide</h1>
        {isAdmin && (
          <div className="segmented">
            <button className={tab === 'admin' ? 'on' : ''} onClick={() => setTab('admin')}>For admins</button>
            <button className={tab === 'user' ? 'on' : ''} onClick={() => setTab('user')}>For users</button>
          </div>
        )}
      </div>

      {tab === 'admin' && isAdmin && (
        <>
          <div className="card pad">
            <h2>Setting up your team</h2>
            <p className="muted">Do these once, in this order. You can change everything later.</p>
            <Step n="1" title="Create departments" action={jump('org', 'Roles & departments')}>
              Group people by team, for example Design or Support. Departments are used to filter the Team report, and a manager only sees their own department.
            </Step>
            <Step n="2" title="Create roles (optional)" action={jump('org', 'Roles & departments')}>
              Three roles exist already: Admin, Manager and User. Add your own names, such as "Team Lead", and give each one an access level:
              <ul>
                <li><b>User</b> tracks time and sees only their own timeline.</li>
                <li><b>Manager</b> also sees the time of people in their own department.</li>
                <li><b>Full access</b> can do everything you can.</li>
              </ul>
            </Step>
            <Step n="3" title="Let people join" action={jump('users', 'Users')}>
              Give everyone this website's address: <ServerAddress />. There are two ways to get an account:
              <ul>
                <li><b>They sign up themselves</b> with <i>Create an account</i> on the sign-in page. The account shows up under Users as "waiting for approval". Click <b>Approve</b>, then <b>Edit</b> to set role and department. Click <b>Reject</b> if you do not know the person.</li>
                <li><b>You add them</b> with <i>Add user</i>. You get a one-time link to send them; they open it and choose their password.</li>
              </ul>
              You never see or set anyone's password.
            </Step>
            <Step n="4" title="Approve their computers" action={jump('devices', 'Devices')}>
              When someone signs in to the desktop app on a computer for the first time, that computer appears under Devices as "waiting for approval". Check the name and MAC address, then click <b>Approve</b>. Until then the app will not track on it. Even with several approved computers, a person can be signed in on only <b>one at a time</b>: signing in on another computer signs the first one out. The Devices page marks that computer "signed in". Two screens on one computer are fine.
            </Step>
            <Step n="5" title="Follow the work" action={jump('team', 'Team')}>
              The Team page shows worked, active and idle time per person for today, this week or this month. Click a person to see their day in 10-minute blocks.
            </Step>
          </div>

          <div className="card pad">
            <h2>Everyday tasks</h2>
            <div className="table-wrap">
              <table className="stack">
                <thead><tr><th>When</th><th>Do this</th></tr></thead>
                <tbody>
                  <tr><td data-label="When">The Users or Devices tab shows a number</td><td data-label="Do this">Someone is waiting for approval. Open that tab and approve or reject.</td></tr>
                  <tr><td data-label="When">Someone forgot their password</td><td data-label="Do this">Users → Password link. Send them the link; they choose a new password.</td></tr>
                  <tr><td data-label="When">Someone got a new computer</td><td data-label="Do this">They sign in on it once, then you approve it under Devices. Remove or block the old one.</td></tr>
                  <tr><td data-label="When">A computer is lost or should stop tracking</td><td data-label="Do this">Devices → Block. The app on that computer signs out within a few minutes.</td></tr>
                  <tr><td data-label="When">Someone leaves for a while</td><td data-label="Do this">Users → Disable. Their time is kept; they cannot sign in.</td></tr>
                  <tr><td data-label="When">Someone leaves for good</td><td data-label="Do this">Users → Delete. This also deletes their tracked time, so export or note it first.</td></tr>
                  <tr><td data-label="When">Someone changes team</td><td data-label="Do this">Users → Edit, and pick the new department or role.</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <div className="card pad">
            <h2>Reading the numbers</h2>
            <ul className="plain">
              <li><b>Worked</b> is all the time the timer was on.</li>
              <li><b>Active</b> is worked time with mouse or keyboard activity (clicks, scrolling, movement, typing).</li>
              <li><b>Idle</b> is worked time inside a pause of 3 minutes or longer with no activity at all. Shorter pauses still count as active. After 5 idle minutes the person gets one reminder; the timer keeps running.</li>
              <li>In the timeline, each small bar is one minute: <span className="dotword"><i className="dot active" />green active</span>, <span className="dotword"><i className="dot idle" />amber idle</span>, <span className="dotword"><i className="dot none" />grey not tracked</span>.</li>
              <li>The app records how much activity there was, never which keys were pressed, and takes no screenshots.</li>
            </ul>
            <h3 className="gap">Status labels</h3>
            <ul className="plain">
              <li><span className="pill pending">waiting for approval</span> a sign-up or a computer you have not accepted yet.</li>
              <li><span className="pill pending">invited</span> you added the person, but they have not chosen a password yet.</li>
              <li><span className="pill approved">active</span> / <span className="pill approved">approved</span> can sign in / can track.</li>
              <li><span className="pill revoked">disabled</span> / <span className="pill revoked">revoked</span> blocked by an admin.</li>
            </ul>
          </div>
        </>
      )}

      {(tab === 'user' || !isAdmin) && (
        <>
          {isManager && (
            <div className="card pad">
              <h2>For managers</h2>
              <p>The <b>Team</b> page shows the worked, active and idle time of everyone in your department{user.departmentName ? <> (<b>{user.departmentName}</b>)</> : null}. Click a person to see their day in 10-minute blocks. You cannot change users or devices; ask an admin for that.</p>
              {jump('team', 'Team')}
            </div>
          )}

          <div className="card pad">
            <h2>1. Install the desktop app</h2>
            <DownloadButtons />
            <div className="twocol guidecols">
              <div>
                <h3>Windows</h3>
                <ol className="steps">
                  <li>Open the downloaded <code>TimeTracker.exe</code>. Nothing is installed; keep the file somewhere you will find it, such as the Desktop.</li>
                  <li>If Windows shows "Windows protected your PC", click <b>More info</b>, then <b>Run anyway</b>.</li>
                  <li>The app's round clock icon sits next to the Windows clock. Closing the window keeps the timer running; right-click the icon to quit.</li>
                </ol>
              </div>
              <div>
                <h3>Mac</h3>
                <ol className="steps">
                  <li>Open the downloaded zip and drag <b>TimeTracker</b> into Applications.</li>
                  <li>Open it once. If macOS blocks it, go to <b>System Settings → Privacy &amp; Security</b> and click <b>Open Anyway</b>.</li>
                  <li>Allow notifications when asked. The clock icon in the menu bar opens the window or quits the app.</li>
                </ol>
              </div>
            </div>
          </div>

          <div className="card pad">
            <h2>2. Sign in to the app</h2>
            <ol className="steps">
              <li>Server address: <ServerAddress /></li>
              <li>Email and password: the same ones you use on this website.</li>
              <li>The first time on a computer, the app says it is waiting for approval. Tell your admin; once they approve the computer, click <b>Sign in</b> again.</li>
            </ol>
          </div>

          <div className="card pad">
            <h2>3. Track your time</h2>
            <ol className="steps">
              <li>Switch the big toggle <b>on</b> when you start working and <b>off</b> when you stop or take a break.</li>
              <li>The app shows the current session, today's total and this week's total.</li>
              <li>Short pauses are fine. If you do not touch the mouse or keyboard for 3 minutes or longer, that whole pause is marked idle, and after 5 minutes you get one reminder. Switch the timer off if you are away.</li>
              <li>You can be signed in on one computer at a time. Signing in on another computer signs you out on the first one.</li>
              <li>No internet? Keep working. The app saves your time and uploads it when you are back online.</li>
            </ol>
            <p className="muted small">The app counts clicks, scrolling, mouse movement and key presses. It never records what you type and takes no screenshots.</p>
          </div>

          <div className="card pad">
            <h2>4. See your time here</h2>
            <ul className="plain">
              <li><b>My time</b> shows any day in 10-minute blocks, with worked, active and idle time and a week overview.</li>
              <li><b>My devices</b> lists your computers and whether they are approved.</li>
              <li>Click your name at the top to change your password. If you forget it, ask your admin for a password link.</li>
            </ul>
            <div className="row">{jump('time', 'My time')}{!isAdmin && jump('mydevices', 'My devices')}</div>
          </div>
        </>
      )}
    </section>
  );
}
