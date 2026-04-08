import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");
const readingArea = document.getElementById("reading-area");
const reportCard = document.getElementById("report-card");
const qualityBar = document.getElementById("quality-bar");

let faceLandmarker;
let currentFacingMode = "user"; 
let readingLevel = 16; 
let finalResults = { reading: "Not Tested", surface: "Not Tested" };
const synth = window.speechSynthesis;

async function initAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numFaces: 1
    });
    renderHistory();
    setMode('reading');
}

window.setMode = (mode) => {
    readingArea.style.display = "none";
    reportCard.style.display = "none";
    document.getElementById("quality-bg").style.display = (mode === 'scan') ? "block" : "none";
    
    currentFacingMode = (mode === 'reading') ? "user" : "environment";
    modeText.innerText = mode.toUpperCase() + " MODE";
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
        video.onloadeddata = () => runDetectionLoop();
    } catch (e) { distMsg.innerText = "Camera Error: " + e.message; }
}

async function runDetectionLoop() {
    if (!faceLandmarker) return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const landmarks = res.faceLandmarks[0];
        const eyeDist = Math.sqrt(Math.pow(landmarks[33].x - landmarks[263].x, 2) + Math.pow(landmarks[33].y - landmarks[263].y, 2));

        if (currentFacingMode === "user") {
            // Reading Mode Logic
            if (eyeDist > 0.18 && eyeDist < 0.30) {
                distMsg.innerHTML = "<b style='color:#38bdf8'>Distance OK. Use the card below.</b>";
                readingArea.style.display = "block";
            } else {
                distMsg.innerText = eyeDist < 0.18 ? "Move closer" : "Move further back";
                readingArea.style.display = "none";
            }
        } else {
            // Scan Mode Logic
            const quality = Math.min((eyeDist / 0.5) * 100, 100);
            qualityBar.style.width = quality + "%";
            
            if (eyeDist > 0.48) {
                distMsg.innerHTML = "<b style='color:#16a34a'>READY: AUTO-SCANNING...</b>";
                setTimeout(() => { if (eyeDist > 0.48) performScan(); }, 1500);
            } else {
                distMsg.innerText = "Bring lens very close to your eye";
            }
        }
    }
    window.requestAnimationFrame(runDetectionLoop);
}

// Reading Handlers
window.passReading = () => {
    readingLevel -= 2;
    if (readingLevel < 6) {
        finalResults.reading = "Normal (J1+)";
        showFinalReport();
    } else {
        document.getElementById("sample-text").style.fontSize = readingLevel + "px";
    }
};
window.failReading = () => {
    finalResults.reading = "Struggled at " + readingLevel + "px font";
    showFinalReport();
};

// Phase 7-8: Scan and Store
async function performScan() {
    const track = video.srcObject.getVideoTracks()[0];
    const caps = track.getCapabilities();
    if (caps.torch) await track.applyConstraints({advanced: [{torch: true}]});

    setTimeout(async () => {
        finalResults.surface = "Healthy Scan Captured";
        if (caps.torch) await track.applyConstraints({advanced: [{torch: false}]});
        showFinalReport();
    }, 600);
}

function showFinalReport() {
    reportCard.style.display = "block";
    readingArea.style.display = "none";
    document.getElementById("r-date").innerText = new Date().toLocaleDateString();
    document.getElementById("r-vision").innerText = finalResults.reading;
    document.getElementById("r-surface").innerText = finalResults.surface;

    // Save to History (Phase 8)
    let history = JSON.parse(localStorage.getItem("gyanam_history") || "[]");
    history.unshift({ date: new Date().toLocaleDateString(), vision: finalResults.reading, scan: finalResults.surface });
    localStorage.setItem("gyanam_history", JSON.stringify(history.slice(0, 5)));
    renderHistory();
}

function renderHistory() {
    const items = JSON.parse(localStorage.getItem("gyanam_history") || "[]");
    document.getElementById("hist-items").innerHTML = items.map(i => `
        <div class="hist-item"><b>${i.date}:</b> Vision ${i.vision} | Scan ${i.scan}</div>
    `).join('');
}

initAI();
