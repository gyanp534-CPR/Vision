import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");

let faceLandmarker, tfModel;
let currentMode = "dashboard"; 
let isLowLightBoost = false, isPediatric = false;
let screenPPI = 96, currentEyeDistPx = 0; 

let results = { pd: "Not Measured", reading: "Not Tested", astig: "Not Tested", periph: "Not Tested", contrast: "Not Tested", color: "Not Tested", amsler: "Not Tested", blinks: "Not Tested", fixation: "Not Tested", surface: "Not Tested" };

// --- Vault Init ---
let db;
const request = indexedDB.open("GyanamVault", 1);
request.onupgradeneeded = (e) => { db = e.target.result; db.createObjectStore("images", { autoIncrement: true }); };
request.onsuccess = (e) => { db = e.target.result; };
function saveToVault(dataUrl) { if(db) { const tx = db.transaction("images", "readwrite"); tx.objectStore("images").add({ date: new Date().toLocaleString(), img: dataUrl }); } }

// --- Speech Recognition Init ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
if (SpeechRecognition) {
    recognizer = new SpeechRecognition();
    recognizer.continuous = true;
    recognizer.lang = 'en-US';
    recognizer.onresult = (event) => {
        const transcript = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
        if (currentMode === "reading") {
            if (transcript.includes("clear") || transcript.includes("yes")) passReading();
            else if (transcript.includes("blurry") || transcript.includes("no") || transcript.includes("fail")) failReading();
        }
    };
}

// --- AI Init ---
async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1 });
        tfModel = await mobilenet.load();
        modeText.innerText = "SYSTEM READY"; distMsg.innerText = "Select a test to begin.";
        startCamera("user"); drawAmslerGrid();
    } catch (e) { distMsg.innerText = "AI failed to load."; console.error(e); }
}

async function startCamera(mode) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: mode, width: 720, height: 720 } });
    video.srcObject = stream;
    ["1", "2", "3"].forEach(id => { const el = document.getElementById(`mini-video-${id}`); if(el) el.srcObject = stream; });
    video.onloadeddata = () => { if (mode === "user") runAILoop(); };
}

// --- Calibration ---
window.adjustCalibration = (val) => { document.getElementById("calib-card").style.width = val + "px"; };
window.saveCalibration = () => { screenPPI = document.getElementById("calib-slider").value / 3.37; document.getElementById("calibration-overlay").style.display = "none"; };

// --- Navigation ---
window.closeRooms = () => {
    document.querySelectorAll(".fullscreen-room").forEach(r => r.style.display = "none");
    document.getElementById("dashboard").style.display = "flex";
    currentMode = "dashboard"; startCamera("user");
    if(recognizer) recognizer.stop();
};
function hideDashboard() { document.getElementById("dashboard").style.display = "none"; }

// --- Auto-PD ---
window.measurePD = () => {
    if (currentEyeDistPx === 0) { alert("Please align your face in the camera first."); return; }
    const pdMM = ((currentEyeDistPx / screenPPI) * 25.4 * 1.2).toFixed(1); 
    results.pd = `${pdMM} mm`; document.getElementById("pd-display").style.display = "block"; document.getElementById("pd-value").innerText = pdMM; showReport();
};

// --- 1. Acuity Test (With Voice) ---
let readingLevelPx = 40;
const textsAdult = ["Vision is a window to the world.", "The quick brown fox jumps.", "Small text helps test sharpness."];
const textsKid = ["🍎 🏠 🍎", "⏹ ⏺ ⏹", "🏠 🍎 ⏺"]; 
window.togglePediatric = () => { isPediatric = document.getElementById("pediatric-toggle").checked; };
window.openReadingRoom = () => { 
    hideDashboard(); document.getElementById("reading-room").style.display = "flex"; currentMode = "reading"; 
    readingLevelPx = (0.5 * screenPPI) / 25.4 * 6; updateReadingUI(); 
    if(recognizer) { recognizer.start(); document.getElementById("voice-status").style.display = "block"; }
};
function updateReadingUI() { const txt = isPediatric ? textsKid : textsAdult; document.getElementById("room-text").innerText = txt[Math.floor(Math.random() * txt.length)]; document.getElementById("room-text").style.fontSize = readingLevelPx + "px"; }
window.passReading = () => { readingLevelPx *= 0.75; const targetPx = (0.5 * screenPPI) / 25.4; if (readingLevelPx <= targetPx * 1.2) { results.reading = "Normal Acuity (J1+)"; closeRooms(); showReport(); } else updateReadingUI(); };
window.failReading = () => { results.reading = `Struggled at physical scale`; closeRooms(); showReport(); };

// --- 2. Astigmatism Test (New) ---
window.openAstigRoom = () => { hideDashboard(); document.getElementById("astig-room").style.display = "flex"; currentMode = "astig"; };
window.submitAstig = (hasDefect) => { results.astig = hasDefect ? "Irregularity Detected (Consult Optometrist)" : "Normal Cornea Shape"; closeRooms(); showReport(); };

// --- 3. Peripheral / Glaucoma Test (New) ---
let periphInterval, periphCount = 0, periphHits = 0, flashActive = false;
window.openPeripheralRoom = () => { hideDashboard(); document.getElementById("peripheral-room").style.display = "flex"; currentMode = "peripheral"; document.getElementById("start-periph-btn").style.display = "block"; periphCount = 0; periphHits = 0; };
window.startPeripheralTest = (e) => {
    e.stopPropagation(); document.getElementById("start-periph-btn").style.display = "none";
    const quadrants = [ {t: '10%', l: '10%'}, {t: '10%', l: '85%'}, {t: '85%', l: '10%'}, {t: '85%', l: '85%'} ];
    const dot = document.getElementById("flash-dot");
    
    function nextFlash() {
        if(periphCount >= 4) { results.periph = periphHits === 4 ? "Full Visual Field" : `Deficit Detected (${periphHits}/4 targets seen)`; closeRooms(); showReport(); return; }
        const delay = Math.random() * 1500 + 1000;
        setTimeout(() => {
            const pos = quadrants[periphCount]; dot.style.top = pos.t; dot.style.left = pos.l; dot.style.display = "block"; flashActive = true;
            setTimeout(() => { dot.style.display = "none"; flashActive = false; periphCount++; nextFlash(); }, 600); // 600ms reaction window
        }, delay);
    }
    nextFlash();
};
window.registerPeripheralClick = () => { if(flashActive) { periphHits++; flashActive = false; document.getElementById("flash-dot").style.display = "none"; } };

// --- Retained Rooms (Contrast, Amsler, Color, Blinks, Fixation, Scan) ---
let contrastLvl = 1.0; window.openContrastRoom = () => { hideDashboard(); document.getElementById("contrast-room").style.display = "flex"; currentMode = "contrast"; contrastLvl = 1.0; document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; };
window.passContrast = () => { contrastLvl -= 0.2; if(contrastLvl <= 0.1) { results.contrast = "Excellent Sensitivity"; closeRooms(); showReport(); } else { document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; } };
window.failContrast = () => { results.contrast = contrastLvl > 0.6 ? "Poor Sensitivity (Possible Cataract)" : "Average Sensitivity"; closeRooms(); showReport(); };

let amslerDefects = 0; function drawAmslerGrid() { const ctx = document.getElementById("amsler-canvas").getContext("2d"); ctx.clearRect(0,0,300,300); ctx.strokeStyle = "#333"; ctx.lineWidth = 1; for(let i=0; i<=300; i+=15) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke(); } }
window.openAmslerRoom = () => { hideDashboard(); document.getElementById("amsler-room").style.display = "flex"; currentMode = "amsler"; amslerDefects = 0; drawAmslerGrid(); };
window.markAmslerDefect = (e) => { const rect = e.target.getBoundingClientRect(); const x = e.clientX - rect.left, y = e.clientY - rect.top; const ctx = document.getElementById("amsler-canvas").getContext("2d"); ctx.fillStyle = "rgba(239, 68, 68, 0.5)"; ctx.beginPath(); ctx.arc(x, y, 15, 0, Math.PI*2); ctx.fill(); amslerDefects++; };
window.submitAmsler = (hasDefects) => { results.amsler = (hasDefects && amslerDefects > 0) ? "Distortion Mapped - Consult Specialist" : "Normal Macula"; closeRooms(); showReport(); };

window.openColorRoom = () => { hideDashboard(); document.getElementById("color-room").style.display = "flex"; currentMode = "color"; };
window.checkColor = (num) => { results.color = (num === 9) ? "Normal (Passed)" : "Deficiency Detected"; closeRooms(); showReport(); };

let blinkCount = 0, isBlinking = false, blinkInterval; window.openBlinkRoom = () => { hideDashboard(); document.getElementById("blink-room").style.display = "flex"; currentMode = "blink"; document.getElementById("start-blink-btn").style.display = "block"; document.getElementById("blink-timer").innerText = "15s"; };
window.startBlinkTest = () => { blinkCount = 0; let t = 15; document.getElementById("start-blink-btn").style.display = "none"; blinkInterval = setInterval(() => { t--; document.getElementById("blink-timer").innerText = t + "s"; if (t <= 0) { clearInterval(blinkInterval); let bpm = blinkCount * 4; results.blinks = bpm < 12 ? `Low (${bpm} BPM)` : `Normal (${bpm} BPM)`; closeRooms(); showReport(); } }, 1000); };

let fixInterval, fixDeviations = 0; window.openFixationRoom = () => { hideDashboard(); document.getElementById("fixation-room").style.display = "flex"; currentMode = "fixation"; };
window.startFixationTest = () => { document.getElementById("start-fix-btn").style.display = "none"; fixDeviations = 0; let moves = 0; const dot = document.getElementById("target-dot"); const positions = [{t:'10%',l:'10%'},{t:'10%',l:'80%'},{t:'80%',l:'80%'},{t:'80%',l:'10%'},{t:'50%',l:'50%'}]; fixInterval = setInterval(() => { if(moves >= positions.length) { clearInterval(fixInterval); results.fixation = fixDeviations > 2 ? "Asymmetry Detected" : "Normal Sync"; closeRooms(); showReport(); return; } dot.style.top = positions[moves].t; dot.style.left = positions[moves].l; moves++; }, 2000); };

window.openVaultRoom = () => { hideDashboard(); document.getElementById("vault-room").style.display = "flex"; currentMode = "vault"; const gallery = document.getElementById("gallery"); gallery.innerHTML = "Loading..."; if(!db) return; const tx = db.transaction("images", "readonly"); const request = tx.objectStore("images").getAll(); request.onsuccess = () => { if(request.result.length === 0) { gallery.innerHTML = "<p>No images saved.</p>"; return; } gallery.innerHTML = request.result.map(img => `<div class="vault-img-card"><p style="margin:0 0 5px 0; font-size:12px;">${img.date}</p><img src="${img.img}"></div>`).reverse().join(""); }; };
window.clearVault = () => { if(confirm("Delete images?")) { db.transaction("images", "readwrite").objectStore("images").clear(); openVaultRoom(); } };

window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Running Neural Scan...</b>"; await startCamera("environment");
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0]; const caps = track.getCapabilities();
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
        setTimeout(async () => {
            const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            canvas.getContext("2d").drawImage(video, 0, 0); saveToVault(canvas.toDataURL("image/jpeg", 0.9));
            if (tfModel) { const pred = await tfModel.classify(canvas); const top = pred[0].className.toLowerCase(); results.surface = (top.includes("spot") || top.includes("bubble")) ? "AI Warning: Potential Opacity" : "Clear Pattern"; } else { results.surface = "Captured to Vault"; }
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            startCamera("user"); showReport();
        }, 800);
    }, 2000);
};

// --- Tracking Loop ---
async function runAILoop() {
    if (!faceLandmarker || ["dashboard", "color", "contrast", "amsler", "vault", "astig", "peripheral"].includes(currentMode)) return;
    const res = await faceLandmarker.detectForVideo(video, performance.now());
    if (res.faceLandmarks.length > 0) {
        const lm = res.faceLandmarks[0];
        currentEyeDistPx = Math.abs(lm[468].x - lm[473].x) * video.videoWidth;
        if (currentMode === "reading") {
            const eyeDist = Math.sqrt(Math.pow(lm[33].x - lm[263].x, 2) + Math.pow(lm[33].y - lm[263].y, 2));
            const msg = (eyeDist > 0.18 && eyeDist < 0.28) ? "DISTANCE PERFECT" : "ADJUST DISTANCE";
            document.getElementById("room-dist-msg").innerText = msg; document.getElementById("room-dist-msg").style.color = (msg === "DISTANCE PERFECT") ? "#10b981" : "#ef4444";
        }
        if (currentMode === "blink" && blinkInterval) { const ear = Math.abs(lm[159].y - lm[145].y); if (ear < 0.012 && !isBlinking) { blinkCount++; isBlinking = true; document.getElementById("blink-count-ui").innerText = blinkCount; } else if (ear > 0.015) { isBlinking = false; } }
        if (currentMode === "fixation") { const leftGap = Math.abs(lm[468].x - lm[33].x); const rightGap = Math.abs(lm[473].x - lm[263].x); if (Math.abs(leftGap - rightGap) > 0.02) fixDeviations++; }
    }
    window.requestAnimationFrame(runAILoop);
}

window.toggleLowLight = () => { isLowLightBoost = !isLowLightBoost; const btn = document.getElementById("lowlight-btn"); if (isLowLightBoost) { btn.style.background = "#8b5cf6"; video.classList.add("low-light-boost"); } else { btn.style.background = "#4b5563"; video.classList.remove("low-light-boost"); } };

function showReport() {
    document.getElementById("report-overlay").style.display = "block";
    ["pd", "vision", "astig", "contrast", "color", "periph", "amsler", "blinks", "fixation", "surface"].forEach(id => { document.getElementById(`r-${id}`).innerText = results[id]; });
    window.scrollTo(0, document.body.scrollHeight);
}

// --- Telemedicine Export (PDF & WhatsApp) ---
window.exportPDF = () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(20); doc.text("Gyanam AI - Clinical Report", 20, 20); doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30); doc.line(20, 35, 190, 35);
    let y = 50; Object.keys(results).forEach(key => { doc.text(`${key.toUpperCase()}: ${results[key]}`, 20, y); y += 10; });
    doc.setFontSize(10); doc.setTextColor(150); doc.text("Note: AI screening only. Exported from Gyanam Vision Pro.", 20, 160); doc.save("Gyanam_Complete_Report.pdf");
};

window.shareWhatsApp = () => {
    let msg = `*Gyanam Vision AI - Clinical Report*\n_Date: ${new Date().toLocaleDateString()}_\n\n`;
    msg += `📏 PD: ${results.pd}\n📖 Acuity: ${results.reading}\n☀️ Astigmatism: ${results.astig}\n🌗 Contrast: ${results.contrast}\n`;
    msg += `🎨 Color: ${results.color}\n🌌 Peripheral: ${results.periph}\n🕸️ Macular: ${results.amsler}\n🎯 Strabismus: ${results.fixation}\n`;
    msg += `👁️ Strain: ${results.blinks}\n📸 Pathology: ${results.surface}\n\n_Note: AI-assisted screening, consult a specialist._`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

initAI();
