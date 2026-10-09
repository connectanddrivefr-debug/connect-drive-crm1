import { useEffect, useRef, useState } from "react";
import { normalizeSerial } from "../lib/serial";

// Scanner de numéros de série en continu:
// - caméra du téléphone (codes-barres 1D + QR + DataMatrix), sans bouton à
//   toucher entre deux cartons: chaque code lu déclenche onScan + un bip;
// - champ texte pour la saisie manuelle ou une douchette Bluetooth (la
//   douchette "tape" le code puis Entrée, comme un clavier).
// Un même code relu dans les 2,5 s est ignoré (la caméra le voit plusieurs
// fois de suite tant que le carton reste devant l'objectif).

let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1200 : 300;
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.3));
  } catch {
    /* audio indisponible */
  }
  try {
    navigator.vibrate && navigator.vibrate(ok ? 60 : [80, 60, 80]);
  } catch {
    /* vibration indisponible */
  }
}

export { beep };

export default function Scanner({ onScan, disabled = false }) {
  const regionId = useRef(`scan-${Math.random().toString(36).slice(2)}`);
  const scannerRef = useRef(null);
  const lastRef = useRef({ code: "", at: 0 });
  const onScanRef = useRef(onScan);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manual, setManual] = useState("");
  const manualRef = useRef(null);

  onScanRef.current = onScan;

  function emit(raw) {
    const code = normalizeSerial(raw);
    if (!code) return;
    const now = Date.now();
    if (lastRef.current.code === code && now - lastRef.current.at < 2500) return;
    lastRef.current = { code, at: now };
    onScanRef.current(code, raw);
  }

  async function startCamera() {
    setCameraError("");
    try {
      const mod = await import("html5-qrcode");
      const { Html5Qrcode, Html5QrcodeSupportedFormats: F } = mod;
      const scanner = new Html5Qrcode(regionId.current, {
        verbose: false,
        formatsToSupport: [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.DATA_MATRIX, F.EAN_13, F.EAN_8, F.UPC_A, F.ITF],
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: (w, h) => ({ width: Math.floor(w * 0.85), height: Math.floor(Math.min(h, w) * 0.55) }),
        },
        (text) => emit(text),
        () => {}
      );
      setCameraOn(true);
    } catch (err) {
      scannerRef.current = null;
      setCameraOn(false);
      setCameraError(
        "Impossible d'ouvrir la caméra. Autorisez l'accès à la caméra pour ce site, ou utilisez la saisie manuelle / la douchette ci-dessous."
      );
      console.error(err);
    }
  }

  async function stopCamera() {
    const s = scannerRef.current;
    scannerRef.current = null;
    setCameraOn(false);
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* déjà arrêtée */
      }
    }
  }

  useEffect(() => () => {
    stopCamera();
  }, []);

  useEffect(() => {
    if (disabled && cameraOn) stopCamera();
  }, [disabled]);

  function submitManual(e) {
    e.preventDefault();
    if (!manual.trim()) return;
    lastRef.current = { code: "", at: 0 }; // saisie volontaire: jamais ignorée
    emit(manual);
    setManual("");
    manualRef.current && manualRef.current.focus();
  }

  return (
    <div className="scanner">
      <div id={regionId.current} className={`scanner-view ${cameraOn ? "on" : ""}`} />
      {!cameraOn ? (
        <button type="button" className="btn-primary scanner-start" onClick={startCamera} disabled={disabled}>
          📷 Ouvrir la caméra et scanner
        </button>
      ) : (
        <button type="button" className="btn-ghost scanner-stop" onClick={stopCamera}>
          Arrêter la caméra
        </button>
      )}
      {cameraError && <p className="error">{cameraError}</p>}
      <form className="scanner-manual" onSubmit={submitManual}>
        <input
          ref={manualRef}
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="N° de série (saisie ou douchette)"
          autoComplete="off"
          autoCapitalize="characters"
          disabled={disabled}
        />
        <button type="submit" className="btn-ghost" disabled={disabled || !manual.trim()}>
          Ajouter
        </button>
      </form>
    </div>
  );
}
