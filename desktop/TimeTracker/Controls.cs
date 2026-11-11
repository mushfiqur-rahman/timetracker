using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace TimeTracker
{
    public static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(244, 246, 245);
        public static readonly Color Card = Color.White;
        public static readonly Color Line = Color.FromArgb(225, 230, 227);
        public static readonly Color Text = Color.FromArgb(23, 33, 29);
        public static readonly Color Muted = Color.FromArgb(102, 115, 109);
        public static readonly Color Accent = Color.FromArgb(15, 138, 95);
        public static readonly Color Idle = Color.FromArgb(227, 160, 8);
        public static readonly Color IdleText = Color.FromArgb(138, 90, 0);
        public static readonly Color None = Color.FromArgb(226, 231, 228);
        public static readonly Color Danger = Color.FromArgb(192, 57, 43);

        public static GraphicsPath Rounded(RectangleF r, float radius)
        {
            float d = radius * 2;
            var p = new GraphicsPath();
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        /// <summary>Round clock icon used for the window and the tray; green while tracking, grey when stopped.</summary>
        public static Icon MakeIcon(Color color)
        {
            using (var bmp = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bmp))
                using (var fill = new SolidBrush(color))
                using (var pen = new Pen(Color.White, 3f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.FillEllipse(fill, 1, 1, 30, 30);
                    g.DrawLines(pen, new[] { new PointF(16, 8), new PointF(16, 17), new PointF(22, 20) });
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }
    }

    /// <summary>White rounded panel.</summary>
    public sealed class CardPanel : Panel
    {
        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Bg;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            float radius = Math.Max(6f, Height / 16f);
            using (var path = Theme.Rounded(new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), Math.Min(radius, 12f)))
            using (var fill = new SolidBrush(Theme.Card))
            using (var pen = new Pen(Theme.Line))
            {
                e.Graphics.FillPath(fill, path);
                e.Graphics.DrawPath(pen, path);
            }
        }
    }

    /// <summary>The big on/off switch that starts and stops the timer.</summary>
    public sealed class ToggleSwitch : Control
    {
        private bool _checked;
        public event EventHandler Toggled;

        public ToggleSwitch()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer |
                     ControlStyles.ResizeRedraw | ControlStyles.Selectable, true);
            SetStyle(ControlStyles.StandardDoubleClick, false);
            Cursor = Cursors.Hand;
            TabStop = true;
            BackColor = Theme.Card;
            AccessibleRole = AccessibleRole.CheckButton;
            AccessibleName = "Track time";
        }

        public bool Checked
        {
            get { return _checked; }
            set { if (_checked != value) { _checked = value; Invalidate(); } }
        }

        private void Flip()
        {
            _checked = !_checked;
            Invalidate();
            var h = Toggled;
            if (h != null) h(this, EventArgs.Empty);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            Focus();
            if (e.Button == MouseButtons.Left) Flip();
        }

        protected override void OnKeyDown(KeyEventArgs e)
        {
            base.OnKeyDown(e);
            if (e.KeyCode == Keys.Space || e.KeyCode == Keys.Enter) { Flip(); e.Handled = true; }
        }

        protected override void OnGotFocus(EventArgs e) { base.OnGotFocus(e); Invalidate(); }
        protected override void OnLostFocus(EventArgs e) { base.OnLostFocus(e); Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(BackColor);
            float pad = 3f;
            var track = new RectangleF(pad, pad, Width - 2 * pad - 1, Height - 2 * pad - 1);
            using (var path = Theme.Rounded(track, track.Height / 2f))
            using (var fill = new SolidBrush(_checked ? Theme.Accent : Color.FromArgb(176, 186, 181)))
                g.FillPath(fill, path);

            float knob = track.Height - 8f;
            float x = _checked ? track.Right - knob - 4f : track.X + 4f;
            using (var white = new SolidBrush(Color.White))
                g.FillEllipse(white, x, track.Y + 4f, knob, knob);

            if (Focused && ShowFocusCues)
                using (var pen = new Pen(Theme.Text) { DashStyle = DashStyle.Dot })
                using (var path = Theme.Rounded(new RectangleF(0.5f, 0.5f, Width - 2f, Height - 2f), Height / 2f - 1f))
                    g.DrawPath(pen, path);
        }
    }

    /// <summary>Ten bars, one per minute: green = active, amber = idle, grey = not tracked.</summary>
    public sealed class ActivityBars : Control
    {
        private int[] _states = new int[10];

        public ActivityBars()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
        }

        public void SetStates(int[] states)
        {
            bool same = states.Length == _states.Length;
            for (int i = 0; same && i < states.Length; i++) same = states[i] == _states[i];
            if (same) return;
            _states = states;
            Invalidate();
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(BackColor);
            int n = _states.Length;
            float gap = Math.Max(3f, Width / 70f);
            float w = (Width - gap * (n - 1)) / n;
            for (int i = 0; i < n; i++)
            {
                Color c = _states[i] == 1 ? Theme.Accent : _states[i] == 2 ? Theme.Idle : Theme.None;
                using (var b = new SolidBrush(c))
                using (var path = Theme.Rounded(new RectangleF(i * (w + gap), 0, w, Height - 1), Math.Min(4f, w / 3f)))
                    g.FillPath(b, path);
            }
        }
    }
}
