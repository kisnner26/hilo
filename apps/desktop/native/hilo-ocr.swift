// Lectura de imágenes y PDF para Hilo en macOS, con Vision y PDFKit: todo ocurre en tu equipo y no cuesta tokens.
// Uso: `hilo-ocr imagen <ruta>` o `hilo-ocr pdf <ruta> [máximo de páginas]`.
// Salida: una línea JSON {"texto": "...", "paginas": N, "paginasOcr": M}.
import AppKit
import Foundation
import PDFKit
import Vision

setbuf(stdout, nil)

func responder(_ d: [String: Any]) {
    if let j = try? JSONSerialization.data(withJSONObject: d), let s = String(data: j, encoding: .utf8) { print(s) }
}

func leer(_ imagen: CGImage) -> String {
    // Primero el nivel preciso; si el equipo no puede (sin motor neuronal disponible), el rápido, que siempre corre.
    for nivel in [VNRequestTextRecognitionLevel.accurate, .fast] {
        let peticion = VNRecognizeTextRequest()
        peticion.recognitionLevel = nivel
        peticion.usesLanguageCorrection = nivel == .accurate
        if nivel == .accurate { peticion.recognitionLanguages = ["es-ES", "en-US"] }
        do { try VNImageRequestHandler(cgImage: imagen, options: [:]).perform([peticion]) } catch { continue }
        let texto = ordenar(peticion)
        if !texto.isEmpty || nivel == .fast { return texto }
    }
    return ""
}

func ordenar(_ peticion: VNRecognizeTextRequest) -> String {
    let obs = (peticion.results ?? []).sorted { a, b in
        // De arriba hacia abajo y, en la misma línea, de izquierda a derecha.
        if abs(a.boundingBox.midY - b.boundingBox.midY) > 0.012 { return a.boundingBox.midY > b.boundingBox.midY }
        return a.boundingBox.minX < b.boundingBox.minX
    }
    var lineas: [String] = []
    var ultimaY: CGFloat = -1
    var actual = ""
    for o in obs {
        guard let t = o.topCandidates(1).first?.string else { continue }
        if ultimaY >= 0 && abs(o.boundingBox.midY - ultimaY) > 0.012 {
            lineas.append(actual)
            actual = t
        } else {
            actual += (actual.isEmpty ? "" : "  ") + t
        }
        ultimaY = o.boundingBox.midY
    }
    if !actual.isEmpty { lineas.append(actual) }
    return lineas.joined(separator: "\n")
}

let args = CommandLine.arguments
guard args.count >= 3 else {
    responder(["error": "uso"])
    exit(2)
}
let ruta = URL(fileURLWithPath: args[2])

if args[1] == "imagen" {
    guard let img = NSImage(contentsOf: ruta), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        responder(["error": "no-se-pudo-abrir"])
        exit(3)
    }
    responder(["texto": leer(cg), "paginas": 1, "paginasOcr": 1])
} else if args[1] == "pdf" {
    guard let doc = PDFDocument(url: ruta) else {
        responder(["error": "no-se-pudo-abrir"])
        exit(3)
    }
    let maximo = args.count > 3 ? (Int(args[3]) ?? 40) : 40
    var partes: [String] = []
    var ocr = 0
    for i in 0..<min(doc.pageCount, maximo) {
        guard let pagina = doc.page(at: i) else { continue }
        var texto = (pagina.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if texto.count < 20 && ocr < 8 {
            // Página escaneada: no trae texto, se lee como imagen.
            let caja = pagina.bounds(for: .mediaBox)
            let escala = 1600 / max(caja.width, caja.height)
            let imagen = pagina.thumbnail(of: NSSize(width: caja.width * escala, height: caja.height * escala), for: .mediaBox)
            if let cg = imagen.cgImage(forProposedRect: nil, context: nil, hints: nil) {
                texto = leer(cg)
                ocr += 1
            }
        }
        if !texto.isEmpty { partes.append("--- página \(i + 1) ---\n\(texto)") }
    }
    responder(["texto": partes.joined(separator: "\n\n"), "paginas": doc.pageCount, "paginasOcr": ocr])
} else {
    responder(["error": "uso"])
    exit(2)
}
