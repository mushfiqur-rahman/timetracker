using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace TimeTracker
{
    /// <summary>
    /// Counts mouse clicks, wheel steps, mouse movement and key presses system-wide while the timer is running.
    /// Movement counts as one mouse action for each second in which the pointer really moved.
    /// Only counts are kept. Which key was pressed is used solely to ignore auto-repeat of a held key
    /// and is never stored or sent anywhere.
    /// Runs on its own thread so the app can never slow down the user's mouse or keyboard.
    /// </summary>
    public sealed class InputHooks : IDisposable
    {
        private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }

        [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
        [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hhk);
        [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
        [DllImport("user32.dll")] private static extern int GetMessage(out MSG msg, IntPtr hWnd, uint min, uint max);
        [DllImport("user32.dll")] private static extern bool PostThreadMessage(uint threadId, uint msg, IntPtr wParam, IntPtr lParam);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandle(string name);

        private const int WH_KEYBOARD_LL = 13, WH_MOUSE_LL = 14;
        private const int WM_QUIT = 0x12, WM_KEYDOWN = 0x100, WM_KEYUP = 0x101, WM_SYSKEYDOWN = 0x104, WM_SYSKEYUP = 0x105;
        private const int WM_MOUSEMOVE = 0x200, MoveThresholdPixels = 8;
        private const int WM_LBUTTONDOWN = 0x201, WM_RBUTTONDOWN = 0x204, WM_MBUTTONDOWN = 0x207, WM_MOUSEWHEEL = 0x20A, WM_XBUTTONDOWN = 0x20B;

        private readonly HookProc _mouseProc, _keyProc; // kept in fields so the GC cannot collect them while hooked
        private readonly bool[] _down = new bool[256];
        private readonly ManualResetEvent _ready = new ManualResetEvent(false);
        private Thread _thread;
        private uint _threadId;
        private IntPtr _mouseHook, _keyHook;
        private int _mouse, _keys, _moved;
        private int _lastX = int.MinValue, _lastY;   // only touched on the hook thread

        /// <summary>False if Windows refused the hooks (activity cannot be counted).</summary>
        public bool Working { get; private set; }

        public InputHooks()
        {
            _mouseProc = MouseProc;
            _keyProc = KeyProc;
        }

        public void Start()
        {
            if (_thread != null) return;
            _ready.Reset();
            _thread = new Thread(Run) { IsBackground = true, Name = "InputHooks" };
            _thread.Start();
            _ready.WaitOne(3000);
        }

        public void Stop()
        {
            var t = _thread;
            if (t == null) return;
            _thread = null;
            try { if (_threadId != 0) PostThreadMessage(_threadId, WM_QUIT, IntPtr.Zero, IntPtr.Zero); } catch { }
            t.Join(1000);
            Working = false;
            Interlocked.Exchange(ref _mouse, 0);
            Interlocked.Exchange(ref _moved, 0);
            Interlocked.Exchange(ref _keys, 0);
        }

        /// <summary>Returns and resets what was counted since the last call.</summary>
        public void Take(out int mouse, out int keys)
        {
            mouse = Interlocked.Exchange(ref _mouse, 0) + Interlocked.Exchange(ref _moved, 0);   // movement: at most 1 per call
            keys = Interlocked.Exchange(ref _keys, 0);
        }

        private void Run()
        {
            try
            {
                _threadId = GetCurrentThreadId();
                IntPtr module = GetModuleHandle(null);
                _mouseHook = SetWindowsHookEx(WH_MOUSE_LL, _mouseProc, module, 0);
                _keyHook = SetWindowsHookEx(WH_KEYBOARD_LL, _keyProc, module, 0);
                Working = _mouseHook != IntPtr.Zero && _keyHook != IntPtr.Zero;
                _ready.Set();

                MSG msg;
                while (GetMessage(out msg, IntPtr.Zero, 0, 0) > 0) { } // low-level hooks are delivered while this loop waits
            }
            catch (Exception)
            {
                Working = false;
            }
            finally
            {
                _ready.Set();
                try
                {
                    if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
                    if (_keyHook != IntPtr.Zero) UnhookWindowsHookEx(_keyHook);
                }
                catch { }
                _mouseHook = _keyHook = IntPtr.Zero;
                _threadId = 0;
            }
        }

        private IntPtr MouseProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int m = wParam.ToInt32();
                if (m == WM_LBUTTONDOWN || m == WM_RBUTTONDOWN || m == WM_MBUTTONDOWN || m == WM_XBUTTONDOWN || m == WM_MOUSEWHEEL)
                    Interlocked.Increment(ref _mouse);
                else if (m == WM_MOUSEMOVE)
                {
                    // MSLLHOOKSTRUCT starts with the pointer position. Ignore tiny jitter (a bumped desk, sensor noise).
                    int x = Marshal.ReadInt32(lParam), y = Marshal.ReadInt32(lParam, 4);
                    if (_lastX == int.MinValue) { _lastX = x; _lastY = y; }
                    else if (Math.Abs(x - _lastX) + Math.Abs(y - _lastY) >= MoveThresholdPixels)
                    {
                        _lastX = x; _lastY = y;
                        Interlocked.Exchange(ref _moved, 1);
                    }
                }
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        private IntPtr KeyProc(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0)
            {
                int m = wParam.ToInt32();
                int vk = Marshal.ReadInt32(lParam) & 0xFF; // first field of KBDLLHOOKSTRUCT
                if (m == WM_KEYDOWN || m == WM_SYSKEYDOWN)
                {
                    if (!_down[vk]) { _down[vk] = true; Interlocked.Increment(ref _keys); } // a held key counts once
                }
                else if (m == WM_KEYUP || m == WM_SYSKEYUP)
                {
                    _down[vk] = false;
                }
            }
            return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
        }

        public void Dispose() { Stop(); }
    }
}
