// At the very beginning of the file
console.log("🔴 Content script file started loading");

// Right before the window.misfah assignment 
console.log("🔵 About to create window.misfah object");

// Right after the window.misfah assignment
console.log("🟢 Created window.misfah object");

// At the DOMContentLoaded event
console.log("🟠 DOMContentLoaded fired");
// Improved content script with better error handling
console.log("[CONTENT] Content script loaded at", new Date().toISOString());

// Debug mode - set to true for detailed logging
const DEBUG_MODE = true;
// Track the results of text analysis
let twitterTextResults = {};
let threadsTextResults = {};
let pendingTextAnalysis = false;

// Define variables at the top level
let isEnabled = true; // Default filter state
let preferences = {
  polytheism: true,
  violence: true,
  gambling: true,
  alcohol: true,
};

// Default keywords for each category
const categoryKeywords = {
  polytheism: ["polytheism", "shirk", "idolatry"],
  violence: ["violence", "aggression", "abuse"],
  gambling: ["gambling", "betting", "casino", "قرعة"],
  alcohol: ["alcohol", "drinks", "liquor"],
};

let twitterFilteredCount = 0;
let threadsFilteredCount = 0;
let processedPosts = new Set(); // Track already processed posts
let lastAlertTime = 0; // Track the last time we showed an alert
let modelStatusChecks = 0;
const MAX_MODEL_STATUS_CHECKS = 90; // 90 checks = 90 seconds (with 1 second interval)

// Try creating the misfah object earlier in the file, right after variable declarations
window.misfah = {};
console.log("Created initial misfah object");

// Then populate it later
function setupDebugInterface() {
  console.log("Setting up debug interface");
  window.misfah.forceReprocess = forceReprocessAllContent;
  window.misfah.getStats = () => ({
    processedPosts: processedPosts.size,
    twitterResults: Object.keys(twitterTextResults).length,
    threadsResults: Object.keys(threadsTextResults).length,
    twitterFiltered: twitterFilteredCount,
    threadsFiltered: threadsFilteredCount
  });
  console.log("Debug interface set up successfully");
}

// Helper function for debugging
function debugLog(...args) {
  if (DEBUG_MODE) {
    console.log("[Sensitive Content Filter]", ...args);
  }
}

// ==========================================
// INITIALIZATION & HELPER FUNCTIONS
// ==========================================

// Helper function for throttled storage operations
function throttledStorageSave(data) {
  const now = Date.now();
  if (!window.lastStorageWriteTime || now - window.lastStorageWriteTime > 3000) {
    window.lastStorageWriteTime = now;
    chrome.storage.sync.set(data);
    debugLog("Storage updated:", data);
  } else {
    debugLog("Storage write throttled");
  }
}

// Add a debug function to force reprocessing of all visible content
function forceReprocessAllContent() {
  debugLog("Manual reprocessing of all content triggered");
  console.log("🔄 Misfah: Forcing reprocessing of all content");
  
  // Clear all tracking data
  processedPosts = new Set();
  twitterTextResults = {};
  threadsTextResults = {};
  
  // Remove processing markers from all posts
  const { twitterPosts, threadsPosts } = getPosts();
  
  Array.from(twitterPosts).forEach(post => {
    delete post.dataset.hasMisfahPlaceholder;
    delete post.dataset.misfahContentViewed;
    delete post.dataset.misfahProcessed;
  });
  
  Array.from(threadsPosts).forEach(post => {
    delete post.dataset.hasMisfahPlaceholder;
    delete post.dataset.misfahContentViewed;
    delete post.dataset.misfahProcessed;
  });
  
  // Run filtering 
  runFilterContent();
  
  return "Reprocessing triggered for " + 
         (twitterPosts.length + threadsPosts.length) + 
         " posts";
}

// Main initialization function - call this when the document is ready
function initializeExtension() {
  debugLog("Initializing extension...");
  
  // Load preferences and filter state from storage
  chrome.storage.sync.get(["preferences", "isEnabled", "twitterFilteredCount", "threadsFilteredCount", "threshold"], (data) => {
    debugLog("Initial filtering starting");
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    twitterFilteredCount = data.twitterFilteredCount || 0;
    threadsFilteredCount = data.threadsFilteredCount || 0;

    debugLog("Initial preferences loaded:", preferences);
    debugLog("Initial filtering state loaded:", isEnabled);
    
    // Initialize text API
    initializeTextAPI();
    
    // Setup URL change monitoring to reset state on navigation
    setupURLChangeMonitoring();
    
    // Initialize filtering
    checkModelAndStartFiltering();
  });
  debugLog("✅ Initialization complete - filter enabled: " + isEnabled);
  
  // Force an initial processing run
  setTimeout(() => {
    debugLog("🔄 Forcing initial content scan");
    runFilterContent();
  }, 3000);
}

// Wait for DOM content to be loaded
document.addEventListener("DOMContentLoaded", function() {
  debugLog("DOM content loaded, initializing Misfah");
  
  // Initialize our extension
  initializeExtension();
});

// Expose debug functions to console
window.misfah = {
  forceReprocess: forceReprocessAllContent,
  getStats: () => ({
    processedPosts: processedPosts.size,
    twitterResults: Object.keys(twitterTextResults).length,
    threadsResults: Object.keys(threadsTextResults).length,
    twitterFiltered: twitterFilteredCount,
    threadsFiltered: threadsFilteredCount
  })
};

// ==========================================
// MODEL & API INITIALIZATION
// ==========================================

// Initialize text API
function initializeTextAPI() {
  if (!window.textAnalysisAPI) {
    console.error("TextAnalysisAPI not available");
    return false;
  }
  
  // Load API key from storage
  chrome.storage.sync.get(["apiKey"], (data) => {
    if (data.apiKey) {
      window.textAnalysisAPI.setApiKey(data.apiKey);
      console.log("API key loaded from storage");
      
      // Test connection
      window.textAnalysisAPI.testConnection()
        .then(result => {
          if (result.success) {
            console.log("Claude API connection successful");
          } else {
            console.warn("Claude API connection failed:", result.error);
          }
        })
        .catch(error => {
          console.error("Claude API test error:", error);
        });
    } else {
      console.warn("No Claude API key found in storage");
      // You might want to notify the user they need an API key
    }
  });
  
  return true;
}

// Improved model status checking with proper error handling
function checkModelAndStartFiltering() {
  debugLog("Checking model status with background script");
  
  const checkModelStatus = () => {
    
    // Increment check counter
    modelStatusChecks++;
    
    // Give up after too many checks
    if (modelStatusChecks > MAX_MODEL_STATUS_CHECKS) {
      debugLog("Model check timed out after too many attempts");
      createWebpageAlert("فشل تحميل نموذج تحليل الصور - حصل خطأ في التحميل", null, true);
      
      // Try to filter content anyway (text only)
      if (isEnabled) {
        runFilterContent();
        setupMutationObserver();
      }
      return;
    }
    
    chrome.runtime.sendMessage({ action: "getModelStatus" }, (response) => {
      console.log("📊 Model status check response:", response);
      if (chrome.runtime.lastError) {
        debugLog("Error checking model status:", chrome.runtime.lastError.message);
        setTimeout(checkModelStatus, 1000); // Check again in 1 second
        return;
      }
      
      if (response && response.isLoaded) {
        debugLog("Model is loaded in background script, starting content filtering");
        
        // Start filtering with the real model
        if (isEnabled) {
          runFilterContent();
          setupMutationObserver();
        }
      } else if (response && response.error) {
        debugLog("Model loading failed with error:", response.error);
        
        // Show error to user
        createWebpageAlert(`فشل تحميل نموذج تحليل الصور: ${response.error}`, null, true);
        
        // Try to filter content anyway (text only)
        if (isEnabled) {
          runFilterContent();
          setupMutationObserver();
        }
      } else {
        debugLog("Model not loaded yet in background, waiting...");
        
        // If model is currently loading, show progress
        if (response && response.isLoading && response.progress > 0) {
          debugLog(`Model loading progress: ${response.progress}%`);
        }
        
        setTimeout(checkModelStatus, 1000); // Check again in 1 second
      }
    });
  };
  
  // Start checking
  checkModelStatus();
}

// ==========================================
// POST DETECTION & FILTERING FUNCTIONS
// ==========================================

// Function to get posts based on the platform
function getPosts() {
  const twitterPosts = document.querySelectorAll('[data-testid="tweet"]');
  console.log("📝 Found Twitter posts:", twitterPosts.length);
  const currentURL = window.location.hostname;
  
  if (currentURL.includes('twitter.com') || currentURL.includes('x.com')) {
    // For Twitter/X
    return {
      twitterPosts: document.querySelectorAll('[data-testid="tweet"]'),
      threadsPosts: []
    };
  } else if (currentURL.includes('threads.net')) {
    // For Threads
    return {
      twitterPosts: [],
      threadsPosts: document.querySelectorAll("article")
    };
  }
  
  return { twitterPosts: [], threadsPosts: [] };
}

// Find images in a post using multiple selectors
function findImagesInPost(post) {
  // Use multiple selectors to find images
  const imageSelectors = [
    'img[src*="media"]',                 // Traditional media
    'img[src*="pbs.twimg.com/media"]',   // Twitter media server
    'img[src*="twimg.com"]',             // Any Twitter image
    'article img',                       // Any image in an article
    '[data-testid="tweetPhoto"] img',    // Tweet photos
    'div[aria-label="Image"] img',       // Labeled images
    'div[data-testid="tweet"] img'       // Any image in tweet
  ];
  
  // Find all images using our comprehensive selectors
  const images = [];
  for (const selector of imageSelectors) {
    const found = post.querySelectorAll(selector);
    found.forEach(img => {
      // Don't add duplicates or profile photos
      if (!images.includes(img) && 
          !(img.alt && img.alt.toLowerCase().includes("profile"))) {
        images.push(img);
      }
    });
  }
  
  // Filter out small images
  return images.filter(img => (img.width >= 100 && img.height >= 100));
}

// Helper for post IDs
function getPostId(post) {
  if (!post._postId) {
    post._postId = 'post_' + Math.random().toString(36).substr(2, 9);
  }
  return post._postId;
}

// Helper function to check if a post has already been processed by Misfah
// Simplified check function
function isPostProcessedByMisfah(post) {
  // Just check processedPosts Set first
  if (processedPosts.has(post)) {
    return true;
  }
  
  // Only check dataset attributes as backup
  return post.dataset.hasMisfahPlaceholder === "true" || 
         post.dataset.misfahContentViewed === "true" ||
         post.dataset.misfahProcessed === "true";
}

// ==========================================
// TEXT ANALYSIS FUNCTIONS
// ==========================================

// Function to batch analyze posts texts
async function batchAnalyzePostsText() {
  if (pendingTextAnalysis) {
    debugLog("Text analysis already in progress, skipping");
    return;
  }
  
  pendingTextAnalysis = true;
  
  try {
    debugLog("Starting batch text analysis with Claude API");
    const { twitterPosts, threadsPosts } = getPosts();
    
    // Get unprocessed posts
    const unprocessedTwitterPosts = Array.from(twitterPosts).filter(post => !isPostProcessedByMisfah(post));
    const unprocessedThreadsPosts = Array.from(threadsPosts).filter(post => !isPostProcessedByMisfah(post));
    
    debugLog(`Found ${unprocessedTwitterPosts.length} unprocessed Twitter posts and ${unprocessedThreadsPosts.length} unprocessed Threads posts`);
    console.log(`Running batch text analysis: ${unprocessedTwitterPosts.length} Twitter posts, ${unprocessedThreadsPosts.length} Threads posts`);
    
    // Debug the DOM state if we're finding 0 unprocessed posts
    if (unprocessedTwitterPosts.length === 0 && twitterPosts.length > 0) {
      console.log("Debug: Twitter posts DOM state");
      Array.from(twitterPosts).slice(0, 3).forEach((post, index) => {
        console.log(`Post ${index + 1} data attributes:`, {
          hasMisfahPlaceholder: post.dataset.hasMisfahPlaceholder,
          misfahContentViewed: post.dataset.misfahContentViewed,
          misfahProcessed: post.dataset.misfahProcessed,
          inProcessedSet: processedPosts.has(post),
          firstTextChars: post.innerText.substring(0, 30)
        });
      });
    }
    
    // Process Twitter posts first
    if (unprocessedTwitterPosts.length > 0) {
      // Extract text content from posts
      const textsToAnalyze = unprocessedTwitterPosts.map(post => {
        const textElement = post.querySelector('[data-testid="tweetText"]');
        return textElement ? textElement.textContent.trim() : '';
      }).filter(text => text.length > 0); // Filter out empty texts
      
      if (textsToAnalyze.length > 0) {
        debugLog(`Analyzing ${textsToAnalyze.length} Twitter texts with Claude API`);
        console.log("Sample tweet text:", textsToAnalyze[0].substring(0, 100));
        
        // Use our textAnalysisAPI to analyze the texts
        try {
          const results = await window.textAnalysisAPI.analyzeTexts(textsToAnalyze);
          debugLog(`Received ${results.length} results from API`);
          console.log(`Text analysis results for ${results.length} tweets`);
          
          // Map results back to posts
          let resultIndex = 0;
          unprocessedTwitterPosts.forEach(post => {
            const textElement = post.querySelector('[data-testid="tweetText"]');
            if (textElement && textElement.textContent.trim()) {
              twitterTextResults[getPostId(post)] = results[resultIndex];
              console.log(`Assigned category '${results[resultIndex]}' to post`, post.innerText.substring(0, 30));
              resultIndex++;
            }
          });
        } catch (error) {
          console.error("Error analyzing Twitter texts:", error);
        }
      }
    }
    
    // Process Threads posts (similar logic to Twitter)
    if (unprocessedThreadsPosts.length > 0) {
      // Extract text content from posts
      const textsToAnalyze = unprocessedThreadsPosts.map(post => {
        return post.innerText.trim();
      }).filter(text => text.length > 0); // Filter out empty texts
      
      if (textsToAnalyze.length > 0) {
        debugLog(`Analyzing ${textsToAnalyze.length} Threads texts with Claude API`);
        
        // Use our textAnalysisAPI to analyze the texts
        try {
          const results = await window.textAnalysisAPI.analyzeTexts(textsToAnalyze);
          debugLog(`Received ${results.length} results from API`);
          
          // Map results back to posts
          let resultIndex = 0;
          unprocessedThreadsPosts.forEach(post => {
            const text = post.innerText.trim();
            if (text) {
              threadsTextResults[getPostId(post)] = results[resultIndex++];
            }
          });
        } catch (error) {
          console.error("Error analyzing Threads texts:", error);
        }
      }
    }
  } catch (error) {
    console.error("Error in batch text analysis:", error);
  } finally {
    pendingTextAnalysis = false;
  }
}

// Fallback keyword analysis
function analyzeTextWithKeywords(text) {
  const lowercaseText = text.toLowerCase();
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    if (preferences[category] && keywords.some(keyword => lowercaseText.includes(keyword))) {
      return category;
    }
  }
  return 'safe';
}

// ==========================================
// IMAGE ANALYSIS FUNCTIONS
// ==========================================

// Improved image processing with better error handling and logging
async function processImageWithModel(img) {
  // Check if filtering is disabled
  if (!isEnabled) {
    console.log("Image processing skipped - filtering is disabled");
    return { is_sensitive: false, reason: "filtering_disabled" };
  }
  
  try {
    debugLog("Processing image through background script:", img.src ? img.src.substring(0, 100) + "..." : "no src");
    console.log("Processing image:", img.width, "x", img.height, "src:", img.src ? img.src.substring(0, 50) + "..." : "no src");
    
    // Skip tiny or invalid images
    if (!img.src || img.width < 100 || img.height < 100) {
      debugLog("Skipping small or invalid image");
      return { is_sensitive: false, reason: "image_too_small_or_invalid" };
    }
    
    // Get image data
    let imageData;
    
    // For data URLs, use directly
    if (img.src && (img.src.startsWith('data:') || img.src.startsWith('blob:'))) {
      imageData = img.src;
      debugLog("Using direct data URL for image");
    } else {
      // For HTTP URLs, use the background script to fetch
      debugLog("Fetching image data through background script");
      try {
        imageData = await new Promise((resolve, reject) => {
          const fetchTimeout = setTimeout(() => {
            reject(new Error("Timeout fetching image data"));
          }, 10000); // 10 second timeout
          
          chrome.runtime.sendMessage(
            { action: "fetchImage", imageUrl: img.src }, 
            (response) => {
              clearTimeout(fetchTimeout);
              
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
              }
              
              if (response && response.success) {
                resolve(response.dataUrl);
              } else {
                reject(new Error(response?.error || "Unknown error fetching image"));
              }
            }
          );
        });
      } catch (fetchError) {
        debugLog("Error fetching image data:", fetchError.message);
        return { is_sensitive: false, error: fetchError.message };
      }
    }
    
    if (!imageData) {
      debugLog("No image data available");
      return { is_sensitive: false, reason: "image_data_unavailable" };
    }
    
    // Check again if filtering was disabled during fetching
    if (!isEnabled) {
      console.log("Image processing canceled - filtering was disabled during fetch");
      return { is_sensitive: false, reason: "filtering_disabled" };
    }
    
    // Send to background for processing with the real model
    debugLog("Sending image to background for processing");
    try {
      const result = await new Promise((resolve, reject) => {
        const processTimeout = setTimeout(() => {
          reject(new Error("Timeout processing image"));
        }, 15000); // 15 second timeout
        
        chrome.runtime.sendMessage(
          { 
            action: "processImageWithWorker", 
            imageData: imageData,
            threshold: 0.15 // Explicitly set threshold for consistent results
          },
          (response) => {
            clearTimeout(processTimeout);
            
            if (chrome.runtime.lastError) {
              debugLog("Error from background script: " + chrome.runtime.lastError.message);
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            
            if (response && response.success) {
              debugLog("Background model processing result: " + JSON.stringify(response.result));
              console.log("Image analysis result:", response.result);
              resolve(response.result);
            } else {
              debugLog("Error in background model processing: " + (response?.error || "Unknown error"));
              reject(new Error(response?.error || "Unknown error in model processing"));
            }
          }
        );
      });
      
      // One final check before returning result
      if (!isEnabled) {
        console.log("Image processing result discarded - filtering disabled before completion");
        return { is_sensitive: false, reason: "filtering_disabled" };
      }
      
      return result;
    } catch (processingError) {
      debugLog("Error processing image with background model:", processingError.message);
      return { is_sensitive: false, error: processingError.message };
    }
  } catch (error) {
    console.error("Error in processImageWithModel:", error);
    return { is_sensitive: false, error: error.message || "Unknown error" };
  }
}
// ==========================================
// CONTENT FILTERING MAIN FUNCTIONS
// ==========================================

// Update the runFilterContent function to include batch text analysis
async function runFilterContent() {
  console.log("Starting filtering with loader");
  debugLog("🔍 runFilterContent called - isEnabled=" + isEnabled);
  console.log("🔍 Starting filtering process - enabled=" + isEnabled);
  
  // Show loader only if there are enough unprocessed posts
  const { twitterPosts, threadsPosts } = getPosts();
  const unprocessedTwitterPosts = Array.from(twitterPosts).filter(post => !isPostProcessedByMisfah(post));
  const unprocessedThreadsPosts = Array.from(threadsPosts).filter(post => !isPostProcessedByMisfah(post));
  const totalUnprocessed = unprocessedTwitterPosts.length + unprocessedThreadsPosts.length;
  
  console.log(`Found ${totalUnprocessed} unprocessed posts`);
  
  // Only show loader if we have enough posts to process
  if (totalUnprocessed >= 10) {
    // First, do text analysis in batch
    await batchAnalyzePostsText();
    // Then process with loader
    return processWithLoader(() => filterContent());
  } else {
    // Just run without the loader for small batches
    if (totalUnprocessed > 0) {
      await batchAnalyzePostsText();
    }
    return filterContent();
  }
}

// Modified filterContent function to use placeholders instead of hiding content
async function filterContent() {
  if (!isEnabled) {
    debugLog("Filtering is disabled");
    return;
  }

  debugLog("Starting content filtering with Claude API and ML model");
  const { twitterPosts, threadsPosts } = getPosts();
  debugLog(`Found ${twitterPosts.length} Twitter posts, ${threadsPosts.length} Threads posts`);
  console.log("Raw posts found:", twitterPosts.length, "Twitter posts,", threadsPosts.length, "Threads posts");

  // First, analyze texts in batch if needed
  await batchAnalyzePostsText();

  let filteredCount = 0;

  // Filter Twitter posts
  for (const post of twitterPosts) {
    // Skip already processed posts
    if (processedPosts.has(post)) {
      console.log("Skipping already processed post");
      continue;
    }
    
    try {
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Log the post content for debugging
      const textElement = post.querySelector('[data-testid="tweetText"]');
      const textContent = textElement ? textElement.textContent.trim() : 'No text';
      console.log("Analyzing tweet:", textContent.substring(0, 100) + "...");
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = twitterTextResults[postId] || 'safe';
      console.log(`Tweet ${postId} text category:`, textCategory);
      
      // Initialize variables
      let shouldHide = textCategory !== 'safe';
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // If text wasn't sensitive, check for images
      if (!shouldHide) {
        console.log("Text not sensitive, checking images");
        // Check if the background model is ready
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          // Find all valid images in the post
          const images = findImagesInPost(post);
          debugLog(`Found ${images.length} images in the post`);
          console.log(`Found ${images.length} images in the post`);
          
          for (const img of images) {
            // Wait for the image to be loaded
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000); // Timeout after 1 second
              });
            }
            
            // Skip tiny images
            if (img.width < 100 || img.height < 100) {
              console.log("Skipping small image:", img.width, "x", img.height);
              continue;
            }
            
            try {
              // Process the image with the real model in background
              console.log("Processing image:", img.src ? img.src.substring(0, 100) + "..." : "no src");
              imageResult = await processImageWithModel(img);
              console.log("Image analysis result:", imageResult);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                debugLog(`Image detected as sensitive: ${sensitiveCategories.join(', ')}`);
                debugLog(`Detection confidence: ${imageResult.confidence}`);
                console.log(`IMAGE SENSITIVE: ${sensitiveCategories.join(', ')}, confidence: ${imageResult.confidence}`);
                break; // Stop processing more images in this post
              } else {
                console.log("Image not sensitive");
              }
            } catch (imgError) {
              debugLog(`Error processing image: ${imgError.message}`);
              console.error(`Error processing image: ${imgError.message}`);
              // Continue with next image
            }
          }
        } else {
          debugLog("Skipping image analysis - model not loaded");
          console.log("Skipping image analysis - model not loaded");
        }
      } else {
        debugLog(`Twitter post filtered by text analysis: ${textCategory}`);
        console.log(`SENSITIVE TEXT: Twitter post filtered by text analysis: ${textCategory}`);
      }

      // After analysis, log the result
      console.log("Tweet analysis result:", {
        postId: postId,
        category: textCategory,
        shouldHide: shouldHide,
        sensitiveCategories: sensitiveCategories
      });

      // Apply filtering if the post contains sensitive content
      if (shouldHide) {
        // Save the original HTML before modifying
        const originalContent = post.innerHTML;
        
        // Replace with placeholder instead of hiding
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        
        twitterFilteredCount++;
        filteredCount++;
        
        // If the post is hidden, log it clearly
        console.log("HIDDEN TWEET:", textContent.substring(0, 100) + "...", "Category:", sensitiveCategories.join(', '));
        
        // Show alert for sensitive content
        const categoryNames = sensitiveCategories.join(', ');
        createWebpageAlert(
          `تنبيه: تم حجب محتوى حساس: ${categoryNames}`, 
          imageResult // Pass the model result for confidence display
        );
      } else {
        console.log("Tweet is safe, not hiding");
      }
    } catch (error) {
      console.error("Error filtering Twitter post:", error);
    }
  }

  // Filter Threads posts with a similar approach
  for (const post of threadsPosts) {
    // Skip already processed posts
    if (processedPosts.has(post) || isPostProcessedByMisfah(post)) {
      console.log("Skipping already processed Threads post");
      continue;
    }
    
    try {
      // Mark post as processed to avoid reprocessing
      processedPosts.add(post);
      post.dataset.misfahProcessed = "true";
      
      // Log the post content for debugging
      const textContent = post.innerText.trim();
      console.log("Analyzing Threads post:", textContent.substring(0, 100) + "...");
      
      // Get text analysis result from our batch processing
      const postId = getPostId(post);
      const textCategory = threadsTextResults[postId] || 'safe';
      console.log(`Threads post ${postId} text category:`, textCategory);
      
      // Initialize variables
      let shouldHide = textCategory !== 'safe';
      let sensitiveCategories = shouldHide ? [textCategory] : [];
      let imageResult = null;

      // If text wasn't sensitive, check for images
      if (!shouldHide) {
        console.log("Text not sensitive, checking images");
        // Check if the background model is ready
        const modelStatus = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: "getModelStatus" }, response => {
            resolve(response || { isLoaded: false });
          });
        });
        
        if (modelStatus.isLoaded) {
          // Find images in the Threads post
          const images = post.querySelectorAll('img:not([alt="Profile photo"])'); // Exclude profile pictures
          debugLog(`Found ${images.length} images in Threads post`);
          console.log(`Found ${images.length} images in Threads post`);
          
          for (const img of images) {
            // Wait for the image to be loaded
            if (!img.complete) {
              await new Promise(resolve => {
                img.onload = resolve;
                img.onerror = resolve;
                setTimeout(resolve, 1000);
              });
            }
            
            // Skip tiny images
            if (img.width < 100 || img.height < 100) {
              console.log("Skipping small image:", img.width, "x", img.height);
              continue;
            }
            
            try {
              // Process with the real model in background
              console.log("Processing image:", img.src ? img.src.substring(0, 100) + "..." : "no src");
              imageResult = await processImageWithModel(img);
              console.log("Image analysis result:", imageResult);
              
              if (imageResult && imageResult.is_sensitive) {
                shouldHide = true;
                sensitiveCategories = imageResult.detected_categories || [];
                debugLog(`Image detected as sensitive: ${sensitiveCategories.join(', ')}`);
                console.log(`IMAGE SENSITIVE: ${sensitiveCategories.join(', ')}, confidence: ${imageResult.confidence}`);
                break;
              } else {
                console.log("Image not sensitive");
              }
            } catch (imgError) {
              debugLog(`Error processing image: ${imgError.message}`);
              console.error(`Error processing image: ${imgError.message}`);
              // Continue with next image
            }
          }
        } else {
          debugLog("Skipping image analysis - model not loaded");
          console.log("Skipping image analysis - model not loaded");
        }
      } else {
        debugLog(`Threads post filtered by text analysis: ${textCategory}`);
        console.log(`SENSITIVE TEXT: Threads post filtered by text analysis: ${textCategory}`);
      }

      // After analysis, log the result
      console.log("Threads post analysis result:", {
        postId: postId,
        category: textCategory,
        shouldHide: shouldHide, 
        sensitiveCategories: sensitiveCategories
      });

      // Apply filtering if the post contains sensitive content
      if (shouldHide) {
        // Save the original HTML before modifying
        const originalContent = post.innerHTML;
        
        // Replace with placeholder instead of hiding
        createFilteredPostPlaceholder(post, sensitiveCategories, originalContent);
        
        threadsFilteredCount++;
        filteredCount++;
        
        // If the post is hidden, log it clearly
        console.log("HIDDEN THREADS POST:", textContent.substring(0, 100) + "...", "Category:", sensitiveCategories.join(', '));
        
        // Show alert for sensitive content
        const categoryNames = sensitiveCategories.join(', ');
        createWebpageAlert(
          `تنبيه: تم حجب محتوى حساس: ${categoryNames}`,
          imageResult
        );
      } else {
        console.log("Threads post is safe, not hiding");
      }
    } catch (error) {
      console.error("Error filtering Threads post:", error);
    }
  }

  // Save updated statistics to Chrome storage (with throttling)
  if (filteredCount > 0) {
    throttledStorageSave({
      twitterFilteredCount,
      threadsFilteredCount
    });
    console.log(`Filtered ${filteredCount} posts in total`);
  } else {
    console.log("No posts were filtered");
  }
  
  return filteredCount;
}

// ==========================================
// PLACEHOLDER & CONTENT HANDLING FUNCTIONS
// ==========================================

// Updated function to create a placeholder for filtered content instead of hiding it
function createFilteredPostPlaceholder(post, categories, originalContent) {
  // Store the original display style
  post._originalDisplay = post.style.display;
  
  // Store the original content for restoration later
  post._originalContent = originalContent || post.innerHTML;
  
  // Store the categories for later reference
  post._sensitiveCategories = categories;
  
  // Mark this post as having a placeholder (to avoid reprocessing)
  post.dataset.hasMisfahPlaceholder = "true";
  
  // Create a timestamp ID to ensure unique button IDs
  const uniqueId = Date.now() + Math.floor(Math.random() * 1000);
  
  // Format categories for display
  const categoryText = Array.isArray(categories) && categories.length > 0
    ? categories.join('، ') // Arabic comma
    : "محتوى غير مناسب";
  
  // Create placeholder content
  const placeholderHTML = `
    <div class="misfah-placeholder" style="border:1px solid #e0e0e0; border-radius:12px; background-color:#f8f8f8; 
               padding:15px; text-align:center; direction:rtl; margin:10px 0; position:relative;">
      <div style="position:absolute; top:10px; left:10px; font-size:12px; color:#888;">
        <span style="background-color:#4fa3f7; color:white; padding:2px 6px; border-radius:3px; font-size:10px;">مصفاة</span>
      </div>
      <div style="font-weight:bold; margin-bottom:10px; margin-top:10px; color:#333;">
        تم حجب محتوى حساس: ${categoryText}
      </div>
      <button id="misfah-show-content-${uniqueId}" style="background-color:#4fa3f7; border:none;
              border-radius:4px; padding:5px 10px; cursor:pointer; font-weight:bold; color:white;">
        إظهار المحتوى
      </button>
    </div>
  `;
  
  // Replace content with placeholder
  post.innerHTML = placeholderHTML;
  
  // Add event listener to the show button
  setTimeout(() => {
    const showButton = document.getElementById(`misfah-show-content-${uniqueId}`);
    if (showButton) {
      showButton.addEventListener('click', function(event) {
        // Prevent event propagation
        event.preventDefault();
        event.stopPropagation();
        
        // Restore original content
        post.innerHTML = post._originalContent;
        
        // Add a visual sensitive content indicator wrapper
        addSensitiveContentIndicator(post, categories);
        
        // Mark as viewed (to prevent reprocessing)
        post.dataset.misfahContentViewed = "true";
        delete post.dataset.hasMisfahPlaceholder;
        
        console.log("Misfah: Content restored by user action but marked as sensitive");
        return false;
      });
    }
  }, 0);
}

// Function to add a visual indicator for sensitive content that has been shown
function addSensitiveContentIndicator(post, categories) {
  // Format categories for the warning banner
  const categoryText = Array.isArray(categories) && categories.length > 0
    ? categories.join('، ') // Arabic comma
    : "محتوى غير مناسب";
  
  // Create a warning banner at the top of the post
  const warningBanner = document.createElement('div');
  warningBanner.className = 'misfah-sensitive-indicator';
  warningBanner.innerHTML = `
    <div class="misfah-warning-icon">⚠️</div>
    <div class="misfah-warning-text">محتوى حساس: ${categoryText}</div>
  `;
  
  // Create a red outline for the post
  post.classList.add('misfah-sensitive-content');
  
  // Add the banner to the beginning of the post
  if (post.firstChild) {
    post.insertBefore(warningBanner, post.firstChild);
  } else {
    post.appendChild(warningBanner);
  }
}

// Function to show all content
function showAllContent() {
  const { twitterPosts, threadsPosts } = getPosts();
  
  // Process Twitter posts
  twitterPosts.forEach((post) => {
    // If this post has a placeholder, restore original content
    if (post.dataset.hasMisfahPlaceholder === "true" && post._originalContent) {
      post.innerHTML = post._originalContent;
      
      // Add sensitive content visual indicator
      if (post._sensitiveCategories) {
        addSensitiveContentIndicator(post, post._sensitiveCategories);
      }
      
      // Mark as viewed to prevent reprocessing
      post.dataset.misfahContentViewed = "true";
      delete post.dataset.hasMisfahPlaceholder;
    }
    // Ensure visible
    post.style.display = "";
  });
  
  // Process Threads posts
  threadsPosts.forEach((post) => {
    // If this post has a placeholder, restore original content
    if (post.dataset.hasMisfahPlaceholder === "true" && post._originalContent) {
      post.innerHTML = post._originalContent;
      
      // Add sensitive content visual indicator
      if (post._sensitiveCategories) {
        addSensitiveContentIndicator(post, post._sensitiveCategories);
      }
      
      // Mark as viewed to prevent reprocessing
      post.dataset.misfahContentViewed = "true";
      delete post.dataset.hasMisfahPlaceholder;
    }
    // Ensure visible
    post.style.display = "";
  });
  
  debugLog("Showing all posts with sensitive content indicators");
}

// ==========================================
// UI COMPONENTS & VISUAL FEEDBACK
// ==========================================

// Function to create and display an alert box on the webpage
function createWebpageAlert(message, modelResult = null, isError = false) {
  // For errors, always show. For normal alerts, limit frequency
  if (!isError) {
    // Limit alert frequency (no more than one every 5 seconds)
    const now = Date.now();
    if (now - lastAlertTime < 5000) {
      return; // Avoid showing alerts too frequently
    }
    lastAlertTime = now;
  }
  
  if (document.getElementById("webpage-alert")) {
    document.getElementById("webpage-alert").remove(); // Remove existing alert
  }

  const alertBox = document.createElement("div");
  alertBox.id = "webpage-alert";
  alertBox.style.position = "fixed";
  alertBox.style.top = "0";
  alertBox.style.left = "0";
  alertBox.style.width = "100%";
  alertBox.style.backgroundColor = isError ? "#e74c3c" : "#ff4d4d";
  alertBox.style.color = "white";
  alertBox.style.padding = "10px";
  alertBox.style.textAlign = "center";
  alertBox.style.zIndex = "10000";
  alertBox.style.fontSize = "16px";
  alertBox.style.fontWeight = "bold";
  alertBox.style.direction = "rtl"; // Right-to-left for Arabic
  
  // Add the main message
  const messageElement = document.createElement("div");
  messageElement.textContent = message || "تنبيه: قد تحتوي هذه الصفحة على محتوى غير مرغوب بناءً على اختياراتك";
  alertBox.appendChild(messageElement);
  
  // Add model confidence info if available
  if (modelResult && modelResult.confidence) {
    const confidencePercent = Math.round(modelResult.confidence * 100);
    const detailsElement = document.createElement("div");
    detailsElement.style.fontSize = "12px";
    detailsElement.style.marginTop = "5px";
    detailsElement.style.fontWeight = "normal";
    
    // Add model-specific details
    let detailsText = `نسبة الثقة: ${confidencePercent}%`;
    
    // Add information about detected categories with top predictions
    if (modelResult.top_predictions && modelResult.top_predictions.length > 0) {
      detailsText += ` | الفئات: `;
      modelResult.top_predictions.forEach((pred, idx) => {
        if (idx > 0) detailsText += ", ";
        const predPercent = Math.round(pred.probability * 100);
        detailsText += `${pred.class_name} (${predPercent}%)`;
      });
    }
    
    detailsElement.textContent = detailsText;
    alertBox.appendChild(detailsElement);
  }

  // Add close button
  const closeButton = document.createElement("button");
  closeButton.textContent = "✖";
  closeButton.style.position = "absolute";
  closeButton.style.top = "2px";
  closeButton.style.right = "20px";
  closeButton.style.backgroundColor = "transparent";
  closeButton.style.color = "white";
  closeButton.style.border = "none";
  closeButton.style.padding = "5px 10px";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontWeight = "bold";
  closeButton.style.fontSize = "16px";

  closeButton.addEventListener("click", () => {
    alertBox.remove();
  });

  alertBox.appendChild(closeButton);
  document.body.prepend(alertBox);
  
  // Auto-hide after 5 seconds for normal alerts, 10 seconds for errors
  setTimeout(() => {
    if (alertBox.parentNode) {
      alertBox.remove();
    }
  }, isError ? 10000 : 5000);
}

// Function to create and display a loader overlay
function createMisfahLoader(message) {
  console.log("Creating Misfah loader element...");
  
  // Remove existing loader if present
  if (document.getElementById("webpage-loader")) {
    document.getElementById("webpage-loader").remove();
  }
  if (document.getElementById("webpage-loader-overlay")) {
    document.getElementById("webpage-loader-overlay").remove();
  }

  // Save the original body overflow style
  const originalBodyOverflow = document.body.style.overflow;
  
  // Prevent scrolling
  document.body.style.overflow = "hidden";

  // Create overlay first
  const overlay = document.createElement('div');
  overlay.id = "webpage-loader-overlay";
  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.width = "100%";
  overlay.style.height = "100%";
  overlay.style.backgroundColor = "rgba(0, 0, 0, 0.5)";
  overlay.style.zIndex = "9999";
  document.body.appendChild(overlay);

  // Create the loader element with all styles directly applied
  const loaderBox = document.createElement("div");
  loaderBox.id = "webpage-loader";
  loaderBox.style.position = "fixed";
  loaderBox.style.top = "50%";
  loaderBox.style.left = "50%";
  loaderBox.style.transform = "translate(-50%, -50%)";
  loaderBox.style.width = "320px";
  loaderBox.style.backgroundColor = "#ffffff";
  loaderBox.style.color = "#333333";
  loaderBox.style.padding = "20px";
  loaderBox.style.borderRadius = "10px";
  loaderBox.style.boxShadow = "0 4px 20px rgba(0, 0, 0, 0.2)";
  loaderBox.style.textAlign = "center";
  loaderBox.style.direction = "rtl";
  loaderBox.style.zIndex = "10000";
  loaderBox.style.fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  loaderBox.style.display = "flex";
  loaderBox.style.flexDirection = "column";
  loaderBox.style.alignItems = "center";

  // Create the header/title with direct styles
  const title = document.createElement("div");
  title.textContent = message || "تحليل المحتوى";
  title.style.fontSize = "18px";
  title.style.fontWeight = "bold";
  title.style.marginBottom = "15px";
  title.style.color = "#333";
  title.style.width = "100%";
  loaderBox.appendChild(title);

  // Create spinner with direct styles
  const spinner = document.createElement("div");
  spinner.style.width = "40px";
  spinner.style.height = "40px";
  spinner.style.margin = "0 auto 15px auto";
  spinner.style.border = "4px solid rgba(0, 120, 255, 0.1)";
  spinner.style.borderRadius = "50%";
  spinner.style.borderLeftColor = "#0078ff";
  loaderBox.appendChild(spinner);

  // Add spinner animation directly in JS
  spinner.animate(
    [
      { transform: 'rotate(0deg)' },
      { transform: 'rotate(360deg)' }
    ],
    {
      duration: 1000,
      iterations: Infinity
    }
  );

  // Create progress text with direct styles
  const progressText = document.createElement("div");
  progressText.id = "loader-progress-text";
  progressText.textContent = "جارٍ تحليل المنشورات... 0%";
  progressText.style.fontSize = "14px";
  progressText.style.marginBottom = "10px";
  progressText.style.color = "#666";
  progressText.style.width = "100%";
  loaderBox.appendChild(progressText);

  // Create progress bar container with direct styles
  const progressBarContainer = document.createElement("div");
  progressBarContainer.style.width = "100%";
  progressBarContainer.style.height = "8px";
  progressBarContainer.style.backgroundColor = "#e9ecef";
  progressBarContainer.style.borderRadius = "4px";
  progressBarContainer.style.overflow = "hidden";
  progressBarContainer.style.marginBottom = "15px";
  loaderBox.appendChild(progressBarContainer);

  // Create progress bar fill with direct styles
  const progressBarFill = document.createElement("div");
  progressBarFill.id = "loader-progress-bar";
  progressBarFill.style.width = "0%";
  progressBarFill.style.height = "100%";
  progressBarFill.style.backgroundColor = "#0078ff";
  progressBarFill.style.borderRadius = "4px";
  progressBarFill.style.transition = "width 0.5s ease";
  progressBarContainer.appendChild(progressBarFill);

  // Create close button with direct styles
  const closeButton = document.createElement("button");
  closeButton.textContent = "إغلاق";
  closeButton.style.backgroundColor = "#f1f3f5";
  closeButton.style.color = "#333";
  closeButton.style.border = "none";
  closeButton.style.padding = "8px 16px";
  closeButton.style.borderRadius = "4px";
  closeButton.style.cursor = "pointer";
  closeButton.style.fontWeight = "bold";
  closeButton.style.fontSize = "14px";
  closeButton.style.marginTop = "10px";
  
  closeButton.addEventListener("click", () => {
    console.log("Close button clicked");
    // Restore scrolling
    document.body.style.overflow = originalBodyOverflow;
    // Remove elements
    if (document.getElementById("webpage-loader-overlay")) {
      document.getElementById("webpage-loader-overlay").remove();
    }
    if (document.getElementById("webpage-loader")) {
      document.getElementById("webpage-loader").remove();
    }
  });
  loaderBox.appendChild(closeButton);

  // Add to document
  console.log("Appending loader to body...");
  document.body.appendChild(loaderBox);
  console.log("Loader should now be visible");
  
  return {
    updateProgress: function(percent) {
      console.log(`Updating progress to ${percent}%`);
      const progressBar = document.getElementById("loader-progress-bar");
      const progressTextElement = document.getElementById("loader-progress-text");
      
      if (progressBar) {
        progressBar.style.width = `${percent}%`;
      } else {
        console.error("Progress bar element not found");
      }
      
      if (progressTextElement) {
        progressTextElement.textContent = `جارٍ تحليل المنشورات... ${percent}%`;
      } else {
        console.error("Progress text element not found");
      }
    },
    
    complete: function() {
      console.log("Marking loader as complete");
      const progressBar = document.getElementById("loader-progress-bar");
      const progressTextElement = document.getElementById("loader-progress-text");
      
      if (progressBar) {
        progressBar.style.width = "100%";
        progressBar.style.backgroundColor = "#28a745"; // Change to green
      } else {
        console.error("Progress bar element not found for completion");
      }
      
      if (progressTextElement) {
        progressTextElement.textContent = "تم الانتهاء من التحليل";
      } else {
        console.error("Progress text element not found for completion");
      }
      
      // Auto-hide after 2 seconds
      console.log("Setting up auto-hide in 2 seconds");
      setTimeout(() => {
        // Restore scrolling
        document.body.style.overflow = originalBodyOverflow;
        // Remove elements
        if (document.getElementById("webpage-loader-overlay")) {
          document.getElementById("webpage-loader-overlay").remove();
        }
        if (document.getElementById("webpage-loader")) {
          document.getElementById("webpage-loader").remove();
        }
      }, 2000);
    },
    
    remove: function() {
      console.log("Manually removing loader");
      // Restore scrolling
      document.body.style.overflow = originalBodyOverflow;
      // Remove elements
      if (document.getElementById("webpage-loader-overlay")) {
        document.getElementById("webpage-loader-overlay").remove();
      }
      if (document.getElementById("webpage-loader")) {
        document.getElementById("webpage-loader").remove();
      }
    }
  };
}

// Add a function to use the loader with your existing filtering system
function processWithLoader(processingFunction) {
  console.log("Starting processing with loader");
  
  const loader = createMisfahLoader("تحليل المحتوى");
  let progress = 0;
  
  // Start a progress simulation
  const progressInterval = setInterval(() => {
    progress += 5;
    if (progress <= 90) {
      loader.updateProgress(progress);
    }
  }, 300);
  
  return Promise.resolve()
    .then(() => {
      // Call the actual processing function
      return processingFunction();
    })
    .then((result) => {
      // Complete the loader
      clearInterval(progressInterval);
      loader.updateProgress(100);
      loader.complete();
      return result;
    })
    .catch((error) => {
      // Handle errors
      clearInterval(progressInterval);
      loader.remove();
      console.error("Error during processing:", error);
      throw error;
    });
}

// Test function for the loader
function testMisfahLoader() {
  console.log("Starting Misfah loader test");
  
  // Create the loader
  const loader = createMisfahLoader("اختبار تحليل المحتوى - Misfah");
  
  // Update progress over time
  let progress = 0;
  const interval = setInterval(() => {
    progress += 10;
    loader.updateProgress(progress);
    
    if (progress >= 100) {
      clearInterval(interval);
      loader.complete();
      console.log("Loader test completed");
    }
  }, 500);
}

// ==========================================
// MUTATION & NAVIGATION OBSERVERS
// ==========================================

// Function to reset the processed posts tracking when new tweets are loaded
function resetProcessedPostsTracking(mutations) {
  // Count significant additions to the DOM
  const significantAdditions = mutations.reduce((count, mutation) => {
    return count + mutation.addedNodes.length;
  }, 0);
  
  // If we see several new nodes, likely new tweets loaded
  if (significantAdditions > 5) {
    debugLog(`Detected ${significantAdditions} new nodes - resetting processed posts tracking`);
    processedPosts = new Set();
    return true;
  }
  
  return false;
}

// Set up mutation observer to detect new content and reset tracking when needed
function setupMutationObserver() {
  console.log("⚙️ Setting up mutation observer");
  debugLog("Setting up mutation observer");
  
  // Create a throttled observer to prevent too many runs
  let lastObserverRun = 0;
  const throttledObserver = new MutationObserver((mutations) => {
    const now = Date.now();
    
    // Check if we need to reset our processed posts tracking
    // due to significant DOM changes (like new tweets being loaded)
    const wasReset = resetProcessedPostsTracking(mutations);
    
    // Only run filtering at most once per second
    if (now - lastObserverRun > 1000 || wasReset) {
      lastObserverRun = now;
      if (isEnabled) {
        debugLog("Mutation observer triggered filtering");
        runFilterContent();
      }
    }
  });

  // Start observing the document with the configured parameters
  throttledObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Clean up observer when extension is disabled/removed
  window.addEventListener("unload", () => {
    throttledObserver.disconnect();
  });
  
  debugLog("Mutation observer initialized");
}

// Function to handle URL changes and reset state
function setupURLChangeMonitoring() {
  let lastURL = window.location.href;
  
  // Check for URL changes periodically
  setInterval(() => {
    const currentURL = window.location.href;
    if (currentURL !== lastURL) {
      debugLog(`URL changed from ${lastURL} to ${currentURL}, resetting state`);
      console.log("URL changed, resetting Misfah state");
      
      // Reset all tracking
      processedPosts = new Set();
      twitterTextResults = {};
      threadsTextResults = {};
      
      // Run filtering after a small delay to let the new page load
      setTimeout(() => {
        if (isEnabled) {
          runFilterContent();
        }
      }, 1000);
      
      lastURL = currentURL;
    }
  }, 1000);
  
  // Also monitor for Twitter's SPA navigation events that don't change the URL
  document.addEventListener('click', (event) => {
    // Check if clicked element is a navigation link
    const isNavigation = event.target.closest('a[href^="/"]') || 
                        event.target.closest('a[role="link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Home_Link"]') ||
                        event.target.closest('[data-testid="AppTabBar_Explore_Link"]');
    
    if (isNavigation) {
      debugLog("Navigation click detected, scheduling state reset");
      
      // Reset all tracking after a slight delay to ensure navigation completes
      setTimeout(() => {
        processedPosts = new Set();
        twitterTextResults = {};
        threadsTextResults = {};
        
        // Run filtering if enabled
        if (isEnabled) {
          runFilterContent();
        }
      }, 1500);
    }
  });
  
  debugLog("URL change monitoring initialized");
}

// ==========================================
// MESSAGE HANDLING
// ==========================================

// Listen for messages from popup or background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Message received in content script:", message);
  
  if (message.action === "updateApiKey") {
    if (window.textAnalysisAPI) {
      window.textAnalysisAPI.setApiKey(message.apiKey);
      console.log("API key updated from popup");
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.action === "testApiConnection") {
    if (!window.textAnalysisAPI) {
      sendResponse({ 
        success: false, 
        error: "واجهة برمجة تحليل النصوص غير متوفرة" 
      });
      return true;
    }
    
    // Test the connection
    window.textAnalysisAPI.testConnection()
      .then(result => {
        if (result.success) {
          sendResponse({ 
            success: true, 
            message: "تم الاتصال بنجاح" 
          });
        } else {
          sendResponse({ 
            success: false, 
            error: result.error || "فشل الاتصال بالخادم" 
          });
        }
      })
      .catch(error => {
        console.error("API test error:", error);
        sendResponse({ 
          success: false, 
          error: error.message || "حدث خطأ أثناء الاتصال"
        });
      });
    
    return true;
  }

  if (message.action === "displayAlert") {
    createWebpageAlert(message.message);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "checkModelStatus") {
    // Forward to background script to get real status
    chrome.runtime.sendMessage({ action: "getModelStatus" }, (response) => {
      sendResponse({ 
        modelLoaded: response?.isLoaded || false,
        modelInitializing: response?.isLoading || false,
        modelError: response?.error || null
      });
    });
    return true;
  }
  
  if (message.action === "updateModelThreshold") {
    // Forward to background
    chrome.runtime.sendMessage({
      action: "updateModelThreshold",
      threshold: message.threshold
    });
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "modelStatusUpdate") {
    // Received status update from background
    debugLog(`Received model status update: loaded=${message.isLoaded}, loading=${message.isLoading}`);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "modelError") {
    // Model encountered an error
    debugLog(`Received model error: ${message.error}`);
    createWebpageAlert(`حدث خطأ في تحميل النموذج: ${message.error}`, null, true);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.action === "testLoader") {
    console.log("Test loader message received");
    testMisfahLoader();
    sendResponse({ success: true });
    return true;
  }
  
  return false;
});

// Immediate initialization to ensure filtering starts
console.log("🔄 Starting immediate initialization");
setTimeout(() => {
  debugLog("Initial filtering checking model");
  
  // Force a direct loading of initial settings
  chrome.storage.sync.get(["preferences", "isEnabled"], (data) => {
    if (data.isEnabled !== undefined) {
      isEnabled = data.isEnabled;
    }
    
    if (data.preferences) {
      preferences = data.preferences;
    }
    
    console.log("Loaded initial settings, isEnabled =", isEnabled);
    
    // Start checking model and filtering
    checkModelAndStartFiltering();
  });
}, 1000);