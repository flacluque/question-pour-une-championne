// Détoure la tête d'un animal : sujet détouré (Vision) × ellipse adoucie autour de la tête.
// Usage : swift tools/animalhead.swift <photo> <sortie.png> <cx> <cy> <rx> <ry> [taille, défaut 400]
// cx, cy, rx, ry : centre et rayons de l'ellipse en pixels, origine en haut à gauche.
// Le bas de l'ellipse est adouci (le cou se fond) ; le reste suit le contour du pelage.
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import Vision

let a = CommandLine.arguments
guard a.count >= 7 else { print("usage: animalhead <in> <out> cx cy rx ry [size]"); exit(1) }
let inURL = URL(fileURLWithPath: a[1]), outURL = URL(fileURLWithPath: a[2])
let cx = CGFloat(Double(a[3])!), cyTop = CGFloat(Double(a[4])!), rx = CGFloat(Double(a[5])!), ry = CGFloat(Double(a[6])!)
let size = CGFloat(a.count > 7 ? Double(a[7])! : 400)

guard let src = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true]) else { print("lecture impossible"); exit(1) }
let H = src.extent.height
let cy = H - cyTop // repère Core Image : origine en bas à gauche

// 1. Masque du sujet
let handler = VNImageRequestHandler(ciImage: src)
let req = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([req])
guard let obs = req.results?.first else { print("aucun sujet trouvé"); exit(1) }
let maskBuf = try obs.generateScaledMaskForImage(forInstances: obs.allInstances, from: handler)
var subject = CIImage(cvPixelBuffer: maskBuf)
subject = subject.transformed(by: CGAffineTransform(scaleX: src.extent.width / subject.extent.width, y: H / subject.extent.height))

// 2. Ellipse adoucie (dégradé radial étiré verticalement)
let grad = CIFilter.radialGradient()
grad.center = .zero
grad.radius0 = Float(rx * 0.86); grad.radius1 = Float(rx)
grad.color0 = CIColor(red: 1, green: 1, blue: 1); grad.color1 = CIColor(red: 0, green: 0, blue: 0)
let ellipse = grad.outputImage!
  .transformed(by: CGAffineTransform(scaleX: 1, y: ry / rx))
  .transformed(by: CGAffineTransform(translationX: cx, y: cy))
  .cropped(to: src.extent)

// 3. Masque final = sujet × ellipse
let mul = CIFilter.multiplyCompositing()
mul.inputImage = subject; mul.backgroundImage = ellipse
let mask = mul.outputImage!.cropped(to: src.extent)

let blend = CIFilter.blendWithMask()
blend.inputImage = src
blend.backgroundImage = CIImage(color: .clear).cropped(to: src.extent)
blend.maskImage = mask
var out = blend.outputImage!

// 4. Recadrage carré centré sur la tête, puis mise à l'échelle
let side = max(rx, ry) * 2
let box = CGRect(x: cx - side / 2, y: cy - side / 2, width: side, height: side)
out = out.cropped(to: box).transformed(by: CGAffineTransform(translationX: -box.minX, y: -box.minY))
let s = size / side
out = out.transformed(by: CGAffineTransform(scaleX: s, y: s))
let final = out.cropped(to: CGRect(x: 0, y: 0, width: size, height: size))

let ctx = CIContext()
try ctx.writePNGRepresentation(of: final, to: outURL, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
print("ok", outURL.lastPathComponent)
