import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const statusDiv = document.getElementById("status");
const chartContainer = document.getElementById("chart-container");
const startBtn = document.getElementById("start-btn");
const letterDisplay = document.getElementById("snellen-letter");

let faceLandmarker;
let currentSize = 120; // Starting font size in pixels
const letters = ["E", "F", "P", "T", "O", "Z", "L", "P", "E", "D"];
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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
    video.srcObject = stream;
    video.addEventListener("loadeddata", predictWebcam);
}

async function predictWebcam() {
    const results = await faceLandmarker.detectForVideo(video, performance.now());

    if (results.faceLandmarks.length > 0) {
        const landmarks = results.faceLandmarks[0];
        // Calculate Distance: Eye landmarks 33 and 263
        const eyeDist = Math.sqrt(
            Math.pow(landmarks[33].x - landmarks[263].x, 2) + 
            Math.pow(landmarks[33].y - landmarks[263].y, 2)
        );

        if (eyeDist > 0.18 && eyeDist < 0.25) { // Optimal distance approx 40-50cm
            statusDiv.innerHTML = "<span style='color:#00ff00'>Distance Perfect. Ready.</span>";
            startBtn.style.display = "block";
        } else if (eyeDist <= 0.18) {
            statusDiv.innerHTML = "Move a bit closer";
            startBtn.style.display = "none";
        } else {
            statusDiv.innerHTML = "Move further back";
            startBtn.style.display = "none";
        }
    } else {
        statusDiv.innerHTML = "Align your face";
    }
    window.requestAnimationFrame(predictWebcam);
}

window.startTest = () => {
    chartContainer.style.display = "block";
    updateLetter();
};

window.nextLevel = () => {
    level++;
    currentSize *= 0.75; // Shrink the letter for the next "line"
    updateLetter();
};

window.failLevel = () => {
    alert(`Your estimated Vision Score: 20/${(20 + (level * 10))}`);
    location.reload();
};

function updateLetter() {
    letterDisplay.innerText = letters[Math.floor(Math.random() * letters.length)];
    letterDisplay.style.fontSize = `${currentSize}px`;
}

initAI();
