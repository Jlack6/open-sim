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
        .icon: "icon",
    ]

    /// Types that a person would actually tap/interact with. Used to decide which
    /// elements get a precise live `isHittable` check after the snapshot walk.
    private static let interactiveTypes: Set<XCUIElement.ElementType> = [
        .button, .cell, .switch, .textField, .secureTextField,
        .link, .searchField, .slider, .picker, .textView,
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

    // Springboard identifiers that are noise rather than tappable icons.
    private static let springboardNoise: Set<String> = [
        "label-view", "spotlight-pill", "Page control", "magnifyingglass",
    ]

    /// Fast accessibility snapshot.
    ///
    /// Reading properties off a *live* `XCUIElement` costs one cross-process call each, so the
    /// old approach (≈16 typed queries × ≈10 property reads per element) made hundreds of
    /// round-trips and took 4–7s. Instead we take ONE `app.snapshot()` — the entire tree in a
    /// single call — and read label/identifier/value/frame/type from memory. The only property a
    /// snapshot can't provide is `isHittable` (it needs live hit-testing), so we refine that with
    /// a bounded number of live checks on just the interactive elements that matter.
    static func describe(app: XCUIApplication, bundleId: String?, limit: Int = 100) -> [UIElementInfo] {
        let isSpringboard = bundleId == "com.apple.springboard"

        guard let snapshot = try? app.snapshot() else {
            // Snapshot unavailable (rare) — fall back to the slower but proven live walk.
            return describeLive(app: app, bundleId: bundleId, limit: limit)
        }

        let screen = app.frame
        var results: [UIElementInfo] = []
        var seen = Set<String>()
        walk(snapshot, screen: screen, isSpringboard: isSpringboard, into: &results, seen: &seen, limit: limit)

        var sorted = results.sorted {
            if abs($0.frame.y - $1.frame.y) > 8 { return $0.frame.y < $1.frame.y }
            return $0.frame.x < $1.frame.x
        }
        for i in sorted.indices { sorted[i].index = i }

        refineHittable(&sorted, in: app)
        return sorted
    }

    /// Walk the in-memory snapshot tree. No cross-process calls happen here.
    private static func walk(
        _ node: XCUIElementSnapshot,
        screen: CGRect,
        isSpringboard: Bool,
        into results: inout [UIElementInfo],
        seen: inout Set<String>,
        limit: Int
    ) {
        if results.count >= limit { return }

        let frame = node.frame
        let label = node.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let identifier = node.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = node.value as? String ?? ""
        let placeholder = node.placeholderValue ?? ""

        let bigEnough = frame.width > 2 && frame.height > 2
        let hasMetadata = !label.isEmpty || !identifier.isEmpty || !value.isEmpty || !placeholder.isEmpty
        let isInteractive = interactiveTypes.contains(node.elementType)

        // On the home screen, app icons are identified by their identifier (e.g. "Safari").
        let isSpringboardIcon = isSpringboard && !identifier.isEmpty && !springboardNoise.contains(identifier)

        if bigEnough, hasMetadata || isInteractive || isSpringboardIcon {
            let key = "\(identifier)|\(label)|\(Int(frame.origin.x))|\(Int(frame.origin.y))|\(Int(frame.width))|\(Int(frame.height))"
            if !seen.contains(key) {
                seen.insert(key)
                let onScreen = frame.intersects(screen)
                results.append(UIElementInfo(
                    type: isSpringboardIcon ? "icon" : typeName(node.elementType),
                    label: label.isEmpty ? nil : label,
                    identifier: identifier.isEmpty ? nil : identifier,
                    value: value.isEmpty ? nil : value,
                    placeholder: placeholder.isEmpty ? nil : placeholder,
                    frame: ElementFrame(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height),
                    enabled: node.isEnabled,
                    // Provisional: refined with a live check for interactive elements below.
                    hittable: node.isEnabled && onScreen,
                    selected: node.isSelected,
                    index: results.count
                ))
            }
        }

        for child in node.children {
            if results.count >= limit { return }
            walk(child, screen: screen, isSpringboard: isSpringboard, into: &results, seen: &seen, limit: limit)
        }
    }

    /// Replace the provisional `hittable` flag with a precise live value for the interactive
    /// elements a model is likely to tap. Bounded so a busy screen can't reintroduce the old cost.
    private static func refineHittable(_ elements: inout [UIElementInfo], in app: XCUIApplication, cap: Int = 40) {
        var refined = 0
        for i in elements.indices {
            if refined >= cap { break }
            guard let elType = elementType(from: elements[i].type), interactiveTypes.contains(elType) else { continue }

            var live: XCUIElement?
            if let id = elements[i].identifier, !id.isEmpty {
                let el = app.descendants(matching: elType).matching(identifier: id).firstMatch
                if el.exists { live = el }
            }
            if live == nil, let label = elements[i].label, !label.isEmpty {
                let el = app.descendants(matching: elType).matching(NSPredicate(format: "label == %@", label)).firstMatch
                if el.exists { live = el }
            }
            guard let el = live else { continue } // keep heuristic when we can't resolve uniquely
            elements[i].hittable = el.isHittable
            refined += 1
        }
    }

    /// Legacy live walk — slower, used only if `app.snapshot()` is unavailable.
    private static func describeLive(app: XCUIApplication, bundleId: String?, limit: Int) -> [UIElementInfo] {
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
