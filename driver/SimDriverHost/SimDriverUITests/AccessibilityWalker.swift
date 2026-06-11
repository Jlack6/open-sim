import XCTest

enum AccessibilityWalker {
    private static let typeNames: [XCUIElement.ElementType: String] = [
        .button: "button",
        .textField: "textField",
        .secureTextField: "secureTextField",
        .staticText: "staticText",
        .image: "image",
        .cell: "cell",
        .table: "table",
        .collectionView: "collectionView",
        .scrollView: "scrollView",
        .switch: "switch",
        .slider: "slider",
        .picker: "picker",
        .textView: "textView",
        .alert: "alert",
        .sheet: "sheet",
        .navigationBar: "navigationBar",
        .toolbar: "toolbar",
        .tabBar: "tabBar",
        .window: "window",
        .other: "other",
        .link: "link",
        .searchField: "searchField",
        .keyboard: "keyboard",
        .key: "key",
    ]

    static func typeName(_ type: XCUIElement.ElementType) -> String {
        typeNames[type] ?? "other"
    }

    static func elementType(from string: String) -> XCUIElement.ElementType? {
        switch string.lowercased() {
        case "button": return .button
        case "textfield", "text_field": return .textField
        case "securetextfield", "secure_text_field": return .secureTextField
        case "statictext", "static_text", "label", "text": return .staticText
        case "image": return .image
        case "cell": return .cell
        case "table": return .table
        case "collectionview", "collection_view": return .collectionView
        case "scrollview", "scroll_view": return .scrollView
        case "switch", "toggle": return .switch
        case "slider": return .slider
        case "picker": return .picker
        case "textview", "text_view": return .textView
        case "alert": return .alert
        case "sheet": return .sheet
        case "navigationbar", "navigation_bar": return .navigationBar
        case "toolbar": return .toolbar
        case "tabbar", "tab_bar": return .tabBar
        case "searchfield", "search_field": return .searchField
        case "link": return .link
        case "key": return .key
        case "any": return .any
        default: return nil
        }
    }

    /// Fast accessibility snapshot — scans typed queries instead of every descendant.
    static func describe(app: XCUIApplication, bundleId: String?, limit: Int = 100) -> [UIElementInfo] {
        var results: [UIElementInfo] = []
        var seen = Set<String>()

        let scanTypes: [XCUIElement.ElementType] = [
            .button, .cell, .staticText, .textField, .secureTextField,
            .switch, .image, .link, .searchField, .tabBar, .navigationBar,
            .alert, .sheet, .slider, .picker, .textView,
        ]

        for elType in scanTypes {
            appendMatches(from: app.descendants(matching: elType), into: &results, seen: &seen, limit: limit)
            if results.count >= limit { break }
        }

        // Home screen and dock apps expose identifiers (e.g. "Safari", "Messages").
        if results.count < limit, bundleId == "com.apple.springboard" {
            let withId = app.descendants(matching: .any)
                .matching(NSPredicate(format: "identifier != '' AND identifier != 'label-view' AND identifier != 'spotlight-pill' AND identifier != 'Page control' AND identifier != 'magnifyingglass'"))
            appendMatches(from: withId, into: &results, seen: &seen, limit: limit, typeLabel: "icon")
        }

        return results.sorted {
            if abs($0.frame.y - $1.frame.y) > 8 { return $0.frame.y < $1.frame.y }
            return $0.frame.x < $1.frame.x
        }
    }

    private static func appendMatches(
        from query: XCUIElementQuery,
        into results: inout [UIElementInfo],
        seen: inout Set<String>,
        limit: Int,
        typeLabel: String? = nil
    ) {
        let count = min(query.count, 40)
        for i in 0..<count {
            if results.count >= limit { return }
            let el = query.element(boundBy: i)
            guard el.exists else { continue }
            let frame = el.frame
            guard frame.width > 2, frame.height > 2 else { continue }

            let label = el.label.trimmingCharacters(in: .whitespacesAndNewlines)
            let identifier = el.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
            let value = el.value as? String ?? ""
            let placeholder = el.placeholderValue ?? ""

            let hasMetadata = !label.isEmpty || !identifier.isEmpty || !value.isEmpty || !placeholder.isEmpty
            let isInteractive = el.isHittable || el.elementType == .button || el.elementType == .switch
                || el.elementType == .textField || el.elementType == .cell || el.elementType == .link
            guard hasMetadata || isInteractive else { continue }

            let key = "\(identifier)|\(label)|\(Int(frame.origin.x))|\(Int(frame.origin.y))|\(Int(frame.width))|\(Int(frame.height))"
            guard !seen.contains(key) else { continue }
            seen.insert(key)

            results.append(UIElementInfo(
                type: typeLabel ?? typeName(el.elementType),
                label: label.isEmpty ? nil : label,
                identifier: identifier.isEmpty ? nil : identifier,
                value: value.isEmpty ? nil : value,
                placeholder: placeholder.isEmpty ? nil : placeholder,
                frame: ElementFrame(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height),
                enabled: el.isEnabled,
                hittable: el.isHittable,
                selected: el.isSelected,
                index: results.count
            ))
        }
    }

    static func toElementInfo(_ el: XCUIElement, index: Int) -> UIElementInfo {
        let frame = el.frame
        let label = el.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let identifier = el.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = el.value as? String ?? ""
        let placeholder = el.placeholderValue ?? ""
        return UIElementInfo(
            type: typeName(el.elementType),
            label: label.isEmpty ? nil : label,
            identifier: identifier.isEmpty ? nil : identifier,
            value: value.isEmpty ? nil : value,
            placeholder: placeholder.isEmpty ? nil : placeholder,
            frame: ElementFrame(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height),
            enabled: el.isEnabled,
            hittable: el.isHittable,
            selected: el.isSelected,
            index: index
        )
    }
}
