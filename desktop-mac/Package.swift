// swift-tools-version:5.7
import PackageDescription

let package = Package(
    name: "TimeTracker",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(name: "TimeTracker", path: "Sources/TimeTracker")
    ]
)
