import { FaceLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const distMsg = document.getElementById("dist-msg");
const modeText = document.getElementById("mode-text");
const cameraSelector = document.getElementById("camera-selector");

let faceLandmarker, tmCataractModel;
let currentMode = "dashboard"; 
let isLowLightBoost = false, isPediatric = false;
let screenPPI = 96, currentEyeDistPx = 0; 
let currentLang = 'en';

let results = { pd: "--", reading: "--", astig: "--", periph: "--", contrast: "--", color: "--", amsler: "--", blinks: "--", fixation: "--", surface: "--" };

// --- Custom AI (Teachable Machine) Setup ---
// Replace this placeholder with your trained model from Teachable Machine
const TM_URL = "https://teachablemachine.withgoogle.com/models/PLACEHOLDER/"; 

// --- Localization Engine ---
const t = {
    en: {
        title: "Gyanam Vision Pro", std: "Standard", ped: "Pediatric", pd: "📏 Auto-PD",
        acuity: "📖 Acuity (Voice)", astig: "☀️ Astigmatism", color: "🎨 Color Test", contrast: "🌗 Contrast",
        amsler: "🕸️ Macular Grid", periph: "🌌 Peripheral", strain: "👁️ Eye Strain", fix: "🎯 Strabismus",
        retina: "📸 AI Cataract Scan", vault: "🖼️ Image Vault", rep: "Comprehensive Report"
    },
    hi: {
        title: "ज्ञानम् विजन प्रो", std: "सामान्य", ped: "बाल रोग (आकार)", pd: "📏 ऑटो-पीडी",
        acuity: "📖 दृष्टि परीक्षण", astig: "☀️ दृष्टिवैषम्य", color: "🎨 रंग परीक्षण", contrast: "🌗 कंट्रास्ट",
        amsler: "🕸️ मैक्यूलर ग्रिड", periph: "🌌 परिधीय दृष्टि", strain: "👁️ आँखों का तनाव", fix: "🎯 भेंगापन",
        retina: "📸 एआई मोतियाबिंद स्कैन", vault: "🖼️ मरीज वॉल्ट", rep: "क्लिनिकल रिपोर्ट"
    }
};

window.toggleLanguage = () => {
    currentLang = currentLang === 'en' ? 'hi' : 'en';
    document.getElementById("app-title").innerText = t[currentLang].title;
    document.getElementById("lbl-std").innerText = t[currentLang].std;
    document.getElementById("lbl-ped").innerText = t[currentLang].ped;
    document.getElementById("btn-pd").innerHTML = t[currentLang].pd;
    document.getElementById("btn-acuity").innerHTML = t[currentLang].acuity;
    document.getElementById("btn-astig").innerHTML = t[currentLang].astig;
    document.getElementById("btn-color").innerHTML = t[currentLang].color;
    document.getElementById("btn-contrast").innerHTML = t[currentLang].contrast;
    document.getElementById("btn-amsler").innerHTML = t[currentLang].amsler;
    document.getElementById("btn-periph").innerHTML = t[currentLang].periph;
    document.getElementById("btn-strain").innerHTML = t[currentLang].strain;
    document.getElementById("btn-fixation").innerHTML = t[currentLang].fix;
    document.getElementById("btn-retina").innerHTML = t[currentLang].retina;
    document.getElementById("btn-vault").innerHTML = t[currentLang].vault;
    document.getElementById("rep-title").innerText = t[currentLang].rep;
    
    if(recognizer) recognizer.lang = currentLang === 'hi' ? 'hi-IN' : 'en-US';
};

// --- Vault & Speech Init ---
let db;
const request = indexedDB.open("GyanamVault", 1);
request.onupgradeneeded = (e) => { db = e.target.result; db.createObjectStore("images", { autoIncrement: true }); };
request.onsuccess = (e) => { db = e.target.result; };
function saveToVault(dataUrl) { if(db) db.transaction("images", "readwrite").objectStore("images").add({ date: new Date().toLocaleString(), img: dataUrl }); }

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognizer;
if (SpeechRecognition) {
    recognizer = new SpeechRecognition(); recognizer.continuous = true; recognizer.lang = 'en-US';
    recognizer.onresult = (event) => {
        const tr = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
        if (currentMode === "reading") {
            if (tr.includes("clear") || tr.includes("yes") || tr.includes("saaf") || tr.includes("haan")) passReading();
            else if (tr.includes("blurry") || tr.includes("no") || tr.includes("dhundhla") || tr.includes("nahi")) failReading();
        }
    };
}

// --- AI Init & Hardware Mapping ---
async function initAI() {
    try {
        await getCameras(); // Populate Hardware Lenses
        const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`, delegate: "GPU" }, runningMode: "VIDEO", numFaces: 1 });
        
        // Attempt to load Teachable Machine Custom AI (Will silently fail until user adds real URL)
        try { tmCataractModel = await tmImage.load(TM_URL + "model.json", TM_URL + "metadata.json"); } catch(err) {}

        modeText.innerText = "SYSTEM READY"; distMsg.innerText = "Select a test to begin.";
        startCamera(); 
    } catch (e) { distMsg.innerText = "AI failed to load."; console.error(e); }
}

async function getCameras() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');
    cameraSelector.innerHTML = "";
    videoDevices.forEach(d => {
        const opt = document.createElement("option"); opt.value = d.deviceId; opt.text = d.label || `Camera ${cameraSelector.length + 1}`;
        cameraSelector.appendChild(opt);
    });
    cameraSelector.style.display = videoDevices.length > 1 ? "block" : "none";
}

async function startCamera(forceMode = null) {
    if (video.srcObject) video.srcObject.getTracks().forEach(t => t.stop());
    let constraints = { video: { width: 720, height: 720 } };
    
    if (forceMode === "environment") constraints.video.facingMode = "environment";
    else if (cameraSelector.value) constraints.video.deviceId = { exact: cameraSelector.value };
    else constraints.video.facingMode = "user";

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    ["1", "2", "3"].forEach(id => { const el = document.getElementById(`mini-video-${id}`); if(el) el.srcObject = stream; });
    video.onloadeddata = () => { if (!forceMode) runAILoop(); };
}

window.changeCamera = () => { startCamera(); };

// --- Calibration ---
window.adjustCalibration = (val) => { document.getElementById("calib-card").style.width = val + "px"; };
window.saveCalibration = () => { screenPPI = document.getElementById("calib-slider").value / 3.37; document.getElementById("calibration-overlay").style.display = "none"; };

// --- Navigation ---
window.closeRooms = () => {
    document.querySelectorAll(".fullscreen-room").forEach(r => r.style.display = "none");
    document.getElementById("dashboard").style.display = "flex"; currentMode = "dashboard"; startCamera();
    if(recognizer) recognizer.stop();
};

window.measurePD = () => {
    if (currentEyeDistPx === 0) return alert("Align face in camera.");
    const pdMM = ((currentEyeDistPx / screenPPI) * 25.4 * 1.2).toFixed(1); 
    results.pd = `${pdMM} mm`; document.getElementById("pd-display").style.display = "block"; document.getElementById("pd-value").innerText = pdMM; showReport();
};

// --- Test Rooms ---
let readingLevelPx = 40; const textsAdult = ["Vision is a window.", "The quick brown fox.", "Small text testing."]; const textsKid = ["🍎 🏠 🍎", "⏹ ⏺ ⏹", "🏠 🍎 ⏺"];
const textsHindi = ["दृष्टि दुनिया की खिड़की है।", "स्वास्थ्य ही वास्तविक धन है।", "एआई मोतियाबिंद की जांच करता है।"];
window.togglePediatric = () => { isPediatric = document.getElementById("pediatric-toggle").checked; };
window.openReadingRoom = () => { 
    document.getElementById("dashboard").style.display = "none"; document.getElementById("reading-room").style.display = "flex"; currentMode = "reading"; 
    readingLevelPx = (0.5 * screenPPI) / 25.4 * 6; updateReadingUI(); 
    if(recognizer) { recognizer.start(); document.getElementById("voice-status").style.display = "block"; }
};
function updateReadingUI() { const txt = isPediatric ? textsKid : (currentLang === 'hi' ? textsHindi : textsAdult); document.getElementById("room-text").innerText = txt[Math.floor(Math.random() * txt.length)]; document.getElementById("room-text").style.fontSize = readingLevelPx + "px"; }
window.passReading = () => { readingLevelPx *= 0.75; const targetPx = (0.5 * screenPPI) / 25.4; if (readingLevelPx <= targetPx * 1.2) { results.reading = "Normal Acuity (J1+)"; closeRooms(); showReport(); } else updateReadingUI(); };
window.failReading = () => { results.reading = `Struggled`; closeRooms(); showReport(); };

window.openAstigRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("astig-room").style.display = "flex"; currentMode = "astig"; };
window.submitAstig = (hasDefect) => { results.astig = hasDefect ? "Irregularity Detected" : "Normal Cornea"; closeRooms(); showReport(); };

let periphInterval, periphCount = 0, periphHits = 0, flashActive = false;
window.openPeripheralRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("peripheral-room").style.display = "flex"; currentMode = "peripheral"; document.getElementById("start-periph-btn").style.display = "block"; periphCount = 0; periphHits = 0; };
window.startPeripheralTest = (e) => {
    e.stopPropagation(); document.getElementById("start-periph-btn").style.display = "none";
    const quadrants = [ {t: '10%', l: '10%'}, {t: '10%', l: '85%'}, {t: '85%', l: '10%'}, {t: '85%', l: '85%'} ];
    function nextFlash() {
        if(periphCount >= 4) { results.periph = periphHits === 4 ? "Full Field" : `Deficit (${periphHits}/4)`; closeRooms(); showReport(); return; }
        setTimeout(() => {
            const pos = quadrants[periphCount]; const dot = document.getElementById("flash-dot"); dot.style.top = pos.t; dot.style.left = pos.l; dot.style.display = "block"; flashActive = true;
            setTimeout(() => { dot.style.display = "none"; flashActive = false; periphCount++; nextFlash(); }, 600);
        }, Math.random() * 1500 + 1000);
    }
    nextFlash();
};
window.registerPeripheralClick = () => { if(flashActive) { periphHits++; flashActive = false; document.getElementById("flash-dot").style.display = "none"; } };

let contrastLvl = 1.0; window.openContrastRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("contrast-room").style.display = "flex"; currentMode = "contrast"; contrastLvl = 1.0; document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; };
window.passContrast = () => { contrastLvl -= 0.2; if(contrastLvl <= 0.1) { results.contrast = "Excellent"; closeRooms(); showReport(); } else { document.getElementById("contrast-text").style.color = `rgba(0,0,0, ${contrastLvl})`; } };
window.failContrast = () => { results.contrast = contrastLvl > 0.6 ? "Poor (Possible Cataract)" : "Average"; closeRooms(); showReport(); };

let amslerDefects = 0; 
window.openAmslerRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("amsler-room").style.display = "flex"; currentMode = "amsler"; amslerDefects = 0; const ctx = document.getElementById("amsler-canvas").getContext("2d"); ctx.clearRect(0,0,300,300); ctx.strokeStyle = "#333"; ctx.lineWidth = 1; for(let i=0; i<=300; i+=15) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 300); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(300, i); ctx.stroke(); } };
window.markAmslerDefect = (e) => { const rect = e.target.getBoundingClientRect(); const ctx = document.getElementById("amsler-canvas").getContext("2d"); ctx.fillStyle = "rgba(239, 68, 68, 0.5)"; ctx.beginPath(); ctx.arc(e.clientX - rect.left, e.clientY - rect.top, 15, 0, Math.PI*2); ctx.fill(); amslerDefects++; };
window.submitAmsler = (hasDefects) => { results.amsler = (hasDefects && amslerDefects > 0) ? "Distortion Mapped" : "Normal Macula"; closeRooms(); showReport(); };

window.openColorRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("color-room").style.display = "flex"; currentMode = "color"; }; window.checkColor = (num) => { results.color = (num === 9) ? "Normal" : "Deficiency"; closeRooms(); showReport(); };

let blinkCount = 0, isBlinking = false, blinkInterval; window.openBlinkRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("blink-room").style.display = "flex"; currentMode = "blink"; document.getElementById("start-blink-btn").style.display = "block"; document.getElementById("blink-timer").innerText = "15s"; };
window.startBlinkTest = () => { blinkCount = 0; let t = 15; document.getElementById("start-blink-btn").style.display = "none"; blinkInterval = setInterval(() => { t--; document.getElementById("blink-timer").innerText = t + "s"; if (t <= 0) { clearInterval(blinkInterval); let bpm = blinkCount * 4; results.blinks = bpm < 12 ? `Low (${bpm} BPM)` : `Normal (${bpm} BPM)`; closeRooms(); showReport(); } }, 1000); };

let fixInterval, fixDeviations = 0; window.openFixationRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("fixation-room").style.display = "flex"; currentMode = "fixation"; };
window.startFixationTest = () => { document.getElementById("start-fix-btn").style.display = "none"; fixDeviations = 0; let moves = 0; const dot = document.getElementById("target-dot"); const positions = [{t:'10%',l:'10%'},{t:'10%',l:'80%'},{t:'80%',l:'80%'},{t:'80%',l:'10%'},{t:'50%',l:'50%'}]; fixInterval = setInterval(() => { if(moves >= positions.length) { clearInterval(fixInterval); results.fixation = fixDeviations > 2 ? "Asymmetry Detected" : "Normal Sync"; closeRooms(); showReport(); return; } dot.style.top = positions[moves].t; dot.style.left = positions[moves].l; moves++; }, 2000); };

window.openVaultRoom = () => { document.getElementById("dashboard").style.display = "none"; document.getElementById("vault-room").style.display = "flex"; currentMode = "vault"; const gallery = document.getElementById("gallery"); gallery.innerHTML = "Loading..."; if(!db) return; db.transaction("images", "readonly").objectStore("images").getAll().onsuccess = (e) => { if(e.target.result.length === 0) { gallery.innerHTML = "<p>No images.</p>"; return; } gallery.innerHTML = e.target.result.map(img => `<div class="vault-img-card"><p style="margin:0 0 5px 0; font-size:12px;">${img.date}</p><img src="${img.img}"></div>`).reverse().join(""); }; };
window.clearVault = () => { if(confirm("Delete images?")) { db.transaction("images", "readwrite").objectStore("images").clear(); openVaultRoom(); } };

// --- Custom AI Teachable Machine Scan ---
// --- Cloud AI Cataract Scan (Hugging Face) ---
window.triggerMacroScan = async () => {
    distMsg.innerHTML = "<b style='color:#f59e0b'>Uploading to Cloud AI...</b>"; 
    await startCamera("environment");
    
    setTimeout(async () => {
        const track = video.srcObject.getVideoTracks()[0]; 
        const caps = track.getCapabilities();
        if (caps.torch) try { await track.applyConstraints({advanced: [{torch: true}]}); } catch(e){}
        
        setTimeout(async () => {
            const canvas = document.createElement("canvas"); 
            canvas.width = video.videoWidth; 
            canvas.height = video.videoHeight;
            canvas.getContext("2d").drawImage(video, 0, 0); 
            
            // Save to offline vault
            saveToVault(canvas.toDataURL("image/jpeg", 0.9));
            
            // Turn off flash instantly so user isn't blinded
            if (caps.torch) try { await track.applyConstraints({advanced: [{torch: false}]}); } catch(e){}
            startCamera(); // Flip back to front camera
            
            // Convert image to blob and send to Hugging Face Cloud
            canvas.toBlob(async (blob) => {
                try {
                    // Replace YOUR_TOKEN_HERE with your actual token starting with hf_
                    const HF_TOKEN = "YOUR_TOKEN_HERE"; 
                    
                    const response = await fetch(
                        "https://api-inference.huggingface.co/models/dima806/cataract_image_detection",
                        {
                            headers: { Authorization: `Bearer ${HF_TOKEN}` },
                            method: "POST",
                            body: blob,
                        }
                    );
                    
                    const result = await response.json();
                    
                    if (result.error) {
                        results.surface = "AI Cloud Warming Up. Please try again in 10 seconds.";
                    } else {
                        // The API returns the highest probability first
                        const topMatch = result[0];
                        const condition = topMatch.label === "normal" ? "Healthy Eye" : topMatch.label;
                        results.surface = `Cloud AI: ${condition.toUpperCase()} (${(topMatch.score * 100).toFixed(0)}%)`;
                    }
                } catch (error) {
                    results.surface = "Network Error: Could not reach AI server.";
                }
                showReport();
            }, 'image/jpeg');

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

window.exportPDF = () => {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.setFontSize(20); doc.text("Gyanam AI - Clinical Report", 20, 20); doc.setFontSize(12); doc.text(`Date: ${new Date().toLocaleDateString()} | Lang: ${currentLang.toUpperCase()}`, 20, 30); doc.line(20, 35, 190, 35);
    let y = 50; Object.keys(results).forEach(key => { doc.text(`${key.toUpperCase()}: ${results[key]}`, 20, y); y += 10; });
    doc.setFontSize(10); doc.setTextColor(150); doc.text("Note: AI screening only.", 20, 160); doc.save("Gyanam_Complete_Report.pdf");
};

window.shareWhatsApp = () => {
    let msg = `*Gyanam Vision AI - Clinical Report*\n_Date: ${new Date().toLocaleDateString()}_\n\n`;
    msg += `📏 PD: ${results.pd}\n📖 Acuity: ${results.reading}\n☀️ Astigmatism: ${results.astig}\n🌗 Contrast: ${results.contrast}\n`;
    msg += `🎨 Color: ${results.color}\n🌌 Peripheral: ${results.periph}\n🕸️ Macular: ${results.amsler}\n🎯 Strabismus: ${results.fixation}\n`;
    msg += `👁️ Strain: ${results.blinks}\n📸 Pathology: ${results.surface}\n\n_Note: AI-assisted screening._`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
};

initAI();
