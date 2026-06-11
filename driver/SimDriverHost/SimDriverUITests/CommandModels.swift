import Foundation

// MARK: - Daemon envelopes (sequence-numbered IPC)

struct CommandEnvelope: Codable {
    var seq: Int
    var command: UICommand
}

struct ResultEnvelope: Codable {
    var seq: Int
    var result: UIResult
}

struct DaemonStatus: Codable {
    var ready: Bool
    var pid: Int32
}

// MARK: - Command protocol (host → driver)

struct UICommand: Codable {
    /// Target app bundle id. Omit to use the app already in the foreground (activate only).
    var bundleId: String?
    var action: String
    var query: ElementQuery?
    var x: Double?
    var y: Double?
    var normalized: Bool?
    var text: String?
    var direction: String?
    var fromX: Double?
    var fromY: Double?
    var toX: Double?
    var toY: Double?
    var duration: Double?
    var timeout: Double?
    var actions: [UICommand]?
}

struct ElementQuery: Codable {
    var label: String?
    var labelContains: String?
    var identifier: String?
    var valueContains: String?
    var type: String?
    var index: Int?
}

struct UIResult: Codable {
    var success: Bool
    var action: String
    var bundleId: String?
    var screen: ScreenInfo?
    var elements: [UIElementInfo]?
    var matched: UIElementInfo?
    var error: String?
    var text: String?
}

struct ScreenInfo: Codable {
    var width: Double
    var height: Double
}

struct UIElementInfo: Codable {
    var type: String
    var label: String?
    var identifier: String?
    var value: String?
    var placeholder: String?
    var frame: ElementFrame
    var enabled: Bool
    var hittable: Bool
    var selected: Bool
    var index: Int
}

struct ElementFrame: Codable {
    var x: Double
    var y: Double
    var width: Double
    var height: Double

    var centerX: Double { x + width / 2 }
    var centerY: Double { y + height / 2 }
}
