import Foundation

/// One tracked minute. t = minutes since 1970 (UTC), s = seconds the timer ran, m = mouse events, k = key presses.
struct MinuteBucket: Equatable {
    var t: Int
    var s: Int
    var m: Int
    var k: Int
}

struct TickResult {
    var queueChanged = false   // a minute was completed and is ready to upload
    var idleNotify = false     // show the "are you still working?" notification (raised once per idle period)
}

/// Time tracking logic with no UI or OS calls (same rules as the Windows app).
/// Call tick about once a second with the input counted since the previous call.
final class Tracker {
    static let idleAfter: TimeInterval = 5 * 60

    private(set) var queue: [MinuteBucket] = []   // completed minutes not uploaded yet
    private(set) var current: MinuteBucket?
    private(set) var running = false
    private(set) var sessionSeconds = 0

    private var history: [Int: Bool] = [:]        // minute -> had activity (for the "last 10 minutes" bars)
    private var lastTick = Date()
    private var lastActivity = Date()
    private var carry = 0.0
    private var idleNotified = false

    static func epochMinute(_ date: Date) -> Int {
        return Int((date.timeIntervalSince1970 / 60).rounded(.down))
    }

    func start(_ now: Date) {
        if running { return }
        running = true
        sessionSeconds = 0
        lastTick = now
        lastActivity = now
        carry = 0
        idleNotified = false
    }

    /// The unfinished minute is kept and queued once that minute is over.
    func stop() {
        running = false
    }

    func isIdle(_ now: Date) -> Bool {
        return running && now.timeIntervalSince(lastActivity) >= Tracker.idleAfter
    }

    func idleSeconds(_ now: Date) -> Int {
        return running ? max(0, Int(now.timeIntervalSince(lastActivity))) : 0
    }

    func tick(_ now: Date, mouse: Int, keys: Int) -> TickResult {
        var result = TickResult()
        let minute = Tracker.epochMinute(now)
        if let cur = current, cur.t != minute {
            closeCurrent()
            result.queueChanged = true
        }
        if !running { return result }

        // Whole seconds since the last tick. A long gap means the Mac slept or the clock changed: do not count it.
        var dt = now.timeIntervalSince(lastTick)
        lastTick = now
        if dt < 0 || dt > 5 {
            dt = 1
            lastActivity = now
        }
        carry += dt
        let add = Int(carry.rounded(.down))
        carry -= Double(add)

        var cur = current ?? MinuteBucket(t: minute, s: 0, m: 0, k: 0)
        cur.s = min(60, cur.s + add)
        cur.m += mouse
        cur.k += keys
        current = cur
        sessionSeconds += add

        if mouse + keys > 0 {
            lastActivity = now
            idleNotified = false
        } else if !idleNotified && now.timeIntervalSince(lastActivity) >= Tracker.idleAfter {
            idleNotified = true
            result.idleNotify = true
        }
        return result
    }

    /// Queue the unfinished minute right away (used when the app quits or the user signs out).
    @discardableResult
    func flush() -> Bool {
        if current == nil { return false }
        closeCurrent()
        return true
    }

    private func closeCurrent() {
        guard let b = current else { return }
        current = nil
        if b.s <= 0 { return }
        history[b.t] = b.m + b.k > 0
        history = history.filter { $0.key >= b.t - 30 }
        enqueue(b)
    }

    func enqueue(_ b: MinuteBucket) {
        if let i = queue.firstIndex(where: { $0.t == b.t }) {
            queue[i].s = min(60, queue[i].s + b.s)
            queue[i].m += b.m
            queue[i].k += b.k
        } else {
            queue.append(b)
        }
    }

    func clearQueue() {
        queue.removeAll()
    }

    /// Drop uploaded minutes, unless they changed while the upload was in flight.
    func removeSent(_ sent: [MinuteBucket]) {
        queue.removeAll { sent.contains($0) }
    }

    /// State of the last ten minutes, oldest first: 0 = not tracked, 1 = active, 2 = idle.
    func recentMinutes(_ now: Date) -> [Int] {
        let minute = Tracker.epochMinute(now)
        return (0..<10).map { i -> Int in
            let t = minute - 9 + i
            if let cur = current, cur.t == t, cur.s > 0 { return cur.m + cur.k > 0 ? 1 : 2 }
            if let active = history[t] { return active ? 1 : 2 }
            return 0
        }
    }

    /// Seconds tracked at or after the given minute that the server does not know about yet.
    func unsentSeconds(since fromMinute: Int) -> Int {
        var total = queue.filter { $0.t >= fromMinute }.reduce(0) { $0 + $1.s }
        if let cur = current, cur.t >= fromMinute { total += cur.s }
        return total
    }
}
