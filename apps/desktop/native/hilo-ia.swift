// IA local de Hilo para macOS: el modelo de Apple Intelligence que ya trae tu Mac, sin descargas ni suscripción.
// Uso: `hilo-ia --probar` dice si está disponible; si no, lee por la entrada un JSON {"sistema","prompt"}
// y escribe una línea JSON por evento: {"delta":"…"}, {"reemplazo":"…"}, {"fin":true} o {"error":"…"}.
import Foundation
import FoundationModels

setbuf(stdout, nil)

func emitir(_ d: [String: Any]) {
    if let j = try? JSONSerialization.data(withJSONObject: d), let s = String(data: j, encoding: .utf8) { print(s) }
}

if CommandLine.arguments.contains("--probar") {
    switch SystemLanguageModel.default.availability {
    case .available:
        emitir(["disponible": true])
    case .unavailable(let razon):
        emitir(["disponible": false, "razon": "\(razon)"])
    }
    exit(0)
}

let datos = FileHandle.standardInput.readDataToEndOfFile()
guard let j = try? JSONSerialization.jsonObject(with: datos) as? [String: Any], let prompt = j["prompt"] as? String else {
    emitir(["error": "entrada"])
    exit(2)
}
let sistema = (j["sistema"] as? String) ?? ""

Task {
    do {
        let sesion = LanguageModelSession(instructions: sistema)
        var previo = ""
        for try await parcial in sesion.streamResponse(to: prompt) {
            let t = parcial.content
            if t.hasPrefix(previo) { emitir(["delta": String(t.dropFirst(previo.count))]) } else { emitir(["reemplazo": t]) }
            previo = t
        }
        emitir(["fin": true])
        exit(0)
    } catch {
        emitir(["error": "\(error)"])
        exit(3)
    }
}
RunLoop.main.run()
