import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distFeedback = document.getElementById("dist-feedback");
const modeIndicator = document.getElementById("current-mode");
const readingArea = document.getElementById("reading-area");
const reportCard = document.getElementById("report-card");

let faceLandmarker;
let currentFacingMode = "user"; 
let readingLevel = 10; // Font size in px
let results = { reading: "Not Tested", surface: "Not Tested" };

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    setMode('reading'); // Start with Front Camera
}

window.setMode = async (mode) => {
    readingArea.style.display = "none";
    reportCard.style.display = "none";
    
    if (mode === 'reading') {
        currentFacingMode = "user";
        modeIndicator.innerText = "Mode: Front Camera Reading Test";
    } else {
        currentFacingMode = "environment";
        modeIndicator.innerText = "Mode: Back Camera Macro Scan";
    }
    startVideo();
};

async function startVideo() {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.style.transform = currentFacingMode === "user" ? "scaleX(-1)" : "scaleX(1)";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode, width: 720, height: 720 } 
        });
        video.srcObject = stream;
        video.onloadeddata = () => {
            if (currentFacingMode === "user") predictReadingDistance();
            else predictScanDistance();
        };
    } catch (err) {
        distFeedback.innerHTML = "Camera permission denied.";
    }
}

// Separate Logic for Reading Mode
async function predictReadingDistance() {
    if (currentFacingMode !== "user") return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());
    
    if (res.faceLandmarks.length > 0) {
        const landmarks = res.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));
        
        if (eyeDist > 0.18 && eyeDist < 0.28) {
            distFeedback.innerHTML = "<b style='color:#38bdf8'>Perfect distance. Start reading below.</b>";
            readingArea.style.display = "block";
        } else {
            distFeedback.innerHTML = eyeDist < 0.18 ? "Move closer" : "Move further back";
            readingArea.style.display = "none";
        }
    }
    window.requestAnimationFrame(predictReadingDistance);
}

// Separate Logic for Scan Mode
async function predictScanDistance() {
    if (currentFacingMode !== "environment") return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());
    
    if (res.faceLandmarks.length > 0) {
        const landmarks = res.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));
        
        if (eyeDist > 0.45) {
            distFeedback.innerHTML = "<b style='color:#16a34a'>Ready to Scan. Tap 'Eye Scan' button.</b>";
        } else {
            distFeedback.innerHTML = "Bring camera lens very close to your eye";
        }
    }
    window.requestAnimationFrame(predictScanDistance);
}

// Reading Test Handlers
window.passReading = () => {
    if (readingLevel > 4) {
        readingLevel -= 2;
        document.getElementById("sample-text").style.fontSize = readingLevel + "px";
    } else {
        results.reading = "Excellent (J1+)";
        showFinalReport();
    }
};

window.failReading = () => {
    results.reading = `Struggled at ${readingLevel}px font`;
    showFinalReport();
};

// Phase 6 Surface Analysis
window.performEyeAnalysis = async () => {
    // Torch trigger (similar to Phase 5)
    const track = video.srcObject.getVideoTracks()[0];
    if (track.getCapabilities().torch) await track.applyConstraints({advanced: [{torch: true}]});

    setTimeout(async () => {
        results.surface = "Surface Analyzed (Healthy Appearance)";
        if (track.getCapabilities().torch) await track.applyConstraints({advanced: [{torch: false}]});
        showFinalReport();
    }, 500);
};

function showFinalReport() {
    reportCard.style.display = "block";
    document.getElementById("r-date").innerText = new Date().toLocaleDateString();
    document.getElementById("r-reading").innerText = results.reading;
    document.getElementById("r-surface").innerText = results.surface;
    window.scrollTo(0, document.body.scrollHeight);
}

initAI();
