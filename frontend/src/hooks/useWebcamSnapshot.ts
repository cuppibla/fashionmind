import { useRef, useState, useCallback } from "react";

export function useWebcamSnapshot() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement("canvas"));
  const [isCameraOn, setIsCameraOn] = useState(false);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setIsCameraOn(true);
    } catch (err) {
      console.error("Camera access error:", err);
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setIsCameraOn(false);
  }, []);

  const captureSnapshot = useCallback((): string => {
    const video = videoRef.current;
    if (!video) return "";
    const canvas = canvasRef.current;
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.drawImage(video, 0, 0, 640, 480);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    return dataUrl.replace("data:image/jpeg;base64,", "");
  }, []);

  return { videoRef, startCamera, stopCamera, captureSnapshot, isCameraOn };
}
