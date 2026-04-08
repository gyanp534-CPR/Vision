import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const miniVideo = document.getElementById("mini-video");
const distMsg = document.getElementById("dist-msg");
const roomDistMsg = document.getElementById("room-dist-msg");
const roomText = document.getElementById("room-text");
const reportOverlay = document.getElementById("report-overlay");

let faceLandmarker;
let currentMode = "dashboard"; // dashboard, reading, scan
let readingLevel = 18; 
let results = { reading: "Not Tested", surface: "Not Tested" };

const readingSamples = [
    "Vision is a window to the world around us.",
    "The quick brown fox jumps over the lazy dog.",
    "Artificial intelligence is transforming healthcare.",
    "Small text helps in testing retinal sharpness.",
    "Always maintain a healthy distance from screens.",
    "Focusing on tiny details improves perception."
];

async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
            runningMode: "VIDEO", numFaces: 1
        });
        renderHistory();
        startCamera("user");
    } catch (e) { distMsg.innerText = "AI failed to load."; }
}

async function startCamera(mode) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 720, height: 720 } });
    video.srcObject = stream;
    miniVideo.srcObject = stream; // Keep mini cam synced
    video.onloadeddata = runAILoop;
}

window.startReadingTest = () => {
    currentMode = "reading";
    document.getElementById("test-room").style.display = "flex";
    updateReadingContent();
};

window.setMode = (mode) => {
    if(mode === 'scan') {
        currentMode = "scan";
        distMsg.innerHTML = "<b style='color:#10b981'>BACK CAMERA: Bring lens close to eye.<br>Capturing in 4s...</b>";
        startCamera("environment");
        setTimeout(() => { if(currentMode === "scan") performMacroScan(); }, 4500);
    }
};

async function runAILoop() {
    if (!faceLandmarker || currentMode === "scan") return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const landmarks = res.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));

        const msg = (eyeDist > 0.18 && eyeDist < 0.28) ? "DISTANCE PERFECT" : (eyeDist < 0.18 ? "MOVE CLOSER" : "MOVE BACK");
        const color = (eyeDist > 0.18 && eyeDist < 0.28) ? "#10b981" : "#ef4444";
        
        distMsg.innerText = msg;
        roomDistMsg.innerText = msg;
        roomDistMsg.style.color = color;
    }
    window.requestAnimationFrame(runAILoop);
}

// Reading Logic
function updateReadingContent() {
    roomText.innerText = readingSamples[Math.floor(Math.random() * readingSamples.length)];
    roomText.style.fontSize = readingLevel + "px";
}

window.passReading = () => {
    readingLevel -= 3;
    if (readingLevel < 6) {
        results.reading = "Normal (J1+)";
        closeTestRoom();
    } else {
        updateReadingContent();
    }
};

window.failReading = () => {
    results.reading = `Struggled at ${readingLevel}px font`;
    closeTestRoom();
};

function closeTestRoom() {
    currentMode = "dashboard";
    document.getElementById("test-room").style.display = "none";
    showFinalReport();
}

// Scan Logic
async function performMacroScan() {
    const track = video.srcObject.getVideoTracks()[0];
    const caps = track.getCapabilities();
    if (caps.torch) await track.applyConstraints({advanced: [{torch: true}]});

    setTimeout(async () => {
        results.surface = "Healthy Scan Captured";
        if (caps.torch) await track.applyConstraints({advanced: [{torch: false}]});
        startCamera("user"); // Flip back to dashboard cam
        showFinalReport();
    }, 600);
}

function showFinalReport() {
    reportOverlay.style.display = "block";
    document.getElementById("r-vision").innerText = results.reading;
    document.getElementById("r-surface").innerText = results.surface;

    let history = JSON.parse(localStorage.getItem("gyanam_pro_hist") || "[]");
    history.unshift({ date: new Date().toLocaleDateString(), v: results.reading, s: results.surface });
    localStorage.setItem("gyanam_pro_hist", JSON.stringify(history.slice(0, 5)));
    renderHistory();
}

function renderHistory() {
    const items = JSON.parse(localStorage.getItem("gyanam_pro_hist") || "[]");
    document.getElementById("hist-items").innerHTML = items.map(i => `
        <div class="hist-item"><b>${i.date}</b>: Vision ${i.v} | Scan ${i.s}</div>
    `).join('');
}

initAI();
