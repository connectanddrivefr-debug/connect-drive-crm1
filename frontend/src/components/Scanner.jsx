import { useEffect, useRef, useState } from "react";
import { readCodes } from "../lib/labelScan";

// Scanner d'étiquettes en continu:
// - caméra du téléphone: chaque image est analysée en entier (zxing-wasm) et
//   TOUS les codes visibles sont remontés ensemble (QR S/N + code-barres
//   produit + code-barres S/N) -> un seul passage devant l'étiquette suffit;
// - champ texte pour la saisie manuelle ou une douchette Bluetooth (la
//   douchette "tape" le code puis Entrée, comme un clavier).
// onCodes(listeDeCodesBruts) est appelé quand une image contient au moins un
// code pas vu dans les 2,5 dernières secondes.

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

export default function Scanner({ onCodes, disabled = false }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef = useRef(null);
  const busyRef = useRef(false);
  const seenRef = useRef(new Map()); // code -> dernier passage (ms)
  const onCodesRef = useRef(onCodes);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [manual, setManual] = useState("");
  const manualRef = useRef(null);

  onCodesRef.current = onCodes;

  function emit(codes, { force = false } = {}) {
    const now = Date.now();
    const seen = seenRef.current;
    const fresh = codes.some((c) => force || !seen.has(c) || now - seen.get(c) > 2500);
    codes.forEach((c) => seen.set(c, now));
    if (fresh) onCodesRef.current(codes);
  }

  async function tick() {
    const video = videoRef.current;
    if (busyRef.current || !video || video.readyState < 2) return;
    busyRef.current = true;
    try {
      const w = video.videoWidth;
      const h = video.videoHeight;
      const scale = Math.min(1, 1600 / Math.max(w, h));
      const canvas = canvasRef.current || (canvasRef.current = document.createElement("canvas"));
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const codes = await readCodes(ctx.getImageData(0, 0, canvas.width, canvas.height), { fast: true });
      if (codes.length && streamRef.current) emit([...new Set(codes)]);
    } catch (err) {
      console.error(err);
    } finally {
      busyRef.current = false;
    }
  }

  async function startCamera() {
    setCameraError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCameraOn(true);
      loopRef.current = setInterval(tick, 250);
    } catch (err) {
      stopCamera();
      setCameraError(
        "Impossible d'ouvrir la caméra. Autorisez l'accès à la caméra pour ce site, ou utilisez la photo / la saisie manuelle / la douchette."
      );
      console.error(err);
    }
  }

  function stopCamera() {
    clearInterval(loopRef.current);
    loopRef.current = null;
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }

  useEffect(() => () => stopCamera(), []);

  useEffect(() => {
    if (disabled && cameraOn) stopCamera();
  }, [disabled]);

  function submitManual(e) {
    e.preventDefault();
    const v = manual.trim();
    if (!v) return;
    emit([v], { force: true }); // saisie volontaire: jamais ignorée
    setManual("");
    manualRef.current && manualRef.current.focus();
  }

  return (
    <div className="scanner">
      <video
        ref={videoRef}
        className={`scanner-view ${cameraOn ? "on" : ""}`}
        playsInline
        muted
        style={{ width: "100%", borderRadius: 8, display: cameraOn ? "block" : "none" }}
      />
      {!cameraOn ? (
        <button type="button" className="btn-ghost scanner-start" onClick={startCamera} disabled={disabled}>
          📷 Ouvrir la caméra et scanner (étiquette entière dans le cadre)
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
          placeholder="Code (saisie ou douchette : S/N ou code-barres produit)"
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
