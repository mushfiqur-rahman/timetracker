# Time Tracker

A small Upwork-style time tracker: a Windows desktop app that counts mouse and keyboard activity while a timer runs, and a website where users see their time in 10-minute blocks and admins manage users and devices.

```
server/    API (Node.js + PostgreSQL)
web/       Website (React), served by the API server
desktop/   Windows 11 app (C#, .NET Framework 4.8 — built into Windows, nothing to install)
```

## How it works

- **Tracking.** While the timer is on, the app counts mouse clicks, wheel steps and key presses per minute. Only the counts are stored — never which keys were pressed. A held-down key counts once.
- **Idle.** A tracked minute with no clicks and no key presses is idle time. After 5 minutes without activity the app shows one notification; the timer keeps running and that time is recorded as idle. The notification is re-armed once the user is active again.
- **Timeline.** The website shows each day in 10-minute blocks, with worked and idle minutes per block, plus a week overview.
- **Devices.** The desktop app sends the computer's MAC address and Windows machine ID when signing in. An unknown computer is registered as *pending* and refused until an admin approves it on the Devices page. An admin can also assign a MAC address to a user in advance (Users → Devices). Blocking a device stops the app on that computer within a few minutes.
- **Offline.** Minutes tracked without a connection are saved on the PC and uploaded later.

## Deploy the website on a VPS (Docker)

1. Point a domain (A record) to the VPS and open ports 80 and 443.
2. Copy this folder to the VPS, then:

   ```bash
   cp .env.example .env
   nano .env            # set DOMAIN, passwords and JWT_SECRET
   docker compose up -d --build
   ```

3. Open `https://your-domain` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

Caddy gets the HTTPS certificate automatically. If you already run a reverse proxy on the VPS, remove the `caddy` service and publish the app instead (`ports: ["127.0.0.1:3000:3000"]` under `app`).

Useful commands:

```bash
docker compose logs -f app                                           # server log
docker compose exec db pg_dump -U timetracker timetracker > backup.sql   # backup
docker compose up -d --build                                         # update after changing code
```

## Desktop app

The ready-built app is `desktop/dist/TimeTracker.exe`. Copy it to the user's PC and run it.

- To pre-fill the server address, put a file named `server.txt` containing `https://your-domain` next to the `.exe`.
- The X button hides the window to the tray; the timer keeps running. Quit from the tray icon or the Menu button.
- "Start with Windows" is in the Menu.
- The `.exe` is not code-signed, so Windows SmartScreen will show "Windows protected your PC" on first run (More info → Run anyway). Some antivirus tools also flag unsigned apps that listen for keyboard input; a code-signing certificate removes both warnings.

Build it yourself (Windows or Linux, .NET SDK 8 or newer):

```bash
cd desktop/TimeTracker
dotnet build -c Release
```

## First steps for an admin

1. **Users → Add user**: set name, email and password, and give those to the user.
2. The user runs the desktop app and signs in. The app says the device is waiting for approval and shows its MAC address.
3. **Devices → Approve**. The user signs in again and can start the timer.

## Local development

```bash
# database
docker run -d --name tt-db -e POSTGRES_USER=timetracker -e POSTGRES_PASSWORD=timetracker -e POSTGRES_DB=timetracker -p 5432:5432 postgres:16-alpine
# API on :3000
cd server && npm install && JWT_SECRET=dev-secret-change-me-123 npm start
# website on :5173 (proxies /api to :3000)
cd web && npm install && npm run dev
```
