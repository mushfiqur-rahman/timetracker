# Time Tracker

A small Upwork-style time tracker for a team.

- **Desktop app** (Windows and macOS): a timer with an on/off switch. While it runs, it counts mouse clicks and key presses per minute.
- **Website**: users see their worked and idle time in 10-minute blocks; admins manage users, roles, departments and devices.

![Website](web-preview.png)

## Contents

1. [How it works](#1-how-it-works)
2. [What is in this repository](#2-what-is-in-this-repository)
3. [Deploy the website](#3-deploy-the-website)
   - [Option A: Hostinger Business Web Hosting](#option-a-hostinger-business-web-hosting-no-docker)
   - [Option B: VPS with Docker](#option-b-vps-with-docker)
4. [First-time setup as admin](#4-first-time-setup-as-admin)
5. [Install the desktop app](#5-install-the-desktop-app)
6. [Daily use](#6-daily-use)
7. [Roles and access](#7-roles-and-access)
8. [Settings reference](#8-settings-reference)
9. [Updating and backups](#9-updating-and-backups)
10. [Troubleshooting](#10-troubleshooting)
11. [Uninstall](#11-uninstall)
12. [For developers](#12-for-developers)

---

## 1. How it works

| Topic | Behaviour |
| --- | --- |
| Tracking | While the timer is on, the app counts mouse clicks, scroll steps, mouse movement and key presses per minute, on all monitors. Movement counts as one mouse action for each second the pointer moves. Only the counts are stored, never which keys were pressed. |
| Idle time | A pause of 3 minutes or longer with no mouse activity and no key presses is idle, in full. Shorter pauses still count as active. After 5 minutes without activity the app shows one notification. The timer keeps running and that time is recorded as idle. |
| Timeline | The website shows each day in 10-minute blocks with worked and idle minutes, plus a week overview. Times use the 12-hour clock. |
| Devices | The desktop app identifies the computer by its MAC address and hardware ID. A new computer is refused until an admin approves it. A person can be signed in on only one computer at a time: signing in on another one signs the first out. Several screens on one computer are fine. |
| Accounts | People create their own account with their own email and password, and an admin approves it. An admin can also add someone and send them a one-time link to choose a password. |
| Passwords | Only the user knows their password. The database stores a one-way bcrypt hash, not the password, so admins and anyone with database access cannot read it. |
| Offline | Minutes tracked without internet are saved on the computer and uploaded later. |

## 2. What is in this repository

```
server.js       Entry file used by hosting
server/src      API server (Node.js, MySQL or MariaDB)
server/public   The website, already built
web/            Website source (React)
desktop/        Windows app. Ready to use: desktop/dist/TimeTracker.exe
desktop-mac/    macOS app. Ready to use: desktop-mac/dist/TimeTracker-mac.zip
```

## 3. Deploy the website

You need the website running before anyone can use the desktop app. Pick one option.

### Option A: Hostinger Business Web Hosting (no Docker)

Works on Hostinger's Business and Cloud plans, which can run Node.js apps. Nothing is compiled on the server.

**Step 1. Create the database**

1. hPanel → **Databases → Management**.
2. Enter a database name, a username and a password, then click **Create**.
3. Note the full names hPanel shows. Hostinger adds a prefix, for example `u123456789_timetracker`.

**Step 2. Add the app**

1. hPanel → **Websites → Add Website → Node.js web app**.
2. Choose **Import from GitHub**, authorise Hostinger and select this repository, branch `main`.
3. Choose your domain.

**Step 3. Check the build settings**

| Setting | Value |
| --- | --- |
| Framework | Express |
| Node.js version | 20 or 22 |
| Build command | leave empty |
| Output directory | leave empty |
| Entry file | `server.js` |

**Step 4. Add the environment variables**

In the app's dashboard open **Environment variables** and add:

| Name | Value |
| --- | --- |
| `DB_HOST` | `127.0.0.1` |
| `DB_NAME` | database name from step 1 |
| `DB_USER` | database username from step 1 |
| `DB_PASSWORD` | database password from step 1 |
| `JWT_SECRET` | a random string of 32 or more letters and digits (see [Settings reference](#8-settings-reference)) |
| `ADMIN_EMAIL` | email for the first admin account |
| `ADMIN_PASSWORD` | password for the first admin account, 8 or more characters |

Do not add `PORT`; Hostinger sets it.

**Step 5. Deploy**

Click **Deploy**. When it is running, open your domain: you should see the Time Tracker sign-in page. The database tables are created automatically.

If the page says "Time Tracker is not configured yet", it also names the variable to fix. Correct it in hPanel and restart the app.

### Option B: VPS with Docker

1. Point your domain (A record) to the VPS and open ports 80 and 443.
2. Copy this repository to the VPS:

   ```bash
   git clone https://github.com/mushfiqur-rahman/timetracker.git
   cd timetracker
   cp .env.example .env
   nano .env
   ```

3. In `.env`, set `DOMAIN`, `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. Start it:

   ```bash
   docker compose up -d --build
   ```

5. Open `https://your-domain`. The HTTPS certificate is issued automatically.

If the VPS already runs a reverse proxy, remove the `caddy` service from `docker-compose.yml` and add `ports: ["127.0.0.1:3000:3000"]` under `app`.

## 4. First-time setup as admin

1. **Sign in** on the website with `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
2. **Create departments** (optional): **Roles & departments → Add department**, for example Design, Support.
3. **Create roles** (optional): on the same page, add roles with your own names, for example "Team Lead", and pick an access level for each. See [Roles and access](#7-roles-and-access).
4. **Let people join.** There are two ways; use either or both:
   - **They sign up themselves.** On the sign-in page they click **Create an account** and enter their name, email and a password of their choice. The account appears under **Users** as *waiting for approval* (the Users tab shows a count). Click **Approve**, then use **Edit** to set their role and department. Click **Reject** to remove a sign-up you do not recognise. Until approved, the account cannot sign in on the website or in the desktop app.
   - **You add them.** **Users → Add user**, enter name and email, choose a role and department. You do not enter a password: the site shows a one-time link to send to that person, and they choose their own password. The link works once and expires after 7 days.
5. **Give them the website address.** The same address is the server address in the desktop app.
6. **Approve devices**: when a user first signs in from the desktop app, their computer appears under **Devices → Waiting for approval**. Click **Approve**.

Other things an admin can do:

| Task | Where |
| --- | --- |
| User forgot their password | **Users → Password link**, send them the new link |
| Allow a computer before the user signs in | **Users → Devices → Assign a device by MAC address** |
| Stop a computer from tracking | **Devices → Block** (takes effect within a few minutes) |
| Temporarily stop a user | **Users → Disable** |
| See everyone's time | **Team**, with Today / This week / This month and a department filter |
| See one person's day in 10-minute blocks | **Team →** click the person |

## 5. Install the desktop app

The **server address** in the app is your website address, for example `https://your-domain`.

The easiest way to get the app is from the website itself: the sign-in page and the **App & guide** page (called **Guide** for admins) have download buttons for Windows and Mac, with step-by-step instructions. Admins also get a **For admins** guide there that explains setup and everyday tasks.

### Windows 11

1. Download [`desktop/dist/TimeTracker.exe`](desktop/dist/TimeTracker.exe) (open the file on GitHub, then "Download raw file").
2. Run it. Nothing is installed; it is a single file.
3. Windows SmartScreen may show "Windows protected your PC" because the app is not code-signed: click **More info → Run anyway**.
4. Enter the server address, your email and your password, then **Sign in**.
5. The first time, the app says the device is waiting for approval and shows its MAC address. After the admin approves it, click **Sign in** again.

Tips:
- To pre-fill the server address for everyone, put a text file named `server.txt` containing the address next to `TimeTracker.exe`.
- The X button hides the window to the tray; the timer keeps running. Use the round clock icon next to the Windows clock to open it or quit.
- **Menu → Start with Windows** starts the app at login.

### macOS 12 or newer

1. Download [`desktop-mac/dist/TimeTracker-mac.zip`](desktop-mac/dist/TimeTracker-mac.zip), unzip it and drag **TimeTracker** into Applications.
2. The app is not signed with an Apple Developer ID, so macOS blocks the first launch. Open it once, then go to **System Settings → Privacy & Security** and click **Open Anyway**.
3. Allow notifications when asked, otherwise the idle reminder cannot appear.
4. Sign in the same way as on Windows.

The Mac app needs no Accessibility or Input Monitoring permission. The red close button hides the window; use the clock icon in the menu bar to open it, start or stop, or quit.

## 6. Daily use

**In the desktop app**

1. Switch the big toggle on to start the timer, off to stop.
2. The window shows the current session, today's and this week's totals, and the last 10 minutes (green = active, amber = idle, grey = not tracked).
3. After 5 minutes with no mouse or keyboard activity you get one reminder. Stop the timer if you are taking a break.

**On the website**

- **My time** shows the selected day: worked, active and idle time, the week chart, and the timeline in 10-minute blocks. Each small bar is one minute.
- **My devices** lists your computers and whether they are approved.
- Click your name (top right) to change your password.

The website works on phones and tablets as well as on desktop.

## 7. Roles and access

Every role has one of three access levels. You can create as many roles as you like and name them freely.

| Access level | Own timeline | Team report | Users, devices, roles, departments |
| --- | --- | --- | --- |
| User | Yes | No | No |
| Manager | Yes | Only people in their own department | No |
| Full access (admin) | Yes | Everyone | Yes |

Three roles are built in and cannot be changed or deleted: **Admin**, **Manager** and **User**. A manager with no department sees nobody, so give managers a department.

## 8. Settings reference

Environment variables read by the server:

| Name | Required | Meaning |
| --- | --- | --- |
| `DB_HOST` | yes | Database host, usually `127.0.0.1` |
| `DB_PORT` | no | Database port, default `3306` |
| `DB_NAME` | yes | Database name |
| `DB_USER` | yes | Database user |
| `DB_PASSWORD` | yes | Database password |
| `DATABASE_URL` | no | Alternative to the five above: `mysql://user:password@host:3306/database` |
| `JWT_SECRET` | yes | Random string, at least 16 characters (32 or more recommended). It signs logins. Keep it private. Changing it signs everyone out. |
| `ADMIN_EMAIL` | first start | Email of the first admin, created only if no admin exists |
| `ADMIN_PASSWORD` | first start | Password of that first admin |
| `ALLOW_SIGNUP` | no | `true` (default) lets people create their own account on the sign-in page, pending admin approval. `false` hides that; only admins can add users. |
| `PORT` | no | Port to listen on. Hosting sets this; default `3000` |

**Creating a `JWT_SECRET`.** You make it up yourself. In Windows PowerShell:

```powershell
-join ((48..57) + (97..122) | Get-Random -Count 40 | ForEach-Object {[char]$_})
```

On macOS or Linux:

```bash
openssl rand -hex 32
```

## 9. Updating and backups

**Updating on Hostinger.** Push to the `main` branch; if auto-deploy is on, Hostinger redeploys. Otherwise click **Redeploy** in the app's dashboard. Database changes are applied automatically at start.

**Updating on a VPS.**

```bash
git pull
docker compose up -d --build
```

**Backups.**

- Hostinger: hPanel → **Databases → phpMyAdmin → Export**, or use Hostinger's backups.
- Docker:

  ```bash
  docker compose exec db sh -c 'mariadb-dump -u timetracker -p"$MARIADB_PASSWORD" timetracker' > backup.sql
  ```

## 10. Troubleshooting

| Problem | What to check |
| --- | --- |
| Website says "Time Tracker is not configured yet" | The page names the variable to fix. Correct it in the hosting panel and restart the app. |
| Website shows a plain 503 | The app is not starting at all. Check that the entry file is `server.js` and read the app's log in the hosting panel. |
| "Your account is waiting for admin approval" | The person signed up themselves. An admin approves the account under **Users**. |
| "You have not chosen a password yet" | The user has not opened their setup link. Send a new one from **Users → Password link**. |
| "This link is no longer valid" | Setup links work once and expire after 7 days. Create a new one. |
| Desktop app: "waiting for admin approval" | Approve the computer under **Devices**, then sign in again. |
| Desktop app: "Cannot reach the server" | Check the server address (it must start with `https://`) and the internet connection. |
| Desktop app signs out by itself | The same account signed in on another computer (only one at a time), the device was blocked, the user was disabled, or 30 days passed since sign-in. |
| Clicks and keys stay at 0 on Windows | An antivirus tool may be blocking the app. Add an exception for `TimeTracker.exe`. |
| Devices page shows "MAC changed" | The computer now reports a different network address (common on Macs with private Wi-Fi addresses). Approval still holds because it is tied to the hardware ID. |

## 11. Uninstall

**Windows.** Quit the app from the tray icon, delete `TimeTracker.exe`, then delete the folder `%APPDATA%\TimeTracker`. If "Start with Windows" was on, disable TimeTracker under Task Manager → Startup apps.

**macOS.** Quit from the menu bar icon, move TimeTracker to the Trash, then delete `~/Library/Application Support/TimeTracker`.

The user's account and tracked time stay on the server until an admin deletes the user.

## 12. For developers

Run locally:

```bash
# database
docker run -d --name tt-db -e MARIADB_DATABASE=timetracker -e MARIADB_USER=timetracker -e MARIADB_PASSWORD=timetracker -e MARIADB_RANDOM_ROOT_PASSWORD=1 -p 3306:3306 mariadb:11
# API + built website on http://localhost:3000
npm install
DB_NAME=timetracker DB_USER=timetracker DB_PASSWORD=timetracker JWT_SECRET=dev-secret-change-me-123 npm start
# website with live reload on http://localhost:5173 (proxies /api to :3000)
cd web && npm install && npm run dev
```

After changing anything in `web/`, rebuild the site and commit the result:

```bash
npm run build:web
```

Build the Windows app (Windows or Linux, .NET SDK 8 or newer):

```bash
cd desktop/TimeTracker
dotnet build -c Release
```

Build the Mac app (on a Mac with Xcode):

```bash
cd desktop-mac
./build.sh
```

The Mac app can also be built and tested on GitHub's Mac servers by starting the "Build macOS app" workflow by hand from the repository's **Actions** tab. It never runs automatically; the result is published to the `mac-build` branch.
