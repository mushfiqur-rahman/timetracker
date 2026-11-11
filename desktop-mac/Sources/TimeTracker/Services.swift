import Foundation
import CoreGraphics
import IOKit

// MARK: - Input activity

/// Counts mouse clicks, scroll steps and key presses for the whole login session, on every display.
/// It reads macOS' own running totals once a second, so the app never sees which key was pressed
/// and needs no Accessibility or Input Monitoring permission.
final class InputCounter {
    private static let mouseTypes: [CGEventType] = [.leftMouseDown, .rightMouseDown, .otherMouseDown, .scrollWheel]
    private var lastMouse: UInt32 = 0
    private var lastKeys: UInt32 = 0

    private static func total(_ types: [CGEventType]) -> UInt32 {
        var sum: UInt32 = 0
        for type in types {
            sum = sum &+ CGEventSource.counterForEventType(.combinedSessionState, eventType: type)
        }
        return sum
    }

    func reset() {
        lastMouse = InputCounter.total(InputCounter.mouseTypes)
        lastKeys = InputCounter.total([.keyDown])
    }

    /// Returns what was counted since the last call.
    func take() -> (mouse: Int, keys: Int) {
        let mouse = InputCounter.total(InputCounter.mouseTypes)
        let keys = InputCounter.total([.keyDown])
        let dm = mouse &- lastMouse
        let dk = keys &- lastKeys
        lastMouse = mouse
        lastKeys = keys
        // a huge jump means the system counters restarted: ignore that one reading
        return (dm > 1_000_000 ? 0 : Int(dm), dk > 1_000_000 ? 0 : Int(dk))
    }
}

// MARK: - Device identity

enum DeviceInfo {
    /// MAC addresses of the Mac's network ports (en0, en1, ...), built-in hardware addresses first.
    static func macs() -> [String] {
        var found: [(rank: Int, mac: String)] = []
        var ifap: UnsafeMutablePointer<ifaddrs>? = nil
        guard getifaddrs(&ifap) == 0 else { return [] }
        defer { freeifaddrs(ifap) }

        var cursor = ifap
        while let cur = cursor {
            cursor = cur.pointee.ifa_next
            guard let addr = cur.pointee.ifa_addr, Int32(addr.pointee.sa_family) == AF_LINK else { continue }
            let name = String(cString: cur.pointee.ifa_name)
            guard name.hasPrefix("en") else { continue }

            // sockaddr_dl: 8 header bytes, then the interface name, then the hardware address
            let raw = UnsafeRawPointer(addr)
            let nameLength = Int(raw.load(fromByteOffset: 5, as: UInt8.self))
            let addressLength = Int(raw.load(fromByteOffset: 6, as: UInt8.self))
            guard addressLength == 6 else { continue }
            let bytes = (0..<6).map { raw.load(fromByteOffset: 8 + nameLength + $0, as: UInt8.self) }
            if bytes.allSatisfy({ $0 == 0 }) { continue }

            let locallyAdministered = bytes[0] & 2 != 0   // private / software-assigned address: least trustworthy
            let index = Int(name.dropFirst(2)) ?? 99
            let mac = bytes.map { String(format: "%02X", $0) }.joined(separator: ":")
            found.append((rank: (locallyAdministered ? 1000 : 0) + index, mac: mac))
        }

        var seen = Set<String>()
        return found.sorted { $0.rank < $1.rank }.map { $0.mac }.filter { seen.insert($0).inserted }
    }

    /// The Mac's hardware UUID. Unlike a MAC address it cannot be changed from network settings.
    static func machineId(_ macs: [String]) -> String {
        let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOPlatformExpertDevice"))
        if service != 0 {
            defer { IOObjectRelease(service) }
            if let value = IORegistryEntryCreateCFProperty(service, "IOPlatformUUID" as CFString, kCFAllocatorDefault, 0)?
                .takeRetainedValue() as? String, !value.isEmpty {
                return value
            }
        }
        return macs.first.map { "mac-" + $0 } ?? ""
    }

    static func hostname() -> String {
        return Host.current().localizedName ?? ProcessInfo.processInfo.hostName
    }

    static func osName() -> String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "macOS \(v.majorVersion).\(v.minorVersion)" + (v.patchVersion > 0 ? ".\(v.patchVersion)" : "")
    }
}

// MARK: - Server API

struct ApiError: Error {
    let status: Int        // 0 = could not reach the server
    let message: String
    let code: String?
    var isAuthFailure: Bool { return status == 401 || status == 403 }
}

typealias Json = [String: Any]
typealias ApiResult = Result<Json, ApiError>

final class Api {
    var baseUrl = ""
    var token: String?

    static func normalize(_ url: String) -> String {
        var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
        while u.hasSuffix("/") { u.removeLast() }
        if u.isEmpty { return "" }
        let lower = u.lowercased()
        if !lower.hasPrefix("http://") && !lower.hasPrefix("https://") { u = "https://" + u }
        return u
    }

    private func makeRequest(_ method: String, _ path: String, _ body: Json?) -> URLRequest? {
        guard let url = URL(string: baseUrl + "/api" + path) else { return nil }
        var request = URLRequest(url: url, timeoutInterval: 20)
        request.httpMethod = method
        if let token = token, !token.isEmpty { request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization") }
        if let body = body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        }
        return request
    }

    private static func parse(_ data: Data?, _ response: URLResponse?, _ error: Error?) -> ApiResult {
        guard error == nil, let http = response as? HTTPURLResponse else {
            return .failure(ApiError(status: 0, message: "Cannot reach the server. Check the server address and your internet connection.", code: nil))
        }
        let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? Json
        if (200..<300).contains(http.statusCode), let json = json { return .success(json) }
        guard let json = json else {
            return .failure(ApiError(status: http.statusCode >= 400 ? http.statusCode : 0,
                                     message: "Unexpected answer from the server (\(http.statusCode)). Check the server address.", code: nil))
        }
        return .failure(ApiError(status: http.statusCode,
                                 message: json["error"] as? String ?? "Request failed (\(http.statusCode))",
                                 code: json["code"] as? String))
    }

    /// Runs the request and calls `done` on the main thread.
    private func send(_ method: String, _ path: String, _ body: Json?, done: @escaping (ApiResult) -> Void) {
        guard let request = makeRequest(method, path, body) else {
            done(.failure(ApiError(status: 0, message: "The server address is not valid.", code: nil)))
            return
        }
        URLSession.shared.dataTask(with: request) { data, response, error in
            let result = Api.parse(data, response, error)
            DispatchQueue.main.async { done(result) }
        }.resume()
    }

    func login(email: String, password: String, macs: [String], machineId: String, done: @escaping (ApiResult) -> Void) {
        send("POST", "/desktop/login", [
            "email": email, "password": password, "macs": macs, "machineId": machineId,
            "hostname": DeviceInfo.hostname(), "os": DeviceInfo.osName(),
        ], done: done)
    }

    private static func payload(_ minutes: [MinuteBucket]) -> Json {
        return ["minutes": minutes.map { ["t": $0.t, "s": $0.s, "m": $0.m, "k": $0.k] }]
    }

    func upload(_ minutes: [MinuteBucket], done: @escaping (ApiResult) -> Void) {
        send("POST", "/desktop/activity", Api.payload(minutes), done: done)
    }

    /// Used while quitting: waits up to `timeout` seconds and reports whether the upload succeeded.
    func uploadBlocking(_ minutes: [MinuteBucket], timeout: TimeInterval) -> Bool {
        guard let request = makeRequest("POST", "/desktop/activity", Api.payload(minutes)) else { return false }
        final class Outcome { var ok = false }
        let outcome = Outcome()
        let semaphore = DispatchSemaphore(value: 0)
        URLSession.shared.dataTask(with: request) { data, response, error in
            if case .success = Api.parse(data, response, error) { outcome.ok = true }
            semaphore.signal()
        }.resume()
        return semaphore.wait(timeout: .now() + timeout) == .success && outcome.ok
    }

    func summary(dayStart: Date, weekStart: Date, done: @escaping (ApiResult) -> Void) {
        let iso = ISO8601DateFormatter()
        send("GET", "/desktop/summary?dayStart=\(iso.string(from: dayStart))&weekStart=\(iso.string(from: weekStart))", nil, done: done)
    }
}

func jsonInt(_ json: Json?, _ key: String) -> Int {
    return (json?[key] as? NSNumber)?.intValue ?? 0
}

// MARK: - Local files: ~/Library/Application Support/TimeTracker

final class Store {
    var server = ""
    var email = ""
    var name = ""
    var token: String?

    private let dir: URL

    init() {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        dir = base.appendingPathComponent("TimeTracker", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        load()
    }

    private var settingsUrl: URL { return dir.appendingPathComponent("settings.json") }

    private func queueUrl(_ email: String) -> URL {
        let safe = String(email.lowercased().map { $0.isLetter || $0.isNumber ? $0 : "_" })
        return dir.appendingPathComponent("queue-\(safe).json")
    }

    private func load() {
        guard let data = try? Data(contentsOf: settingsUrl),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? Json else { return }
        server = json["server"] as? String ?? ""
        email = json["email"] as? String ?? ""
        name = json["name"] as? String ?? ""
        let saved = json["token"] as? String ?? ""
        token = saved.isEmpty ? nil : saved
    }

    func save() {
        let json: Json = ["server": server, "email": email, "name": name, "token": token ?? ""]
        write(json, to: settingsUrl)
    }

    /// Minutes tracked while offline (or not uploaded before the app quit) for this account.
    func loadQueue(_ email: String) -> [MinuteBucket] {
        guard let data = try? Data(contentsOf: queueUrl(email)),
              let rows = (try? JSONSerialization.jsonObject(with: data)) as? [[Int]] else { return [] }
        return rows.filter { $0.count == 4 }.map { MinuteBucket(t: $0[0], s: $0[1], m: $0[2], k: $0[3]) }
    }

    func saveQueue(_ email: String, _ queue: [MinuteBucket]) {
        write(queue.map { [$0.t, $0.s, $0.m, $0.k] }, to: queueUrl(email))
    }

    private func write(_ object: Any, to url: URL) {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return }
        try? data.write(to: url, options: .atomic)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)   // readable by this user only
    }
}
