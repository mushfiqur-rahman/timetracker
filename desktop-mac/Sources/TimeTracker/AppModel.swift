import AppKit
import Foundation
import UserNotifications

/// Everything the window shows. Rebuilt once a second and only published when something changed.
struct UiState: Equatable {
    var running = false
    var idle = false
    var timer = "0:00:00"
    var stateText = "Timer is off. Switch it on to start tracking."
    var today = "0h 00m"
    var week = "0h 00m"
    var bars = [Int](repeating: 0, count: 10)
    var counts = ""
    var status = "Connecting..."
    var offline = false
}

final class AppModel: ObservableObject {
    @Published var signedIn = false
    @Published var loginBusy = false
    @Published var loginError = ""
    @Published var serverField = ""
    @Published var emailField = ""
    @Published var passwordField = ""
    @Published var name = ""
    @Published var email = ""
    @Published var ui = UiState()

    let tracker = Tracker()
    private let store = Store()
    private let api = Api()
    private let counter = InputCounter()
    private var timer: Timer?
    private var napGuard: NSObjectProtocol?

    private var syncing = false
    private var offline = false
    private var lastSyncAttempt = Date.distantPast
    private var lastSummary = Date.distantPast
    private var lastSyncOk: Date?
    private var serverToday = 0
    private var serverWeek = 0
    private var startWhenSignedIn = CommandLine.arguments.contains("--start")

    /// Called when something needs the window in front (for example after being signed out by the server).
    var onNeedsAttention: () -> Void = {}

    func launch() {
        serverField = store.server
        emailField = store.email

        let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(t, forMode: .common)
        timer = t

        if let token = store.token, !store.server.isEmpty {
            api.baseUrl = store.server
            api.token = token
            enterMain()
        } else {
            // Optional unattended sign-in for managed installs: TT_SERVER, TT_EMAIL and TT_PASSWORD in the environment.
            let env = ProcessInfo.processInfo.environment
            if let server = env["TT_SERVER"], let mail = env["TT_EMAIL"], let password = env["TT_PASSWORD"] {
                serverField = server
                emailField = mail
                passwordField = password
                login()
            }
        }
    }

    // MARK: sign in / out

    func login() {
        if loginBusy { return }
        let server = Api.normalize(serverField)
        let mail = emailField.trimmingCharacters(in: .whitespacesAndNewlines)
        let password = passwordField
        if server.isEmpty || mail.isEmpty || password.isEmpty {
            loginError = "Fill in the server address, your email and your password."
            return
        }
        let macs = DeviceInfo.macs()
        if macs.isEmpty {
            loginError = "No network port was found on this Mac, so it cannot be identified."
            return
        }

        loginBusy = true
        loginError = ""
        api.baseUrl = server
        api.token = nil
        api.login(email: mail, password: password, macs: macs, machineId: DeviceInfo.machineId(macs)) { [weak self] result in
            guard let self = self else { return }
            self.loginBusy = false
            switch result {
            case .success(let json):
                let user = json["user"] as? Json
                self.api.token = json["token"] as? String
                self.store.server = server
                self.store.email = user?["email"] as? String ?? mail
                self.store.name = user?["name"] as? String ?? mail
                self.store.token = self.api.token
                self.store.save()
                self.passwordField = ""
                self.enterMain()
            case .failure(let error):
                var message = error.message
                if error.code == "DEVICE_PENDING" || error.code == "DEVICE_REVOKED" {
                    message += "\n\nThis Mac: \(DeviceInfo.hostname())\nMAC address: \(macs[0])"
                }
                self.loginError = message
                // remember what was typed so the user does not retype it after the admin approves
                self.store.server = server
                self.store.email = mail
                self.store.save()
            }
        }
    }

    private func enterMain() {
        offline = false
        lastSyncOk = nil
        serverToday = 0
        serverWeek = 0
        tracker.clearQueue()
        for bucket in store.loadQueue(store.email) { tracker.enqueue(bucket) }
        name = store.name.isEmpty ? store.email : store.name
        email = store.email
        signedIn = true
        if startWhenSignedIn {
            startWhenSignedIn = false
            startTracking()
        }
        refresh()
        sync()   // uploads anything left from last time and loads today's totals
    }

    func signOut() {
        if !signedIn { return }
        stopTracking()
        if tracker.flush() { store.saveQueue(store.email, tracker.queue) }
        let pending = tracker.queue
        if !pending.isEmpty, api.uploadBlocking(pending, timeout: 4) {
            tracker.removeSent(pending)
            store.saveQueue(store.email, tracker.queue)
        }
        showLogin("")
    }

    private func showLogin(_ message: String) {
        api.token = nil
        store.token = nil
        store.save()
        serverField = store.server
        emailField = store.email
        passwordField = ""
        loginError = message
        signedIn = false
    }

    /// The server rejected us: device blocked, account disabled or session expired.
    private func forceSignOut(_ reason: String) {
        stopTracking()
        if tracker.flush() { store.saveQueue(store.email, tracker.queue) }
        showLogin(reason + "\n\nTime tracking has stopped. Sign in again to continue.")
        onNeedsAttention()
    }

    // MARK: tracking

    func toggleTracking() {
        if tracker.running { stopTracking() } else { startTracking() }
    }

    func startTracking() {
        if !signedIn || tracker.running { return }
        counter.reset()
        tracker.start(Date())
        // keep the one-second timer accurate while the app is in the background
        napGuard = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep], reason: "Tracking time")
        refresh()
    }

    func stopTracking() {
        if !tracker.running { return }
        let input = counter.take()
        _ = tracker.tick(Date(), mouse: input.mouse, keys: input.keys)   // count the last partial second and its input
        tracker.stop()
        if let token = napGuard {
            ProcessInfo.processInfo.endActivity(token)
            napGuard = nil
        }
        refresh()
    }

    private func tick() {
        let now = Date()
        var input = (mouse: 0, keys: 0)
        if tracker.running { input = counter.take() }
        let result = tracker.tick(now, mouse: input.mouse, keys: input.keys)
        if result.queueChanged && signedIn { store.saveQueue(store.email, tracker.queue) }
        if result.idleNotify { notifyIdle() }

        if signedIn && !syncing {
            let sinceAttempt = now.timeIntervalSince(lastSyncAttempt)
            let haveData = !tracker.queue.isEmpty && sinceAttempt >= (offline ? 60 : 3)
            let refreshDue = now.timeIntervalSince(lastSummary) >= 300 && sinceAttempt >= 60   // also notices a blocked device while stopped
            if haveData || refreshDue { sync() }
        }
        refresh()
    }

    private func notifyIdle() {
        // Shown once per idle period; the tracker re-arms it when the user is active again.
        guard Bundle.main.bundleIdentifier != nil else { return }
        let content = UNMutableNotificationContent()
        content.title = "Are you still working?"
        content.body = "No mouse or keyboard activity for 5 minutes. The timer is still running and this time is recorded as idle. Stop the timer if you are taking a break."
        content.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "idle", content: content, trigger: nil))
    }

    private static func dayStart() -> Date {
        return Calendar.current.startOfDay(for: Date())
    }

    private static func weekStart() -> Date {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: Date())
        let back = (calendar.component(.weekday, from: today) + 5) % 7   // Monday
        return calendar.date(byAdding: .day, value: -back, to: today) ?? today
    }

    private func sync() {
        if syncing || !signedIn { return }
        syncing = true
        lastSyncAttempt = Date()
        let batch = Array(tracker.queue.prefix(2000))
        if batch.isEmpty {
            loadSummary()
            return
        }
        api.upload(batch) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success:
                let day = Tracker.epochMinute(AppModel.dayStart()), week = Tracker.epochMinute(AppModel.weekStart())
                self.serverToday += batch.filter { $0.t >= day }.reduce(0) { $0 + $1.s }
                self.serverWeek += batch.filter { $0.t >= week }.reduce(0) { $0 + $1.s }
                self.tracker.removeSent(batch)
                self.store.saveQueue(self.store.email, self.tracker.queue)
                self.loadSummary()
            case .failure(let error):
                self.syncFailed(error)
            }
        }
    }

    private func loadSummary() {
        api.summary(dayStart: AppModel.dayStart(), weekStart: AppModel.weekStart()) { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let json):
                self.serverToday = jsonInt(json, "today")
                self.serverWeek = jsonInt(json, "week")
                self.lastSummary = Date()
                self.lastSyncOk = Date()
                self.offline = false
                self.syncing = false
                self.refresh()
            case .failure(let error):
                self.syncFailed(error)
            }
        }
    }

    private func syncFailed(_ error: ApiError) {
        syncing = false
        if error.isAuthFailure {
            if signedIn { forceSignOut(error.message) }
            return
        }
        offline = true
        refresh()
    }

    // MARK: display

    private static func hm(_ seconds: Int) -> String {
        let minutes = seconds / 60
        return "\(minutes / 60)h " + String(format: "%02d", minutes % 60) + "m"
    }

    private func refresh() {
        guard signedIn else { return }
        let now = Date()
        var state = UiState()
        state.running = tracker.running
        state.idle = tracker.isIdle(now)

        let s = tracker.sessionSeconds
        state.timer = "\(s / 3600):" + String(format: "%02d:%02d", s / 60 % 60, s % 60)
        if !state.running { state.stateText = "Timer is off. Switch it on to start tracking." }
        else if state.idle { state.stateText = "Idle for \(tracker.idleSeconds(now) / 60) min - no mouse or keyboard activity" }
        else { state.stateText = "Tracking your time" }

        let today = serverToday + tracker.unsentSeconds(since: Tracker.epochMinute(AppModel.dayStart()))
        let week = serverWeek + tracker.unsentSeconds(since: Tracker.epochMinute(AppModel.weekStart()))
        state.today = AppModel.hm(today)
        state.week = AppModel.hm(max(week, today))

        state.bars = tracker.recentMinutes(now)
        if state.running, let cur = tracker.current {
            state.counts = "This minute: \(cur.m) mouse actions, \(cur.k) key presses"
        } else {
            state.counts = "Green = active, amber = idle, grey = not tracked"
        }

        let waiting = tracker.queue.count
        state.offline = offline
        if offline {
            state.status = "Offline - " + (waiting > 0 ? "\(waiting) min saved on this Mac, will upload when the connection is back." : "will retry shortly.")
        } else if let ok = lastSyncOk {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.dateFormat = "h:mm a"
            state.status = "Synced at " + formatter.string(from: ok) + (waiting > 0 ? " - \(waiting) min waiting to upload" : "")
        } else {
            state.status = "Connecting..."
        }

        if state != ui { ui = state }
    }

    // MARK: misc

    func openWebsite() {
        if let url = URL(string: store.server), !store.server.isEmpty { NSWorkspace.shared.open(url) }
    }

    /// Called when the app quits: nothing tracked is lost, unsent minutes stay in the queue file.
    func shutdown() {
        timer?.invalidate()
        stopTracking()
        guard signedIn else { return }
        tracker.flush()
        store.saveQueue(store.email, tracker.queue)
        let pending = tracker.queue
        if !pending.isEmpty, api.uploadBlocking(pending, timeout: 4) {
            tracker.removeSent(pending)
            store.saveQueue(store.email, tracker.queue)
        }
    }
}
