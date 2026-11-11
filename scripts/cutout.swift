// Background removal and face detection via Apple's Vision framework — the same
// foreground-instance mask that powers Preview's "Remove Background". Offline,
// no API key, macOS 14+.
//
//   swift scripts/cutout.swift <input-image> <output.png>   cut out, report faces
//   swift scripts/cutout.swift --detect <input-image>       report faces only
//
// Prints one line of JSON. Face rectangles are in top-left-origin pixels of the
// input image, so the caller can frame the artist inside the logo window.

import AppKit
import CoreImage
import Foundation
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("cutout: \(message)\n".utf8))
  exit(1)
}

struct Rect: Encodable {
  let x: Int, y: Int, width: Int, height: Int
  let confidence: Float
}

struct Report: Encodable {
  let width: Int
  let height: Int
  let instances: Int
  let faces: [Rect]
}

let args = CommandLine.arguments
let detectOnly = args.count == 3 && args[1] == "--detect"
guard detectOnly || args.count == 3 else {
  fail("usage: cutout.swift <input> <output.png>  |  cutout.swift --detect <input>")
}
let inputURL = URL(fileURLWithPath: detectOnly ? args[2] : args[1])
guard FileManager.default.fileExists(atPath: inputURL.path) else {
  fail("no such file: \(inputURL.path)")
}

let handler = VNImageRequestHandler(url: inputURL, options: [:])

// --- face rectangles -------------------------------------------------------

func detectFaces(pixelWidth: Int, pixelHeight: Int) -> [Rect] {
  let request = VNDetectFaceRectanglesRequest()
  do {
    try handler.perform([request])
  } catch {
    return []
  }
  return (request.results ?? []).map { face in
    let b = face.boundingBox // normalised, bottom-left origin
    return Rect(
      x: Int((b.minX * CGFloat(pixelWidth)).rounded()),
      // flip to a top-left origin so the caller doesn't have to
      y: Int(((1 - b.maxY) * CGFloat(pixelHeight)).rounded()),
      width: Int((b.width * CGFloat(pixelWidth)).rounded()),
      height: Int((b.height * CGFloat(pixelHeight)).rounded()),
      confidence: face.confidence
    )
  }
}

func emit(_ report: Report) -> Never {
  let data = try! JSONEncoder().encode(report)
  print(String(data: data, encoding: .utf8)!)
  exit(0)
}

if detectOnly {
  guard let image = NSImage(contentsOf: inputURL),
    let rep = image.representations.first
  else { fail("could not read \(inputURL.path)") }
  let w = rep.pixelsWide, h = rep.pixelsHigh
  emit(Report(width: w, height: h, instances: 0, faces: detectFaces(pixelWidth: w, pixelHeight: h)))
}

// --- foreground mask -------------------------------------------------------

let outputURL = URL(fileURLWithPath: args[2])
let maskRequest = VNGenerateForegroundInstanceMaskRequest()

do {
  try handler.perform([maskRequest])
} catch {
  fail("Vision request failed: \(error.localizedDescription)")
}

guard let observation = maskRequest.results?.first, !observation.allInstances.isEmpty else {
  fail("no foreground subject found — supply a hand-cut transparent PNG instead")
}

// Keep every detected instance: duo acts (SAMEFACES) come back as two.
let masked: CVPixelBuffer
do {
  masked = try observation.generateMaskedImage(
    ofInstances: observation.allInstances,
    from: handler,
    croppedToInstancesExtent: false
  )
} catch {
  fail("mask generation failed: \(error.localizedDescription)")
}

let ciImage = CIImage(cvPixelBuffer: masked)
let context = CIContext()
guard let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) else { fail("no sRGB color space") }

do {
  try context.writePNGRepresentation(
    of: ciImage, to: outputURL, format: .RGBA8, colorSpace: colorSpace)
} catch {
  fail("could not write PNG: \(error.localizedDescription)")
}

let w = CVPixelBufferGetWidth(masked), h = CVPixelBufferGetHeight(masked)
emit(
  Report(
    width: w, height: h, instances: observation.allInstances.count,
    faces: detectFaces(pixelWidth: w, pixelHeight: h)))
