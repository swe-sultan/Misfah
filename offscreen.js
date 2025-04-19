// Global state
let modelLoaded = false;
let modelLoading = false;
let model = null;
let flatSensitiveClasses = {};
let modelThreshold = 0.01;

// Update status display and log
function updateStatus(message, color) {
  const statusEl = document.getElementById('status');
  if (statusEl) {
    statusEl.textContent = message;
    statusEl.style.color = color || 'black';
  }
  console.log("🟢 [OFFSCREEN]", message);
}

// Handle messages from background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target !== 'offscreen') return false;
  
  console.log("🟢 [OFFSCREEN] Received message:", message.action);
  
  switch (message.action) {
    case 'initialize':
      if (!modelLoaded && !modelLoading) {
        // Load model when initialize message is received
        initializeModel()
          .then(() => {
            sendResponse({ success: true, modelStatus: { isLoaded: modelLoaded } });
          })
          .catch(error => {
            console.error("❌ [OFFSCREEN] Error initializing model:", error);
            sendResponse({ success: false, error: error.message });
          });
        return true; // Async response
      } else {
        sendResponse({ success: true, modelStatus: { isLoaded: modelLoaded } });
              // Add to offscreen.js initialization
      console.log("🔍 TensorFlow.js version object:", tf.version);
      console.log("🔍 TensorFlow backend in use:", tf.getBackend());
      }
      break;
    case 'processImage':
      if (!modelLoaded || !model) {
        sendResponse({ success: false, error: 'Model not loaded' });
        return true;
      }
      
      processImage(message.imageData, message.threshold || modelThreshold)
        .then(result => {
          sendResponse({ success: true, result: result });
        })
        .catch(error => {
          console.error("❌ [OFFSCREEN] Error processing image:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep channel open for async response
      
    case 'setSensitiveClasses':
      flatSensitiveClasses = message.classes;
      sendResponse({ success: true });
      break;
      
    case 'updateThreshold':
      modelThreshold = message.threshold;
      sendResponse({ success: true });
      break;
      
    case 'getModelStatus':
      sendResponse({ 
        isLoaded: modelLoaded, 
        isLoading: modelLoading 
      });
      break;
  }
  
  return true;
});

// In offscreen.js - Update the initializeModel function

// Initialize TensorFlow and load MobileNet model
async function initializeModel() {
  if (modelLoaded) return true;
  if (modelLoading) return false;
  
  modelLoading = true;
  
  try {
    updateStatus("Starting TensorFlow initialization...", "blue");
    
    // Report status to background
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: false,
      isLoading: true,
      status: "loading",
      progress: 10
    });
    
    // Check if TensorFlow.js is available (it should be, loaded by script tag)
    if (typeof tf === 'undefined') {
      throw new Error("TensorFlow.js failed to load");
    }
    
    console.log("🟢 [OFFSCREEN] TensorFlow.js available, version:", tf.version?.tfjs || "unknown");
    
    // 🔍 DETAILED TENSORFLOW DEBUGGING
    console.log("🔍 TENSORFLOW DETAILS:");
    console.log("  - TensorFlow.js version:", tf.version);
    
    // ✅ Use the official tf.getBackends() API instead
    const availableBackends = typeof tf.getBackends === 'function'
      ? tf.getBackends()
      : [];   // or ["cpu","webgl"] if you prefer a hard‑coded fallback
    console.log("  - Available backends:", availableBackends);

    console.log("  - Available backends (via tf.getBackends()):", availableBackends);
    console.log("  - Current backend (before setting):", tf.getBackend());
    
    // Try to force WebGL backend with better error handling
    try {
      console.log("  - Attempting to set WebGL backend...");
      await tf.setBackend('webgl');
      console.log("  - SUCCESS: Now using backend:", tf.getBackend());
      
      // Verify WebGL is working with a simple operation
      try {
        const testTensor = tf.zeros([1, 2, 2, 3]);
        console.log("  - Test tensor created successfully on backend:", tf.getBackend());
        testTensor.dispose();
      } catch (testError) {
        console.error("  - ERROR: Backend test failed:", testError.message);
      }
    } catch (webglError) {
      console.error("  - ERROR: Failed to set WebGL backend:", webglError.message);
      
      // Try WebGL2 as alternative
      try {
        console.log("  - Attempting to set WebGL2 backend...");
        await tf.setBackend('webgl2');
        console.log("  - SUCCESS: Using WebGL2 backend:", tf.getBackend());
      } catch (webgl2Error) {
        console.error("  - ERROR: WebGL2 backend failed:", webgl2Error.message);
        
        // Fall back to CPU as last resort
        try {
          console.log("  - Falling back to CPU backend...");
          await tf.setBackend('cpu');
          console.log("  - Using CPU backend (fallback):", tf.getBackend());
        } catch (cpuError) {
          console.error("  - ERROR: CPU backend failed too:", cpuError.message);
        }
      }
    }
    
    // Wait for TensorFlow to be ready
    await tf.ready();
    console.log("🟢 [OFFSCREEN] TensorFlow ready, using backend:", tf.getBackend());
    console.log("🔍 Backend after tf.ready():", tf.getBackend());
    console.log("🔍 WebGL support?", tf.getBackend() === 'webgl');

    
    // Update progress
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: false,
      isLoading: true,
      status: "loading model",
      progress: 30
    });
    
    // Load the MobileNetV2 model
    updateStatus(`Loading MobileNetV2 model (using ${tf.getBackend()} backend)...`, "blue");
    model = await tf.loadGraphModel(
      'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1',
      { fromTFHub: true }
    );
    console.log("🟢 [OFFSCREEN] MobileNetV2 model loaded successfully");
    
    // Update progress
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: false,
      isLoading: true,
      status: "warming up model",
      progress: 80
    });
    
    // Warm up the model
    updateStatus("Warming up model...", "blue");
    const dummyTensor = tf.zeros([1, 224, 224, 3]);
    const warmupResult = model.predict(dummyTensor);
    warmupResult.dispose();
    dummyTensor.dispose();
    console.log("🟢 [OFFSCREEN] Model warmup complete");
    
    // Mark as loaded
    modelLoaded = true;
    modelLoading = false;
    
    // Update final status
    updateStatus(`Model loaded successfully! Using ${tf.getBackend()} backend`, "green");
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: true,
      isLoading: false,
      status: "ready",
      progress: 100
    });
    
    return true;
  } catch (error) {
    modelLoading = false;
    updateStatus(`Error loading model: ${error.message}`, "red");
    console.error("❌ [OFFSCREEN] Error loading model:", error);
    
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: false,
      isLoading: false,
      status: "error",
      error: error.message,
      progress: 0
    });
    
    throw error;
  }
}

async function loadImage(imageData) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      console.log(`[OFFSCREEN] Image loaded: ${img.width}x${img.height}`);
      resolve(img);
    };
    img.onerror = () => {
      console.error("[OFFSCREEN] Image load failed, src length:", imageData.length);
      reject(new Error("Failed to load image"));
    };
    img.src = imageData;
  });
}
// Get top K predictions
function getTopK(values, k) {
  const valuesAndIndices = Array.from(values).map((value, index) => ({value, index}));
  valuesAndIndices.sort((a, b) => b.value - a.value);
  return valuesAndIndices.slice(0, k);
}

async function processImage(imageData, threshold = 0.5) {
  if (!modelLoaded || !model) {
    console.error("[OFFSCREEN] Model not loaded");
    return { is_sensitive: false, error: "Model not loaded" };
  }

  try {
    const img = await loadImage(imageData);
    console.log(`[OFFSCREEN] Image loaded, dimensions: ${img.width}x${img.height}, data length: ${imageData.length}`);

    const tensor = tf.tidy(() => {
      const imageTensor = tf.browser.fromPixels(img, 3);
      console.log(`[OFFSCREEN] Raw tensor shape: ${imageTensor.shape}, dtype: ${imageTensor.dtype}, min: ${tf.min(imageTensor).dataSync()[0]}, max: ${tf.max(imageTensor).dataSync()[0]}`);
      const resized = tf.image.resizeBilinear(imageTensor, [224, 224], true);
      console.log(`[OFFSCREEN] Resized tensor shape: ${resized.shape}`);
      const scaled = tf.div(resized, tf.scalar(255.0));
      console.log(`[OFFSCREEN] Scaled tensor min: ${tf.min(scaled).dataSync()[0]}, max: ${tf.max(scaled).dataSync()[0]}`);
      const normalized = tf.mul(tf.sub(scaled, tf.scalar(0.5)), tf.scalar(2.0));
      console.log(`[OFFSCREEN] Normalized tensor min: ${tf.min(normalized).dataSync()[0]}, max: ${tf.max(normalized).dataSync()[0]}`);
      return tf.expandDims(normalized, 0);
    });

    const predictions = model.predict(tensor);
    const scores = await predictions.data();
    console.log("[OFFSCREEN] Prediction scores length:", scores.length);

    const topK = getTopK(scores, 10);
    // Apply softmax to normalize probabilities
    const expScores = scores.map(s => Math.exp(s));
    const sumExpScores = expScores.reduce((a, b) => a + b, 0);
    const normalizedScores = expScores.map(s => s / sumExpScores);
    const normalizedTopK = topK.map(pred => ({
      index: pred.index,
      value: normalizedScores[pred.index]
    }));
    const adjustedTopK = normalizedTopK.map(pred => ({
      index: pred.index - 1,
      value: pred.value
    }));

    console.log("[OFFSCREEN] Top 10 predictions (adjusted indices):", 
      adjustedTopK.map(p => 
        `Class ${p.index}: ${(p.value * 100).toFixed(2)}% ${flatSensitiveClasses[p.index]?.name || `Unknown (ID ${p.index})`}`
      )
    );

    const detectedCategories = [];
    let highestConfidence = 0;

    for (const pred of adjustedTopK) {
      if (pred.value < threshold) continue;
      const classId = pred.index.toString();
      if (flatSensitiveClasses[classId]) {
        flatSensitiveClasses[classId].categories.forEach(category => {
          if (!detectedCategories.includes(category)) detectedCategories.push(category);
        });
        highestConfidence = Math.max(highestConfidence, pred.value);
      }
    }

    tensor.dispose();
    predictions.dispose();

    return {
      is_sensitive: detectedCategories.length > 0,
      confidence: highestConfidence,
      detected_categories: detectedCategories,
      top_predictions: adjustedTopK.slice(0, 3).map(p => ({
        class_id: p.index,
        probability: p.value,
        class_name: flatSensitiveClasses[p.index]?.name || `Class ${p.index}`
      }))
    };
  } catch (error) {
    console.error("[OFFSCREEN] Error processing image:", error);
    return { is_sensitive: false, error: error.message };
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "processImage") {
    console.log("[OFFSCREEN] Received image for processing");
    processImage(message.imageData, message.threshold)
      .then(result => {
        console.log("[OFFSCREEN] Processing result:", result);
        sendResponse(result);
      })
      .catch(error => {
        console.error("[OFFSCREEN] Error in processing:", error);
        sendResponse({ is_sensitive: false, error: error.message });
      });
    return true;
  }
});




chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === "processImage") {
    console.log("[OFFSCREEN] Received image for processing");
    processImage(message.imageData, message.threshold)
      .then(result => {
        console.log("[OFFSCREEN] Processing result:", result);
        sendResponse(result);
      })
      .catch(error => {
        console.error("[OFFSCREEN] Error in processing:", error);
        sendResponse({ is_sensitive: false, error: error.message });
      });
    return true;
  }
});

// Start model initialization immediately when offscreen document loads
console.log("🟢 [OFFSCREEN] Offscreen document loaded");
console.log("🟢 [OFFSCREEN] TensorFlow.js available:", typeof tf !== 'undefined');

// Auto-initialize when the document is fully loaded
document.addEventListener('DOMContentLoaded', () => {
  console.log("🟢 [OFFSCREEN] Document content loaded, auto-initializing model...");
  setTimeout(() => {
    initializeModel().catch(error => {
      console.error("❌ [OFFSCREEN] Auto-initialization error:", error);
    });
  }, 500);
});