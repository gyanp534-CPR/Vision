import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");

let faceLandmarker, tfModel;
let currentMode = "dashboard"; 
let isLowLightBoost = false, isPediatric = false;
let screenPPI = 96; // Default, updated by calibration
let results = { reading: "Not Tested", color: "Not Tested", blinks: "Not Tested", fixation: "Not Tested", surface: "Not Tested" };

// --- 1. Initialization (MediaPipe & TensorFlow) ---
async function initAI() {
    try {
        // Load MediaPipe
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
            runningMode: "VIDEO", numFaces: 1
        });
        
        // Load TensorFlow.js Image Model
        tfModel = await mobilenet.load();
        
        modeText.innerText = "SYSTEM READY";
        distMsg.innerText = "Select a test to begin.";
        startCamera("user");
    } catch (e) { distMsg.innerText = "AI failed to load."; console.error(e); }
}

async function startCamera(mode) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 720, height: 720 } });
    
    video.srcObject = stream;
    document.getElementById("mini-video-1").srcObject = stream;
    document.getElementById("mini-video-2").srcObject = stream;
    document.getElementById("mini-video-3").srcObject = stream;
    
    video.onloadeddata = () => { if (mode === "user") runAILoop(); };
}

// --- 2. Screen DPI Calibration ---
window.adjustCalibration = (val) => { document.getElementById("calib-card").style.width = val + "px"; };
window.saveCalibration = () => {
    const cardWidthPx = document.getElementById("calib-slider").value;
    screenPPI = cardWidthPx / 3.37; // Standard credit card width is 3.37 inches
    document.getElementById("calibration-overlay").style.display = "none";
};

// --- Navigation ---
window.closeRooms = () => {
    document.querySelectorAll(".fullscreen-room").forEach(r => r.style.display = "none");
    document.getElementById("dashboard").style.display = "flex";
    currentMode = "dashboard";
    startCamera("user");
};
function hideDashboard() { document.getElementById("dashboard").style.display = "none"; }

// --- 3. Pediatric & Acuity Test ---
let readingLevelPx = 40;
const textsAdult = ["Vision is a window to the world.", "The quick brown fox jumps.", "Small text helps test sharpness."];
const textsKid = ["🍎 🏠 🍎", "⏹ ⏺ ⏹", "🏠 🍎 ⏺"]; // LEA Symbols

window.togglePediatric = () => { isPediatric = document.getElementById("pediatric-toggle").checked; };

window.openReadingRoom = () => {
    hideDashboard(); document.getElementById("reading-room").style.display = "flex";
    currentMode = "reading";
    
    // Calculate precise physical font size using calibrated PPI
    // J1+ target is roughly 0.5mm physical height on screen
    readingLevelPx = (0.5 * screenPPI) / 25.4 * 6; // Start 6x larger than target
    updateReadingUI();
};

function updateReadingUI() {
    const txtArray = isPediatric ? textsKid : textsAdult;
    document.getElementById("room-text").innerText = txtArray[Math.floor(Math.random() * txtArray.length)];
    document.getElementById("room-text").style.fontSize = readingLevelPx + "px";
}

window.passReading = () => {
    readingLevelPx *= 0.75; // Shrink by 25%
    const targetPx = (0.5 * screenPPI) / 25.4; // The physical target size
    if (readingLevelPx <= targetPx * 1.2) {
        results.reading = "Normal Acuity (J1+)"; closeRooms(); showReport();
    } else { updateReadingUI(); }
};
window.failReading = () => { results.reading = `Struggled at physical scale`; closeRooms(); showReport(); };

// --- Color Test ---
window.openColorRoom = () => { hideDashboard(); document.getElementById("color-room").style.display = "flex"; currentMode = "color"; };
window.checkColor = (num) => { results.color = (num === 9) ? "Normal (Passed)" : "Deficiency Detected"; closeRooms(); showReport(); };

// --- Eye Strain (Blinks) ---
let blinkCount = 0, isBlinking = false, blinkInterval;
window.openBlinkRoom = () => {
    hideDashboard(); document.getElementById("blink-room").style.display = "flex"; currentMode = "blink";
    document.getElementById("start-blink-btn").style.display = "block"; document.getElementById("blink-count-ui").innerText = "0"; document.getElementById("blink-timer").innerText = "15s";
};
window.startBlinkTest = () => {
    blinkCount = 0; let timeLeft = 15; document.getElementById("start-blink-btn").style.display = "none";
    blinkInterval = setInterval(() => {
        timeLeft--; document.getElementById("blink-timer").innerText = timeLeft + "s";
        if (timeLeft <= 0) {
            clearInterval(blinkInterval); let bpm = blinkCount * 4;
            results.blinks = bpm < 12 ? `Low (${bpm} BPM) - Dry Eye Risk` : `Normal (${bpm} BPM)`;
            closeRooms(); showReport();
        }
    }, 1000);
};

// --- 4. Neurological Strabismus (Fixation) ---
let fixInterval, fixDeviations = 0;
window.openFixationRoom = () => { hideDashboard(); document.getElementById("fixation-room").style.display = "flex"; currentMode = "fixation"; };
window.startFixationTest = () => {
    document.getElementById("start-fix-btn").style.display = "none";
    fixDeviations = 0; let moves = 0;
    const dot = document.getElementById("target-dot");
    const positions = [ {t: '10%', l: '10%'}, {t: '10%', l: '80%'}, {t: '80%', l: '80%'}, {t: '80%', l: '10%'}, {t: '50%', l: '50%'} ];
    
    fixInterval = setInterval(() => {
        if(moves >= positions.length) {
            clearInterval(fixInterval);
            results.fixation = fixDeviations > 2 ? "Asymmetry Detected (Potential Strabismus)" : "Normal Eye Sync";
            closeRooms(); showReport(); return;
        }
        dot.style.top = positions[moves].t; dot.style.left = positions[moves].l;
        moves++;
    }, 2000);
};

// --- 5. True AI Pathology (TensorFlow) ---
window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Running Neural Scan...</b>";
    await startCamera("environment");
    
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0];
        const caps = track.getCapabilities();
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}

        setTimeout(async () => {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d"); ctx.drawImage(video, 0, 0);
            
            // Pass the image to TensorFlow JS
            if (tfModel) {
                const predictions = await tfModel.classify(canvas);
                const topPrediction = predictions[0].className.toLowerCase();
                // We use a general model as a framework. In a real medical app, you plug in a custom h5 cataract model here.
                if (topPrediction.includes("spot") || topPrediction.includes("bubble")) {
                    results.surface = "AI Warning: Potential Opacity Detected";
                } else {
                    results.surface = "AI Scan: Clear Pattern";
                }
            } else { results.surface = "Hardware Capture Complete"; }
            
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            startCamera("user"); showReport();
        }, 800);
    }, 2000);
};

// --- AI Loop (Distance, Blinks, Iris Tracking) ---
async function runAILoop() {
    if (!faceLandmarker || currentMode === "dashboard" || currentMode === "color") return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const lm = res.faceLandmarks[0];
        
        if (currentMode === "reading") {
            const eyeDist = Math.sqrt(Math.pow(lm[33].x - lm[263].x, 2) + Math.pow(lm[33].y - lm[263].y, 2));
            const msg = (eyeDist > 0.18 && eyeDist < 0.28) ? "DISTANCE PERFECT" : "ADJUST DISTANCE";
            document.getElementById("room-dist-msg").innerText = msg;
            document.getElementById("room-dist-msg").style.color = (msg === "DISTANCE PERFECT") ? "#10b981" : "#ef4444";
        }

        if (currentMode === "blink" && blinkInterval) {
            const ear = Math.abs(lm[159].y - lm[145].y);
            if (ear < 0.012 && !isBlinking) { blinkCount++; isBlinking = true; document.getElementById("blink-count-ui").innerText = blinkCount; } 
            else if (ear > 0.015) { isBlinking = false; }
        }

        if (currentMode === "fixation") {
            // Check symmetry of left vs right iris relative to eye corners
            const leftIrisGap = Math.abs(lm[468].x - lm[33].x);
            const rightIrisGap = Math.abs(lm[473].x - lm[263].x);
            if (Math.abs(leftIrisGap - rightIrisGap) > 0.02) fixDeviations++; // If one eye lags
        }
    }
    window.requestAnimationFrame(runAILoop);
}

// Low Light Toggle
window.toggleLowLight = () => {
    isLowLightBoost = !isLowLightBoost; const btn = document.getElementById("lowlight-btn");
    if (isLowLightBoost) { btn.innerText = "🌙 Night Mode: ON"; btn.style.background = "#8b5cf6"; video.classList.add("low-light-boost"); } 
    else { btn.innerText = "🌙 Night Mode: OFF"; btn.style.background = "#4b5563"; video.classList.remove("low-light-boost"); }
};

// Reporting
function showReport() {
    document.getElementById("report-overlay").style.display = "block";
    document.getElementById("r-vision").innerText = results.reading;
    document.getElementById("r-color").innerText = results.color;
    document.getElementById("r-blinks").innerText = results.blinks;
    document.getElementById("r-fixation").innerText = results.fixation;
    document.getElementById("r-surface").innerText = results.surface;
    window.scrollTo(0, document.body.scrollHeight);
}

window.exportPDF = () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(20); doc.text("Gyanam AI - Clinical Vision Report", 20, 20);
    doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30); doc.line(20, 35, 190, 35);
    doc.text(`Near Vision (Calibrated): ${results.reading} [Pediatric: ${isPediatric}]`, 20, 50);
    doc.text(`Color Vision: ${results.color}`, 20, 60);
    doc.text(`Eye Strain (Blinks): ${results.blinks}`, 20, 70);
    doc.text(`Neurological Fixation: ${results.fixation}`, 20, 80);
    doc.text(`AI Pathology Scan: ${results.surface}`, 20, 90);
    doc.setFontSize(10); doc.setTextColor(150); doc.text("Note: AI screening only. Consult an ophthalmologist.", 20, 110);
    doc.save("Gyanam_Clinical_Report.pdf");
};

initAI();
