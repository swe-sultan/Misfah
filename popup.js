// Load saved settings from Chrome storage
chrome.storage.sync.get(["keywords", "isEnabled", "preferences", "threshold"], (data) => {
  if (data.keywords) {
    document.getElementById("keywords").value = data.keywords.join(", ");
  }

  // Set toggle state
  document.getElementById("filterToggle").checked = data.isEnabled !== false;
  
  // Set threshold value if available
  if (data.threshold) {
    const thresholdSlider = document.getElementById("threshold-slider");
    const thresholdValue = document.getElementById("threshold-value");
    if (thresholdSlider && thresholdValue) {
      thresholdSlider.value = data.threshold;
      thresholdValue.textContent = data.threshold;
    }
  }
  
  // Check model status in active tab
  checkModelStatus();
});

// Save new keywords to Chrome storage
document.getElementById("save").addEventListener("click", () => {
  const keywords = document.getElementById("keywords").value.split(",").map((k) => k.trim());
  chrome.storage.sync.set({ keywords });
  showCustomAlert("تم حفظ الكلمات المفتاحية بنجاح!");
});

// Handle toggle switch
document.getElementById("filterToggle").addEventListener("change", (e) => {
  const isEnabled = e.target.checked;
  chrome.storage.sync.set({ isEnabled });
  showCustomAlert(isEnabled ? "تم تفعيل الفلتر" : "تم إيقاف الفلتر");
  
  // If enabled, check model status
  if (isEnabled) {
    checkModelStatus();
  }
});

// Add these functions to your popup.js file

// Load the API key from storage
function loadApiKey() {
  chrome.storage.sync.get(["apiKey"], (data) => {
    if (data.apiKey) {
      document.getElementById("api-key").value = data.apiKey;
      console.log("API key loaded from storage");
    }
  });
}

// Save API key to storage
document.getElementById("save-api-key").addEventListener("click", () => {
  const apiKey = document.getElementById("api-key").value.trim();
  
  if (!apiKey) {
    updateApiStatus("يرجى إدخال مفتاح API", "error");
    return;
  }
  
  chrome.storage.sync.set({ apiKey }, () => {
    console.log("API key saved to storage");
    updateApiStatus("تم حفظ مفتاح API بنجاح", "success");
    
    // Send message to active tab to update the API key
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: "updateApiKey", 
          apiKey: apiKey 
        });
      }
    });
  });
});

// Test API connection
document.getElementById("test-api").addEventListener("click", () => {
  const apiKey = document.getElementById("api-key").value.trim();
  
  if (!apiKey) {
    updateApiStatus("يرجى إدخال مفتاح API أولاً", "error");
    return;
  }
  
  updateApiStatus("جارٍ اختبار الاتصال...", "loading");
  
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "testApiConnection"
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error testing connection:", chrome.runtime.lastError);
          updateApiStatus("خطأ في الاتصال بالصفحة: " + chrome.runtime.lastError.message, "error");
          return;
        }
        
        if (response && response.success) {
          updateApiStatus("تم الاتصال بنجاح", "success");
        } else {
          updateApiStatus(response.error || "فشل الاتصال", "error");
        }
      });
    } else {
      updateApiStatus("لا توجد صفحة نشطة", "error");
    }
  });
});

// Update the API status indicator
function updateApiStatus(message, status) {
  const statusElement = document.getElementById("api-status");
  statusElement.textContent = message;
  statusElement.className = "api-status";
  
  if (status) {
    statusElement.classList.add(status);
  }
}

// Call this in your document.addEventListener("DOMContentLoaded", ...) function
// Add this line to your existing DOMContentLoaded event listener
// document.addEventListener("DOMContentLoaded", () => {
//   loadStatistics();
//   loadApiKey(); // Add this line
// });
function checkModelStatus() {
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        // Check if the tab is compatible with our extension
        const currentUrl = tabs[0].url;
        const isMatchedUrl = currentUrl.includes('twitter.com') || 
                          currentUrl.includes('x.com') || 
                          currentUrl.includes('threads.net');
        
        if (!isMatchedUrl) {
          console.log("Extension not active on this page");
          updateModelStatusIndicator("inactive");
          return;
        }
        
        // Try to send message to content script
        chrome.tabs.sendMessage(tabs[0].id, { action: "checkModelStatus" }, (response) => {
          if (chrome.runtime.lastError) {
            console.log("Error checking model status:", chrome.runtime.lastError.message);
            
            // Ask background script directly
            chrome.runtime.sendMessage({ action: "getModelStatus" }, (backgroundResponse) => {
              if (backgroundResponse) {
                updateModelStatusIndicator(backgroundResponse.isLoaded ? true : 
                                          backgroundResponse.isLoading ? "loading" : false);
              } else {
                updateModelStatusIndicator(false);
              }
            });
          } else if (response) {
            updateModelStatusIndicator(response.modelLoaded ? true : 
                                       response.modelInitializing ? "loading" : false);
          } else {
            updateModelStatusIndicator(false);
          }
        });
      }
    });
  } catch (error) {
    console.error("Error in checkModelStatus:", error);
    updateModelStatusIndicator(false);
  }
}



function updateModelStatusIndicator(status) {
  const indicator = document.getElementById("model-status-indicator");
  const progressBar = document.getElementById("model-progress-bar");
  
  if (!indicator) return;
  
  if (status === true) {
    indicator.textContent = "جاهز";
    indicator.className = "status-indicator status-ready";
    if (progressBar) progressBar.style.width = "100%";
  } else if (status === "loading") {
    indicator.textContent = "جاري التحميل...";
    indicator.className = "status-indicator status-loading";
  } else if (status === "inactive") {
    indicator.textContent = "غير نشط على هذه الصفحة";
    indicator.className = "status-indicator status-inactive";
    if (progressBar) progressBar.style.width = "0%";
  } else {
    indicator.textContent = "غير متصل";
    indicator.className = "status-indicator status-error";
    if (progressBar) progressBar.style.width = "0%";
  }
}


// Show custom alert box
function showCustomAlert(message) {
  const alertBox = document.getElementById("custom-alert");
  const alertMessage = document.getElementById("custom-alert-message");
  
  alertMessage.textContent = message;
  alertBox.style.display = "block";
  
  // Hide after 3 seconds
  setTimeout(() => {
    alertBox.style.display = "none";
  }, 3000);
}

// Show webpage alert
function showWebpageAlert(message) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "displayAlert", message }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("Error sending alert message to content script:", chrome.runtime.lastError.message);
        } else {
          console.log("Alert displayed on the webpage:", response);
        }
      });
    }
  });
}

// Listen for model loading updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "modelLoadingUpdate") {
    const statusIndicator = document.getElementById("model-status-indicator");
    const progressBar = document.getElementById("model-progress-bar");
    
    if (statusIndicator) {
      statusIndicator.textContent = message.status;
      statusIndicator.className = "status-indicator status-loading";
    }
    
    if (progressBar) {
      progressBar.style.width = `${message.progress}%`;
    }
    
    if (message.progress === 100) {
      if (statusIndicator) {
        statusIndicator.className = "status-indicator status-ready";
      }
    }
    
    sendResponse({ received: true });
    return true;
  }
  
  if (message.action === "modelStatusUpdate") {
    updateModelStatusIndicator(message.isLoaded);
    sendResponse({ received: true });
    return true;
  }
  
  return false;
});

// Add to your popup.js
document.getElementById("test-direct-api").addEventListener("click", () => {
  document.getElementById("api-status").textContent = "جارٍ الاختبار المباشر...";
  document.getElementById("api-status").className = "api-status loading";
  
  chrome.runtime.sendMessage({ action: "runDirectApiTest" }, (response) => {
    if (chrome.runtime.lastError) {
      document.getElementById("api-status").textContent = "خطأ: " + chrome.runtime.lastError.message;
      document.getElementById("api-status").className = "api-status error";
      return;
    }
    
    if (response.success) {
      if (response.categories && response.categories.length > 0) {
        const category = response.categories[0];
        const isExpectedCategory = category === "wine/drugs";
        
        if (isExpectedCategory) {
          document.getElementById("api-status").textContent = 
            "نجاح! تم تصنيف النص كـ " + category + " كما هو متوقع";
          document.getElementById("api-status").className = "api-status success";
        } else {
          document.getElementById("api-status").textContent = 
            "نجاح، لكن التصنيف غير متوقع: " + category + " (متوقع: wine/drugs)";
          document.getElementById("api-status").className = "api-status warning";
        }
      } else {
        document.getElementById("api-status").textContent = 
          "تم الاتصال بنجاح، لكن لم يتم الحصول على تصنيف";
        document.getElementById("api-status").className = "api-status warning";
      }
    } else {
      document.getElementById("api-status").textContent = 
        "فشل الاختبار المباشر: " + (response.error || "خطأ غير معروف");
      document.getElementById("api-status").className = "api-status error";
      
      if (response.status === 401) {
        document.getElementById("api-status").textContent += " (خطأ في مفتاح API)";
      }
    }
    
    // Log the full response to the console for debugging
    console.log("Direct API test response:", response);
  });
});

// Load and display statistics in the popup
function loadStatistics() {
  chrome.storage.sync.get(["twitterFilteredCount", "threadsFilteredCount"], (data) => {
    const twitterCount = data.twitterFilteredCount || 0;
    const threadsCount = data.threadsFilteredCount || 0;

    document.getElementById("twitter-stats").textContent = `عدد التغريدات المحجوبة: ${twitterCount}`;
    document.getElementById("threads-stats").textContent = `عدد المنشورات المحجوبة: ${threadsCount}`;
  });
}

// Load statistics on popup open
document.addEventListener("DOMContentLoaded", () => {
  loadStatistics();
  loadApiKey(); // Add this line
});

// Close custom alert box
document.getElementById("close-alert").addEventListener("click", () => {
  const alertBox = document.getElementById("custom-alert");
  alertBox.style.display = "none";
});

// Test custom alert on button click
document.getElementById("test-alert").addEventListener("click", () => {
  showWebpageAlert("تنبيه: قد تحتوي هذه الصفحة على محتوى غير مرغوب بناءً على اختياراتك.");
});
// Test the loader animation
document.getElementById("test-loader").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { 
        action: "testLoader"
      });
      showCustomAlert("تم تشغيل اختبار التحميل");
    }
  });
});

// Update threshold value display when slider changes
document.getElementById("threshold-slider").addEventListener("input", (e) => {
  const value = e.target.value;
  document.getElementById("threshold-value").textContent = value;
});

// Show the customization modal and load preferences
document.getElementById("customize-options").addEventListener("click", () => {
  const modal = document.getElementById("customize-modal");

  // Load preferences from Chrome storage
  chrome.storage.sync.get(["preferences", "threshold"], (data) => {
    const checkboxes = document.querySelectorAll("#customize-modal input[type='checkbox']");
    const preferences = data.preferences || {
      polytheism: true,
      violence: true,
      gambling: true,
      alcohol: true,
    };

    // Update checkbox states based on saved preferences
    checkboxes.forEach((checkbox) => {
      checkbox.checked = preferences[checkbox.value];
    });

    // Update threshold slider if available
    if (data.threshold) {
      const thresholdSlider = document.getElementById("threshold-slider");
      const thresholdValue = document.getElementById("threshold-value");
      if (thresholdSlider && thresholdValue) {
        thresholdSlider.value = data.threshold;
        thresholdValue.textContent = data.threshold;
      }
    }

    console.log("Preferences loaded into modal:", preferences);
  });

  // Show the modal
  modal.classList.remove("hidden");
  modal.style.display = "block";
  console.log("Customization modal opened");
});

// Close the customization modal
document.getElementById("close-modal").addEventListener("click", () => {
  const modal = document.getElementById("customize-modal");
  modal.classList.add("hidden");
  modal.style.display = "none"; // Ensure the modal is hidden
  console.log("Customization modal closed");
});

// Save preferences and close the modal
document.getElementById("save-preferences").addEventListener("click", () => {
  const checkboxes = document.querySelectorAll("#customize-modal input[type='checkbox']");
  const preferences = {};

  checkboxes.forEach((checkbox) => {
    preferences[checkbox.value] = checkbox.checked;
  });

  // Get threshold value
  const threshold = parseFloat(document.getElementById("threshold-slider").value);

  // Save preferences to Chrome storage
  chrome.storage.sync.set({ preferences, threshold }, () => {
    console.log("Preferences saved:", preferences);
    console.log("Threshold saved:", threshold);

    // Update model threshold in active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { 
          action: "updateModelThreshold", 
          threshold: threshold 
        });
      }
    });

    // Close the modal after saving
    const modal = document.getElementById("customize-modal");
    modal.classList.add("hidden");
    modal.style.display = "none";
    showCustomAlert("تم حفظ الإعدادات بنجاح!");
    console.log("Customization modal closed after saving");
  });
});