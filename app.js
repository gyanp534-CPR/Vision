import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusDiv = document.getElementById("status");
let faceLandmarker;

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1
    });
    startVideo();
}

async function startVideo() {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
}

async function predictWebcam() {
    const startTimeMs = performance.now();
    const results = await faceLandmarker.detectForVideo(video, startTimeMs);

    if (results.faceLandmarks.length > 0) {
        // Index 468-477 are usually Iris landmarks in MediaPipe
        statusDiv.innerHTML = "<span class='detected'>Eyes Detected: Ready to Scan</span>";
    } else {
        statusDiv.innerHTML = "<span class='not-detected'>Align your face to the camera</span>";
    }
    window.requestAnimationFrame(predictWebcam);
}

initAI();
