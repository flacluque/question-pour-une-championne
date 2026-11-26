// Détoure les bonhommes (fond blanc) et les adoucit pour le motif de fond.
// Usage : swift tools/stickers.swift <dossier images> <dossier sortie> [taille max, défaut 260] [saturation, défaut 0.55] [luminosité, défaut 0.06]
// (saturation 1 et luminosité 0 = couleurs d'origine)
// Chaque image produit <nom>.png : sujet détouré, recadré, désaturé et éclairci.
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: stickers <in> <out> [max]"); exit(1) }
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
let maxSide = CGFloat(args.count > 3 ? Double(args[3])! : 260)
let saturation = Float(args.count > 4 ? Double(args[4])! : 0.55)
let brightness = Float(args.count > 5 ? Double(args[5])! : 0.06)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let exts = ["jpg", "jpeg", "png", "webp", "heic"]
let files = try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil)
  .filter { exts.contains($0.pathExtension.lowercased()) }
  .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }

let ctx = CIContext()
let srgb = CGColorSpace(name: CGColorSpace.sRGB)!

for url in files {
  guard let src = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else { print("skip", url.lastPathComponent); continue }
  let handler = VNImageRequestHandler(ciImage: src)
  let req = VNGenerateForegroundInstanceMaskRequest()
  do { try handler.perform([req]) } catch { print("fail", url.lastPathComponent, error); continue }
  guard let obs = req.results?.first else { print("no subject", url.lastPathComponent); continue }
  let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: true)
  var img = CIImage(cvPixelBuffer: buf)

  // Adoucir : moins saturé, un peu plus clair
  let cc = CIFilter.colorControls()
  cc.inputImage = img; cc.saturation = saturation; cc.brightness = brightness; cc.contrast = saturation >= 1 ? 1 : 0.85
  img = cc.outputImage!

  let s = min(1, maxSide / max(img.extent.width, img.extent.height))
  img = img.transformed(by: CGAffineTransform(scaleX: s, y: s))
  img = img.transformed(by: CGAffineTransform(translationX: -img.extent.minX, y: -img.extent.minY))

  let out = outDir.appendingPathComponent(url.deletingPathExtension().lastPathComponent + ".png")
  try ctx.writePNGRepresentation(of: img, to: out, format: .RGBA8, colorSpace: srgb)
  print("ok", out.lastPathComponent, Int(img.extent.width), "x", Int(img.extent.height))
}
