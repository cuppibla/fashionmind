import { useRef, useState, useCallback, useEffect } from "react";
import { FilesetResolver, HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";

export type GestureState = "idle" | "no_hand" | "phone_detected" | "phone_confirmed" | "error";

interface UseHandTrackingOptions {
  onPhoneGesture: () => void;
}

interface UseHandTrackingReturn {
  isTracking: boolean;
  landmarks: NormalizedLandmark[] | null;
  gestureState: GestureState;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
}

const PHONE_HOLD_MS = 800;
/** Euclidean distance between two landmarks (x,y,z). */
function dist(lm: NormalizedLandmark[], a: number, b: number): number {
  return Math.hypot(
    lm[a].x - lm[b].x,
    lm[a].y - lm[b].y,
    (lm[a].z ?? 0) - (lm[b].z ?? 0),
  );
}

/**
 * Phone pose: thumb (4) and pinky (20) extended, index (8), middle (12), ring (16) curled.
 * Compare tip-to-MCP distance for each finger.
 */
function isPhonePose(lm: NormalizedLandmark[], debug = false): boolean {
  // Relaxed thresholds for better detection across hand sizes/distances
  const thumbDist = dist(lm, 4, 2);
  const pinkyDist = dist(lm, 20, 17);
  const indexDist = dist(lm, 8, 5);
  const middleDist = dist(lm, 12, 9);
  const ringDist = dist(lm, 16, 13);

  const thumbExtended = thumbDist > 0.06;
  const pinkyExtended = pinkyDist > 0.05;
  const indexCurled = indexDist < 0.08;
  const middleCurled = middleDist < 0.08;
  const ringCurled = ringDist < 0.08;

  if (debug) {
    console.log(
      `[hand-tracking] pose: thumb=${thumbDist.toFixed(3)}(${thumbExtended?'✓':'✗'}) pinky=${pinkyDist.toFixed(3)}(${pinkyExtended?'✓':'✗'}) index=${indexDist.toFixed(3)}(${indexCurled?'✓':'✗'}) middle=${middleDist.toFixed(3)}(${middleCurled?'✓':'✗'}) ring=${ringDist.toFixed(3)}(${ringCurled?'✓':'✗'})`
    );
  }
  return thumbExtended && pinkyExtended && indexCurled && middleCurled && ringCurled;
}

/**
 * Wait for the video element to be truly ready for MediaPipe processing.
 * `onloadeddata` alone is insufficient — we need readyState >= 2 AND valid dimensions.
 */
function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("Video element never became ready (timeout)"));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  });
}

export function useHandTracking({
  onPhoneGesture,
}: UseHandTrackingOptions): UseHandTrackingReturn {
  const [isTracking, setIsTracking] = useState(false);
  const [landmarks, setLandmarks] = useState<NormalizedLandmark[] | null>(null);
  const [gestureState, setGestureState] = useState<GestureState>("idle");

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafIdRef = useRef<number>(0);
  const phoneTimerRef = useRef<number | null>(null);
  const phoneStartTimeRef = useRef<number>(0);
  const poseConsecutiveFramesRef = useRef<number>(0);
  const onPhoneGestureRef = useRef(onPhoneGesture);
  const isInitializingRef = useRef(false);  // mutex guard against duplicate starts

  onPhoneGestureRef.current = onPhoneGesture;

  const stopTracking = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = 0;
    }
    if (phoneTimerRef.current !== null) {
      clearTimeout(phoneTimerRef.current);
      phoneTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    handLandmarkerRef.current?.close();
    handLandmarkerRef.current = null;

    setIsTracking(false);
    setLandmarks(null);
    setGestureState("idle");
  }, []);

  const startTracking = useCallback(async () => {
    // Use ref-based guard (state is stale in closures under Strict Mode)
    if (isTracking || isInitializingRef.current) return;
    isInitializingRef.current = true;

    // Clean up any prior resources (Strict Mode double-mount)
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    handLandmarkerRef.current?.close();
    if (videoRef.current) videoRef.current.remove();

    try {
      // Initialize MediaPipe
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm",
      );

      // Try GPU first, fall back to CPU
      let handLandmarker: HandLandmarker;
      try {
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/hand_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
        console.log("[hand-tracking] Using GPU delegate");
      } catch (gpuErr) {
        console.warn("[hand-tracking] GPU delegate failed, falling back to CPU:", gpuErr);
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/hand_landmarker.task",
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numHands: 1,
          minHandDetectionConfidence: 0.3,
          minHandPresenceConfidence: 0.3,
          minTrackingConfidence: 0.3,
        });
        console.log("[hand-tracking] Using CPU delegate");
      }
      handLandmarkerRef.current = handLandmarker;

      // Start camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      });
      streamRef.current = stream;

      const video = document.createElement("video");
      video.srcObject = stream;
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      // Use offscreen positioning instead of display:none so the browser still decodes frames
      video.style.position = "fixed";
      video.style.top = "-9999px";
      video.style.left = "-9999px";
      video.style.width = "640px";
      video.style.height = "480px";
      video.style.opacity = "0.01";
      video.style.pointerEvents = "none";
      document.body.appendChild(video);
      videoRef.current = video;

      // Explicitly start playback (autoplay alone can be blocked by Chrome policies)
      try {
        await video.play();
        console.log("[hand-tracking] video.play() succeeded");
      } catch (playErr) {
        console.warn("[hand-tracking] video.play() failed:", playErr);
      }

      // Wait until video is truly ready (readyState >= 2, valid dimensions)
      await waitForVideoReady(video);
      console.log(
        `[hand-tracking] Video ready: ${video.videoWidth}×${video.videoHeight}, readyState=${video.readyState}`,
      );

      setIsTracking(true);
      setGestureState("no_hand");

      // Detection loop
      let lastTime = -1;
      let consecutiveErrors = 0;
      const MAX_CONSECUTIVE_ERRORS = 10;
      let frameCount = 0;

      const detect = () => {
        if (!handLandmarkerRef.current || !videoRef.current) return;

        const now = performance.now();
        if (now === lastTime) {
          rafIdRef.current = requestAnimationFrame(detect);
          return;
        }
        lastTime = now;

        // Guard: skip frame if video isn't ready (e.g. tab backgrounded)
        if (videoRef.current.readyState < 2 || videoRef.current.videoWidth === 0) {
          rafIdRef.current = requestAnimationFrame(detect);
          return;
        }

        let result;
        try {
          result = handLandmarkerRef.current.detectForVideo(videoRef.current, now);
          consecutiveErrors = 0;
        } catch (err) {
          consecutiveErrors++;
          if (consecutiveErrors <= 3) {
            console.warn("[hand-tracking] Detection error (frame skipped):", err);
          }
          if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
            console.error("[hand-tracking] Too many consecutive errors, stopping.");
            setGestureState("error");
            return; // stop the loop
          }
          rafIdRef.current = requestAnimationFrame(detect);
          return;
        }

        const hand = result.landmarks?.[0] ?? null;

        frameCount++;
        const shouldLog = frameCount % 60 === 0;
        if (shouldLog) {
          console.log(`[hand-tracking] frame=${frameCount} hands=${hand ? 1 : 0}`);
        }

        if (hand) {
          setLandmarks(hand);

          // Phone gesture detection with smoothing
          if (isPhonePose(hand, shouldLog)) {
            poseConsecutiveFramesRef.current++;
            
            // Require 3 consecutive frames before starting/maintaining the timer
            if (poseConsecutiveFramesRef.current >= 3) {
              if (phoneTimerRef.current === null) {
                phoneStartTimeRef.current = now;
                setGestureState("phone_detected");
                phoneTimerRef.current = window.setTimeout(() => {
                  setGestureState("phone_confirmed");
                  onPhoneGestureRef.current();
                  phoneTimerRef.current = null;
                }, PHONE_HOLD_MS);
              }
            }
          } else {
            poseConsecutiveFramesRef.current = 0;
            if (phoneTimerRef.current !== null) {
              clearTimeout(phoneTimerRef.current);
              phoneTimerRef.current = null;
            }
            setGestureState("no_hand");
          }
        } else {
          // Hand lost
          poseConsecutiveFramesRef.current = 0;
          setLandmarks(null);
          if (phoneTimerRef.current !== null) {
            clearTimeout(phoneTimerRef.current);
            phoneTimerRef.current = null;
          }
          setGestureState("no_hand");
        }

        rafIdRef.current = requestAnimationFrame(detect);
      };

      rafIdRef.current = requestAnimationFrame(detect);
    } catch (err) {
      console.error("[hand-tracking] Failed to initialize:", err);
      isInitializingRef.current = false;
      setIsTracking(false);
      setGestureState("error");
    }
  }, [isTracking]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTracking();
      if (videoRef.current) {
        videoRef.current.remove();
      }
    };
  }, [stopTracking]);

  return { isTracking, landmarks, gestureState, startTracking, stopTracking };
}
