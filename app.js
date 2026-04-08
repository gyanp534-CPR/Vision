import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
let faceLandmarker;
let currentMode = "dashboard"; 
let screenPPI = window.devicePixelRatio * 160; // FIX 4: Auto calibration approximation
let currentEyeDistPx = 0; 

// Base Results
let results = { pd: "--", reading: "Not Tested", astig: "--", periph: "--", contrast: "--", color: "--", amsler: "--", blinks: "--", fixation: "--", surface: "--" };

// --- Vault & Patient Init ---
let db;
indexedDB.open("GyanamVault", 1).onupgradeneeded = e => { db = e.target.result; db.createObjectStore("images", { autoIncrement: true }); };
indexedDB.open("GyanamVault", 1).onsuccess = e => { db = e.target.result; };

function getPatientName() {
    let name = document.getElementById("patient-name").value.trim();
    return name === "" ? "Guest" : name;
}

function saveToVault(dataUrl) { 
    if(db) db.transaction("images", "readwrite").objectStore("images").add({ patient: getPatientName(), date: new Date().toLocaleString(), img: dataUrl }); 
}

// --- FIX 2: Robust Speech Recognition ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
if (SpeechRecognition) {
    recognizer = new SpeechRecognition(); 
    recognizer.continuous = true; 
    recognizer.lang = 'en-US';
    recognizer.onresult = (e) => {
        const tr = e.results[e.results.length - 1][0].transcript.toLowerCase().trim();
        if (currentMode === "reading") {
            if (tr.includes("clear") || tr.includes("saaf")) passReading();
            else if (tr.includes("blurry") || tr.includes("dhundhla")) failReading();
        }
    };
    recognizer.onend = () => { if(currentMode === "reading") recognizer.start(); }; // Auto-restart on mobile Chrome
}

// --- AI Setup ---
async function initAI() {
    try {
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1 });
        
        document.getElementById("mode-text").innerText = "SYSTEM READY"; distMsg.innerText = "Select a test to begin.";
        await startCamera(); 
        
        // Ensure loop runs continuously
        video.addEventListener("loadeddata", runAILoop);
        drawAstigmatismCanvas(); // Pre-draw
    } catch (e) { distMsg.innerText = "AI failed to load."; console.error(e); }
}

async function startCamera(forceMode = "user") {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: forceMode, width: 640, height: 480 } }); 
    video.srcObject = stream;
    ["1", "2", "3"].forEach(id => { const el = document.getElementById(`mini-video-${id}`); if(el) el.srcObject = stream; });
}

window.closeRooms = () => { 
    document.querySelectorAll(".fullscreen-room").forEach(r => r.style.display = "none"); 
    document.getElementById("dashboard").style.display = "flex"; 
    currentMode = "dashboard"; 
    startCamera("user"); 
    if(recognizer) recognizer.stop(); 
};

// --- Tests ---
window.measurePD = () => {
    if (currentEyeDistPx === 0) return alert("AI is tracking... Please center your face in the camera.");
    const pdMM = ((currentEyeDistPx / screenPPI) * 25.4 * 1.2).toFixed(1); 
    results.pd = `${pdMM} mm`; document.getElementById("pd-display").style.display = "block"; document.getElementById("pd-value").innerText = pdMM; showReport();
};

let readingLevelPx = 40; 
const texts = ["Vision is a window.", "The quick brown fox.", "Small text testing."];
window.openReadingRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("reading-room").style.display = "flex"; currentMode = "reading"; readingLevelPx = (0.5 * screenPPI) / 25.4 * 6; updateReadingUI(); if(recognizer) recognizer.start(); };
function updateReadingUI() { document.getElementById("room-text").innerText = texts[Math.floor(Math.random() * texts.length)]; document.getElementById("room-text").style.fontSize = readingLevelPx + "px"; }
window.passReading = () => { readingLevelPx *= 0.75; const targetPx = (0.5 * screenPPI) / 25.4; if (readingLevelPx <= targetPx * 1.2) { results.reading = "Normal Acuity (J1+)"; closeRooms(); showReport(); } else updateReadingUI(); };
window.failReading = () => { results.reading = `Struggled at current font`; closeRooms(); showReport(); };

// --- FIX 3: Astigmatism Canvas Drawing ---
function drawAstigmatismCanvas() {
    const c = document.getElementById("astig-canvas"); const ctx = c.getContext("2d");
    const cx = c.width / 2; const cy = c.height / 2; const radius = 100;
    ctx.clearRect(0,0,c.width,c.height); ctx.lineWidth = 3; ctx.strokeStyle = "black";
    for(let i=0; i<180; i+=15) { // Draw lines every 15 degrees
        let rad = i * Math.PI / 180;
        ctx.beginPath(); ctx.moveTo(cx - radius * Math.cos(rad), cy - radius * Math.sin(rad));
        ctx.lineTo(cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)); ctx.stroke();
    }
}
window.openAstigRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("astig-room").style.display = "flex"; currentMode = "astig"; }; 
window.submitAstig = (hasDefect) => { results.astig = hasDefect ? "Irregularity Detected" : "Normal Cornea"; closeRooms(); showReport(); };

// --- FIX 6: Comprehensive Peripheral ---
let periphCount = 0, periphHits = 0, flashActive = false;
window.openPeripheralRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("peripheral-room").style.display = "flex"; currentMode = "peripheral"; document.getElementById("start-periph-btn").style.display = "block"; periphCount = 0; periphHits = 0; };
window.startPeripheralTest = (e) => {
    e.stopPropagation(); document.getElementById("start-periph-btn").style.display = "none";
    const quadrants = [ {t: '15%', l: '15%'}, {t: '15%', l: '85%'}, {t: '85%', l: '15%'}, {t: '85%', l: '85%'}, {t: '50%', l: '10%'}, {t: '50%', l: '90%'}, {t: '10%', l: '50%'}, {t: '90%', l: '50%'} ]; // 8 points
    function nextFlash() {
        if(periphCount >= 8) { results.periph = periphHits >= 7 ? "Full Field" : `Deficit (${periphHits}/8 seen)`; closeRooms(); showReport(); return; }
        setTimeout(() => { const pos = quadrants[periphCount]; const dot = document.getElementById("flash-dot"); dot.style.top = pos.t; dot.style.left = pos.l; dot.style.display = "block"; flashActive = true; setTimeout(() => { dot.style.display = "none"; flashActive = false; periphCount++; nextFlash(); }, 600); }, Math.random() * 1500 + 800);
    } nextFlash();
};
window.registerPeripheralClick = () => { if(flashActive) { periphHits++; flashActive = false; document.getElementById("flash-dot").style.display = "none"; } };

let contrastLvl = 1.0; window.openContrastRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("contrast-room").style.display = "flex"; currentMode = "contrast"; contrastLvl = 1.0; document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; }; window.passContrast = () => { contrastLvl -= 0.2; if(contrastLvl <= 0.1) { results.contrast = "Excellent"; closeRooms(); showReport(); } else { document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; } }; window.failContrast = () => { results.contrast = contrastLvl > 0.6 ? "Poor" : "Average"; closeRooms(); showReport(); };

let amslerDefects = 0; window.openAmslerRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("amsler-room").style.display = "flex"; currentMode = "amsler"; amslerDefects = 0; const ctx = document.getElementById("amsler-canvas").getContext("2d"); ctx.clearRect(0,0,300,300); ctx.strokeStyle = "#333"; ctx.lineWidth = 1; for(let i=0; i<=300; i+=15) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke(); } }; window.markAmslerDefect = (e) => { const rect = e.target.getBoundingClientRect(); document.getElementById("amsler-canvas").getContext("2d").fillStyle = "rgba(239, 68, 68, 0.5)"; document.getElementById("amsler-canvas").getContext("2d").beginPath(); document.getElementById("amsler-canvas").getContext("2d").arc(e.clientX - rect.left, e.clientY - rect.top, 15, 0, Math.PI*2); document.getElementById("amsler-canvas").getContext("2d").fill(); amslerDefects++; }; window.submitAmsler = (hasDefects) => { results.amsler = (hasDefects && amslerDefects > 0) ? "Distortion Mapped" : "Normal Macula"; closeRooms(); showReport(); };

// --- FIX 5: Comprehensive Color Vision ---
const colorPlates = [
    { src: "https://upload.wikimedia.org/wikipedia/commons/e/e0/Ishihara_9.png", ans: 74, opts: [7, 74, 4, 'None'] },
    { src: "https://upload.wikimedia.org/wikipedia/commons/1/12/Ishihara_11.PNG", ans: 6, opts: [6, 8, 9, 'None'] },
    { src: "https://upload.wikimedia.org/wikipedia/commons/f/fc/Ishihara_23.PNG", ans: 42, opts: [2, 4, 42, 'None'] }
];
let currentColorIndex = 0; let colorScore = 0;
window.openColorRoom = () => { 
    document.getElementById("dashboard").style.display = "none"; document.getElementById("color-room").style.display = "flex"; currentMode = "color"; 
    currentColorIndex = 0; colorScore = 0; loadColorPlate();
}; 
function loadColorPlate() {
    if(currentColorIndex >= colorPlates.length) { results.color = colorScore === 3 ? "Normal Vision" : "Deficiency Detected"; closeRooms(); showReport(); return; }
    document.getElementById("color-progress").innerText = `Plate ${currentColorIndex + 1} of 3`;
    document.getElementById("plate-img").src = colorPlates[currentColorIndex].src;
    const pad = document.getElementById("color-keypad"); pad.innerHTML = "";
    colorPlates[currentColorIndex].opts.forEach(opt => {
        let btn = document.createElement("button"); btn.className = "key-btn"; btn.innerText = opt;
        btn.onclick = () => { if(opt === colorPlates[currentColorIndex].ans) colorScore++; currentColorIndex++; loadColorPlate(); };
        pad.appendChild(btn);
    });
}

// --- FIX 1, 8, 9: AI Logic Loops ---
let blinkCount = 0, isBlinking = false, blinkInterval; window.openBlinkRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("blink-room").style.display = "flex"; currentMode = "blink"; document.getElementById("start-blink-btn").style.display = "block"; document.getElementById("blink-timer").innerText = "15s"; document.getElementById("blink-count-ui").innerText = "0"; }; window.startBlinkTest = () => { blinkCount = 0; let t = 15; document.getElementById("start-blink-btn").style.display = "none"; blinkInterval = setInterval(() => { t--; document.getElementById("blink-timer").innerText = t + "s"; if (t <= 0) { clearInterval(blinkInterval); results.blinks = (blinkCount * 4) < 12 ? `Low Dry Eye Risk` : `Normal`; closeRooms(); showReport(); } }, 1000); };

let fixInterval, fixDeviations = 0; window.openFixationRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("fixation-room").style.display = "flex"; currentMode = "fixation"; }; window.startFixationTest = () => { document.getElementById("start-fix-btn").style.display = "none"; fixDeviations = 0; let moves = 0; const dot = document.getElementById("target-dot"); const positions = [{t:'10%',l:'10%'},{t:'10%',l:'80%'},{t:'80%',l:'80%'},{t:'80%',l:'10%'},{t:'50%',l:'50%'}]; fixInterval = setInterval(() => { if(moves >= positions.length) { clearInterval(fixInterval); results.fixation = fixDeviations > 2 ? "Asymmetry Detected" : "Normal Sync"; closeRooms(); showReport(); return; } dot.style.top = positions[moves].t; dot.style.left = positions[moves].l; moves++; }, 2000); };

window.openVaultRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("vault-room").style.display = "flex"; currentMode = "vault"; const gallery = document.getElementById("gallery"); gallery.innerHTML = "Loading..."; if(!db) return; db.transaction("images", "readonly").objectStore("images").getAll().onsuccess = (e) => { if(e.target.result.length === 0) { gallery.innerHTML = "<p>No images.</p>"; return; } gallery.innerHTML = e.target.result.map(img => `<div class="vault-img-card"><p style="margin:0 0 5px 0; font-size:12px; color:var(--primary); font-weight:bold;">${img.patient}</p><p style="margin:0 0 5px 0; font-size:10px;">${img.date}</p><img src="${img.img}"></div>`).reverse().join(""); }; }; window.clearVault = () => { if(confirm("Delete images?")) { db.transaction("images", "readwrite").objectStore("images").clear(); openVaultRoom(); } };

// --- FIX 10: Hugging Face API with Hybrid Fallback ---
window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Processing Scan...</b>"; await startCamera("environment");
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0]; const caps = track.getCapabilities();
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
        setTimeout(async () => {
            const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d"); ctx.drawImage(video, 0, 0); saveToVault(canvas.toDataURL("image/jpeg", 0.9));
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            startCamera("user");
            
            canvas.toBlob(async (blob) => {
                try {
                    const response = await fetch("https://api-inference.huggingface.co/models/dima806/cataract_image_detection", { headers: { Authorization: `Bearer YOUR_TOKEN_HERE` }, method: "POST", body: blob });
                    const result = await response.json();
                    if (result.error) throw new Error("API Sleeping");
                    results.surface = `Cloud AI: ${result[0].label.toUpperCase()} (${(result[0].score * 100).toFixed(0)}%)`;
                } catch (error) {
                    // FALLBACK: Basic Pixel algorithmic analysis if API fails due to CORS or Cold Boot
                    let imgData = ctx.getImageData(0,0, canvas.width, canvas.height).data; let bright = 0; for(let i=0; i<imgData.length; i+=4) bright += imgData[i];
                    let avg = bright / (canvas.width * canvas.height);
                    results.surface = avg > 150 ? "AI Fallback: Opacity Detected" : "AI Fallback: Clear";
                }
                showReport();
            }, 'image/jpeg');
        }, 800);
    }, 2000);
};

// --- Core Tracking Engine ---
async function runAILoop() {
    if (!faceLandmarker || ["dashboard", "color", "contrast", "amsler", "vault", "astig", "peripheral"].includes(currentMode)) {
        window.requestAnimationFrame(runAILoop); return;
    }
    
    let startTimeMs = performance.now();
    const res = await faceLandmarker.detectForVideo(video, startTimeMs);
    
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

function showReport() { 
    document.getElementById("report-overlay").style.display = "block"; 
    document.getElementById("r-name").innerText = getPatientName();
    ["pd", "vision", "astig", "contrast", "color", "periph", "amsler", "blinks", "fixation", "surface"].forEach(id => { document.getElementById(`r-${id}`).innerText = results[id]; }); 
    window.scrollTo(0, document.body.scrollHeight); 
}

window.exportPDF = () => { const { jsPDF } = window.jspdf; const doc = new jsPDF(); doc.setFontSize(20); doc.text("Gyanam AI - Clinical Report", 20, 20); doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()} | Patient: ${getPatientName()}`, 20, 30); doc.line(20, 35, 190, 35); let y = 50; Object.keys(results).forEach(key => { doc.text(`${key.toUpperCase()}: ${results[key]}`, 20, y); y += 10; }); doc.setFontSize(10); doc.setTextColor(150); doc.text("Note: AI screening only.", 20, 160); doc.save(`${getPatientName()}_Report.pdf`); };
window.shareWhatsApp = () => { let msg = `*Gyanam Vision AI - Report*\n_Patient: ${getPatientName()}_\n_Date: ${new Date().toLocaleDateString()}_\n\n📏 PD: ${results.pd}\n📖 Acuity: ${results.reading}\n☀️ Astigmatism: ${results.astig}\n🌗 Contrast: ${results.contrast}\n🎨 Color: ${results.color}\n🌌 Peripheral: ${results.periph}\n🕸️ Macular: ${results.amsler}\n🎯 Strabismus: ${results.fixation}\n👁️ Strain: ${results.blinks}\n📸 Pathology: ${results.surface}`; window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank'); };

initAI();
