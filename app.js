import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusDiv = document.getElementById("status");
const chartContainer = document.getElementById("chart-container");
const startBtn = document.getElementById("start-btn");
const scanBtn = document.getElementById("scan-btn");
const letterDisplay = document.getElementById("snellen-letter");

let faceLandmarker;
let currentSize = 120;
const letters = ["E", "F", "P", "T", "O", "Z", "L", "D"];
let level = 0;

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    startVideo();
}

async function startVideo() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    } catch (err) {
        statusDiv.innerHTML = "Camera Error: " + err.message;
    }
}

async function predictWebcam() {
    const results = await faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        // Calculate Distance using Interpupillary Distance (eye center to center)
        const eyeDist = Math.sqrt(
            Math.pow(landmarks[33].x - landmarks[263].x, 2) + 
            Math.pow(landmarks[33].y - landmarks[263].y, 2)
        );

        // UI Logic based on Distance
        if (eyeDist > 0.45) { // VERY CLOSE (For Surface Scan)
            statusDiv.innerHTML = "<span style='color:#28a745'>Ready for Surface Scan</span>";
            scanBtn.style.display = "block";
            startBtn.style.display = "none";
        } else if (eyeDist > 0.18 && eyeDist < 0.28) { // OPTIMAL (For Vision Test)
            statusDiv.innerHTML = "<span style='color:#0078d4'>Ready for Vision Test</span>";
            startBtn.style.display = "block";
            scanBtn.style.display = "none";
        } else {
            statusDiv.innerHTML = eyeDist < 0.18 ? "Move closer" : "Move further back";
            startBtn.style.display = "none";
            scanBtn.style.display = "none";
        }
    } else {
        statusDiv.innerHTML = "Looking for your eyes...";
    }
    window.requestAnimationFrame(predictWebcam);
}

// --- Vision Test Functions ---
window.startTest = () => {
    chartContainer.style.display = "block";
    updateLetter();
};

window.nextLevel = () => {
    level++;
    currentSize *= 0.7;
    updateLetter();
};

window.failLevel = () => {
    document.getElementById("test-controls").style.display = "none";
    document.getElementById("result-text").innerHTML = `<b>Result:</b> Estimated Vision 20/${20 + (level * 10)}`;
    document.getElementById("reset-btn").style.display = "inline-block";
};

function updateLetter() {
    letterDisplay.innerText = letters[Math.floor(Math.random() * letters.length)];
    letterDisplay.style.fontSize = `${currentSize}px`;
}

// --- Phase 3: Surface Analysis Function ---
window.performEyeAnalysis = () => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    let r = 0, g = 0, b = 0;

    for (let i = 0; i < data.length; i += 4) {
        r += data[i]; g += data[i+1]; b += data[i+2];
    }

    const avgR = r / (data.length / 4);
    const avgG = g / (data.length / 4);
    const avgB = b / (data.length / 4);

    chartContainer.style.display = "block";
    document.getElementById("test-controls").style.display = "none";
    document.getElementById("snellen-letter").style.display = "none";
    document.getElementById("reset-btn").style.display = "inline-block";

    if (avgR > avgG + 35) {
        document.getElementById("result-text").innerHTML = "<b style='color:red'>Redness Detected:</b> Possible irritation. Consult a doctor.";
    } else if (avgR > 170 && avgG > 170 && avgB < 140) {
        document.getElementById("result-text").innerHTML = "<b style='color:#CCAC00'>Yellowish Tint:</b> Potential sign of Jaundice.";
    } else {
        document.getElementById("result-text").innerHTML = "<b>Analysis:</b> Eye surface appears normal in current lighting.";
    }
};

initAI();
