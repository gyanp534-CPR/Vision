import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusDiv = document.getElementById("status");
const chartContainer = document.getElementById("chart-container");
const startBtn = document.getElementById("start-btn");
const scanBtn = document.getElementById("scan-btn");
const letterDisplay = document.getElementById("snellen-letter");
const reportCard = document.getElementById("report-card");

let faceLandmarker;
let currentFacingMode = "user"; 
let currentSize = 120;
let level = 0;
let finalVision = "Not Measured";
let finalSurface = "Not Analyzed";

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    startVideo();
}

async function startVideo() {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode, width: { ideal: 1080 }, height: { ideal: 1080 } } 
        });
        video.srcObject = stream;
        video.onloadeddata = () => predictWebcam();
    } catch (err) {
        statusDiv.innerHTML = "Camera Error. Check permissions.";
    }
}

window.switchCamera = () => {
    currentFacingMode = (currentFacingMode === "user") ? "environment" : "user";
    startVideo();
};

async function toggleTorch(on) {
    const track = video.srcObject.getVideoTracks()[0];
    const capabilities = track.getCapabilities();
    if (capabilities.torch) {
        try { await track.applyConstraints({ advanced: [{ torch: on }] }); } catch (e) { console.error(e); }
    }
}

async function predictWebcam() {
    if (!faceLandmarker) return;
    const results = await faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));

        if (eyeDist > 0.48) {
            statusDiv.innerHTML = "<span style='color:#4ade80'>READY FOR MACRO SCAN<br>Flash will trigger automatically</span>";
            scanBtn.style.display = "block";
            startBtn.style.display = "none";
        } else if (eyeDist > 0.18 && eyeDist < 0.30) {
            statusDiv.innerHTML = "<span style='color:#38bdf8'>Vision Test Distance OK</span>";
            startBtn.style.display = "block";
            scanBtn.style.display = "none";
        } else {
            statusDiv.innerHTML = eyeDist < 0.18 ? "Move phone closer" : "Move phone back";
            startBtn.style.display = "none"; scanBtn.style.display = "none";
        }
    } else {
        statusDiv.innerHTML = "Align your eye in the circle...";
    }
    window.requestAnimationFrame(predictWebcam);
}

// --- Vision Test Logic ---
window.startTest = () => { chartContainer.style.display = "block"; reportCard.style.display = "none"; updateLetter(); };
window.nextLevel = () => { level++; currentSize *= 0.7; updateLetter(); };
window.failLevel = () => { finalVision = `20/${20 + (level * 10)}`; chartContainer.style.display = "none"; showReport(); };

function updateLetter() {
    const alphabet = "EFPTOZLD";
    letterDisplay.innerText = alphabet[Math.floor(Math.random() * alphabet.length)];
    letterDisplay.style.fontSize = `${currentSize}px`;
}

// --- Phase 5 Macro Analysis ---
window.performEyeAnalysis = async () => {
    statusDiv.innerHTML = "ACTIVATE FLASH...";
    if (currentFacingMode === "environment") await toggleTorch(true);

    // Wait for exposure to adjust
    setTimeout(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);

        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; }
        const avgR = r / (data.length / 4);
        const avgG = g / (data.length / 4);

        if (currentFacingMode === "environment") await toggleTorch(false);

        // Analysis Logic
        if (avgR > avgG + 45) finalSurface = "Strong Red Reflex / Irritation";
        else if (avgR > 190 && avgG > 190) finalSurface = "Lens Opacity Detected (Clouding)";
        else finalSurface = "Surface looks Healthy";

        showReport();
    }, 400); 
};

function showReport() {
    reportCard.style.display = "block";
    document.getElementById("r-date").innerText = new Date().toLocaleDateString();
    document.getElementById("r-vision").innerText = finalVision;
    document.getElementById("r-surface").innerText = finalSurface;
    window.scrollTo(0, document.body.scrollHeight);
}

initAI();
