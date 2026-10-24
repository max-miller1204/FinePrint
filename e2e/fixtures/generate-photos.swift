// Renders the fixture photos for the DEBUG fixture camera (#22). Run from the repository root:
//
//   swift e2e/fixtures/generate-photos.swift
//
// Every image is drawn here from a fixed seed, so the photos are our own content and re-running
// the script reproduces the same pixels (JPEG bytes can differ across macOS versions).
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct Generator: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }
}

struct Scene {
    let name: String
    let seed: UInt64
    let wall: (r: Double, g: Double, b: Double)
    /// Where the scuff sits as a fraction of the frame, move-out only.
    let scuff: CGPoint
    let feature: (CGContext, Int, Int) -> Void
}

let width = 1200
let height = 900

let scenes: [Scene] = [
    Scene(name: "01-kitchen-wall", seed: 11, wall: (0.86, 0.80, 0.68), scuff: CGPoint(x: 0.62, y: 0.45)) { context, w, h in
        // An outlet plate.
        let x = w * 3 / 10
        let y = h * 4 / 10
        context.setFillColor(gray: 0.94, alpha: 1)
        context.fill(CGRect(x: x, y: y, width: 70, height: 110))
        context.setFillColor(gray: 0.35, alpha: 1)
        for (dx, dy) in [(24, 22), (38, 22), (24, 66), (38, 66)] {
            context.fill(CGRect(x: x + dx, y: y + dy, width: 8, height: 24))
        }
    },
    Scene(name: "02-bathroom-tile", seed: 23, wall: (0.80, 0.86, 0.88), scuff: CGPoint(x: 0.35, y: 0.55)) { context, w, h in
        // A tile grid.
        context.setStrokeColor(gray: 0.55, alpha: 1)
        context.setLineWidth(3)
        for x in stride(from: 0, through: w, by: 150) {
            context.move(to: CGPoint(x: x, y: 0))
            context.addLine(to: CGPoint(x: x, y: h))
        }
        for y in stride(from: 0, through: h, by: 150) {
            context.move(to: CGPoint(x: 0, y: y))
            context.addLine(to: CGPoint(x: w, y: y))
        }
        context.strokePath()
    },
    Scene(name: "03-bedroom-door", seed: 37, wall: (0.90, 0.88, 0.84), scuff: CGPoint(x: 0.5, y: 0.25)) { context, w, h in
        // A door with a knob.
        context.setFillColor(CGColor(red: 0.45, green: 0.32, blue: 0.22, alpha: 1))
        context.fill(CGRect(x: w * 3 / 10, y: 0, width: w * 4 / 10, height: h * 8 / 10))
        context.setFillColor(CGColor(red: 0.82, green: 0.68, blue: 0.30, alpha: 1))
        context.fillEllipse(in: CGRect(x: w * 6 / 10, y: h * 4 / 10, width: 36, height: 36))
    },
]

func render(_ scene: Scene, scuffed: Bool) -> CGImage {
    let context = CGContext(
        data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    )!
    // Move-out is the same view framed a few pixels differently, like a hand-held shot.
    let shift: CGFloat = scuffed ? 7 : 0
    context.translateBy(x: shift, y: -shift)

    context.setFillColor(red: scene.wall.r, green: scene.wall.g, blue: scene.wall.b, alpha: 1)
    context.fill(CGRect(x: -20, y: -20, width: width + 40, height: height + 40))
    scene.feature(context, width, height)

    // Baseboard.
    context.setFillColor(gray: 0.97, alpha: 1)
    context.fill(CGRect(x: -20, y: -20, width: width + 40, height: 90))

    // Plaster texture: seeded speckle gives the photo real detail, so it passes the sharpness gate.
    var random = Generator(state: scene.seed)
    for _ in 0..<9000 {
        let x = CGFloat.random(in: 0..<CGFloat(width), using: &random)
        let y = CGFloat.random(in: 0..<CGFloat(height), using: &random)
        let size = CGFloat.random(in: 2...5, using: &random)
        let tone = CGFloat.random(in: 0.2...0.8, using: &random)
        context.setFillColor(gray: tone, alpha: 0.12)
        context.fillEllipse(in: CGRect(x: x, y: y, width: size, height: size))
    }

    if scuffed {
        // A dark diagonal scuff with a soft halo: the damage the ghost overlay should reveal.
        let center = CGPoint(x: scene.scuff.x * CGFloat(width), y: scene.scuff.y * CGFloat(height))
        context.setLineCap(.round)
        for (lineWidth, alpha) in [(34.0, 0.10), (20.0, 0.18), (8.0, 0.55)] {
            context.setStrokeColor(gray: 0.12, alpha: alpha)
            context.setLineWidth(lineWidth)
            context.move(to: CGPoint(x: center.x - 70, y: center.y - 40))
            context.addLine(to: CGPoint(x: center.x + 70, y: center.y + 40))
            context.strokePath()
        }
    }
    return context.makeImage()!
}

func write(_ image: CGImage, to url: URL) {
    let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: 0.8] as CFDictionary)
    precondition(CGImageDestinationFinalize(destination), "could not write \(url.path)")
}

let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? "e2e/fixtures/photos", isDirectory: true)
for (folder, scuffed) in [("move-in", false), ("move-out", true)] {
    let directory = root.appending(path: folder, directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    for scene in scenes {
        write(render(scene, scuffed: scuffed), to: directory.appending(path: "\(scene.name).jpg"))
    }
}
print("wrote \(scenes.count * 2) photos under \(root.path)")
