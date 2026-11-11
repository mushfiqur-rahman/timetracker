import SwiftUI

enum Theme {
    static let bg = Color(red: 244 / 255, green: 246 / 255, blue: 245 / 255)
    static let card = Color.white
    static let line = Color(red: 225 / 255, green: 230 / 255, blue: 227 / 255)
    static let text = Color(red: 23 / 255, green: 33 / 255, blue: 29 / 255)
    static let muted = Color(red: 102 / 255, green: 115 / 255, blue: 109 / 255)
    static let accent = Color(red: 15 / 255, green: 138 / 255, blue: 95 / 255)
    static let idle = Color(red: 227 / 255, green: 160 / 255, blue: 8 / 255)
    static let idleText = Color(red: 138 / 255, green: 90 / 255, blue: 0)
    static let none = Color(red: 226 / 255, green: 231 / 255, blue: 228 / 255)
    static let danger = Color(red: 192 / 255, green: 57 / 255, blue: 43 / 255)
}

struct RootView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        Group {
            if model.signedIn { MainView() } else { LoginView() }
        }
        .frame(width: 340, height: 540, alignment: .top)
        .background(Theme.bg)
        .foregroundColor(Theme.text)
    }
}

/// White rounded panel.
struct Card<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 12).fill(Theme.card))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Theme.line, lineWidth: 1))
    }
}

struct Caption: View {
    let text: String

    var body: some View {
        Text(text).font(.system(size: 11, weight: .bold)).foregroundColor(Theme.muted)
    }
}

// MARK: - Sign in

struct LoginView: View {
    @EnvironmentObject var model: AppModel

    var body: some View {
        VStack(spacing: 0) {
            Text("Time Tracker").font(.system(size: 24, weight: .bold)).padding(.top, 28)
            Text("Sign in with the account your admin gave you")
                .font(.system(size: 12)).foregroundColor(Theme.muted).padding(.top, 4).padding(.bottom, 20)

            Card {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Server address").font(.system(size: 12, weight: .semibold))
                    TextField("https://time.example.com", text: $model.serverField)
                        .textFieldStyle(.roundedBorder).disableAutocorrection(true).padding(.bottom, 8)
                    Text("Email").font(.system(size: 12, weight: .semibold))
                    TextField("", text: $model.emailField)
                        .textFieldStyle(.roundedBorder).disableAutocorrection(true).padding(.bottom, 8)
                    Text("Password").font(.system(size: 12, weight: .semibold))
                    SecureField("", text: $model.passwordField)
                        .textFieldStyle(.roundedBorder).padding(.bottom, 12)

                    Button(action: { model.login() }) {
                        Text(model.loginBusy ? "Signing in..." : "Sign in")
                            .font(.system(size: 14, weight: .bold)).foregroundColor(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 10)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Theme.accent))
                    }
                    .buttonStyle(.plain)
                    .keyboardShortcut(.defaultAction)
                    .disabled(model.loginBusy)
                }
            }

            Text(model.loginError)
                .font(.system(size: 12)).foregroundColor(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)
                .padding(.top, 12)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
    }
}

// MARK: - Tracker

struct MainView: View {
    @EnvironmentObject var model: AppModel

    private var stateColor: Color {
        if !model.ui.running { return Theme.muted }
        return model.ui.idle ? Theme.idleText : Theme.accent
    }

    private var timerColor: Color {
        if !model.ui.running { return Theme.muted }
        return model.ui.idle ? Theme.idleText : Theme.text
    }

    var body: some View {
        VStack(spacing: 10) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(model.name).font(.system(size: 15, weight: .bold)).lineLimit(1)
                    Text(model.email).font(.system(size: 11)).foregroundColor(Theme.muted).lineLimit(1)
                }
                Spacer()
                Menu("Menu") {
                    Button("Open my timeline in the browser") { model.openWebsite() }
                    Divider()
                    Button("Sign out") { model.signOut() }
                    Button("Quit Time Tracker") { NSApp.terminate(nil) }
                }
                .frame(width: 76)
            }
            .padding(.top, 12)

            Card {
                VStack(spacing: 8) {
                    Caption(text: "CURRENT SESSION")
                    Text(model.ui.timer)
                        .font(.system(size: 44, weight: .bold)).monospacedDigit()
                        .foregroundColor(timerColor)
                    BigToggle(isOn: model.ui.running) { model.toggleTracking() }
                    Text(model.ui.stateText)
                        .font(.system(size: 12)).foregroundColor(stateColor)
                        .multilineTextAlignment(.center)
                        .frame(height: 30)
                }
            }

            Card {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Caption(text: "TODAY")
                        Text(model.ui.today).font(.system(size: 21, weight: .bold)).monospacedDigit()
                    }
                    Spacer()
                    VStack(alignment: .leading, spacing: 4) {
                        Caption(text: "THIS WEEK")
                        Text(model.ui.week).font(.system(size: 21, weight: .bold)).monospacedDigit()
                    }
                    Spacer()
                }
            }

            Card {
                VStack(alignment: .leading, spacing: 8) {
                    Caption(text: "LAST 10 MINUTES")
                    HStack(spacing: 4) {
                        ForEach(0..<10, id: \.self) { i in
                            RoundedRectangle(cornerRadius: 4)
                                .fill(barColor(i < model.ui.bars.count ? model.ui.bars[i] : 0))
                                .frame(height: 26)
                        }
                    }
                    Text(model.ui.counts).font(.system(size: 11)).foregroundColor(Theme.muted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Text(model.ui.status)
                .font(.system(size: 11)).foregroundColor(model.ui.offline ? Theme.idleText : Theme.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
    }

    private func barColor(_ state: Int) -> Color {
        return state == 1 ? Theme.accent : state == 2 ? Theme.idle : Theme.none
    }
}

/// The big on/off switch that starts and stops the timer.
struct BigToggle: View {
    let isOn: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? Theme.accent : Color(white: 0.70)).frame(width: 84, height: 44)
                Circle().fill(Color.white).frame(width: 36, height: 36).padding(4)
            }
            .animation(.easeInOut(duration: 0.15), value: isOn)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Track time")
        .accessibilityValue(isOn ? "On" : "Off")
    }
}
