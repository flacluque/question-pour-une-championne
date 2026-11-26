// Assemble les bonhommes détourés en un motif qui se répète sans raccord visible.
// Usage : swift tools/pattern.swift <dossier stickers png> <sortie.png|.jpg> [taille de case, défaut 250] [fond #rrggbb] [opacité] [échelle]
// Avec un fond, le motif est pré-mélangé à cette couleur (opacité 0-1) : idéal en .jpg, bien plus léger.
// Chaque bonhomme apparaît une fois par motif, sur une grille décalée (en quinconce),
// avec une petite rotation et un léger décalage aléatoires (mais reproductibles).
import Foundation
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: pattern <stickers> <out.png> [cell]"); exit(1) }
let inDir = URL(fileURLWithPath: args[1]), out = URL(fileURLWithPath: args[2])
let cell = CGFloat(args.count > 3 ? Double(args[3])! : 250)
let bgHex = args.count > 4 ? args[4] : nil
let alpha = CGFloat(args.count > 5 ? Double(args[5])! : 1)
let outScale = CGFloat(args.count > 6 ? Double(args[6])! : 1)

let files = try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil)
  .filter { $0.pathExtension.lowercased() == "png" }
  .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
var images: [CGImage] = files.compactMap {
  guard let src = CGImageSourceCreateWithURL($0 as CFURL, nil) else { return nil }
  return CGImageSourceCreateImageAtIndex(src, 0, nil)
}
guard !images.isEmpty else { print("no stickers"); exit(1) }

// Générateur pseudo-aléatoire déterministe
var seed: UInt64 = 0x51ED_C0DE
func rnd() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }

// Mélange pour que deux bonhommes voisins ne se ressemblent pas trop
for i in stride(from: images.count - 1, to: 0, by: -1) { images.swapAt(i, Int(rnd() * CGFloat(i + 1)) % (i + 1)) }

let n = images.count
var cols = max(3, Int(ceil(sqrt(Double(n) * 1.2))))
var rows = Int(ceil(Double(n) / Double(cols)))
if rows % 2 == 1 { rows += 1 } // nombre de rangées pair pour que la quinconce se raccorde
let W = CGFloat(cols) * cell, H = CGFloat(rows) * cell
let total = cols * rows

let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.interpolationQuality = .high

for k in 0..<total {
  let img = images[k % n]
  let r = k / cols, c = k % cols
  let cx = (CGFloat(c) + 0.5 + (r % 2 == 1 ? 0.5 : 0)) * cell + (rnd() - 0.5) * cell * 0.18
  let cy = (CGFloat(r) + 0.5) * cell + (rnd() - 0.5) * cell * 0.18
  let target = cell * (0.70 + rnd() * 0.12)
  let s = target / max(CGFloat(img.width), CGFloat(img.height))
  let w = CGFloat(img.width) * s, h = CGFloat(img.height) * s
  let angle = (rnd() - 0.5) * 0.5 // environ ±14°
  // Dessine aussi les copies décalées d'un motif pour que les bords se raccordent
  for dx in [-W, 0, W] { for dy in [-H, 0, H] {
    let x = cx + dx, y = cy + dy
    if x + w < -cell || x - w > W + cell || y + h < -cell || y - h > H + cell { continue }
    ctx.saveGState()
    ctx.translateBy(x: x, y: H - y) // CG a l'origine en bas
    ctx.rotate(by: angle)
    ctx.draw(img, in: CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
    ctx.restoreGState()
  }}
}

var final = ctx.makeImage()!
let OW = Int(W * outScale), OH = Int(H * outScale)
if bgHex != nil || outScale != 1 {
  let fctx = CGContext(data: nil, width: OW, height: OH, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                       bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  fctx.interpolationQuality = .high
  if let hex = bgHex, let v = UInt32(hex.replacingOccurrences(of: "#", with: ""), radix: 16) {
    fctx.setFillColor(red: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
    fctx.fill(CGRect(x: 0, y: 0, width: OW, height: OH))
  }
  fctx.setAlpha(alpha)
  fctx.draw(final, in: CGRect(x: 0, y: 0, width: OW, height: OH))
  final = fctx.makeImage()!
}
let isJPG = ["jpg", "jpeg"].contains(out.pathExtension.lowercased())
let dest = CGImageDestinationCreateWithURL(out as CFURL, (isJPG ? UTType.jpeg : UTType.png).identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, final, isJPG ? [kCGImageDestinationLossyCompressionQuality: 0.82] as CFDictionary : nil)
CGImageDestinationFinalize(dest)
print("ok", out.lastPathComponent, OW, "x", OH, "·", n, "bonhommes,", cols, "x", rows)
