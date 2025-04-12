// Global state
let modelLoaded = false;
let modelLoading = false;
let model = null;
let flatSensitiveClasses = {};
let modelThreshold = 0.15;

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
    
    console.log("🟢 [OFFSCREEN] TensorFlow.js available, version:", tf.version ? tf.version : "unknown");
    
    // Set the backend explicitly
    try {
      await tf.setBackend('webgl');
      console.log("🟢 [OFFSCREEN] Backend set to:", tf.getBackend());
    } catch (e) {
      console.error("⚠️ [OFFSCREEN] WebGL backend failed, trying CPU:", e);
      await tf.setBackend('cpu');
      console.log("🟢 [OFFSCREEN] Backend set to:", tf.getBackend());
    }
    
    // Wait for TensorFlow to be ready
    await tf.ready();
    console.log("🟢 [OFFSCREEN] TensorFlow ready, backend:", tf.getBackend ? tf.getBackend() : "unknown");
    
    // Update progress
    chrome.runtime.sendMessage({
      action: "modelStatusUpdate",
      isLoaded: false,
      isLoading: true,
      status: "loading model",
      progress: 30
    });
    
    // Load the MobileNet model from TensorFlow Hub
    updateStatus("Loading MobileNet model...", "blue");
    model = await tf.loadGraphModel(
      'https://tfhub.dev/google/tfjs-model/imagenet/mobilenet_v2_100_224/classification/3/default/1',
      { fromTFHub: true }
    );
    console.log("🟢 [OFFSCREEN] MobileNet model loaded successfully");
    
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
    updateStatus("Model loaded successfully!", "green");
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

// Helper function to load an image
async function loadImage(imageData) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imageData;
  });
}

// Get top K predictions
function getTopK(values, k) {
  const valuesAndIndices = Array.from(values).map((value, index) => ({value, index}));
  valuesAndIndices.sort((a, b) => b.value - a.value);
  return valuesAndIndices.slice(0, k);
}

// Process an image
async function processImage(imageData, threshold) {
  if (!model || !modelLoaded) {
    throw new Error("Model not loaded");
  }
  
  try {
    // Load the image
    const img = await loadImage(imageData);
    console.log("🟢 [OFFSCREEN] Image loaded, dimensions:", img.width, "x", img.height);
    
    // Prepare the image tensor using separate operations
    const tensor = tf.tidy(() => {
      // Create tensor from image
      const imageTensor = tf.browser.fromPixels(img);
      
      // Resize using tf.image namespace
      const resized = tf.image.resizeBilinear(imageTensor, [224, 224]);
      
      // Convert to float manually
      const normalized = tf.div(resized, tf.scalar(255)); 
      
      // Add batch dimension
      return tf.expandDims(normalized, 0);
    });
    
    console.log("🟢 [OFFSCREEN] Image tensor prepared:", tensor.shape);
    
    // Run inference
    const predictions = model.predict(tensor);
    const scores = await predictions.data();
    
    // Rest of the function remains the same...
    
    console.log("🟢 [OFFSCREEN] Prediction complete");
    
    // Get top predictions
    const topK = getTopK(scores, 5);
    
    // Map to sensitive categories
    const detectedCategories = [];
    let highestConfidence = 0;
    
    // Check predictions against sensitive classes
    for (const pred of topK) {
      const classId = pred.index.toString();
      const confidence = pred.value;
      
      // Skip if below threshold
      if (confidence < threshold) continue;
      
      // Track highest confidence
      if (confidence > highestConfidence) {
        highestConfidence = confidence;
      }
      
      // Check if this class is in our sensitive classes
      if (flatSensitiveClasses && flatSensitiveClasses[classId]) {
        const categories = flatSensitiveClasses[classId].categories;
        for (const category of categories) {
          if (!detectedCategories.includes(category)) {
            detectedCategories.push(category);
          }
        }
      }
    }
    
    // Clean up tensors
    tensor.dispose();
    predictions.dispose();
    
    // Return results
    const result = {
      is_sensitive: detectedCategories.length > 0,
      confidence: highestConfidence,
      detected_categories: detectedCategories,
      top_predictions: topK.slice(0, 3).map(p => ({
        class_id: p.index,
        probability: p.value,
        class_name: flatSensitiveClasses[p.index]?.name || `Class ${p.index}`
      }))
    };
    
    console.log("🟢 [OFFSCREEN] Processing result:", result);
    return result;
    
  } catch (error) {
    console.error("❌ [OFFSCREEN] Error processing image:", error);
    throw error;
  }
}

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