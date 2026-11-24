// Dictado por voz de Hilo para macOS: escucha el micrófono y entrega el texto a medida que hablas.
// Usa el reconocimiento de voz del propio sistema (en el equipo si el idioma lo permite): no manda audio a ningún servicio mío.
// Salida: una línea JSON por evento: {"estado":"escuchando"}, {"parcial":"…"}, {"final":"…"} o {"error":"…"}.
// Entrada: la línea "stop" (o cerrar la entrada) termina y entrega lo dicho. Argumentos: idioma, segundos de silencio.
import AVFoundation
import Foundation
import Speech

setbuf(stdout, nil)

func emitir(_ d: [String: Any]) {
    if let j = try? JSONSerialization.data(withJSONObject: d), let s = String(data: j, encoding: .utf8) { print(s) }
}

let args = CommandLine.arguments
let idioma = args.count > 1 ? args[1] : "es-MX"
let silencio = args.count > 2 ? (Double(args[2]) ?? 2.2) : 2.2

if args.contains("--probar") {
    let voz = SFSpeechRecognizer.authorizationStatus()
    let mic = AVCaptureDevice.authorizationStatus(for: .audio)
    let rec = SFSpeechRecognizer(locale: Locale(identifier: idioma))
    emitir(["voz": voz.rawValue, "microfono": mic.rawValue, "idioma": idioma, "disponible": rec != nil, "enEquipo": rec?.supportsOnDeviceRecognition ?? false])
    exit(0)
}

final class Dictado {
    let motor = AVAudioEngine()
    let reconocedor: SFSpeechRecognizer
    let peticion = SFSpeechAudioBufferRecognitionRequest()
    var tarea: SFSpeechRecognitionTask?
    var texto = ""
    var temporizador: Timer?
    var terminado = false

    init?(idioma: String) {
        guard let r = SFSpeechRecognizer(locale: Locale(identifier: idioma)) ?? SFSpeechRecognizer(locale: Locale(identifier: "es-MX")) else { return nil }
        reconocedor = r
        peticion.shouldReportPartialResults = true
        if r.supportsOnDeviceRecognition { peticion.requiresOnDeviceRecognition = true }
    }

    func empezar() throws {
        let entrada = motor.inputNode
        let formato = entrada.outputFormat(forBus: 0)
        entrada.installTap(onBus: 0, bufferSize: 1024, format: formato) { [weak self] b, _ in self?.peticion.append(b) }
        motor.prepare()
        try motor.start()
        tarea = reconocedor.recognitionTask(with: peticion) { [weak self] res, err in
            guard let self = self, !self.terminado else { return }
            if let res = res {
                let t = res.bestTranscription.formattedString
                if !t.isEmpty {
                    self.texto = t
                    emitir(["parcial": t])
                    self.armar()
                }
                if res.isFinal { self.cerrar() }
            } else if err != nil { self.cerrar() }
        }
        emitir(["estado": "escuchando"])
    }

    /// Si hay texto y nadie habla durante un rato, se da por terminado.
    func armar() {
        temporizador?.invalidate()
        temporizador = Timer.scheduledTimer(withTimeInterval: silencio, repeats: false) { [weak self] _ in self?.terminar() }
    }

    func terminar() {
        if terminado { return }
        motor.stop()
        motor.inputNode.removeTap(onBus: 0)
        peticion.endAudio()
        // Le damos un instante al reconocedor para cerrar la última palabra.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in self?.cerrar() }
    }

    func cerrar() {
        if terminado { return }
        terminado = true
        temporizador?.invalidate()
        tarea?.cancel()
        emitir(["final": texto])
        exit(0)
    }
}

SFSpeechRecognizer.requestAuthorization { estado in
    DispatchQueue.main.async {
        guard estado == .authorized else {
            emitir(["error": "permiso-voz"])
            exit(2)
        }
        AVCaptureDevice.requestAccess(for: .audio) { ok in
            DispatchQueue.main.async {
                guard ok else {
                    emitir(["error": "permiso-microfono"])
                    exit(3)
                }
                guard let d = Dictado(idioma: idioma) else {
                    emitir(["error": "idioma-no-disponible"])
                    exit(4)
                }
                guard d.reconocedor.isAvailable else {
                    emitir(["error": "reconocedor-no-disponible"])
                    exit(5)
                }
                do { try d.empezar() } catch {
                    emitir(["error": "microfono-ocupado"])
                    exit(6)
                }
                let h = FileHandle.standardInput
                h.readabilityHandler = { f in
                    let datos = f.availableData
                    if datos.isEmpty || (String(data: datos, encoding: .utf8) ?? "").contains("stop") { DispatchQueue.main.async { d.terminar() } }
                }
                signal(SIGTERM) { _ in exit(0) }
            }
        }
    }
}

RunLoop.main.run()
