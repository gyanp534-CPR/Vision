import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");

let faceLandmarker;
let currentMode = "dashboard"; 
let isLowLightBoost = false;

// Global Results Object
let results = { reading: "Not Tested", color: "Not Tested", blinks: "Not Tested", surface: "Not Tested", reflex: "Not Tested" };

// Init AI
async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
            runningMode: "VIDEO", numFaces: 1
        });
        startCamera("user");
    } catch (e) { distMsg.innerText = "AI failed to load. Check internet."; }
}

async function startCamera(mode) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 720, height: 720 } });
    
    video.srcObject = stream;
    document.getElementById("mini-video-1").srcObject = stream;
    document.getElementById("mini-video-2").srcObject = stream;
    
    video.onloadeddata = () => { if (mode === "user") runAILoop(); };
}

// --- Navigation & Dashboard Control ---
window.closeRooms = () => {
    document.querySelectorAll(".fullscreen-room").forEach(r => r.style.display = "none");
    document.getElementById("dashboard").style.display = "flex";
    currentMode = "dashboard";
    startCamera("user");
};

function hideDashboard() {
    document.getElementById("dashboard").style.display = "none";
}

// --- 1. Acuity (Reading) Test ---
let readingLevel = 18;
const texts = ["Vision is a window to the world.", "The quick brown fox jumps over the lazy dog.", "Small text helps test retinal sharpness."];

window.openReadingRoom = () => {
    hideDashboard();
    document.getElementById("reading-room").style.display = "flex";
    currentMode = "reading";
    readingLevel = 18;
    document.getElementById("room-text").innerText = texts[0];
};

window.passReading = () => {
    readingLevel -= 4;
    if (readingLevel < 6) {
        results.reading = "Normal (J1+)";
        closeRooms(); showReport();
    } else {
        document.getElementById("room-text").innerText = texts[Math.floor(Math.random() * texts.length)];
        document.getElementById("room-text").style.fontSize = readingLevel + "px";
    }
};

window.failReading = () => {
    results.reading = `Struggled at ${readingLevel}px font`;
    closeRooms(); showReport();
};

// --- 2. Color Vision Test ---
window.openColorRoom = () => {
    hideDashboard();
    document.getElementById("color-room").style.display = "flex";
    currentMode = "color";
};

window.checkColor = (num) => {
    results.color = (num === 9) ? "Normal (Passed)" : "Deficiency Detected";
    closeRooms(); showReport();
};

// --- 3. Blink Tracker (Eye Strain) ---
let blinkCount = 0;
let isBlinking = false;
let blinkInterval;

window.openBlinkRoom = () => {
    hideDashboard();
    document.getElementById("blink-room").style.display = "flex";
    currentMode = "blink";
    document.getElementById("start-blink-btn").style.display = "block";
    document.getElementById("blink-count-ui").innerText = "0";
    document.getElementById("blink-timer").innerText = "15s";
};

window.startBlinkTest = () => {
    blinkCount = 0;
    let timeLeft = 15;
    document.getElementById("start-blink-btn").style.display = "none";
    
    blinkInterval = setInterval(() => {
        timeLeft--;
        document.getElementById("blink-timer").innerText = timeLeft + "s";
        if (timeLeft <= 0) {
            clearInterval(blinkInterval);
            let bpm = blinkCount * 4; // Extrapolate to 1 minute
            results.blinks = bpm < 12 ? `Low (${bpm} BPM) - Dry Eye Risk` : `Normal (${bpm} BPM)`;
            closeRooms(); showReport();
        }
    }, 1000);
};

// --- 4. Retina & Pupil Reflex ---
window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Processing Retina & Reflex...</b>";
    await startCamera("environment");
    
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0];
        const caps = track.getCapabilities();

        // Step 1: Pre-Flash Capture (Pupil is large)
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0);
        let preData = ctx.getImageData(0,0, canvas.width, canvas.height).data;
        let preBright = 0; for(let i=0; i<preData.length; i+=4) preBright += preData[i];

        // Step 2: Flash ON
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}

        // Step 3: Wait for pupil to react, then Post-Flash Capture
        setTimeout(async () => {
            ctx.drawImage(video, 0, 0);
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            
            let postData = ctx.getImageData(0,0, canvas.width, canvas.height).data;
            let postBright = 0; for(let i=0; i<postData.length; i+=4) postBright += postData[i];

            // Analyze
            let ratio = postBright / preBright;
            results.reflex = (ratio > 1.2) ? "Normal Light Reaction" : "Sluggish/No Reaction";
            results.surface = "Scan Completed";
            
            startCamera("user");
            showReport();
        }, 600);
    }, 2000); // Give user 2 seconds to position camera
};

// --- AI Tracking Loop (Distance & Blinks) ---
async function runAILoop() {
    if (!faceLandmarker || currentMode === "dashboard" || currentMode === "color") return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const lm = res.faceLandmarks[0];
        
        // Distance Logic for Reading Room
        if (currentMode === "reading") {
            const eyeDist = Math.sqrt(Math.pow(lm[33].x - lm[263].x, 2) + Math.pow(lm[33].y - lm[263].y, 2));
            const msg = (eyeDist > 0.18 && eyeDist < 0.28) ? "DISTANCE PERFECT" : "ADJUST DISTANCE";
            document.getElementById("room-dist-msg").innerText = msg;
            document.getElementById("room-dist-msg").style.color = (msg === "DISTANCE PERFECT") ? "#10b981" : "#ef4444";
        }

        // Blink Logic for Blink Room
        if (currentMode === "blink" && blinkInterval) {
            // Calculate Eye Aspect Ratio (EAR) for Right Eye (159 top, 145 bottom)
            const ear = Math.abs(lm[159].y - lm[145].y);
            if (ear < 0.012 && !isBlinking) {
                blinkCount++;
                isBlinking = true;
                document.getElementById("blink-count-ui").innerText = blinkCount;
            } else if (ear > 0.015) {
                isBlinking = false;
            }
        }
    }
    window.requestAnimationFrame(runAILoop);
}

// --- Low Light Toggle ---
window.toggleLowLight = () => {
    isLowLightBoost = !isLowLightBoost;
    const btn = document.getElementById("lowlight-btn");
    if (isLowLightBoost) {
        btn.innerText = "🌙 Night Mode: ON"; btn.style.background = "#8b5cf6";
        video.classList.add("low-light-boost");
    } else {
        btn.innerText = "🌙 Night Mode: OFF"; btn.style.background = "#4b5563";
        video.classList.remove("low-light-boost");
    }
};

// --- Reporting & PDF ---
function showReport() {
    document.getElementById("report-overlay").style.display = "block";
    document.getElementById("r-vision").innerText = results.reading;
    document.getElementById("r-color").innerText = results.color;
    document.getElementById("r-blinks").innerText = results.blinks;
    document.getElementById("r-surface").innerText = results.surface;
    document.getElementById("r-reflex").innerText = results.reflex;
    window.scrollTo(0, document.body.scrollHeight);
}

window.exportPDF = () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text("Gyanam AI - Clinical Vision Report", 20, 20);
    
    doc.setFontSize(12);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30);
    
    doc.line(20, 35, 190, 35);
    
    doc.text(`Near Vision Acuity: ${results.reading}`, 20, 50);
    doc.text(`Color Vision (Ishihara): ${results.color}`, 20, 60);
    doc.text(`Eye Strain (Blink Rate): ${results.blinks}`, 20, 70);
    doc.text(`Surface Scan: ${results.surface}`, 20, 80);
    doc.text(`Pupillary Light Reflex: ${results.reflex}`, 20, 90);
    
    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text("Note: This is an AI-assisted screening, not a medical diagnosis.", 20, 110);
    
    doc.save("Gyanam_Vision_Report.pdf");
};

initAI();
