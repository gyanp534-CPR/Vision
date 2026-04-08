import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusDiv = document.getElementById("status");
const chartContainer = document.getElementById("chart-container");
const startBtn = document.getElementById("start-btn");
const scanBtn = document.getElementById("scan-btn");
const letterDisplay = document.getElementById("snellen-letter");
const reportCard = document.getElementById("report-card");

let faceLandmarker;
let currentFacingMode = "user"; // "user" = Front, "environment" = Back
let currentSize = 120;
let level = 0;
let finalVision = "Not Tested";
let finalSurface = "Not Analyzed";

async function initAI() {
    statusDiv.innerHTML = "Loading AI Models...";
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    startVideo();
}

async function startVideo() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
    }

    // Mirroring fix: Back camera should NOT be mirrored
    video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode, width: 720, height: 720 } 
        });
        video.srcObject = stream;
        video.onloadeddata = () => predictWebcam();
    } catch (err) {
        statusDiv.innerHTML = "Error: Camera not found or permission denied.";
    }
}

window.switchCamera = () => {
    currentFacingMode = (currentFacingMode === "user") ? "environment" : "user";
    statusDiv.innerHTML = "Switching camera...";
    startVideo();
};

async function predictWebcam() {
    if (!faceLandmarker) return;
    const results = await faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        // Calculate Distance
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));

        if (eyeDist > 0.45) {
            statusDiv.innerHTML = "<span style='color:#28a745'>PERFECT: Hold still for Surface Scan</span>";
            scanBtn.style.display = "block";
            startBtn.style.display = "none";
        } else if (eyeDist > 0.18 && eyeDist < 0.30) {
            statusDiv.innerHTML = "<span style='color:#0078d4'>Ready for Vision Test</span>";
            startBtn.style.display = "block";
            scanBtn.style.display = "none";
        } else {
            statusDiv.innerHTML = eyeDist < 0.18 ? "Move closer to screen" : "Move further away";
            startBtn.style.display = "none";
            scanBtn.style.display = "none";
        }
    } else {
        statusDiv.innerHTML = "Looking for your eyes...";
    }
    window.requestAnimationFrame(predictWebcam);
}

// --- Test & Analysis Logic ---
window.startTest = () => {
    chartContainer.style.display = "block";
    reportCard.style.display = "none";
    updateLetter();
};

window.nextLevel = () => {
    level++;
    currentSize *= 0.75;
    updateLetter();
};

window.failLevel = () => {
    finalVision = `20/${20 + (level * 10)}`;
    chartContainer.style.display = "none";
    showReport();
};

function updateLetter() {
    const letters = ["E", "F", "P", "T", "O", "L", "D"];
    letterDisplay.innerText = letters[Math.floor(Math.random() * letters.length)];
    letterDisplay.style.fontSize = `${currentSize}px`;
}

window.performEyeAnalysis = () => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i+1]; b += data[i+2];
    }
    const avgR = r / (data.length / 4);
    const avgG = g / (data.length / 4);

    if (avgR > avgG + 35) finalSurface = "High Redness Detected";
    else if (avgR > 180 && avgG > 180) finalSurface = "Potential Cloudiness/Yellowing";
    else finalSurface = "Appearance Normal";

    showReport();
};

function showReport() {
    reportCard.style.display = "block";
    document.getElementById("report-date").innerText = new Date().toLocaleDateString();
    document.getElementById("report-cam").innerText = currentFacingMode === "user" ? "Front (Selfie)" : "Back (Macro)";
    document.getElementById("report-vision").innerText = finalVision;
    document.getElementById("report-surface").innerText = finalSurface;
    window.scrollTo(0, document.body.scrollHeight);
}

initAI();
