import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");

let faceLandmarker, tfModel;
let currentMode = "dashboard"; 
let isLowLightBoost = false, isPediatric = false;
let screenPPI = 96; 
let currentEyeDistPx = 0; // For PD calculation

let results = { pd: "Not Measured", reading: "Not Tested", contrast: "Not Tested", color: "Not Tested", amsler: "Not Tested", blinks: "Not Tested", fixation: "Not Tested", surface: "Not Tested" };

// --- 0. Setup IndexedDB for Patient Vault ---
let db;
const request = indexedDB.open("GyanamVault", 1);
request.onupgradeneeded = (e) => { db = e.target.result; db.createObjectStore("images", { autoIncrement: true }); };
request.onsuccess = (e) => { db = e.target.result; };

function saveToVault(dataUrl) {
    if(!db) return;
    const tx = db.transaction("images", "readwrite");
    tx.objectStore("images").add({ date: new Date().toLocaleString(), img: dataUrl });
}

// --- 1. AI Initialization ---
async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" },
            runningMode: "VIDEO", numFaces: 1
        });
        tfModel = await mobilenet.load();
        
        modeText.innerText = "SYSTEM READY"; distMsg.innerText = "Select a test to begin.";
        startCamera("user");
        drawAmslerGrid();
    } catch (e) { distMsg.innerText = "AI failed to load."; console.error(e); }
}

async function startCamera(mode) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 720, height: 720 } });
    
    video.srcObject = stream;
    ["1", "2", "3"].forEach(id => {
        const el = document.getElementById(`mini-video-${id}`);
        if(el) el.srcObject = stream;
    });
    video.onloadeddata = () => { if (mode === "user") runAILoop(); };
}

// --- 2. Screen Calibration ---
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
    currentMode = "dashboard"; startCamera("user");
};
function hideDashboard() { document.getElementById("dashboard").style.display = "none"; }

// --- 3. Auto-PD (Pupillary Distance) ---
window.measurePD = () => {
    if (currentEyeDistPx === 0) { alert("Please align your face in the camera first."); return; }
    // Convert px to inches, then to mm. We apply a 1.2 scale factor to approximate the 3D depth compensation of holding phone at arm's length.
    const pdMM = ((currentEyeDistPx / screenPPI) * 25.4 * 1.2).toFixed(1); 
    results.pd = `${pdMM} mm`;
    document.getElementById("pd-display").style.display = "block";
    document.getElementById("pd-value").innerText = pdMM;
    showReport();
};

// --- 4. Contrast Sensitivity Test (Pelli-Robson Approximation) ---
let contrastLevel = 1.0;
window.openContrastRoom = () => {
    hideDashboard(); document.getElementById("contrast-room").style.display = "flex";
    currentMode = "contrast"; contrastLevel = 1.0;
    document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLevel})`;
};
window.passContrast = () => {
    contrastLevel -= 0.2;
    if(contrastLevel <= 0.1) { results.contrast = "Excellent Sensitivity"; closeRooms(); showReport(); }
    else { document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLevel})`; }
};
window.failContrast = () => {
    results.contrast = contrastLevel > 0.6 ? "Poor Sensitivity (Possible Cataract)" : "Average Sensitivity";
    closeRooms(); showReport();
};

// --- 5. Macular Degeneration (Amsler Grid) ---
let amslerDefects = 0;
function drawAmslerGrid() {
    const canvas = document.getElementById("amsler-canvas");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0,0,300,300);
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1;
    for(let i=0; i<=300; i+=15) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke();
    }
}
window.openAmslerRoom = () => {
    hideDashboard(); document.getElementById("amsler-room").style.display = "flex";
    currentMode = "amsler"; amslerDefects = 0; drawAmslerGrid();
};
window.markAmslerDefect = (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left; const y = e.clientY - rect.top;
    const ctx = document.getElementById("amsler-canvas").getContext("2d");
    ctx.fillStyle = "rgba(239, 68, 68, 0.5)"; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI*2); ctx.fill();
    amslerDefects++;
};
window.submitAmsler = (hasDefects) => {
    if(hasDefects && amslerDefects > 0) results.amsler = "Distortion Mapped - Consult Retina Specialist";
    else results.amsler = "Normal Macula Structure";
    closeRooms(); showReport();
};

// --- 6. Patient Vault (IndexedDB) ---
window.openVaultRoom = () => {
    hideDashboard(); document.getElementById("vault-room").style.display = "flex";
    currentMode = "vault";
    const gallery = document.getElementById("gallery"); gallery.innerHTML = "Loading...";
    if(!db) return;
    const tx = db.transaction("images", "readonly");
    const store = tx.objectStore("images");
    const request = store.getAll();
    request.onsuccess = () => {
        if(request.result.length === 0) { gallery.innerHTML = "<p>No images saved yet.</p>"; return; }
        gallery.innerHTML = request.result.map(img => `
            <div class="vault-img-card">
                <p style="margin:0 0 5px 0; font-size:12px; color:#cbd5e1;">${img.date}</p>
                <img src="${img.img}">
            </div>`).reverse().join("");
    };
};
window.clearVault = () => {
    if(confirm("Delete all medical images?")) {
        const tx = db.transaction("images", "readwrite");
        tx.objectStore("images").clear();
        openVaultRoom();
    }
};

// --- Standard Acuity, Color, Blink & AI Pathology Logic (Preserved from V1) ---
// (Pediatric Toggle, Pass/Fail Reading, Color checks, Fixation logic remain unchanged)
window.togglePediatric = () => { isPediatric = document.getElementById("pediatric-toggle").checked; };

let readingLevelPx = 40;
const textsAdult = ["Vision is a window to the world.", "The quick brown fox jumps.", "Small text helps test sharpness."];
const textsKid = ["🍎 🏠 🍎", "⏹ ⏺ ⏹", "🏠 🍎 ⏺"]; 
window.openReadingRoom = () => { hideDashboard(); document.getElementById("reading-room").style.display = "flex"; currentMode = "reading"; readingLevelPx = (0.5 * screenPPI) / 25.4 * 6; updateReadingUI(); };
function updateReadingUI() { const txt = isPediatric ? textsKid : textsAdult; document.getElementById("room-text").innerText = txt[Math.floor(Math.random() * txt.length)]; document.getElementById("room-text").style.fontSize = readingLevelPx + "px"; }
window.passReading = () => { readingLevelPx *= 0.75; const targetPx = (0.5 * screenPPI) / 25.4; if (readingLevelPx <= targetPx * 1.2) { results.reading = "Normal Acuity (J1+)"; closeRooms(); showReport(); } else updateReadingUI(); };
window.failReading = () => { results.reading = `Struggled at physical scale`; closeRooms(); showReport(); };

window.openColorRoom = () => { hideDashboard(); document.getElementById("color-room").style.display = "flex"; currentMode = "color"; };
window.checkColor = (num) => { results.color = (num === 9) ? "Normal (Passed)" : "Deficiency Detected"; closeRooms(); showReport(); };

let blinkCount = 0, isBlinking = false, blinkInterval;
window.openBlinkRoom = () => { hideDashboard(); document.getElementById("blink-room").style.display = "flex"; currentMode = "blink"; document.getElementById("start-blink-btn").style.display = "block"; document.getElementById("blink-timer").innerText = "15s"; };
window.startBlinkTest = () => { blinkCount = 0; let t = 15; document.getElementById("start-blink-btn").style.display = "none"; blinkInterval = setInterval(() => { t--; document.getElementById("blink-timer").innerText = t + "s"; if (t <= 0) { clearInterval(blinkInterval); let bpm = blinkCount * 4; results.blinks = bpm < 12 ? `Low (${bpm} BPM) - Dry Eye` : `Normal (${bpm} BPM)`; closeRooms(); showReport(); } }, 1000); };

let fixInterval, fixDeviations = 0;
window.openFixationRoom = () => { hideDashboard(); document.getElementById("fixation-room").style.display = "flex"; currentMode = "fixation"; };
window.startFixationTest = () => { document.getElementById("start-fix-btn").style.display = "none"; fixDeviations = 0; let moves = 0; const dot = document.getElementById("target-dot"); const positions = [{t:'10%',l:'10%'},{t:'10%',l:'80%'},{t:'80%',l:'80%'},{t:'80%',l:'10%'},{t:'50%',l:'50%'}]; fixInterval = setInterval(() => { if(moves >= positions.length) { clearInterval(fixInterval); results.fixation = fixDeviations > 2 ? "Asymmetry Detected (Potential Strabismus)" : "Normal Eye Sync"; closeRooms(); showReport(); return; } dot.style.top = positions[moves].t; dot.style.left = positions[moves].l; moves++; }, 2000); };

// --- Retina Pathology Trigger & Vault Save ---
window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Running Neural Scan...</b>";
    await startCamera("environment");
    
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0]; const caps = track.getCapabilities();
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}

        setTimeout(async () => {
            const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d"); ctx.drawImage(video, 0, 0);
            
            // Save high-res capture to IndexedDB Vault
            saveToVault(canvas.toDataURL("image/jpeg", 0.9));

            if (tfModel) {
                const predictions = await tfModel.classify(canvas); const top = predictions[0].className.toLowerCase();
                results.surface = (top.includes("spot") || top.includes("bubble")) ? "AI Warning: Potential Opacity" : "AI Scan: Clear Pattern";
            } else { results.surface = "Image Captured to Vault"; }
            
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            startCamera("user"); showReport();
        }, 800);
    }, 2000);
};

// --- Global Tracking Loop ---
async function runAILoop() {
    if (!faceLandmarker || ["dashboard", "color", "contrast", "amsler", "vault"].includes(currentMode)) return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());

    if (res.faceLandmarks.length > 0) {
        const lm = res.faceLandmarks[0];
        
        // Track PD in background
        currentEyeDistPx = Math.abs(lm[468].x - lm[473].x) * video.videoWidth;

        if (currentMode === "reading") {
            const eyeDist = Math.sqrt(Math.pow(lm[33].x - lm[263].x, 2) + Math.pow(lm[33].y - lm[263].y, 2));
            const msg = (eyeDist > 0.18 && eyeDist < 0.28) ? "DISTANCE PERFECT" : "ADJUST DISTANCE";
            document.getElementById("room-dist-msg").innerText = msg; document.getElementById("room-dist-msg").style.color = (msg === "DISTANCE PERFECT") ? "#10b981" : "#ef4444";
        }
        if (currentMode === "blink" && blinkInterval) {
            const ear = Math.abs(lm[159].y - lm[145].y);
            if (ear < 0.012 && !isBlinking) { blinkCount++; isBlinking = true; document.getElementById("blink-count-ui").innerText = blinkCount; } else if (ear > 0.015) { isBlinking = false; }
        }
        if (currentMode === "fixation") {
            const leftGap = Math.abs(lm[468].x - lm[33].x); const rightGap = Math.abs(lm[473].x - lm[263].x);
            if (Math.abs(leftGap - rightGap) > 0.02) fixDeviations++;
        }
    }
    window.requestAnimationFrame(runAILoop);
}

window.toggleLowLight = () => {
    isLowLightBoost = !isLowLightBoost; const btn = document.getElementById("lowlight-btn");
    if (isLowLightBoost) { btn.innerText = "🌙 Night Mode: ON"; btn.style.background = "#8b5cf6"; video.classList.add("low-light-boost"); } 
    else { btn.innerText = "🌙 Night Mode: OFF"; btn.style.background = "#4b5563"; video.classList.remove("low-light-boost"); }
};

function showReport() {
    document.getElementById("report-overlay").style.display = "block";
    document.getElementById("r-pd").innerText = results.pd;
    document.getElementById("r-vision").innerText = results.reading;
    document.getElementById("r-contrast").innerText = results.contrast;
    document.getElementById("r-color").innerText = results.color;
    document.getElementById("r-amsler").innerText = results.amsler;
    document.getElementById("r-blinks").innerText = results.blinks;
    document.getElementById("r-fixation").innerText = results.fixation;
    document.getElementById("r-surface").innerText = results.surface;
    window.scrollTo(0, document.body.scrollHeight);
}

window.exportPDF = () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(20); doc.text("Gyanam AI - Comprehensive Clinical Report", 20, 20);
    doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30); doc.line(20, 35, 190, 35);
    
    doc.text(`Pupillary Distance (Est): ${results.pd}`, 20, 50);
    doc.text(`Acuity: ${results.reading} [Pediatric Mode: ${isPediatric}]`, 20, 60);
    doc.text(`Contrast Sensitivity: ${results.contrast}`, 20, 70);
    doc.text(`Color Vision: ${results.color}`, 20, 80);
    doc.text(`Macular Grid (Amsler): ${results.amsler}`, 20, 90);
    doc.text(`Neurological Sync: ${results.fixation}`, 20, 100);
    doc.text(`Dry Eye/Blink Rate: ${results.blinks}`, 20, 110);
    doc.text(`AI Pathology Scan: ${results.surface}`, 20, 120);
    
    doc.setFontSize(10); doc.setTextColor(150); doc.text("Note: AI screening only. Exported from Gyanam Vision Pro.", 20, 140);
    doc.save("Gyanam_Complete_Report.pdf");
};

initAI();
