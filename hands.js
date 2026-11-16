// Hand tracking with MediaPipe Hand Landmarker (21 landmarks per hand, up to 2 hands).
import { FilesetResolver, HandLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const H = window.Hands;
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

async function create(fileset, delegate) {
  return HandLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
  });
}

async function init() {
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM);
    let landmarker;
    try { landmarker = await create(fileset, 'GPU'); }
    catch { landmarker = await create(fileset, 'CPU'); }
    H.detect = (video, t) => landmarker.detectForVideo(video, t);
    H.ready = true;
    H.status = 'hands ready';
  } catch (e) {
    H.status = 'hand tracking failed: ' + e.message;
  }
}

init();
