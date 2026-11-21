// swift-tools-version: 5.8

import PackageDescription
import AppleProductTypes

let package = Package(
    name: "AlphaPad",
    platforms: [
        .iOS("16.0")
    ],
    products: [
        .iOSApplication(
            name: "AlphaPad",
            targets: ["AppModule"],
            bundleIdentifier: "com.alphapad.controller",
            teamIdentifier: "",
            displayVersion: "1.0",
            bundleVersion: "1",
            appIcon: .placeholder(icon: .palette),
            accentColor: .presetColor(.orange),
            supportedDeviceFamilies: [
                .pad,
                .phone
            ],
            supportedInterfaceOrientations: [
                .portrait,
                .landscapeRight,
                .landscapeLeft,
                .portraitUpsideDown(.when(deviceFamilies: [.pad]))
            ]
        )
    ],
    targets: [
        .executableTarget(
            name: "AppModule",
            path: ".",
            resources: [
                .copy("Web")
            ]
        )
    ]
)
