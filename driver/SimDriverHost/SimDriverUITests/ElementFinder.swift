import XCTest

enum ElementFinder {
    /// Find elements matching a fluid query — uses targeted XCTest queries, not blind tree walks.
    static func findAll(query: ElementQuery, in app: XCUIApplication, bundleId: String?) -> [XCUIElement] {
        var matches: [XCUIElement] = []

        if let id = query.identifier, !id.isEmpty {
            let el = app.descendants(matching: .any).matching(identifier: id).firstMatch
            if el.exists { matches.append(el) }
        }

        if matches.isEmpty, let label = query.label, !label.isEmpty {
            let el = app.descendants(matching: .any)
                .matching(NSPredicate(format: "label == %@", label)).firstMatch
            if el.exists { matches.append(el) }
        }

        if matches.isEmpty, let contains = query.labelContains, !contains.isEmpty {
            let predicate = NSPredicate(format: "label CONTAINS[c] %@", contains)
            let all = app.descendants(matching: .any).matching(predicate)
            let count = min(all.count, 30)
            for i in 0..<count {
                let el = all.element(boundBy: i)
                if el.exists, el.frame.width > 1, el.frame.height > 1 {
                    matches.append(el)
                }
            }
        }

        if matches.isEmpty, let valueContains = query.valueContains, !valueContains.isEmpty {
            let predicate = NSPredicate(format: "value CONTAINS[c] %@", valueContains)
            let all = app.descendants(matching: .any).matching(predicate)
            let count = min(all.count, 20)
            for i in 0..<count {
                let el = all.element(boundBy: i)
                if el.exists { matches.append(el) }
            }
        }

        if matches.isEmpty, let typeStr = query.type, let elType = AccessibilityWalker.elementType(from: typeStr) {
            let all = app.descendants(matching: elType)
            let count = min(all.count, 40)
            for i in 0..<count {
                let el = all.element(boundBy: i)
                if el.exists, matchesQuery(el, query: query, skipLabelChecks: true) {
                    matches.append(el)
                }
            }
        }

        return sortMatches(matches)
    }

    static func find(query: ElementQuery, in app: XCUIApplication, bundleId: String?) -> XCUIElement? {
        let matches = findAll(query: query, in: app, bundleId: bundleId)
        let idx = query.index ?? 0
        guard idx < matches.count else { return nil }
        return matches[idx]
    }

    private static func matchesQuery(_ el: XCUIElement, query: ElementQuery, skipLabelChecks: Bool = false) -> Bool {
        if !skipLabelChecks {
            if let label = query.label, el.label != label { return false }
            if let contains = query.labelContains,
               !el.label.localizedCaseInsensitiveContains(contains) { return false }
            if let id = query.identifier, el.identifier != id { return false }
        }
        if let typeStr = query.type, let elType = AccessibilityWalker.elementType(from: typeStr) {
            guard el.elementType == elType else { return false }
        }
        return true
    }

    private static func sortMatches(_ matches: [XCUIElement]) -> [XCUIElement] {
        matches.sorted {
            if $0.isHittable != $1.isHittable { return $0.isHittable && !$1.isHittable }
            if abs($0.frame.origin.y - $1.frame.origin.y) > 8 {
                return $0.frame.origin.y < $1.frame.origin.y
            }
            return $0.frame.origin.x < $1.frame.origin.x
        }
    }

    static func coordinate(
        x: Double,
        y: Double,
        normalized: Bool,
        in app: XCUIApplication
    ) -> XCUICoordinate {
        let frame = app.frame
        let px = normalized ? x * frame.width : x
        let py = normalized ? y * frame.height : y
        return app.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: px, dy: py))
    }
}
