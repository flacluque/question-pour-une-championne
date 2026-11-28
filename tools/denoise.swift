// Isole un son (ex. un miaulement) dans un enregistrement bruité.
// 1. Apprend le « profil » du bruit de fond sur des passages sans le son.
// 2. Soustraction spectrale : chaque fréquence est atténuée selon ce qu'elle contient de bruit.
// 3. Ne garde que la bande utile, puis coupe tout ce qui reste entre les passages forts.
// Usage : swift tools/denoise.swift <entrée.wav> <sortie.wav> <début> <fin> <bruit début-fin,...> [force 2.5] [bande 350-7500]
// Exemple : swift tools/denoise.swift full.wav miaou.wav 6.60 7.28 "6.30-6.58,7.30-7.60"
import Foundation
import AVFoundation
import Accelerate

let a = CommandLine.arguments
guard a.count >= 6 else { print("usage: denoise <in> <out> <t0> <t1> <noise ranges> [strength] [band]"); exit(1) }
let t0 = Double(a[3])!, t1 = Double(a[4])!
let noiseRanges = a[5].split(separator: ",").map { r -> (Double, Double) in
  let p = r.split(separator: "-").map { Double($0)! }; return (p[0], p[1])
}
let strength = Float(a.count > 6 ? Double(a[6])! : 2.5)
let band = (a.count > 7 ? a[7] : "350-7500").split(separator: "-").map { Float($0)! }

// ---------- lecture ----------
let file = try AVAudioFile(forReading: URL(fileURLWithPath: a[1]))
let sr = file.processingFormat.sampleRate
let total = AVAudioFrameCount(file.length)
let buf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: total)!
try file.read(into: buf)
let x = Array(UnsafeBufferPointer(start: buf.floatChannelData![0], count: Int(buf.frameLength)))

// ---------- STFT ----------
let N = 2048, hop = 256, log2n = vDSP_Length(11)
let setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
var window = [Float](repeating: 0, count: N)
vDSP_hann_window(&window, vDSP_Length(N), Int32(vDSP_HANN_NORM))
let bins = N / 2

func spectrum(_ start: Int) -> ([Float], [Float]) {
  var frame = [Float](repeating: 0, count: N)
  for i in 0..<N { let j = start + i; frame[i] = (j >= 0 && j < x.count ? x[j] : 0) * window[i] }
  var re = [Float](repeating: 0, count: bins), im = [Float](repeating: 0, count: bins)
  re.withUnsafeMutableBufferPointer { rp in im.withUnsafeMutableBufferPointer { ip in
    var sc = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
    frame.withUnsafeBufferPointer { fp in
      fp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: bins) { vDSP_ctoz($0, 2, &sc, 1, vDSP_Length(bins)) }
    }
    vDSP_fft_zrip(setup, &sc, 1, log2n, FFTDirection(FFT_FORWARD))
  } }
  return (re, im)
}
func mags(_ re: [Float], _ im: [Float]) -> [Float] { (0..<bins).map { sqrt(re[$0] * re[$0] + im[$0] * im[$0]) } }

// ---------- profil du bruit ----------
var noise = [Float](repeating: 0, count: bins); var count: Float = 0
for (n0, n1) in noiseRanges {
  var s = Int(n0 * sr)
  while s + N < Int(n1 * sr) {
    let (re, im) = spectrum(s); let m = mags(re, im)
    for k in 0..<bins { noise[k] += m[k] }
    count += 1; s += hop
  }
}
noise = noise.map { $0 / max(count, 1) }
// Un peu de lissage en fréquence pour un profil stable
noise = (0..<bins).map { k in let lo = max(0, k - 2), hi = min(bins - 1, k + 2); return noise[lo...hi].reduce(0, +) / Float(hi - lo + 1) }

// ---------- hauteur de la note (pour ne garder que ses harmoniques) ----------
// Autocorrélation normalisée entre 300 et 1300 Hz ; on prend le premier pic proche du meilleur (évite l'octave du dessous)
let minLag = Int(sr / 1300), maxLag = Int(sr / 300)
func pitch(_ st: Int) -> (Float, Float) {
  let L = 1536
  var seg = [Float](repeating: 0, count: L + maxLag + 2)
  for i in 0..<seg.count { let j = st + (N - L) / 2 + i; seg[i] = (j >= 0 && j < x.count) ? x[j] : 0 }
  var e0: Float = 0
  vDSP_svesq(seg, 1, &e0, vDSP_Length(L))
  if e0 < 1e-10 { return (0, 0) }
  var rs = [Float](repeating: 0, count: maxLag + 2)
  seg.withUnsafeBufferPointer { p in
    for lag in minLag...maxLag {
      var c: Float = 0, e1: Float = 0
      vDSP_dotpr(p.baseAddress!, 1, p.baseAddress! + lag, 1, &c, vDSP_Length(L))
      vDSP_svesq(p.baseAddress! + lag, 1, &e1, vDSP_Length(L))
      rs[lag] = c / sqrt(e0 * e1 + 1e-12)
    }
  }
  let best = rs.max() ?? 0
  for lag in (minLag + 1)..<maxLag where rs[lag] >= best * 0.88 && rs[lag] >= rs[lag - 1] && rs[lag] >= rs[lag + 1] {
    return (Float(sr) / Float(lag), rs[lag])
  }
  return (0, best)
}

// ---------- débruitage ----------
let start = Int(t0 * sr) - N, end = Int(t1 * sr) + N
var out = [Float](repeating: 0, count: end - start + N)
var norm = [Float](repeating: 0, count: end - start + N)
var prevGain = [Float](repeating: 0, count: bins)
let binHz = Float(sr) / Float(N)
var frameEnergy: [Float] = []
var s = start
while s < end {
  var (re, im) = spectrum(s)
  let m = mags(re, im)
  var gain = [Float](repeating: 0, count: bins)
  for k in 0..<bins {
    let f = Float(k) * binHz
    if f < band[0] || f > band[1] { gain[k] = 0; continue }
    let g = max(0, 1 - strength * noise[k] / max(m[k], 1e-9))
    // lissage dans le temps (évite le « gazouillis » du débruitage)
    gain[k] = g > prevGain[k] ? g : 0.6 * prevGain[k] + 0.4 * g
  }
  // lissage léger en fréquence
  let sm = (0..<bins).map { k -> Float in let lo = max(0, k - 1), hi = min(bins - 1, k + 1); return gain[lo...hi].reduce(0, +) / Float(hi - lo + 1) }
  prevGain = gain
  // Masque harmonique : on ne garde que la note du chat et ses harmoniques, le bruit entre elles disparaît
  let (f0, voicing) = pitch(s)
  var sm2 = sm
  for k in 0..<bins {
    let f = Float(k) * binHz
    var mask: Float = 0.08
    if voicing > 0.45 && f0 > 0 {
      let h = max(1, (f / f0).rounded())
      let d = abs(f - h * f0), w = max(2.2 * binHz, 0.07 * f0)
      mask = f < f0 * 0.75 ? 0 : max(0.04, exp(-2 * (d / w) * (d / w)))
    }
    sm2[k] = sm[k] * mask
  }
  let smf = sm2
  var e: Float = 0
  for k in 0..<bins { re[k] *= smf[k]; im[k] *= smf[k]; e += (m[k] * smf[k]) * (m[k] * smf[k]) }
  frameEnergy.append(e)
  // retour au temps
  var frame = [Float](repeating: 0, count: N)
  re.withUnsafeMutableBufferPointer { rp in im.withUnsafeMutableBufferPointer { ip in
    var sc = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
    vDSP_fft_zrip(setup, &sc, 1, log2n, FFTDirection(FFT_INVERSE))
    frame.withUnsafeMutableBufferPointer { fp in
      fp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: bins) { vDSP_ztoc(&sc, 1, $0, 2, vDSP_Length(bins)) }
    }
  } }
  for i in 0..<N { let j = s - start + i; out[j] += frame[i] * window[i]; norm[j] += window[i] * window[i] }
  s += hop
}
for i in 0..<out.count where norm[i] > 1e-6 { out[i] /= norm[i] }

// ---------- porte : on coupe tout ce qui est loin du miaulement ----------
let peakE = frameEnergy.max() ?? 1
var env = [Float](repeating: 0, count: out.count)
for (fi, e) in frameEnergy.enumerated() {
  let open: Float = e > peakE * 0.004 ? 1 : 0 // ≈ −24 dB sous le plus fort
  for i in 0..<hop { let j = fi * hop + N / 2 + i; if j < env.count { env[j] = open } }
}
// adoucir la porte (attaque 10 ms, relâche 60 ms)
var g: Float = 0
let att = Float(1 / (0.010 * sr)), rel = Float(1 / (0.060 * sr))
for i in 0..<out.count { g += (env[i] - g) * (env[i] > g ? att * 4 : rel * 4); out[i] *= min(1, g) }

// on retire les marges ajoutées, puis on garde de l'attaque à la fin du son
var trimmed = Array(out[N..<(out.count - N * 2)])
var first = 0, last = trimmed.count - 1
let peak = trimmed.map { abs($0) }.max() ?? 1
while first < last && abs(trimmed[first]) < peak * 0.01 { first += 1 }
while last > first && abs(trimmed[last]) < peak * 0.01 { last -= 1 }
first = max(0, first - Int(0.01 * sr)); last = min(trimmed.count - 1, last + Int(0.03 * sr))
trimmed = Array(trimmed[first...last])
let fade = Int(0.012 * sr)
for i in 0..<min(fade, trimmed.count / 2) { let k = Float(i) / Float(fade); trimmed[i] *= k; trimmed[trimmed.count - 1 - i] *= k }
let pk = trimmed.map { abs($0) }.max() ?? 1
trimmed = trimmed.map { $0 * 0.89 / pk }

// ---------- écriture ----------
let fmt = AVAudioFormat(standardFormatWithSampleRate: sr, channels: 1)!
let ob = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(trimmed.count))!
ob.frameLength = AVAudioFrameCount(trimmed.count)
for i in 0..<trimmed.count { ob.floatChannelData![0][i] = trimmed[i] }
do { // le fichier se referme (et s'écrit complètement) à la sortie de ce bloc
  let outFile = try AVAudioFile(forWriting: URL(fileURLWithPath: a[2]), settings: [AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: sr, AVNumberOfChannelsKey: 1, AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false])
  try outFile.write(from: ob)
}
print("ok", a[2], String(format: "%.2f s", Double(trimmed.count) / sr))
