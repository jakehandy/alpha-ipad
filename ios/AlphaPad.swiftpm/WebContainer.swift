import SwiftUI
import WebKit
import UIKit

/// Hosts the AlphaPad web UI and bridges it to CoreMIDI and on-device storage.
/// JS -> native: webkit.messageHandlers.alphapad.postMessage({type: ...})
/// native -> JS: AlphaNative.ports({...}) and AlphaNative.midi(sourceId, [bytes])
struct WebContainer: UIViewRepresentable {
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let coordinator = context.coordinator
        let controller = WKUserContentController()
        controller.add(WeakHandler(coordinator), name: "alphapad")

        let stored = Storage.load() ?? ""
        let storedLiteral = Storage.jsStringLiteral(stored)
        let boot = "window.__alphaNative = true; window.__alphaStore = \(stored.isEmpty ? "null" : storedLiteral);"
        controller.addUserScript(WKUserScript(source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.07, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        coordinator.webView = webView

        if let index = Self.indexURL() {
            webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
        } else {
            webView.loadHTMLString("<body style='background:#111;color:#eee;font:16px -apple-system;padding:40px'>Web folder missing from the app bundle. Run scripts/sync-ios.sh and rebuild.</body>", baseURL: nil)
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    static func indexURL() -> URL? {
        #if SWIFT_PACKAGE
        if let url = Bundle.module.url(forResource: "index", withExtension: "html", subdirectory: "Web") { return url }
        #endif
        // Fallback: look in the main bundle and any resource bundles inside it.
        var bundles = [Bundle.main] + Bundle.allBundles
        if let dir = Bundle.main.resourceURL,
           let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) {
            bundles += items.filter { $0.pathExtension == "bundle" }.compactMap { Bundle(url: $0) }
        }
        for bundle in bundles {
            if let url = bundle.url(forResource: "index", withExtension: "html", subdirectory: "Web") { return url }
        }
        return nil
    }

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?
        let midi = MIDIBridge()

        override init() {
            super.init()
            midi.onPortsChanged = { [weak self] in self?.publishPorts() }
            midi.onMessage = { [weak self] source, bytes in
                let list = bytes.map(String.init).joined(separator: ",")
                self?.eval("window.AlphaNative && AlphaNative.midi('\(source)', [\(list)])")
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            switch type {
            case "midiList":
                publishPorts()
            case "midiSend":
                guard let dest = body["dest"] as? String, let data = body["data"] as? [NSNumber] else { return }
                midi.send(data.map { UInt8(truncating: $0) }, to: dest)
            case "store":
                if let json = body["json"] as? String { Storage.save(json) }
            case "export":
                guard let name = body["filename"] as? String, let b64 = body["base64"] as? String,
                      let data = Data(base64Encoded: b64) else { return }
                share(data, filename: name)
            default:
                break
            }
        }

        private func publishPorts() {
            let ports: [String: Any] = [
                "inputs": midi.sources().map { ["id": $0.id, "name": $0.name] },
                "outputs": midi.destinations().map { ["id": $0.id, "name": $0.name] }
            ]
            guard let json = try? JSONSerialization.data(withJSONObject: ports),
                  let text = String(data: json, encoding: .utf8) else { return }
            eval("window.AlphaNative && AlphaNative.ports(\(text))")
        }

        private func eval(_ js: String) {
            DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(js, completionHandler: nil) }
        }

        private func share(_ data: Data, filename: String) {
            let safe = filename.replacingOccurrences(of: "/", with: "_")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
            do { try data.write(to: url) } catch { return }
            DispatchQueue.main.async { [weak self] in
                guard let view = self?.webView, let root = view.window?.rootViewController else { return }
                var top = root
                while let presented = top.presentedViewController { top = presented }
                let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
                if let pop = sheet.popoverPresentationController {
                    pop.sourceView = view
                    pop.sourceRect = CGRect(x: view.bounds.midX, y: 60, width: 1, height: 1)
                }
                top.present(sheet, animated: true)
            }
        }
    }
}

/// Avoids the retain cycle WKUserContentController creates with its handlers.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(c, didReceive: message)
    }
}

enum Storage {
    static var fileURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("alphapad-library.json")
    }
    static func load() -> String? { try? String(contentsOf: fileURL, encoding: .utf8) }
    static func save(_ json: String) { try? json.write(to: fileURL, atomically: true, encoding: .utf8) }
    /// Encode a Swift string as a JavaScript string literal.
    static func jsStringLiteral(_ s: String) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: [s]),
              let arr = String(data: data, encoding: .utf8) else { return "null" }
        // arr is ["..."]; strip the brackets and escape the two JS-only line terminators.
        return String(arr.dropFirst().dropLast())
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
