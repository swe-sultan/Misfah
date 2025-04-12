// Model loader for browser extension
class ModelLoader {
    constructor() {
        this.model = null;
        this.isModelLoaded = false;
        this.imagenetLabels = [];
        this.sensitiveClasses = {};
        this.flatSensitiveClasses = {};
        this.preprocessingParams = {
            // ImageNet mean and std for normalization
            mean: [0.485, 0.456, 0.406],
            std: [0.229, 0.224, 0.225]
        };
    }

    async initialize() {
        try {
            console.log('Initializing model loader...');
            
            // Load model and data in parallel
            await Promise.all([
                this.loadModel(),
                this.loadImagenetLabels(),
                this.loadSensitiveClasses()
            ]);
            
            console.log('Model loader initialization complete');
            return true;
        } catch (error) {
            console.error('Error initializing model loader:', error);
            return false;
        }
    }

    async loadModel() {
        try {
            // Path to your model.json file in model/ directory
            const modelPath = chrome.runtime.getURL('model/model.json');
            console.log('Loading TensorFlow.js model from:', modelPath);
            
            // Use the loadLayersModel function for ResNet
            this.model = await tf.loadLayersModel(modelPath);
            console.log('Model loaded successfully');
            
            // Warm up the model with a dummy prediction
            const dummyInput = tf.zeros([1, 224, 224, 3]);
            const warmupResult = this.model.predict(dummyInput);
            warmupResult.dispose();
            dummyInput.dispose();
            
            this.isModelLoaded = true;
            console.log('Model warm-up complete');
            return true;
        } catch (error) {
            console.error('Error loading model:', error);
            return false;
        }
    }

    async loadImagenetLabels() {
        try {
            const response = await fetch(chrome.runtime.getURL('data/imagenet_labels.json'));
            this.imagenetLabels = await response.json();
            console.log(`Loaded ${this.imagenetLabels.length} ImageNet labels`);
            return true;
        } catch (error) {
            console.error('Error loading ImageNet labels:', error);
            return false;
        }
    }

    async loadSensitiveClasses() {
        try {
            // Load sensitive classes
            const sensitiveResponse = await fetch(chrome.runtime.getURL('data/sensitive_classes.json'));
            this.sensitiveClasses = await sensitiveResponse.json();
            
            // Load flat sensitive classes
            const flatResponse = await fetch(chrome.runtime.getURL('data/flat_sensitive_classes.json'));
            this.flatSensitiveClasses = await flatResponse.json();
            
            console.log('Loaded sensitive classes data');
            return true;
        } catch (error) {
            console.error('Error loading sensitive classes:', error);
            return false;
        }
    }

    async processImage(image, threshold = 0.15, top_k = 5) {
        if (!this.isModelLoaded) {
            console.error('Model not loaded, cannot process image');
            return null;
        }

        try {
            return tf.tidy(() => {
                // Create a canvas to get image data
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Resize to 224x224 (model input size)
                canvas.width = 224;
                canvas.height = 224;
                
                // Draw and resize the image
                ctx.drawImage(image, 0, 0, 224, 224);
                
                // Get image tensor
                const tensor = tf.browser.fromPixels(canvas);
                
                // Normalize and preprocess (values between 0-1)
                const normalized = tensor.toFloat().div(tf.scalar(255));
                
                // Expand dimensions for batch [1, 224, 224, 3]
                const batched = normalized.expandDims(0);
                
                // Run inference
                const output = this.model.predict(batched);
                
                // Get probabilities
                const probabilities = Array.from(tf.softmax(output).dataSync());
                
                // Get top k predictions
                const indices = Array.from(Array(probabilities.length).keys());
                indices.sort((a, b) => probabilities[b] - probabilities[a]);
                const topK = indices.slice(0, top_k);
                
                // Check if any sensitive class is in top predictions
                let is_sensitive = false;
                const detected_categories = new Set();
                const sensitivity_details = {};
                
                for (const idx of topK) {
                    const prob = probabilities[idx];
                    
                    // Check if this class is in our sensitive classes
                    if (this.flatSensitiveClasses[idx] && prob >= threshold) {
                        is_sensitive = true;
                        const classInfo = this.flatSensitiveClasses[idx];
                        
                        // Add all categories this class belongs to
                        for (const category of classInfo.categories) {
                            detected_categories.add(category);
                            
                            // Store details about what triggered the detection
                            if (!sensitivity_details[category]) {
                                sensitivity_details[category] = [];
                            }
                            
                            sensitivity_details[category].push({
                                class_id: idx,
                                class_name: classInfo.name,
                                probability: prob
                            });
                        }
                    }
                }
                
                // Prepare top predictions for return
                const top_predictions = topK.map(idx => ({
                    class_id: idx,
                    class_name: this.imagenetLabels[idx] || `Class ${idx}`,
                    probability: probabilities[idx],
                    is_sensitive: this.flatSensitiveClasses[idx] ? true : false
                }));
                
                return {
                    is_sensitive,
                    detected_categories: Array.from(detected_categories),
                    sensitivity_details,
                    top_predictions
                };
            });
        } catch (error) {
            console.error('Error processing image:', error);
            return null;
        }
    }
}

// Export for browser extension
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { ModelLoader };
} else {
    // For direct browser usage
    window.ModelLoader = ModelLoader;
}