using System;
using System.Collections.Generic;

namespace TimeTracker
{
    /// <summary>One tracked minute. T = minutes since 1970 (UTC), S = seconds the timer ran, M = mouse events, K = key presses.</summary>
    public sealed class MinuteBucket
    {
        public long T;
        public int S, M, K;
        public MinuteBucket Clone() { return new MinuteBucket { T = T, S = S, M = M, K = K }; }
    }

    public struct TickResult
    {
        public bool QueueChanged;   // a minute was completed and is ready to upload
        public bool IdleNotify;     // show the "are you still working?" notification (raised once per idle period)
    }

    /// <summary>
    /// Time tracking logic with no UI or OS calls, so it can be tested on its own.
    /// Call Tick about once a second with the input counted since the previous call.
    /// </summary>
    public sealed class Tracker
    {
        public const int IdleAfterSeconds = 5 * 60;

        public readonly List<MinuteBucket> Queue = new List<MinuteBucket>(); // completed minutes not uploaded yet
        public MinuteBucket Current { get; private set; }
        public bool Running { get; private set; }
        public int SessionSeconds { get; private set; }

        // minute -> had activity? Used for the "last 10 minutes" bars.
        private readonly Dictionary<long, bool> _history = new Dictionary<long, bool>();
        private DateTime _lastTick, _lastActivity;
        private double _carry;
        private bool _idleNotified;

        public static long EpochMinute(DateTime utc)
        {
            return (long)Math.Floor((utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMinutes);
        }

        public void Start(DateTime nowUtc)
        {
            if (Running) return;
            Running = true;
            SessionSeconds = 0;
            _lastTick = _lastActivity = nowUtc;
            _carry = 0;
            _idleNotified = false;
        }

        public void Stop()
        {
            Running = false; // the unfinished minute is kept and queued once that minute is over
        }

        public bool IsIdle(DateTime nowUtc)
        {
            return Running && (nowUtc - _lastActivity).TotalSeconds >= IdleAfterSeconds;
        }

        public int IdleSeconds(DateTime nowUtc)
        {
            return Running ? Math.Max(0, (int)(nowUtc - _lastActivity).TotalSeconds) : 0;
        }

        public TickResult Tick(DateTime nowUtc, int mouse, int keys)
        {
            var result = new TickResult();
            long minute = EpochMinute(nowUtc);
            if (Current != null && Current.T != minute) { CloseCurrent(); result.QueueChanged = true; }
            if (!Running) return result;

            // Whole seconds since the last tick. A long gap means the PC slept or the clock changed: do not count it.
            double dt = (nowUtc - _lastTick).TotalSeconds;
            _lastTick = nowUtc;
            if (dt < 0 || dt > 5) { dt = 1; _lastActivity = nowUtc; }
            _carry += dt;
            int add = (int)Math.Floor(_carry);
            _carry -= add;

            if (Current == null) Current = new MinuteBucket { T = minute };
            Current.S = Math.Min(60, Current.S + add);
            Current.M += mouse;
            Current.K += keys;
            SessionSeconds += add;

            if (mouse + keys > 0)
            {
                _lastActivity = nowUtc;
                _idleNotified = false;
            }
            else if (!_idleNotified && (nowUtc - _lastActivity).TotalSeconds >= IdleAfterSeconds)
            {
                _idleNotified = true;
                result.IdleNotify = true;
            }
            return result;
        }

        /// <summary>Queue the unfinished minute right away (used when the app closes or the user signs out).</summary>
        public bool Flush()
        {
            if (Current == null) return false;
            CloseCurrent();
            return true;
        }

        private void CloseCurrent()
        {
            var b = Current;
            Current = null;
            if (b.S <= 0) return;
            _history[b.T] = b.M + b.K > 0;
            foreach (var old in new List<long>(_history.Keys)) if (old < b.T - 30) _history.Remove(old);
            Enqueue(b);
        }

        public void Enqueue(MinuteBucket b)
        {
            var existing = Queue.Find(x => x.T == b.T);
            if (existing == null) { Queue.Add(b); return; }
            existing.S = Math.Min(60, existing.S + b.S);
            existing.M += b.M;
            existing.K += b.K;
        }

        /// <summary>Drop uploaded minutes, unless they changed while the upload was in flight.</summary>
        public void RemoveSent(List<MinuteBucket> sent)
        {
            foreach (var s in sent)
                Queue.RemoveAll(x => x.T == s.T && x.S == s.S && x.M == s.M && x.K == s.K);
        }

        /// <summary>State of the last ten minutes, oldest first: 0 = not tracked, 1 = active, 2 = idle.</summary>
        public int[] RecentMinutes(DateTime nowUtc)
        {
            long minute = EpochMinute(nowUtc);
            var states = new int[10];
            for (int i = 0; i < 10; i++)
            {
                long t = minute - 9 + i;
                bool active;
                if (Current != null && Current.T == t && Current.S > 0) states[i] = Current.M + Current.K > 0 ? 1 : 2;
                else if (_history.TryGetValue(t, out active)) states[i] = active ? 1 : 2;
            }
            return states;
        }

        /// <summary>Seconds tracked at or after the given minute that the server does not know about yet.</summary>
        public int UnsentSecondsSince(long fromMinute)
        {
            int total = 0;
            foreach (var b in Queue) if (b.T >= fromMinute) total += b.S;
            if (Current != null && Current.T >= fromMinute) total += Current.S;
            return total;
        }
    }
}
