using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace TimeTracker
{
    public sealed class MainForm : Form
    {
        private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string RunValue = "TimeTracker";

        private readonly Store _store = new Store();
        private readonly Api _api = new Api();
        private readonly Tracker _tracker = new Tracker();
        private readonly InputHooks _hooks = new InputHooks();
        private readonly Timer _timer = new Timer { Interval = 1000 };
        private readonly NotifyIcon _tray = new NotifyIcon();
        private readonly Icon _iconOn = Theme.MakeIcon(Theme.Accent), _iconOff = Theme.MakeIcon(Color.FromArgb(120, 130, 125));

        private bool _signedIn, _syncing, _offline, _quitting, _trayHintShown, _hooksFailed;
        private DateTime _lastSyncAttempt = DateTime.MinValue, _lastSummary = DateTime.MinValue;
        private DateTime? _lastSyncOk;
        private int _serverToday, _serverWeek;

        // login view
        private Panel _loginView;
        private TextBox _txtServer, _txtEmail, _txtPassword;
        private Button _btnLogin;
        private Label _lblLoginError;

        // tracker view
        private Panel _mainView;
        private Label _lblName, _lblEmail, _lblTimer, _lblState, _lblToday, _lblWeek, _lblCounts, _lblStatus;
        private ToggleSwitch _toggle;
        private ActivityBars _bars;
        private ContextMenuStrip _menu;
        private ToolStripMenuItem _trayToggleItem, _autoStartItem;

        public MainForm()
        {
            SuspendLayout();
            Text = "Time Tracker";
            Font = new Font("Segoe UI", 9f);
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(340, 524);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Icon = _iconOff;

            BuildLoginView();
            BuildMainView();
            BuildTray();
            ResumeLayout(false);

            _timer.Tick += (s, e) => OnTick();
            _timer.Start();
            SystemEvents.SessionEnding += (s, e) => Shutdown();

            _txtServer.Text = _store.Server;
            _txtEmail.Text = _store.Email;
            if (!string.IsNullOrEmpty(_store.Token) && !string.IsNullOrEmpty(_store.Server))
            {
                _api.BaseUrl = _store.Server;
                _api.Token = _store.Token;
                EnterMain();
            }
            else ShowLogin(null);
        }

        // ------------------------------------------------------------------ UI construction

        private static Label MakeLabel(Control parent, string text, int x, int y, int w, int h, float size, FontStyle style, Color color,
                                       ContentAlignment align = ContentAlignment.MiddleLeft)
        {
            var l = new Label
            {
                Text = text, Location = new Point(x, y), Size = new Size(w, h), AutoSize = false, TextAlign = align,
                Font = new Font("Segoe UI", size, style), ForeColor = color,
                BackColor = parent is CardPanel ? Theme.Card : Theme.Bg, UseMnemonic = false,
            };
            parent.Controls.Add(l);
            return l;
        }

        private static TextBox MakeInput(Control parent, string caption, int y, bool password = false)
        {
            MakeLabel(parent, caption, 16, y, 276, 18, 8.5f, FontStyle.Bold, Theme.Text);
            var t = new TextBox { Location = new Point(16, y + 21), Size = new Size(276, 26), Font = new Font("Segoe UI", 10f), UseSystemPasswordChar = password };
            parent.Controls.Add(t);
            return t;
        }

        private void BuildLoginView()
        {
            _loginView = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg, Visible = false };
            MakeLabel(_loginView, "Time Tracker", 16, 26, 308, 34, 17f, FontStyle.Bold, Theme.Text, ContentAlignment.MiddleCenter);
            MakeLabel(_loginView, "Sign in with the account your admin gave you", 16, 60, 308, 20, 9f, FontStyle.Regular, Theme.Muted, ContentAlignment.MiddleCenter);

            var card = new CardPanel { Location = new Point(16, 98), Size = new Size(308, 262) };
            _txtServer = MakeInput(card, "Server address", 16);
            _txtEmail = MakeInput(card, "Email", 74);
            _txtPassword = MakeInput(card, "Password", 132, true);
            _btnLogin = new Button
            {
                Text = "Sign in", Location = new Point(16, 204), Size = new Size(276, 40), FlatStyle = FlatStyle.Flat,
                BackColor = Theme.Accent, ForeColor = Color.White, Font = new Font("Segoe UI", 10.5f, FontStyle.Bold), Cursor = Cursors.Hand,
            };
            _btnLogin.FlatAppearance.BorderSize = 0;
            _btnLogin.Click += async (s, e) => await DoLogin();
            card.Controls.Add(_btnLogin);
            _loginView.Controls.Add(card);

            _lblLoginError = MakeLabel(_loginView, "", 16, 370, 308, 140, 9f, FontStyle.Regular, Theme.Danger, ContentAlignment.TopLeft);
            Controls.Add(_loginView);
        }

        private void BuildMainView()
        {
            _mainView = new Panel { Dock = DockStyle.Fill, BackColor = Theme.Bg, Visible = false };

            _lblName = MakeLabel(_mainView, "", 16, 12, 262, 24, 11.5f, FontStyle.Bold, Theme.Text);
            _lblEmail = MakeLabel(_mainView, "", 17, 35, 262, 18, 8.5f, FontStyle.Regular, Theme.Muted);
            _lblName.AutoEllipsis = _lblEmail.AutoEllipsis = true;

            _menu = new ContextMenuStrip();
            _menu.Items.Add("Open my timeline in the browser", null, (s, e) => OpenWebsite());
            _autoStartItem = new ToolStripMenuItem("Start with Windows") { CheckOnClick = true, Checked = IsAutoStart() };
            _autoStartItem.CheckedChanged += (s, e) => SetAutoStart(_autoStartItem.Checked);
            _menu.Items.Add(_autoStartItem);
            _menu.Items.Add(new ToolStripSeparator());
            _menu.Items.Add("Sign out", null, async (s, e) => await SignOut());
            _menu.Items.Add("Quit", null, (s, e) => Quit());

            var btnMenu = new Button
            {
                Text = "Menu", Location = new Point(270, 16), Size = new Size(54, 28), FlatStyle = FlatStyle.Flat,
                BackColor = Theme.Card, ForeColor = Theme.Text, Font = new Font("Segoe UI", 8.5f), Cursor = Cursors.Hand,
            };
            btnMenu.FlatAppearance.BorderColor = Theme.Line;
            btnMenu.Click += (s, e) => _menu.Show(btnMenu, new Point(btnMenu.Width, btnMenu.Height), ToolStripDropDownDirection.BelowLeft);
            _mainView.Controls.Add(btnMenu);

            // timer card
            var c1 = new CardPanel { Location = new Point(16, 64), Size = new Size(308, 196) };
            MakeLabel(c1, "CURRENT SESSION", 8, 14, 292, 18, 8f, FontStyle.Bold, Theme.Muted, ContentAlignment.MiddleCenter);
            _lblTimer = MakeLabel(c1, "0:00:00", 8, 34, 292, 60, 32f, FontStyle.Bold, Theme.Text, ContentAlignment.MiddleCenter);
            _toggle = new ToggleSwitch { Location = new Point(112, 102), Size = new Size(84, 44) };
            _toggle.Toggled += (s, e) => { if (_toggle.Checked) StartTracking(); else StopTracking(); };
            c1.Controls.Add(_toggle);
            _lblState = MakeLabel(c1, "", 8, 152, 292, 30, 9.5f, FontStyle.Regular, Theme.Muted, ContentAlignment.MiddleCenter);
            _mainView.Controls.Add(c1);

            // totals card
            var c2 = new CardPanel { Location = new Point(16, 270), Size = new Size(308, 78) };
            MakeLabel(c2, "TODAY", 16, 12, 130, 18, 8f, FontStyle.Bold, Theme.Muted);
            _lblToday = MakeLabel(c2, "0h 00m", 14, 32, 136, 32, 16f, FontStyle.Bold, Theme.Text);
            MakeLabel(c2, "THIS WEEK", 164, 12, 130, 18, 8f, FontStyle.Bold, Theme.Muted);
            _lblWeek = MakeLabel(c2, "0h 00m", 162, 32, 136, 32, 16f, FontStyle.Bold, Theme.Text);
            _mainView.Controls.Add(c2);

            // activity card
            var c3 = new CardPanel { Location = new Point(16, 358), Size = new Size(308, 108) };
            MakeLabel(c3, "LAST 10 MINUTES", 16, 12, 276, 18, 8f, FontStyle.Bold, Theme.Muted);
            _bars = new ActivityBars { Location = new Point(16, 38), Size = new Size(276, 28) };
            c3.Controls.Add(_bars);
            _lblCounts = MakeLabel(c3, "", 16, 74, 276, 20, 8.5f, FontStyle.Regular, Theme.Muted);
            _mainView.Controls.Add(c3);

            _lblStatus = MakeLabel(_mainView, "", 16, 474, 308, 40, 8.5f, FontStyle.Regular, Theme.Muted, ContentAlignment.TopLeft);
            Controls.Add(_mainView);
        }

        private void BuildTray()
        {
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Time Tracker", null, (s, e) => ShowWindow());
            _trayToggleItem = new ToolStripMenuItem("Start tracking", null, (s, e) =>
            {
                if (!_signedIn) { ShowWindow(); return; }
                if (_tracker.Running) StopTracking(); else StartTracking();
            });
            menu.Items.Add(_trayToggleItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Quit", null, (s, e) => Quit());
            _tray.ContextMenuStrip = menu;
            _tray.Icon = _iconOff;
            _tray.Text = "Time Tracker";
            _tray.Visible = true;
            _tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowWindow(); };
            _tray.BalloonTipClicked += (s, e) => ShowWindow();
        }

        // ------------------------------------------------------------------ sign in / out

        private void ShowLogin(string error)
        {
            _signedIn = false;
            _mainView.Visible = false;
            _loginView.Visible = true;
            _lblLoginError.Text = error ?? "";
            _txtPassword.Text = "";
            AcceptButton = _btnLogin;
            ActiveControl = _txtServer.Text.Length == 0 ? _txtServer : _txtEmail.Text.Length == 0 ? (Control)_txtEmail : _txtPassword;
        }

        private async Task DoLogin()
        {
            string server = Api.NormalizeUrl(_txtServer.Text), email = _txtEmail.Text.Trim(), password = _txtPassword.Text;
            if (server.Length == 0 || email.Length == 0 || password.Length == 0)
            {
                _lblLoginError.Text = "Fill in the server address, your email and your password.";
                return;
            }

            var macs = DeviceInfo.GetMacs();
            if (macs.Count == 0)
            {
                _lblLoginError.Text = "No network card was found on this computer, so it cannot be identified. Connect Wi-Fi or a network cable and try again.";
                return;
            }

            _btnLogin.Enabled = false;
            _btnLogin.Text = "Signing in...";
            _lblLoginError.Text = "";
            try
            {
                _api.BaseUrl = server;
                _api.Token = null;
                var res = await _api.Login(email, password, macs, DeviceInfo.GetMachineId(macs));
                var user = res.ContainsKey("user") ? res["user"] as Dictionary<string, object> : null;
                _api.Token = Api.Str(res, "token");
                _store.Server = server;
                _store.Email = Api.Str(user, "email") ?? email;
                _store.Name = Api.Str(user, "name") ?? email;
                _store.Token = _api.Token;
                _store.Save();
                EnterMain();
            }
            catch (ApiException ex)
            {
                string msg = ex.Message;
                if (ex.Code == "DEVICE_PENDING" || ex.Code == "DEVICE_REVOKED")
                    msg += "\n\nThis computer: " + Environment.MachineName + "\nMAC address: " + macs[0];
                _lblLoginError.Text = msg;
                // remember what was typed so the user does not retype it after the admin approves
                _store.Server = server; _store.Email = email; _store.Save();
            }
            finally
            {
                _btnLogin.Enabled = true;
                _btnLogin.Text = "Sign in";
            }
        }

        private void EnterMain()
        {
            _signedIn = true;
            _offline = false;
            _lastSyncOk = null;
            _serverToday = _serverWeek = 0;
            _tracker.Queue.Clear();
            foreach (var b in _store.LoadQueue(_store.Email)) _tracker.Enqueue(b);
            _lblName.Text = string.IsNullOrEmpty(_store.Name) ? _store.Email : _store.Name;
            _lblEmail.Text = _store.Email;
            _loginView.Visible = false;
            _mainView.Visible = true;
            AcceptButton = null;
            ActiveControl = _toggle;
            UpdateUi();
            var ignore = SyncAsync(); // uploads anything left from last time and loads today's totals
        }

        private async Task SignOut()
        {
            if (!_signedIn) return;
            StopTracking();
            if (_tracker.Flush()) _store.SaveQueue(_store.Email, _tracker.Queue);
            await SyncAsync();
            if (!_signedIn) return; // the sync already sent us to the login screen
            _api.Token = _store.Token = null;
            _store.Save();
            ShowLogin(null);
        }

        /// <summary>The server rejected us: device blocked, account disabled or session expired.</summary>
        private void ForceSignOut(string reason)
        {
            StopTracking();
            if (_tracker.Flush()) _store.SaveQueue(_store.Email, _tracker.Queue);
            _api.Token = _store.Token = null;
            _store.Save();
            ShowLogin(reason + "\n\nTime tracking has stopped. Sign in again to continue.");
            ShowWindow();
        }

        // ------------------------------------------------------------------ tracking

        private void StartTracking()
        {
            if (!_signedIn || _tracker.Running) return;
            _hooks.Start();
            _hooksFailed = !_hooks.Working;
            _tracker.Start(DateTime.UtcNow);
            UpdateUi();
        }

        private void StopTracking()
        {
            if (!_tracker.Running) return;
            int m, k;
            _hooks.Take(out m, out k);
            _tracker.Tick(DateTime.UtcNow, m, k); // count the last partial second and its input
            _tracker.Stop();
            _hooks.Stop();
            UpdateUi();
        }

        private void OnTick()
        {
            var now = DateTime.UtcNow;
            int m = 0, k = 0;
            if (_tracker.Running) _hooks.Take(out m, out k);
            var r = _tracker.Tick(now, m, k);
            if (r.QueueChanged && _signedIn) _store.SaveQueue(_store.Email, _tracker.Queue);
            if (r.IdleNotify) NotifyIdle();

            if (_signedIn && !_syncing)
            {
                double sinceAttempt = (now - _lastSyncAttempt).TotalSeconds;
                bool haveData = _tracker.Queue.Count > 0 && sinceAttempt >= (_offline ? 60 : 3);
                bool refresh = (now - _lastSummary).TotalSeconds >= 300 && sinceAttempt >= 60; // also notices a blocked device while stopped
                if (haveData || refresh) { var ignore = SyncAsync(); }
            }
            UpdateUi();
        }

        private void NotifyIdle()
        {
            // Shown once per idle period; the tracker re-arms it when the user is active again.
            _tray.ShowBalloonTip(15000, "Are you still working?",
                "No mouse or keyboard activity for 5 minutes. The timer is still running and this time is recorded as idle. Stop the timer if you are taking a break.",
                ToolTipIcon.Warning);
        }

        private static DateTime LocalDayStartUtc() { return DateTime.Today.ToUniversalTime(); }

        private static DateTime LocalWeekStartUtc()
        {
            int back = ((int)DateTime.Today.DayOfWeek + 6) % 7; // Monday
            return DateTime.Today.AddDays(-back).ToUniversalTime();
        }

        private async Task SyncAsync()
        {
            if (_syncing || !_signedIn) return;
            _syncing = true;
            _lastSyncAttempt = DateTime.UtcNow;
            try
            {
                var batch = _tracker.Queue.Take(2000).Select(b => b.Clone()).ToList();
                if (batch.Count > 0)
                {
                    await _api.Upload(batch);
                    long day = Tracker.EpochMinute(LocalDayStartUtc()), week = Tracker.EpochMinute(LocalWeekStartUtc());
                    _serverToday += batch.Where(b => b.T >= day).Sum(b => b.S);
                    _serverWeek += batch.Where(b => b.T >= week).Sum(b => b.S);
                    _tracker.RemoveSent(batch);
                    _store.SaveQueue(_store.Email, _tracker.Queue);
                }
                var s = await _api.Summary(LocalDayStartUtc(), LocalWeekStartUtc());
                _serverToday = Api.Int(s, "today");
                _serverWeek = Api.Int(s, "week");
                _lastSummary = DateTime.UtcNow;
                _lastSyncOk = DateTime.Now;
                _offline = false;
            }
            catch (ApiException ex)
            {
                if (ex.IsAuthFailure) { _syncing = false; ForceSignOut(ex.Message); return; }
                _offline = true;
            }
            catch (Exception)
            {
                _offline = true;
            }
            finally
            {
                _syncing = false;
            }
            UpdateUi();
        }

        // ------------------------------------------------------------------ display

        private static string Hm(int seconds)
        {
            int m = seconds / 60;
            return (m / 60) + "h " + (m % 60).ToString("00") + "m";
        }

        private static void SetText(Control c, string text) { if (c.Text != text) c.Text = text; }

        private void UpdateUi()
        {
            if (!_signedIn) { SetTray(false, "Time Tracker - signed out"); return; }
            var now = DateTime.UtcNow;
            bool running = _tracker.Running, idle = _tracker.IsIdle(now);

            if (_toggle.Checked != running) _toggle.Checked = running;
            int s = _tracker.SessionSeconds;
            SetText(_lblTimer, (s / 3600) + ":" + (s / 60 % 60).ToString("00") + ":" + (s % 60).ToString("00"));
            _lblTimer.ForeColor = !running ? Theme.Muted : idle ? Theme.IdleText : Theme.Text;

            if (!running) { SetText(_lblState, "Timer is off. Switch it on to start tracking."); _lblState.ForeColor = Theme.Muted; }
            else if (_hooksFailed) { SetText(_lblState, "Tracking, but activity cannot be read on this PC"); _lblState.ForeColor = Theme.Danger; }
            else if (idle) { SetText(_lblState, "Idle for " + (_tracker.IdleSeconds(now) / 60) + " min - no mouse or keyboard activity"); _lblState.ForeColor = Theme.IdleText; }
            else { SetText(_lblState, "Tracking your time"); _lblState.ForeColor = Theme.Accent; }

            int today = _serverToday + _tracker.UnsentSecondsSince(Tracker.EpochMinute(LocalDayStartUtc()));
            int week = _serverWeek + _tracker.UnsentSecondsSince(Tracker.EpochMinute(LocalWeekStartUtc()));
            SetText(_lblToday, Hm(today));
            SetText(_lblWeek, Hm(Math.Max(week, today)));

            _bars.SetStates(_tracker.RecentMinutes(now));
            var cur = _tracker.Current;
            SetText(_lblCounts, running && cur != null
                ? "This minute: " + cur.M + " mouse clicks, " + cur.K + " key presses"
                : "Green = active, amber = idle, grey = not tracked");

            int waiting = _tracker.Queue.Count;
            string status;
            if (_offline) status = "Offline - " + (waiting > 0 ? waiting + " min saved on this PC, will upload when the connection is back." : "will retry shortly.");
            else if (_lastSyncOk.HasValue) status = "Synced at " + _lastSyncOk.Value.ToString("HH:mm") + (waiting > 0 ? " - " + waiting + " min waiting to upload" : "");
            else status = "Connecting...";
            SetText(_lblStatus, status);
            _lblStatus.ForeColor = _offline ? Theme.IdleText : Theme.Muted;

            SetTray(running, running ? "Time Tracker - " + (idle ? "idle" : "tracking") + " - today " + Hm(today) : "Time Tracker - stopped");
        }

        private void SetTray(bool running, string text)
        {
            var icon = running ? _iconOn : _iconOff;
            if (!ReferenceEquals(_tray.Icon, icon)) { _tray.Icon = icon; Icon = icon; }
            if (text.Length > 63) text = text.Substring(0, 63);
            if (_tray.Text != text) _tray.Text = text;
            string item = running ? "Stop tracking" : "Start tracking";
            if (_trayToggleItem.Text != item) _trayToggleItem.Text = item;
        }

        // ------------------------------------------------------------------ window, tray, exit

        private void ShowWindow()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        private void OpenWebsite()
        {
            try { if (!string.IsNullOrEmpty(_store.Server)) Process.Start(new ProcessStartInfo(_store.Server) { UseShellExecute = true }); } catch { }
        }

        private static bool IsAutoStart()
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue(RunValue) != null; } catch { return false; }
        }

        private static void SetAutoStart(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (on) k.SetValue(RunValue, "\"" + Application.ExecutablePath + "\"");
                    else k.DeleteValue(RunValue, false);
                }
            }
            catch { }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            // The X button only hides the window; the timer keeps running from the tray (like Upwork).
            if (!_quitting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                Hide();
                if (!_trayHintShown)
                {
                    _trayHintShown = true;
                    _tray.ShowBalloonTip(5000, "Time Tracker is still running",
                        _tracker.Running ? "The timer keeps running. Click this icon to open the window." : "Click this icon to open the window. Right-click it to quit.",
                        ToolTipIcon.Info);
                }
                return;
            }
            Shutdown();
            base.OnFormClosing(e);
        }

        private void Quit()
        {
            if (_tracker.Running &&
                MessageBox.Show(this, "The timer is running. Stop tracking and quit?", "Time Tracker", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK)
                return;
            _quitting = true;
            Close();
        }

        private bool _shutDown;
        private void Shutdown()
        {
            if (_shutDown) return;
            _shutDown = true;
            _timer.Stop();
            StopTracking();
            if (_signedIn)
            {
                _tracker.Flush();
                _store.SaveQueue(_store.Email, _tracker.Queue);
                // Best effort upload; anything not sent stays in the queue file for the next start.
                var batch = _tracker.Queue.Select(b => b.Clone()).ToList();
                if (batch.Count > 0)
                {
                    try
                    {
                        if (Task.Run(() => _api.Upload(batch)).Wait(4000))
                        {
                            _tracker.RemoveSent(batch);
                            _store.SaveQueue(_store.Email, _tracker.Queue);
                        }
                    }
                    catch { }
                }
            }
            _hooks.Dispose();
            _tray.Visible = false;
            _tray.Dispose();
        }
    }
}
