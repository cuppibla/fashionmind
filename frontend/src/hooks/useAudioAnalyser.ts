import { useRef, useCallback } from "react";

/**
 * Reads vocal-range volume from an AnalyserNode.
 * Call getVocalVolume() in a rAF/render loop — no state updates.
 */
export function useAudioAnalyser(analyserRef: React.RefObject<AnalyserNode | null>) {
  const dataArrayRef = useRef<Uint8Array | null>(null);

  const getVocalVolume = useCallback((): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;

    if (!dataArrayRef.current || dataArrayRef.current.length !== analyser.frequencyBinCount) {
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(dataArrayRef.current as Uint8Array<ArrayBuffer>);

    // At sampleRate=24000, fftSize=256: binWidth ≈ 93.75Hz
    // Vocal range 300–3000Hz → bins 3..32
    const startBin = 3;
    const endBin = Math.min(32, dataArrayRef.current.length - 1);
    let sum = 0;
    for (let i = startBin; i <= endBin; i++) {
      sum += dataArrayRef.current[i];
    }
    const avg = sum / (endBin - startBin + 1);
    return Math.min(1, avg / 180);
  }, [analyserRef]);

  return { getVocalVolume };
}
