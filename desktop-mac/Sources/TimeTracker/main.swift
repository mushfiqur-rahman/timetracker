import AppKit
import SwiftUI
import UserNotifications

// MARK: - Command line checks (used by the automated build; no window is opened)

/// Prints what the server would see for this Mac.
func printDeviceInfo() {
    let macs = DeviceInfo.macs()
    let info: Json = ["macs": macs, "machineId": DeviceInfo.machineId(macs), "hostname": DeviceInfo.hostname(), "os": DeviceInfo.osName()]
    if let data = try? JSONSerialization.data(withJSONObject: info), let text = String(data: data, encoding: .utf8) { print(text) }
}

/// Simulates a work session and checks the tracking rules. Returns the number of failed checks.
func runSelfTest() -> Int32 {
    var failures: Int32 = 0
    func check(_ name: String, _ got: Int, _ want: Int) {
        if got == want { print("ok   \(name)") } else { failures += 1; print("FAIL \(name): got \(got), want \(want)") }
    }

    let tracker = Tracker()
    var now = Date(timeIntervalSince1970: 1_794_387_600)   // on a minute boundary
    tracker.start(now)
    func run(_ seconds: Int, active: (Int) -> Bool) -> Int {
        var notifications = 0
        for i in 1...seconds {
            now = now.addingTimeInterval(1)
            let on = active(i)
            if tracker.tick(now, mouse: on ? 1 : 0, keys: on ? 3 : 0).idleNotify { notifications += 1 }
        }
        return notifications
    }

    check("no notification while active", run(120) { $0 % 10 == 0 }, 0)
    check("minutes queued after 2 min", tracker.queue.count, 2)
    check("no notification before 5 min idle", run(299) { _ in false }, 0)
    check("exactly one notification in an idle period", run(121) { _ in false }, 1)
    check("idle state", tracker.isIdle(now) ? 1 : 0, 1)
    check("no notification when active again", run(60) { $0 % 5 == 0 }, 0)
    check("not idle after activity", tracker.isIdle(now) ? 1 : 0, 0)
    check("one notification in the second idle period", run(400) { _ in false }, 1)
    check("session seconds", tracker.sessionSeconds, 1000)
    tracker.stop()
    now = now.addingTimeInterval(71)
    _ = tracker.tick(now, mouse: 5, keys: 5)
    check("all seconds queued after stop", tracker.queue.reduce(0) { $0 + $1.s }, 1000)
    tracker.start(now)
    now = now.addingTimeInterval(7200)
    _ = tracker.tick(now, mouse: 0, keys: 0)
    check("sleep gap is not counted", tracker.sessionSeconds, 1)
    tracker.removeSent(tracker.queue)
    check("queue empty after upload", tracker.queue.count, 0)

    let counter = InputCounter()
    counter.reset()
    let input = counter.take()
    print("input counters readable: mouse +\(input.mouse), keys +\(input.keys)")
    printDeviceInfo()
    print(failures == 0 ? "SELFTEST PASS" : "SELFTEST FAILED (\(failures))")
    return failures
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
    let model = AppModel()
    private var window: NSWindow!
    private var statusItem: NSStatusItem!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMainMenu()

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 340, height: 540),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Time Tracker"
        window.isReleasedWhenClosed = false          // the red button only hides the window; tracking continues
        window.appearance = NSAppearance(named: .aqua)
        window.contentView = NSHostingView(rootView: RootView().environmentObject(model))
        window.center()

        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        menu.delegate = self
        statusItem.menu = menu
        updateStatusIcon()

        if Bundle.main.bundleIdentifier != nil {
            let center = UNUserNotificationCenter.current()
            center.delegate = self
            center.requestAuthorization(options: [.alert, .sound]) { _, _ in }
        }

        model.onNeedsAttention = { [weak self] in self?.showWindow() }
        model.launch()
        showWindow()

        // keep the menu bar icon in step with the timer
        let iconTimer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.updateStatusIcon() }
        RunLoop.main.add(iconTimer, forMode: .common)
    }

    private func buildMainMenu() {
        let main = NSMenu()

        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Hide Time Tracker", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit Time Tracker", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        main.addItem(appItem)

        // without an Edit menu, copy and paste do not work in the sign-in fields
        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        main.addItem(editItem)

        let windowItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowItem.submenu = windowMenu
        main.addItem(windowItem)

        NSApp.mainMenu = main
    }

    private func updateStatusIcon() {
        guard let button = statusItem.button else { return }
        let running = model.signedIn && model.tracker.running
        let image = NSImage(systemSymbolName: running ? "clock.fill" : "clock", accessibilityDescription: "Time Tracker")
        image?.isTemplate = true
        button.image = image
        if image == nil { button.title = "TT" }
        button.toolTip = running ? "Time Tracker - tracking, today \(model.ui.today)" : "Time Tracker - stopped"
    }

    /// Menu bar icon menu, rebuilt each time it opens.
    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        menu.addItem(withTitle: "Open Time Tracker", action: #selector(openFromMenu), keyEquivalent: "").target = self
        if model.signedIn {
            let title = model.tracker.running ? "Stop tracking" : "Start tracking"
            menu.addItem(withTitle: title, action: #selector(toggleFromMenu), keyEquivalent: "").target = self
            menu.addItem(withTitle: "Today: \(model.ui.today)", action: nil, keyEquivalent: "")
        }
        menu.addItem(NSMenuItem.separator())
        menu.addItem(withTitle: "Quit Time Tracker", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
    }

    @objc private func openFromMenu() { showWindow() }

    @objc private func toggleFromMenu() {
        model.toggleTracking()
        updateStatusIcon()
    }

    private func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { return false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !model.tracker.running { return .terminateNow }
        let alert = NSAlert()
        alert.messageText = "The timer is running"
        alert.informativeText = "Stop tracking and quit Time Tracker?"
        alert.addButton(withTitle: "Stop and Quit")
        alert.addButton(withTitle: "Cancel")
        return alert.runModal() == .alertFirstButtonReturn ? .terminateNow : .terminateCancel
    }

    func applicationWillTerminate(_ notification: Notification) {
        model.shutdown()
    }

    // show the idle notification even while the app's own window is in front
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        DispatchQueue.main.async { self.showWindow() }
        completionHandler()
    }
}

if CommandLine.arguments.contains("--device-info") {
    printDeviceInfo()
    exit(0)
}
if CommandLine.arguments.contains("--selftest") {
    exit(runSelfTest())
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
