import SwiftUI
import UIKit
import Shared

/// Hosts the Compose UI. `MainViewController()` is the Kotlin entry point
/// in shared/src/iosMain/kotlin/me/groundwire/chat/MainViewController.kt.
struct ComposeView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> UIViewController {
        MainViewControllerKt.MainViewController()
    }

    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}

struct ContentView: View {
    var body: some View {
        ComposeView()
    }
}
