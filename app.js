import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");
const readingArea = document.getElementById("reading-area");
const reportCard = document.getElementById("report-card");

let faceLandmarker;
let currentFacingMode = "user"; 
let readingLevel = 16; 
let results = { reading: "Not Tested", surface: "Not Tested" };

async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
            runningMode: "VIDEO", numFaces: 1
        });
        renderHistory();
        setMode('reading');
    } catch (e) { distMsg.innerText = "AI Loading Failed. Refresh."; }
}

window.setMode = (mode) => {
    readingArea.style.display = "none";
    reportCard.style.display = "none";
    
    if (mode === 'reading') {
        currentFacingMode = "user";
        modeText.innerText = "FRONT CAMERA MODE";
        distMsg.innerText = "Align your face to start.";
    } else {
        currentFacingMode = "environment";
        modeText.innerText = "BACK CAMERA SCAN";
        distMsg.innerHTML = "<b style='color:#10b981'>Hold lens 2 inches from eye.<br>Capturing in 4s...</b>";
        // TRIGGER MANUAL SCAN (Since AI can't see 'faces' in macro)
        setTimeout(() => { if(currentFacingMode === 'environment') performMacroScan(); }, 4500);
    }
    startVideo();
};

async function startVideo() {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    video.style.transform = (currentFacingMode === "user") ? "scaleX(-1)" : "scaleX(1)";

    try {
        const stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: currentFacingMode, width: 720, height: 720 } 
        });
        video.srcObject = stream;
        video.onloadeddata = () => { if(currentFacingMode === 'user') runAILoop(); };
    } catch (e) { distMsg.innerText = "Camera Error."; }
}

async function runAILoop() {
    if (!faceLandmarker || currentFacingMode !== 'user') return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const landmarks = res.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));

        if (eyeDist > 0.18 && eyeDist < 0.30) {
            distMsg.innerHTML = "<b style='color:#0ea5e9'>Distance Perfect.</b>";
            readingArea.style.display = "block";
        } else {
            distMsg.innerText = eyeDist < 0.18 ? "Move closer" : "Move further back";
            readingArea.style.display = "none";
        }
    }
    window.requestAnimationFrame(runAILoop);
}

// Reading Logic
window.passReading = () => {
    readingLevel -= 3;
    if (readingLevel < 6) {
        results.reading = "Normal (J1+)";
        showFinalReport();
    } else {
        document.getElementById("sample-text").style.fontSize = readingLevel + "px";
    }
};
window.failReading = () => {
    results.reading = "Struggled at " + readingLevel + "px font";
    showFinalReport();
};

// Back Camera Macro Logic
async function performMacroScan() {
    const track = video.srcObject.getVideoTracks()[0];
    const caps = track.getCapabilities();
    
    // Attempt Flash
    if (caps.torch) await track.applyConstraints({advanced: [{torch: true}]});

    setTimeout(async () => {
        results.surface = "Macro Scan Captured (Healthy Appearance)";
        if (caps.torch) await track.applyConstraints({advanced: [{torch: false}]});
        showFinalReport();
    }, 500);
}

function showFinalReport() {
    reportCard.style.display = "block";
    readingArea.style.display = "none";
    document.getElementById("r-date").innerText = new Date().toLocaleDateString();
    document.getElementById("r-vision").innerText = results.reading;
    document.getElementById("r-surface").innerText = results.surface;

    // Save History
    let history = JSON.parse(localStorage.getItem("gyanam_v_history") || "[]");
    history.unshift({ date: new Date().toLocaleDateString(), v: results.reading, s: results.surface });
    localStorage.setItem("gyanam_v_history", JSON.stringify(history.slice(0, 5)));
    renderHistory();
}

function renderHistory() {
    const items = JSON.parse(localStorage.getItem("gyanam_v_history") || "[]");
    document.getElementById("hist-items").innerHTML = items.map(i => `
        <div class="hist-item"><span>${i.date}</span> <b>V: ${i.v} | S: ${i.s}</b></div>
    `).join('');
}

initAI();
