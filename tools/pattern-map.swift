// Carte du motif de fond : retrouve où chaque bonhomme est dessiné dans le motif (même tirage que pattern.swift),
// et exporte chaque bonhomme en petit PNG. Le site s'en sert pour faire « prendre vie » un bonhomme du fond.
// Usage : swift tools/pattern-map.swift <dossier stickers png> <dossier sortie> [taille max des PNG, défaut 220]
// Sortie : <dossier>/NN.png et <dossier>/map.json  ({ cols, rows, items: [{ f, x, y, s, a }] })
//   x, y : centre en fraction du motif ; s : taille (plus grand côté) en fraction d'une case ; a : rotation en degrés (sens CSS)
import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: pattern-map <stickers> <out dir> [max]"); exit(1) }
let inDir = URL(fileURLWithPath: args[1]), outDir = URL(fileURLWithPath: args[2])
let maxSide = CGFloat(args.count > 3 ? Double(args[3])! : 220)
try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let files = try FileManager.default.contentsOfDirectory(at: inDir, includingPropertiesForKeys: nil)
  .filter { $0.pathExtension.lowercased() == "png" }
  .sorted { $0.lastPathComponent.localizedStandardCompare($1.lastPathComponent) == .orderedAscending }
var images: [(CGImage, Int)] = files.enumerated().compactMap { i, url in
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return nil }
  return (img, i + 1)
}

// Même générateur et même ordre de tirage que pattern.swift
var seed: UInt64 = 0x51ED_C0DE
func rnd() -> CGFloat { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return CGFloat(seed >> 33) / CGFloat(1 << 31) }
for i in stride(from: images.count - 1, to: 0, by: -1) { images.swapAt(i, Int(rnd() * CGFloat(i + 1)) % (i + 1)) }

let n = images.count
let cols = max(3, Int(ceil(sqrt(Double(n) * 1.2))))
var rows = Int(ceil(Double(n) / Double(cols)))
if rows % 2 == 1 { rows += 1 }
let total = cols * rows

var items: [[String: Any]] = []
for k in 0..<total {
  let (_, id) = images[k % n]
  let r = k / cols, c = k % cols
  // en unités de « case » (cell = 1)
  let cx = (CGFloat(c) + 0.5 + (r % 2 == 1 ? 0.5 : 0)) + (rnd() - 0.5) * 0.18
  let cy = (CGFloat(r) + 0.5) + (rnd() - 0.5) * 0.18
  let target = 0.70 + rnd() * 0.12
  let angle = (rnd() - 0.5) * 0.5
  items.append([
    "f": String(format: "%02d", id),
    "x": Double(cx / CGFloat(cols)), "y": Double(cy / CGFloat(rows)),
    "s": Double(target), "a": Double(-angle * 180 / .pi), // CG tourne dans l'autre sens que CSS
  ])
}

// PNG réduits, nommés par leur numéro (ordre alphabétique des fichiers d'origine)
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
for (img, id) in images {
  let s = min(1, maxSide / max(CGFloat(img.width), CGFloat(img.height)))
  let w = Int((CGFloat(img.width) * s).rounded()), h = Int((CGFloat(img.height) * s).rounded())
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.interpolationQuality = .high
  ctx.draw(img, in: CGRect(x: 0, y: 0, width: w, height: h))
  let url = outDir.appendingPathComponent(String(format: "%02d.png", id))
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  CGImageDestinationFinalize(dest)
}

let json = try JSONSerialization.data(withJSONObject: ["cols": cols, "rows": rows, "items": items], options: [])
try json.write(to: outDir.appendingPathComponent("map.json"))
print("ok", n, "bonhommes,", items.count, "places,", cols, "x", rows)
