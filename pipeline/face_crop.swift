import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count >= 3 else {
    fputs("Usage: face_crop <input_image> <output_png> [size]\n", stderr)
    exit(1)
}

let inPath = CommandLine.arguments[1]
let outPath = CommandLine.arguments[2]
let targetSize = CommandLine.arguments.count >= 4 ? Double(CommandLine.arguments[3]) ?? 160.0 : 160.0

guard let nsImage = NSImage(contentsOfFile: inPath),
      let tiffData = nsImage.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiffData),
      let cgImage = bitmap.cgImage else {
    exit(2)
}

let width = Double(cgImage.width)
let height = Double(cgImage.height)

let request = VNDetectFaceRectanglesRequest()
let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
try? handler.perform([request])

var cropRect: CGRect
if let results = request.results, !results.isEmpty {
    // Pick the highest/largest face (in Vision normalized coords, origin is bottom-left)
    let bestFace = results.max(by: { ($0.boundingBox.width * $0.boundingBox.height) < ($1.boundingBox.width * $1.boundingBox.height) })!
    let fb = bestFace.boundingBox
    let faceW = fb.width * width
    let faceH = fb.height * height
    let cx = (fb.origin.x + fb.width / 2.0) * width
    // Convert bottom-left Y to top-left Y for CGImage cropping
    let cyTop = (1.0 - (fb.origin.y + fb.height / 2.0)) * height

    let side = min(min(width, height), max(faceW, faceH) * 2.4)
    let x0 = max(0.0, min(width - side, cx - side / 2.0))
    let y0 = max(0.0, min(height - side, cyTop - side * 0.45))
    cropRect = CGRect(x: x0, y: y0, width: side, height: side)
} else {
    // Fallback: top-center square crop (where head/cap sits in vertical portraits)
    let side = min(width, height)
    let x0 = (width - side) / 2.0
    let y0 = 0.0
    cropRect = CGRect(x: x0, y: y0, width: side, height: side)
}

guard let croppedCG = cgImage.cropping(to: cropRect) else {
    exit(3)
}

let outSize = NSSize(width: targetSize, height: targetSize)
let outImage = NSImage(size: outSize)
outImage.lockFocus()
NSGraphicsContext.current?.imageInterpolation = .high
let rep = NSBitmapImageRep(cgImage: croppedCG)
rep.draw(in: NSRect(origin: .zero, size: outSize))
outImage.unlockFocus()

guard let outTiff = outImage.tiffRepresentation,
      let outRep = NSBitmapImageRep(data: outTiff),
      let pngData = outRep.representation(using: .png, properties: [:]) else {
    exit(4)
}

try pngData.write(to: URL(fileURLWithPath: outPath))
print(request.results?.isEmpty == false ? "FACE_DETECTED" : "TOP_CROP")
