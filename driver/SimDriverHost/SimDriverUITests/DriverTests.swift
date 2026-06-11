import XCTest

final class DriverTests: XCTestCase {
    private var app: XCUIApplication!
    private var activeBundleId: String?
    private var lastResolvedBundleId: String?

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    func testRunCommand() throws {
        let activeDir = "/tmp/open-sim/active"
        // Env vars don't propagate into the runner, so daemon mode is signaled by a flag file.
        // Persistent daemon keeps the runner alive so each command avoids xcodebuild cold start.
        if FileManager.default.fileExists(atPath: "\(activeDir)/daemon.flag") {
            runDaemon(activeDir: activeDir)
        } else {
            try runSingle(activeDir: activeDir)
        }
    }

    // MARK: - Daemon mode (one long-lived test, many commands)

    private func runDaemon(activeDir: String) {
        let fm = FileManager.default
        try? fm.createDirectory(atPath: activeDir, withIntermediateDirectories: true)
        let commandPath = "\(activeDir)/command.json"
        let resultPath = "\(activeDir)/result.json"
        let statusPath = "\(activeDir)/status.json"

        // Signal readiness so the host knows it can start sending commands.
        writeJSON(DaemonStatus(ready: true, pid: ProcessInfo.processInfo.processIdentifier), to: statusPath)

        var lastSeq = -1
        var lastActivity = Date()
        let idleTimeout: TimeInterval = 900  // exit after 15 min idle; host respawns on demand

        while true {
            if Date().timeIntervalSince(lastActivity) > idleTimeout { break }

            guard
                let data = try? Data(contentsOf: URL(fileURLWithPath: commandPath)),
                let envelope = try? JSONDecoder().decode(CommandEnvelope.self, from: data),
                envelope.seq > lastSeq
            else {
                Thread.sleep(forTimeInterval: 0.02)
                continue
            }

            lastSeq = envelope.seq
            lastActivity = Date()

            if envelope.command.action == "__shutdown" { break }

            let result = handle(envelope.command)
            writeJSON(ResultEnvelope(seq: envelope.seq, result: result), to: resultPath)
        }
    }

    // MARK: - Single-shot mode (fallback / debugging)

    private func runSingle(activeDir: String) throws {
        let commandPath = ProcessInfo.processInfo.environment["UI_TEST_COMMAND_PATH"]
            ?? "\(activeDir)/command.json"
        let resultPath = ProcessInfo.processInfo.environment["UI_TEST_RESULT_PATH"]
            ?? "\(activeDir)/result.json"

        var output = UIResult(
            success: false, action: "unknown", bundleId: nil, screen: nil,
            elements: nil, matched: nil, error: "Not executed", text: nil
        )
        defer {
            if let data = try? JSONEncoder().encode(output) {
                try? data.write(to: URL(fileURLWithPath: resultPath), options: .atomic)
            }
        }

        let data = try Data(contentsOf: URL(fileURLWithPath: commandPath))
        let command = try JSONDecoder().decode(UICommand.self, from: data)
        output = handle(command)
        if !output.success {
            XCTFail(output.error ?? "Command failed")
        }
    }

    private func handle(_ command: UICommand) -> UIResult {
        let resolved = resolveApp(bundleId: command.bundleId)
        app = resolved.app
        activeBundleId = resolved.bundleId
        if app.state != .runningForeground {
            let screen = ScreenInfo(width: app.frame.width, height: app.frame.height)
            return fail(
                command.action,
                bundle: resolved.bundleId,
                screen: screen,
                "App \(resolved.bundleId) is not in the foreground. Use launch_app first."
            )
        }
        return execute(command)
    }

    private func writeJSON<T: Encodable>(_ value: T, to path: String) {
        if let data = try? JSONEncoder().encode(value) {
            try? data.write(to: URL(fileURLWithPath: path), options: .atomic)
        }
    }

    // MARK: - App resolution (no hardcoded UI — only system bundle for home screen fallback)

    private func resolveApp(bundleId: String?) -> (app: XCUIApplication, bundleId: String) {
        let id = (bundleId?.isEmpty == false) ? bundleId! : "com.apple.springboard"

        if id == "com.apple.springboard" {
            // Home screen: dismiss whatever app is currently open.
            XCUIDevice.shared.press(.home)
            let springboard = XCUIApplication(bundleIdentifier: id)
            _ = springboard.wait(for: .runningForeground, timeout: 1)
            lastResolvedBundleId = id
            return (springboard, id)
        }

        // Switching to a different app: close the current one first.
        if let current = lastResolvedBundleId, current != id {
            XCUIDevice.shared.press(.home)
            _ = XCUIApplication(bundleIdentifier: "com.apple.springboard")
                .wait(for: .runningForeground, timeout: 0.8)
        }

        let target = XCUIApplication(bundleIdentifier: id)
        // Never call launch() here — it crashes the daemon when another app is foreground.
        // The Node host uses simctl launch before sending UI commands.
        if target.state != .runningForeground {
            target.activate()
            _ = target.wait(for: .runningForeground, timeout: 1)
        }
        lastResolvedBundleId = id
        return (target, id)
    }

    // MARK: - Command execution

    private func execute(_ command: UICommand) -> UIResult {
        let screen = ScreenInfo(width: app.frame.width, height: app.frame.height)
        let bundle = activeBundleId

        switch command.action {
        case "describe":
            let elements = AccessibilityWalker.describe(app: app, bundleId: activeBundleId)
            return UIResult(
                success: true, action: "describe", bundleId: bundle, screen: screen,
                elements: elements, matched: nil, error: nil, text: nil
            )

        case "tap":
            return performTap(command, screen: screen, bundle: bundle)

        case "swipe":
            return performSwipe(command, screen: screen, bundle: bundle)

        case "type":
            return performType(command, screen: screen, bundle: bundle)

        case "longPress":
            return performLongPress(command, screen: screen, bundle: bundle)

        case "wait":
            let seconds = command.timeout ?? command.duration ?? 1
            Thread.sleep(forTimeInterval: seconds)
            return UIResult(success: true, action: "wait", bundleId: bundle, screen: screen,
                            elements: nil, matched: nil, error: nil, text: nil)

        case "script":
            guard let actions = command.actions, !actions.isEmpty else {
                return fail("script", bundle: bundle, screen: screen, "No actions provided")
            }
            for step in actions {
                let stepResult = execute(step)
                if !stepResult.success { return stepResult }
            }
            return UIResult(success: true, action: "script", bundleId: bundle, screen: screen,
                            elements: nil, matched: nil, error: nil, text: nil)

        default:
            return fail(command.action, bundle: bundle, screen: screen, "Unknown action: \(command.action)")
        }
    }

    private func performTap(_ command: UICommand, screen: ScreenInfo, bundle: String?) -> UIResult {
        if let query = command.query {
            guard let el = ElementFinder.find(query: query, in: app, bundleId: activeBundleId) else {
                return fail("tap", bundle: bundle, screen: screen,
                            "No element matched query: \(queryDescription(query))")
            }
            // Coordinate tap is more reliable for home screen icons and distant elements.
            el.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            let matched = AccessibilityWalker.toElementInfo(el, index: 0)
            return UIResult(success: true, action: "tap", bundleId: bundle, screen: screen,
                            elements: nil, matched: matched, error: nil, text: nil)
        }

        guard let x = command.x, let y = command.y else {
            return fail("tap", bundle: bundle, screen: screen, "Provide query or x/y coordinates")
        }
        let coord = ElementFinder.coordinate(x: x, y: y, normalized: command.normalized ?? false, in: app)
        coord.tap()
        return UIResult(success: true, action: "tap", bundleId: bundle, screen: screen,
                        elements: nil, matched: nil, error: nil, text: nil)
    }

    private func performSwipe(_ command: UICommand, screen: ScreenInfo, bundle: String?) -> UIResult {
        if let direction = command.direction?.lowercased() {
            let target: XCUIElement = command.query.flatMap { ElementFinder.find(query: $0, in: app, bundleId: activeBundleId) } ?? app
            switch direction {
            case "up": target.swipeUp()
            case "down": target.swipeDown()
            case "left": target.swipeLeft()
            case "right": target.swipeRight()
            default:
                return fail("swipe", bundle: bundle, screen: screen, "Unknown direction: \(direction)")
            }
            return UIResult(success: true, action: "swipe", bundleId: bundle, screen: screen,
                            elements: nil, matched: nil, error: nil, text: nil)
        }

        guard let fx = command.fromX, let fy = command.fromY, let tx = command.toX, let ty = command.toY else {
            return fail("swipe", bundle: bundle, screen: screen, "Provide direction or from/to coordinates")
        }
        let norm = command.normalized ?? false
        let start = ElementFinder.coordinate(x: fx, y: fy, normalized: norm, in: app)
        let end = ElementFinder.coordinate(x: tx, y: ty, normalized: norm, in: app)
        start.press(forDuration: 0.05, thenDragTo: end)
        return UIResult(success: true, action: "swipe", bundleId: bundle, screen: screen,
                        elements: nil, matched: nil, error: nil, text: nil)
    }

    private func performType(_ command: UICommand, screen: ScreenInfo, bundle: String?) -> UIResult {
        guard let text = command.text else {
            return fail("type", bundle: bundle, screen: screen, "text is required")
        }

        if let query = command.query {
            guard let el = ElementFinder.find(query: query, in: app, bundleId: activeBundleId) else {
                return fail("type", bundle: bundle, screen: screen, "No element matched query")
            }
            el.tap()
            if let existing = el.value as? String, !existing.isEmpty {
                el.clearText()
            }
            el.typeText(text)
            return UIResult(success: true, action: "type", bundleId: bundle, screen: screen,
                            elements: nil, matched: AccessibilityWalker.toElementInfo(el, index: 0),
                            error: nil, text: text)
        }

        if let x = command.x, let y = command.y {
            ElementFinder.coordinate(x: x, y: y, normalized: command.normalized ?? false, in: app).tap()
        }

        // Type into whatever field is focused.
        app.typeText(text)
        return UIResult(success: true, action: "type", bundleId: bundle, screen: screen,
                        elements: nil, matched: nil, error: nil, text: text)
    }

    private func performLongPress(_ command: UICommand, screen: ScreenInfo, bundle: String?) -> UIResult {
        let duration = command.duration ?? 1.0
        if let query = command.query, let el = ElementFinder.find(query: query, in: app, bundleId: activeBundleId) {
            el.press(forDuration: duration)
            return UIResult(success: true, action: "longPress", bundleId: bundle, screen: screen,
                            elements: nil, matched: AccessibilityWalker.toElementInfo(el, index: 0),
                            error: nil, text: nil)
        }
        guard let x = command.x, let y = command.y else {
            return fail("longPress", bundle: bundle, screen: screen, "Provide query or x/y")
        }
        ElementFinder.coordinate(x: x, y: y, normalized: command.normalized ?? false, in: app)
            .press(forDuration: duration)
        return UIResult(success: true, action: "longPress", bundleId: bundle, screen: screen,
                        elements: nil, matched: nil, error: nil, text: nil)
    }

    private func fail(_ action: String, bundle: String?, screen: ScreenInfo, _ message: String) -> UIResult {
        UIResult(success: false, action: action, bundleId: bundle, screen: screen,
                 elements: nil, matched: nil, error: message, text: nil)
    }

    private func queryDescription(_ q: ElementQuery) -> String {
        [q.label.map { "label=\($0)" },
         q.labelContains.map { "labelContains=\($0)" },
         q.identifier.map { "id=\($0)" },
         q.type.map { "type=\($0)" }]
            .compactMap { $0 }.joined(separator: ", ")
    }
}

// MARK: - Helpers

private extension XCUIElement {
    func clearText() {
        guard let stringValue = value as? String, !stringValue.isEmpty else { return }
        let deleteString = String(repeating: XCUIKeyboardKey.delete.rawValue, count: stringValue.count)
        typeText(deleteString)
    }
}
