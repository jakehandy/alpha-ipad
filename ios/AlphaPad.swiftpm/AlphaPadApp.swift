import SwiftUI

@main
struct AlphaPadApp: App {
    var body: some Scene {
        WindowGroup {
            WebContainer()
                .ignoresSafeArea()
                .preferredColorScheme(.dark)
                .background(Color(red: 0.06, green: 0.06, blue: 0.07))
        }
    }
}
