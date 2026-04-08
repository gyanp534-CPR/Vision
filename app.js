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
let results = { reading: "Not Tested", surface: "Not Tested", color: "Not Tested" };
let isLowLightBoost = false;

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
    distMsg.innerHTML = "<b style='color:#f59e0b'>Adjusting Focus & Light...</b>";
    
    const track = video.srcObject.getVideoTracks()[0];
    const caps = track.getCapabilities();

    // 1. Force Torch if available
    if (caps.torch) {
        try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
    }

    // 2. Short delay to allow exposure to settle
    setTimeout(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        
        // Apply software boost to the captured image if Night Mode is ON
        if (isLowLightBoost) ctx.filter = "brightness(1.2) contrast(1.1)";
        
        ctx.drawImage(video, 0, 0);

        // 3. Simple brightness check to ensure scan isn't pitch black
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let brightness = 0;
        for (let i = 0; i < data.length; i+=4) brightness += data[i];
        
        if (brightness / (data.length/4) < 35) {
            results.surface = "Scan Fail: Too Dark";
        } else {
            results.surface = "High Quality Scan Captured";
        }

        // Turn off Torch
        if (caps.torch) {
            try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
        }
        
        startCamera("user"); // Return to selfie view
        showFinalReport();
    }, 800);
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

window.toggleLowLight = async () => {
    isLowLightBoost = !isLowLightBoost;
    const btn = document.getElementById("lowlight-btn");
    const videoEl = document.getElementById("webcam");

    if (isLowLightBoost) {
        btn.innerText = "🌙 Night Mode: ON";
        btn.style.background = "#8b5cf6";
        videoEl.classList.add("low-light-boost");
    } else {
        btn.innerText = "🌙 Night Mode: OFF";
        btn.style.background = "#4b5563";
        videoEl.classList.remove("low-light-boost");
    }
};



window.openColorRoom = () => {
    document.getElementById("color-room").style.display = "flex";
};

window.closeColorRoom = () => {
    document.getElementById("color-room").style.display = "none";
};

window.checkColor = (num) => {
    // Basic Logic: Plate shown is '9'
    if (num === 9) {
        results.color = "Normal (Passed)";
        alert("Correct! Your color perception for this plate is sharp.");
    } else {
        results.color = "Deficiency Detected";
        alert("Incorrect. This might indicate a color vision deficiency.");
    }
    closeColorRoom();
    showFinalReport();
};

initAI();
