// Enhanced background script for better reliability

// Global variable to track model status
let modelStatus = {
  isLoaded: false,
  isLoading: false,
  progress: 0,
  error: null
};

// Improved offscreen document management
let offscreenCreationInProgress = false;
let offscreenDocumentReady = false;
let offscreenCreateAttempts = 0;
const MAX_CREATE_ATTEMPTS = 3;

// Add retry mechanism with exponential backoff
async function createOffscreenDocument() {
  // Don't try to create multiple documents simultaneously
  if (offscreenCreationInProgress) {
    console.log("[BACKGROUND] Offscreen document creation already in progress");
    return;
  }
  
  if (offscreenCreateAttempts >= MAX_CREATE_ATTEMPTS) {
    console.error("[BACKGROUND] Max offscreen creation attempts reached");
    return;
  }
  
  offscreenCreationInProgress = true;
  offscreenCreateAttempts++;
  
  try {
    // First check if document already exists
    let hasDocument = false;
    try {
      hasDocument = await chrome.offscreen.hasDocument();
    } catch (e) {
      console.log("[BACKGROUND] Error checking offscreen document:", e);
    }
    
    if (hasDocument) {
      console.log("[BACKGROUND] Offscreen document already exists, initializing it");
      
      try {
        // Check if document is responsive
        const response = await sendMessageToOffscreen({
          action: 'getModelStatus'
        }, 5000);  // 5 second timeout
        
        console.log("[BACKGROUND] Offscreen document responded:", response);
        
        // Update model status
        modelStatus.isLoaded = response.isLoaded;
        modelStatus.isLoading = response.isLoading;
        modelStatus.error = response.error;
        
        offscreenDocumentReady = true;
        offscreenCreationInProgress = false;
        return;
      } catch (error) {
        console.error("[BACKGROUND] Existing offscreen document not responsive:", error);
        
        // Try to close and recreate
        try {
          await chrome.offscreen.closeDocument();
          console.log("[BACKGROUND] Closed non-responsive offscreen document");
        } catch (closeError) {
          console.warn("[BACKGROUND] Error closing document:", closeError);
        }
      }
    }
    
    // Create new document
    console.log("[BACKGROUND] Creating new offscreen document");
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: ['DOM_PARSER', 'IFRAME_SCRIPTING'],
      justification: 'Load TensorFlow.js model for content filtering'
    });
    
    console.log("[BACKGROUND] Offscreen document successfully created");
    offscreenDocumentReady = true;
    
    // Wait a moment for the document to initialize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Load the sensitive classes data 
    try {
      await loadSensitiveClasses();
      await sendMessageToOffscreen({
        action: 'initialize'
      }, 30000); // 30 second timeout for initialization
      
      console.log("[BACKGROUND] Offscreen document initialized");
    } catch (error) {
      console.error("[BACKGROUND] Error initializing offscreen document:", error);
      modelStatus.error = error.message;
    }
    
    offscreenCreationInProgress = false;
    
  } catch (error) {
    console.error("[BACKGROUND] Error managing offscreen document:", error);
    offscreenCreationInProgress = false;
    
    // Use exponential backoff for retries
    const backoffTime = Math.pow(2, offscreenCreateAttempts) * 1000;
    console.log(`[BACKGROUND] Will retry in ${backoffTime}ms (attempt ${offscreenCreateAttempts})`);
    
    setTimeout(() => {
      createOffscreenDocument();
    }, backoffTime);
  }
}

// Improved message sending with timeout
function sendMessageToOffscreen(message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout after ${timeoutMs}ms sending message to offscreen`));
    }, timeoutMs);
    
    message.target = 'offscreen';
    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timeoutId);
      
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

// Load sensitive classes and pass to offscreen
async function loadSensitiveClasses() {
  try {
    const response = await fetch(chrome.runtime.getURL('data/flat_sensitive_classes.json'));
    const data = await response.json();
    console.log('[BACKGROUND] Loaded flat sensitive classes data');
    
    await sendMessageToOffscreen({
      action: 'setSensitiveClasses',
      classes: data
    });
    
    return true;
  } catch (error) {
    console.error('[BACKGROUND] Error loading sensitive classes:', error);
    return false;
  }
}

// Add this to your background.js or create a new background-api.js file
// and update your manifest to include it


// Function to classify texts using Claude API
async function claudeAnalyzeTexts(texts, apiKey) {
  if (!texts || texts.length === 0) {
    return [];
  }
  
  // Use the same classification logic but in background script
  return classifyWithApi(texts, apiKey);
}

// Function to test connection to Claude API
async function claudeTestConnection(apiKey) {
  try {
    const result = await classifyWithApi(["Hello world"], apiKey);
    return { success: true, result };
  } catch (error) {
    console.error("Claude connection test failed:", error);
    return { success: false, error: error.message };
  }
}

// Keep most of the existing background.js code, but update the Claude API integration part

// Claude API classification function
async function classifyWithApi(texts, apiKey) {
  console.log(`[Background] Classifying ${texts.length} texts with Claude API using model claude-3-5-haiku-20241022`);
  console.log(`[Background] API Key used: ${apiKey.substring(0, 15)}...`); // Only log first part for security
  
  if (!apiKey) {
    console.error("[Background] API key not provided");
    throw new Error("API key not provided");
  }
  
  const url = "https://api.anthropic.com/v1/messages";
  
  const headers = {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    "anthropic-dangerous-direct-browser-access": "1" // Required for browser use
  };
  
  // Updated prompt to make clear which categories are safe vs. sensitive
  let prompt = "Classify each of the following texts into EXACTLY ONE of these categories:\n"
  prompt += "- safe (general safe content)\n"
  prompt += "- sexual\n"
  prompt += "- violent\n"
  prompt += "- wine/drugs\n"
  prompt += "- gambling\n"
  prompt += "- atheism (this includes atheism from Islamic perspective, and blasphemy against the Quran and Sunnah)\n"
  prompt += "- Astrology\n"
  prompt += "- Text from Quran (direct quotes from the Quran)\n"
  prompt += "- Islam (Islamic content that is not direct Quran quotes)\n"
  prompt += "- economy (content about economics)\n"
  prompt += "- science (scientific content)\n"
  prompt += "- LGBTQ\n\n"
  prompt += "Respond with a JSON array of category names only, no explanations or extra text and only accept one category as an answer.\n\n"
  
  // Add each text with an index
  texts.forEach((text, i) => {
    prompt += `Text ${i+1}: ${text}\n\n`;
  });
  
  const payload = {
    "model": "claude-3-5-haiku-20241022",
    "max_tokens": 1000,
    "messages": [
      {
        "role": "user",
        "content": prompt
      }
    ]
  };
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`[Background] API request failed with status ${response.status}:`, errorBody);
      throw new Error(`API request failed with status ${response.status}`);
    }
    
    const apiResponse = await response.json();
    const content = apiResponse.content || [];
    
    if (content && content.length > 0) {
      const responseText = content[0]?.text?.trim() || "";
      
      try {
        // Find JSON array in the response
        const startIdx = responseText.indexOf('[');
        const endIdx = responseText.lastIndexOf(']') + 1;
        
        if (startIdx >= 0 && endIdx > startIdx) {
          const jsonStr = responseText.substring(startIdx, endIdx);
          const categories = JSON.parse(jsonStr);
          
          if (categories.length === texts.length) {
            console.log("[Background] Successfully parsed API response");
            return categories;
          } else {
            console.error("[Background] Length mismatch between texts and classifications");
          }
        } else {
          console.error("[Background] Could not find JSON array in response");
        }
      } catch (err) {
        console.error("[Background] JSON parsing error:", err);
        
        // If JSON parsing fails, try to extract categories line by line
        const lines = responseText.split('\n');
        const categories = [];
        
        for (const line of lines) {
          if (line.includes(':')) {
            const parts = line.split(':');
            if (parts.length > 1) {
              const category = parts[1].trim().replace(/[\\"'\[\](),]/g, '');
              
              // Make sure we match all possible categories
              if (["safe", "sexual", "violent", "wine/drugs", "gambling", "atheism", "Astrology", 
                   "Text from Quran", "Quran text", "Islam", "economy", "science", "LGBTQ"].includes(category)) {
                categories.push(category);
              }
            }
          }
        }
        
        if (categories.length === texts.length) {
          console.log("[Background] Extracted categories using line parsing");
          return categories;
        } else {
          console.error("[Background] Could not extract correct number of categories");
        }
      }
    } else {
      console.error("[Background] Empty content in API response");
    }
    
    // Return error for all texts if we couldn't parse the response
    throw new Error("Failed to parse API response");
  } catch (error) {
    console.error("[Background] API request error:", error);
    throw error;
  }
}

// Improved image processing function
async function processImageInOffscreen(imageData, threshold) {
  // Make sure offscreen document is ready
  if (!offscreenDocumentReady) {
    await createOffscreenDocument();
  }
  
  // Process the image
  try {
    const response = await sendMessageToOffscreen({
      action: 'processImage',
      imageData: imageData,
      threshold: threshold
    }, 15000); // 15 second timeout for processing
    
    return response;
  } catch (error) {
    console.error("[BACKGROUND] Error processing image in offscreen:", error);
    throw error;
  }
}

// Add this to your background.js file
async function testDirectApiCall() {
  console.log("[Background] Running direct API test with fixed text");
  
  // Use the same known text that should be detected as sensitive
  const testText = "ليلة البارحة رحت حفل وشربت خمر اخيرا وكنت سكران";
  
  try {
    // Get the API key from storage
    const data = await chrome.storage.sync.get(["apiKey"]);
    const apiKey = data.apiKey || "blabla";
    
    console.log("[Background] Using API key starting with:", apiKey.substring(0, 15) + "...");
    
    // Make direct API call mimicking the Colab code
    const url = "https://api.anthropic.com/v1/messages";
    
    const headers = {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerous-direct-browser-access": "1" // Add this line
    };
    
    // Create a prompt just like in the Colab
    let prompt = "Classify each of the following texts into EXACTLY ONE of these categories:\n";
    prompt += "- safe\n";
    prompt += "- sexual\n";
    prompt += "- violent\n";
    prompt += "- wine/drugs\n";
    prompt += "- gambling\n";
    prompt += "- ath (this include atheism from Islamic perspective, and Blasphemer (which only cover The Quran and Sunnah))\n";
    prompt += "- Astrology\n";
    prompt += "- Text from Quran\n";
    prompt += "- Islam\n";
    prompt += "- LGBTQ\n\n";
    prompt += "Respond with a JSON array of category names only, no explanations or extra text and only accept one category as an answer.\n\n";
    prompt += `Text 1: ${testText}\n\n`;
    
    const payload = {
      "model": "claude-3-5-haiku-20241022",
      "max_tokens": 1000,
      "messages": [
        {
          "role": "user",
          "content": prompt
        }
      ]
    };
    
    console.log("[Background] Sending API request with payload:", payload);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Background] Direct API test failed with status ${response.status}:`, errorText);
      return {
        success: false,
        status: response.status,
        error: errorText
      };
    }
    
    const responseData = await response.json();
    console.log("[Background] Direct API test response:", responseData);
    
    // Extract classification from the response
    const content = responseData.content || [];
    if (content && content.length > 0) {
      const responseText = content[0]?.text?.trim() || "";
      console.log("[Background] Response text:", responseText);
      
      try {
        // Parse the JSON array response
        const startIdx = responseText.indexOf('[');
        const endIdx = responseText.lastIndexOf(']') + 1;
        
        if (startIdx >= 0 && endIdx > startIdx) {
          const jsonStr = responseText.substring(startIdx, endIdx);
          const categories = JSON.parse(jsonStr);
          
          console.log("[Background] Parsed categories:", categories);
          
          return {
            success: true,
            categories: categories,
            rawResponse: responseData
          };
        }
      } catch (err) {
        console.error("[Background] JSON parsing error:", err);
      }
    }
    
    return {
      success: true,
      error: "Could not parse category from response",
      rawResponse: responseData
    };
    
  } catch (error) {
    console.error("[Background] Direct API test error:", error);
    return {
      success: false,
      error: error.message
    };
  }
}


// Create offscreen document when background first loads
console.log("[BACKGROUND] Background script started");
setTimeout(() => {
  createOffscreenDocument();
}, 2000);

// Single, consolidated message handler with improved error handling
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Use a switch statement for better organization
  switch (message.action) {
    // Claude API related actions
    case "claudeAnalyzeTexts":
      claudeAnalyzeTexts(message.texts, message.apiKey)
        .then(results => {
          sendResponse({ success: true, results });
        })
        .catch(error => {
          console.error("Error in Claude API call:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep the message channel open for async response
      
    case "claudeTestConnection":
      claudeTestConnection(message.apiKey)
        .then(result => {
          sendResponse(result);
        })
        .catch(error => {
          console.error("Error in Claude API test:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
      
    case "runDirectApiTest":
      testDirectApiCall()
        .then(result => {
          console.log("[Background] Direct test result:", result);
          sendResponse(result);
        })
        .catch(error => {
          console.error("[Background] Direct test error:", error);
          sendResponse({ 
            success: false, 
            error: error.message 
          });
        });
      return true;
    
    // Image processing related actions
    case "processImageWithWorker":
      processImageInOffscreen(message.imageData, message.threshold)
        .then(result => {
          sendResponse({ success: true, result: result.result });
        })
        .catch(error => {
          console.error("[BACKGROUND] Image processing error:", error);
          sendResponse({ 
            success: false, 
            error: error.message || "Unknown error processing image" 
          });
        });
      return true;
    
    // Model management actions  
    case "initializeModel":
      createOffscreenDocument()
        .then(() => {
          sendResponse({ 
            success: true, 
            status: "initialization_started",
            modelStatus: modelStatus
          });
        })
        .catch(error => {
          console.error("[BACKGROUND] Error initializing model:", error);
          sendResponse({ 
            success: false, 
            error: error.message,
            modelStatus: modelStatus
          });
        });
      return true;
    
    case "updateModelThreshold":
      if (!offscreenDocumentReady) {
        createOffscreenDocument();
        sendResponse({ 
          success: false, 
          error: "Offscreen document not ready, initialization started"
        });
        return true;
      }
      
      sendMessageToOffscreen({
        action: 'updateThreshold',
        threshold: parseFloat(message.threshold)
      })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error("[BACKGROUND] Error updating threshold:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    
    case "setSensitiveClasses":
      if (!offscreenDocumentReady) {
        createOffscreenDocument();
        sendResponse({ 
          success: false, 
          error: "Offscreen document not ready, initialization started"
        });
        return true;
      }
      
      sendMessageToOffscreen({
        action: 'setSensitiveClasses',
        classes: message.classes
      })
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          console.error("[BACKGROUND] Error setting sensitive classes:", error);
          sendResponse({ success: false, error: error.message });
        });
      return true;
    
    case "fetchImage":
      const imageUrl = message.imageUrl;
      
      // Validate URL
      if (!imageUrl || typeof imageUrl !== 'string' || 
          !(imageUrl.startsWith('http://') || imageUrl.startsWith('https://'))) {
        sendResponse({ success: false, error: "Invalid image URL" });
        return true;
      }
      
      // Fetch image data
      fetch(imageUrl, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-cache',
        credentials: 'same-origin',
        redirect: 'follow',
        referrerPolicy: 'no-referrer'
      })
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
          }
          return response.blob();
        })
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            sendResponse({ success: true, dataUrl: reader.result });
          };
          reader.onerror = (error) => {
            sendResponse({ success: false, error: "Failed to convert image data" });
          };
          reader.readAsDataURL(blob);
        })
        .catch(error => {
          // Try no-cors fallback if needed
          if (error.message.includes("CORS")) {
            fetch(imageUrl, {
              method: 'GET',
              mode: 'no-cors',
              cache: 'no-cache',
              credentials: 'omit',
              redirect: 'follow',
              referrerPolicy: 'no-referrer'
            })
              .then(response => response.blob())
              .then(blob => {
                const reader = new FileReader();
                reader.onloadend = () => {
                  sendResponse({ success: true, dataUrl: reader.result, note: "Used no-cors mode" });
                };
                reader.readAsDataURL(blob);
              })
              .catch(err => {
                sendResponse({ success: false, error: "Failed in both CORS and no-cors modes" });
              });
          } else {
            sendResponse({ success: false, error: error.message });
          }
        });
      
      return true;
    
    case "getModelStatus":
      // If not ready or loaded, try to create the offscreen document
      if (!offscreenDocumentReady || (!modelStatus.isLoaded && !modelStatus.isLoading)) {
        // Only start creation if not already in progress
        if (!offscreenCreationInProgress) {
          createOffscreenDocument();
        }
      }
      
      sendResponse(modelStatus);
      return true;
    
    case "modelStatusUpdate":
      console.log("[BACKGROUND] Received model status update:", message);
      
      // Update the model status
      modelStatus.isLoaded = message.isLoaded;
      modelStatus.isLoading = message.isLoading;
      modelStatus.progress = message.progress || 0;
      
      if (message.error) {
        modelStatus.error = message.error;
      }
      
      // Broadcast to tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          try {
            chrome.tabs.sendMessage(tab.id, {
              action: "modelStatusUpdate",
              isLoaded: modelStatus.isLoaded,
              isLoading: modelStatus.isLoading,
              progress: modelStatus.progress,
              error: modelStatus.error
            }).catch(() => {});
          } catch (e) {
            // Ignore errors when sending to tabs
          }
        });
      });
      
      return true;
    
    case "modelError":
      console.error(`[BACKGROUND] Model error in ${message.context}:`, message.error);
      modelStatus.error = message.error;
      
      // Broadcast error to tabs
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          try {
            chrome.tabs.sendMessage(tab.id, {
              action: "modelError",
              context: message.context,
              error: message.error
            }).catch(() => {});
          } catch (e) {
            // Ignore errors when sending to tabs
          }
        });
      });
      
      return true;
      
    default:
      // No matching action found
      console.log("[BACKGROUND] Unknown message action:", message.action);
      return false;
  }
});