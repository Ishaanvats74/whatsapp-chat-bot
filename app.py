import google.generativeai as genai
import os
from PIL import Image
import traceback
from io import BytesIO
import base64
import subprocess
import threading
import time
import signal
from flask import Flask, request, jsonify, send_file, render_template_string
from gradio_client import Client
from huggingface_hub import InferenceClient
from dotenv import load_dotenv
import sys
import random
import json
import requests
import tempfile

load_dotenv()

# Configure Gemini with better error handling
try:
    genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
    text_model = genai.GenerativeModel("models/gemini-1.5-flash")
    GEMINI_AVAILABLE = True
    print("✅ Gemini API configured successfully")
except Exception as e:
    print(f"❌ Gemini API configuration failed: {e}")
    GEMINI_AVAILABLE = False

# Configure Hugging Face with multiple fallback options
HF_AVAILABLE = False
image_model = None
HF_TOKEN = os.getenv("token") or os.getenv("HF_TOKEN") or os.getenv("HUGGINGFACE_TOKEN")

if HF_TOKEN:
    try:
        # Method 1: Try InferenceClient
        image_model = InferenceClient(token=HF_TOKEN)
        
        # Test the connection with a simple model
        test_response = requests.get(
            "https://huggingface.co/api/models/black-forest-labs/FLUX.1-schnell",
            headers={"Authorization": f"Bearer {HF_TOKEN}"}
        )
        
        if test_response.status_code == 200:
            HF_AVAILABLE = True
            print("✅ Hugging Face InferenceClient configured successfully")
        else:
            print(f"⚠️ HF API test failed with status: {test_response.status_code}")
            
    except Exception as e:
        print(f"❌ Hugging Face InferenceClient configuration failed: {e}")
        image_model = None
else:
    print("❌ No Hugging Face token found. Set 'token', 'HF_TOKEN', or 'HUGGINGFACE_TOKEN' in your .env file")

# Updated image generation models with working alternatives
IMAGE_MODELS = [
    "black-forest-labs/FLUX.1-schnell",  # New fast model
    "stabilityai/stable-diffusion-xl-base-1.0",
    "runwayml/stable-diffusion-v1-5",
    "Lykon/DreamShaper",
    "SG161222/Realistic_Vision_V5.1_noVAE",
    "nitrosocke/Ghibli-Diffusion",
    "wavymulder/Analog-Diffusion"
]

app = Flask(__name__)

# Global variables to track bot status
bot_process = None
bot_status = {"running": False, "qr_code": None, "ready": False}

# [HTML_TEMPLATE remains the same as in your original code]
HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🤖 WhatsApp Bot Controller</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji';
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            color: white;
            padding: 20px;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(15px);
            border-radius: 25px;
            padding: 40px;
            box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37);
            border: 1px solid rgba(255, 255, 255, 0.18);
            margin-top: 20px;
        }
        
        h1 {
            text-align: center;
            margin-bottom: 30px;
            font-size: 2.8em;
            font-weight: 700;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        
        .instructions {
            background: rgba(255, 255, 255, 0.1);
            padding: 25px;
            border-radius: 15px;
            margin: 25px 0;
            font-size: 16px;
            line-height: 1.6;
            border-left: 4px solid #4CAF50;
        }
        
        .instructions h3 {
            color: #4CAF50;
            margin-bottom: 15px;
            font-size: 1.3em;
        }
        
        .instructions ol {
            padding-left: 20px;
        }
        
        .instructions li {
            margin-bottom: 8px;
        }
        
        .status {
            text-align: center;
            padding: 25px;
            margin: 25px 0;
            border-radius: 15px;
            font-size: 20px;
            font-weight: 600;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            transition: all 0.3s ease;
        }
        
        .status.stopped { 
            background: linear-gradient(45deg, rgba(244, 67, 54, 0.3), rgba(211, 47, 47, 0.3)); 
            border: 2px solid rgba(244, 67, 54, 0.5);
        }
        
        .status.starting { 
            background: linear-gradient(45deg, rgba(255, 152, 0, 0.3), rgba(245, 124, 0, 0.3)); 
            border: 2px solid rgba(255, 152, 0, 0.5);
        }
        
        .status.ready { 
            background: linear-gradient(45deg, rgba(76, 175, 80, 0.3), rgba(67, 160, 71, 0.3)); 
            border: 2px solid rgba(76, 175, 80, 0.5);
        }
        
        .controls {
            text-align: center;
            margin: 30px 0;
        }
        
        button {
            background: linear-gradient(45deg, #4CAF50, #45a049);
            color: white;
            border: none;
            padding: 15px 30px;
            font-size: 18px;
            border-radius: 12px;
            cursor: pointer;
            margin: 10px;
            transition: all 0.3s ease;
            font-weight: 600;
            min-width: 140px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        
        button:hover:not(:disabled) {
            transform: translateY(-3px);
            box-shadow: 0 8px 25px rgba(0,0,0,0.2);
        }
        
        button:disabled {
            background: linear-gradient(45deg, #666, #555);
            cursor: not-allowed;
            transform: none;
            opacity: 0.6;
        }
        
        .stop-btn {
            background: linear-gradient(45deg, #f44336, #d32f2f) !important;
        }
        
        .qr-container {
            text-align: center;
            margin: 30px 0;
            padding: 30px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 20px;
            display: none;
            box-shadow: 0 8px 25px rgba(0,0,0,0.2);
            animation: slideIn 0.5s ease;
        }
        
        @keyframes slideIn {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }
        
        .qr-container h3 {
            color: #333;
            margin-bottom: 15px;
            font-size: 1.4em;
        }
        
        .qr-instructions {
            color: #666;
            margin-bottom: 20px;
            font-size: 14px;
            padding: 10px;
            background: #f0f0f0;
            border-radius: 8px;
        }
        
        .qr-code {
            font-family: 'Courier New', monospace;
            font-size: 4px;
            line-height: 4px;
            color: #000;
            white-space: pre;
            background: white;
            padding: 20px;
            border-radius: 10px;
            display: inline-block;
            border: 3px solid #333;
            margin: 10px;
            max-width: 100%;
            overflow: auto;
            letter-spacing: 0;
        }
        
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: #fff;
            animation: spin 1s ease-in-out infinite;
            margin-left: 10px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .info-section {
            background: rgba(255, 255, 255, 0.1);
            padding: 20px;
            border-radius: 15px;
            margin: 20px 0;
            border-left: 4px solid #2196F3;
        }
        
        .info-section h3 {
            color: #2196F3;
            margin-bottom: 10px;
        }
        
        .error-message {
            background: rgba(244, 67, 54, 0.2);
            color: #fff;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            display: none;
            border-left: 4px solid #f44336;
        }
        
        .success-message {
            background: rgba(76, 175, 80, 0.2);
            color: #fff;
            padding: 15px;
            border-radius: 8px;
            margin: 15px 0;
            display: none;
            border-left: 4px solid #4CAF50;
        }
        
        @media (max-width: 768px) {
            .container {
                margin: 10px;
                padding: 20px;
            }
            
            h1 {
                font-size: 2.2em;
            }
            
            button {
                min-width: 120px;
                font-size: 16px;
                padding: 12px 20px;
            }
            
            .qr-code {
                font-size: 3px;
                line-height: 3px;
                padding: 15px;
            }
        }
        
        .api-status {
            background: rgba(255, 255, 255, 0.1);
            padding: 15px;
            border-radius: 10px;
            margin: 20px 0;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🤖 WhatsApp AI Bot Controller</h1>
        
        <div class="api-status">
            <h3>📡 API Status:</h3>
            <p id="geminiStatus">🔄 Checking Gemini API...</p>
            <p id="hfStatus">🔄 Checking Hugging Face API...</p>
        </div>
        
        <div class="instructions">
            <h3>📋 How to Use:</h3>
            <ol>
                <li>🚀 Click "Start Bot" to initialize the WhatsApp bot</li>
                <li>📱 A QR code will appear - scan it with WhatsApp on your phone</li>
                <li>⚙️ Go to WhatsApp → Settings → Linked Devices → Link a Device</li>
                <li>📷 Scan the QR code displayed below</li>
                <li>💬 Once connected, mention the bot in any WhatsApp group to get responses</li>
                <li>🎨 The bot responds with emojis and can generate images or witty text</li>
                <li>🛑 Click "Stop Bot" when you're done</li>
            </ol>
        </div>
        
        <div id="errorMessage" class="error-message"></div>
        <div id="successMessage" class="success-message"></div>
        
        <div id="status" class="status stopped">
            ⏹️ Bot is stopped - Click Start to begin
        </div>
        
        <div class="controls">
            <button id="startBtn" onclick="startBot()">🚀 Start Bot</button>
            <button id="stopBtn" class="stop-btn" onclick="stopBot()" disabled>🛑 Stop Bot</button>
            <button onclick="checkAPIs()" style="background: linear-gradient(45deg, #2196F3, #1976D2);">🔧 Check APIs</button>
            <button onclick="testImageGen()" style="background: linear-gradient(45deg, #9C27B0, #7B1FA2);">🎨 Test Image</button>
        </div>
        
        <div id="qrContainer" class="qr-container">
            <h3>📱 Scan QR Code with WhatsApp</h3>
            <div class="qr-instructions">
                📲 Open WhatsApp → Tap ⋮ (menu) → Linked Devices → Link a Device → Point camera at QR code
            </div>
            <div id="qrCode" class="qr-code"></div>
        </div>
    </div>

    <script>
        let statusInterval;
        
        function showMessage(message, type = 'info') {
            const errorMsg = document.getElementById('errorMessage');
            const successMsg = document.getElementById('successMessage');
            
            errorMsg.style.display = 'none';
            successMsg.style.display = 'none';
            
            if (type === 'error') {
                errorMsg.innerHTML = '❌ ' + message;
                errorMsg.style.display = 'block';
                setTimeout(() => errorMsg.style.display = 'none', 5000);
            } else if (type === 'success') {
                successMsg.innerHTML = '✅ ' + message;
                successMsg.style.display = 'block';
                setTimeout(() => successMsg.style.display = 'none', 3000);
            }
        }
        
        function testImageGen() {
            showMessage('Testing image generation...', 'info');
            fetch('/test-image', { method: 'POST' })
                .then(response => {
                    if (response.headers.get('content-type').includes('image')) {
                        showMessage('Image generation test successful!', 'success');
                        // Create a blob URL and open in new tab
                        response.blob().then(blob => {
                            const url = URL.createObjectURL(blob);
                            window.open(url, '_blank');
                        });
                    } else {
                        return response.json();
                    }
                })
                .then(data => {
                    if (data && data.error) {
                        showMessage('Image generation failed: ' + data.error, 'error');
                    }
                })
                .catch(error => showMessage('Image generation test failed', 'error'));
        }
        
        function checkAPIs() {
            fetch('/api-status')
                .then(response => response.json())
                .then(data => {
                    document.getElementById('geminiStatus').innerHTML = 
                        data.gemini ? '✅ Gemini API: Ready' : '❌ Gemini API: Not configured';
                    document.getElementById('hfStatus').innerHTML = 
                        data.huggingface ? '✅ Hugging Face: Ready' : '❌ Hugging Face: Not configured';
                })
                .catch(() => {
                    document.getElementById('geminiStatus').innerHTML = '❌ Gemini API: Error checking';
                    document.getElementById('hfStatus').innerHTML = '❌ Hugging Face: Error checking';
                });
        }
        
        function updateStatus() {
            fetch('/status')
                .then(response => response.json())
                .then(data => {
                    const statusDiv = document.getElementById('status');
                    const qrContainer = document.getElementById('qrContainer');
                    const qrCode = document.getElementById('qrCode');
                    const startBtn = document.getElementById('startBtn');
                    const stopBtn = document.getElementById('stopBtn');
                    
                    if (data.running) {
                        if (data.ready) {
                            statusDiv.innerHTML = '✅ Bot Connected & Ready!';
                            statusDiv.className = 'status ready';
                            qrContainer.style.display = 'none';
                        } else if (data.qr_code) {
                            statusDiv.innerHTML = '📱 Scan QR Code to Connect';
                            statusDiv.className = 'status starting';
                            qrCode.textContent = data.qr_code;
                            qrContainer.style.display = 'block';
                        } else {
                            statusDiv.innerHTML = '🔄 Starting Bot...';
                            statusDiv.className = 'status starting';
                            qrContainer.style.display = 'none';
                        }
                        startBtn.disabled = true;
                        stopBtn.disabled = false;
                    } else {
                        statusDiv.innerHTML = '⏹️ Bot is Stopped';
                        statusDiv.className = 'status stopped';
                        qrContainer.style.display = 'none';
                        startBtn.disabled = false;
                        stopBtn.disabled = true;
                    }
                })
                .catch(error => {
                    console.error('Status check error:', error);
                });
        }
        
        function startBot() {
            fetch('/start', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        showMessage('Bot started successfully!', 'success');
                        statusInterval = setInterval(updateStatus, 2000);
                    } else {
                        showMessage('Failed to start bot: ' + data.message, 'error');
                    }
                })
                .catch(error => showMessage('Error starting bot', 'error'));
        }
        
        function stopBot() {
            fetch('/stop', { method: 'POST' })
                .then(response => response.json())
                .then(data => {
                    showMessage('Bot stopped!', 'success');
                    if (statusInterval) clearInterval(statusInterval);
                    setTimeout(updateStatus, 1000);
                })
                .catch(error => showMessage('Error stopping bot', 'error'));
        }
        
        document.addEventListener('DOMContentLoaded', function() {
            checkAPIs();
            updateStatus();
            setInterval(updateStatus, 5000);
        });
    </script>
</body>
</html>"""

# Enhanced emoji responses for different contexts
EMOJI_RESPONSES = {
    "greetings": ["👋", "🙋‍♂️", "😊", "🤗", "✨"],
    "funny": ["😂", "🤣", "😄", "😆", "🙃"],
    "positive": ["👍", "✅", "🎉", "💪", "🔥"],
    "thinking": ["🤔", "💭", "🧠", "💡", "🤖"],
    "love": ["❤️", "💖", "😍", "🥰", "💕"],
    "food": ["🍕", "🍔", "🍰", "🍜", "🥗"],
    "tech": ["💻", "📱", "🤖", "⚡", "🔧"],
    "hindi": ["🙏", "😄", "👌", "💫", "🌟"]
}

def get_random_emoji(context="positive"):
    """Get a random emoji based on context"""
    return random.choice(EMOJI_RESPONSES.get(context, EMOJI_RESPONSES["positive"]))

def generate_image_with_hf_api(prompt, max_retries=3):
    """Generate image using direct Hugging Face API calls with updated working models"""
    if not HF_TOKEN:
        raise Exception("No Hugging Face token available")
    
    headers = {
        "Authorization": f"Bearer {HF_TOKEN}",
        "Content-Type": "application/json"
    }
    
    # Clean and enhance the prompt
    clean_prompt = prompt.replace("@", "").strip()
    enhanced_prompt = f"{clean_prompt}, high quality, detailed, vibrant colors, masterpiece"
    
    # Try different models with updated endpoints
    working_models = [
        "black-forest-labs/FLUX.1-schnell",
        "stabilityai/stable-diffusion-xl-base-1.0", 
        "Lykon/DreamShaper",
        "SG161222/Realistic_Vision_V5.1_noVAE"
    ]
    
    for model_name in working_models:
        for attempt in range(max_retries):
            try:
                print(f"🎨 Trying model: {model_name} (attempt {attempt + 1}/{max_retries})")
                
                url = f"https://api-inference.huggingface.co/models/{model_name}"
                
                payload = {
                    "inputs": enhanced_prompt,
                    "parameters": {
                        "negative_prompt": "low quality, blurry, distorted, ugly, bad anatomy, text, watermark, signature",
                        "num_inference_steps": 20,
                        "guidance_scale": 7.5,
                        "width": 512,
                        "height": 512
                    }
                }
                
                response = requests.post(
                    url, 
                    headers=headers, 
                    json=payload, 
                    timeout=60
                )
                
                print(f"📊 Response status: {response.status_code}")
                
                if response.status_code == 200:
                    content_type = response.headers.get('content-type', '')
                    
                    if 'image' in content_type:
                        print(f"✅ Image generated successfully with {model_name}")
                        return response.content
                    else:
                        print(f"⚠️ Unexpected content type: {content_type}")
                        continue
                        
                elif response.status_code == 503:
                    try:
                        error_data = response.json()
                        estimated_time = error_data.get('estimated_time', 10)
                        print(f"⏳ Model loading, estimated time: {estimated_time}s")
                        
                        if attempt < max_retries - 1:
                            time.sleep(min(estimated_time + 5, 30))
                            continue
                    except:
                        if attempt < max_retries - 1:
                            time.sleep(10)
                            continue
                        
                else:
                    try:
                        error_data = response.json()
                        error_msg = error_data.get('error', f'HTTP {response.status_code}')
                        print(f"❌ Error with {model_name}: {error_msg}")
                    except:
                        print(f"❌ Error with {model_name}: HTTP {response.status_code}")
                    
                    # If it's a model-specific error, try next model
                    if response.status_code != 503:
                        break
                    
            except requests.exceptions.Timeout:
                print(f"⏰ Timeout with {model_name} (attempt {attempt + 1})")
                if attempt < max_retries - 1:
                    time.sleep(5)
                    continue
                    
            except Exception as e:
                print(f"❌ Exception with {model_name}: {str(e)}")
                if attempt < max_retries - 1:
                    time.sleep(3)
                    continue
                break
    
    raise Exception("All image generation models failed")

def generate_simple_image_fallback(prompt):
    """Fallback image generation using a different approach"""
    try:
        # Try using a dedicated image generation service
        fallback_url = "https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5"
        
        headers = {
            "Authorization": f"Bearer {HF_TOKEN}",
        }
        
        response = requests.post(
            fallback_url,
            headers=headers,
            json={"inputs": prompt},
            timeout=30
        )
        
        if response.status_code == 200 and 'image' in response.headers.get('content-type', ''):
            return response.content
        else:
            print(f"❌ Fallback failed with status: {response.status_code}")
            return None
            
    except Exception as e:
        print(f"❌ Fallback image generation failed: {e}")
        return None

def generate_image_with_inference_client(prompt):
    """Enhanced InferenceClient method with better error handling"""
    if not image_model or not HF_TOKEN:
        raise Exception("InferenceClient not available")
    
    try:
        clean_prompt = prompt.replace("@", "").strip()
        enhanced_prompt = f"{clean_prompt}, high quality, detailed, vibrant colors, digital art"
        
        print(f"🎨 Trying InferenceClient with prompt: {enhanced_prompt}")
        
        # Try with different models through InferenceClient
        models_to_try = [
            "black-forest-labs/FLUX.1-schnell",
            "stabilityai/stable-diffusion-xl-base-1.0"
        ]
        
        for model in models_to_try:
            try:
                print(f"🔄 Trying {model} with InferenceClient")
                client = InferenceClient(model=model, token=HF_TOKEN)
                
                response = client.text_to_image(
                    prompt=enhanced_prompt,
                    negative_prompt="low quality, blurry, distorted, ugly, bad anatomy, text, watermark",
                    guidance_scale=7.5,
                    num_inference_steps=20,
                    width=512,
                    height=512
                )
                
                if hasattr(response, "save"):
                    buffer = BytesIO()
                    response.save(buffer, format="PNG")
                    buffer.seek(0)
                    print(f"✅ InferenceClient success with {model}")
                    return buffer.getvalue()
                    
            except Exception as model_error:
                print(f"❌ {model} failed: {model_error}")
                continue
                
        raise Exception("All InferenceClient models failed")
            
    except Exception as e:
        print(f"❌ InferenceClient error: {str(e)}")
        raise

def get_enhanced_fallback_response(user_msg):
    """Generate enhanced fallback responses with better Hindi support"""
    user_msg_lower = user_msg.lower()
    
    # Hindi greetings
    if any(word in user_msg_lower for word in ["arey", "are", "arrey", "hello", "hi", "hey", "namaste", "namaskar"]):
        responses = [
            f"Arey haan! {get_random_emoji('hindi')} Kya haal hai?",
            f"Hey there! {get_random_emoji('greetings')} Kaise ho?",
            f"Namaste! {get_random_emoji('hindi')} Sab badhiya?",
            f"Arey bhai! {get_random_emoji('funny')} What's up?",
            f"Hello ji! {get_random_emoji('greetings')} Kya chal raha hai?"
        ]
    
    # Food related (Hindi + English)
    elif any(word in user_msg_lower for word in ["food", "eat", "hungry", "khana", "khaana", "bhookh", "khane"]):
        responses = [
            f"Arey khana ki baat! {get_random_emoji('food')} Kya khayenge?",
            f"Bhookh lagi hai kya? {get_random_emoji('food')} Menu batao!",
            f"Food lover detected! {get_random_emoji('food')} Fav dish bolo!",
            f"Khane ki baat sunkar mann khush ho gaya! {get_random_emoji('food')}"
        ]
    
    # Love/positive (Hindi + English)
    elif any(word in user_msg_lower for word in ["love", "heart", "like", "awesome", "great", "pyaar", "accha", "badhiya"]):
        responses = [
            f"Arey waah! {get_random_emoji('love')} Dil khush kar diya!",
            f"That's so sweet! {get_random_emoji('love')} Bahut accha laga!",
            f"Love the vibes! {get_random_emoji('love')} Keep it up!",
            f"Badhiya baat! {get_random_emoji('hindi')} Aur batao!"
        ]
    
    # Questions (Hindi + English)
    elif any(word in user_msg_lower for word in ["what", "how", "why", "when", "where", "kya", "kaise", "kyun", "kab", "kahan"]):
        responses = [
            f"Accha sawal! {get_random_emoji('thinking')} Let me think...",
            f"Interesting question! {get_random_emoji('thinking')} Bolo aur!",
            f"Hmm, good point! {get_random_emoji('thinking')} What do you think?",
            f"Waah bhai! {get_random_emoji('hindi')} Deep question hai ye to!"
        ]
    
    # Tech related
    elif any(word in user_msg_lower for word in ["tech", "computer", "phone", "app", "bot", "ai"]):
        responses = [
            f"Tech geek spotted! {get_random_emoji('tech')} Main bhi tech lover hun!",
            f"Technology rocks! {get_random_emoji('tech')} Kya discuss karna hai?",
            f"Beep boop! {get_random_emoji('tech')} Tech mode activated!",
            f"Gadgets ki baat? {get_random_emoji('tech')} Count me in!"
        ]
    
    # Default responses with Hindi touch
    else:
        responses = [
            f"Interesting! {get_random_emoji('positive')} Aur batao!",
            f"Cool baat hai! {get_random_emoji('positive')} Continue karo!",
            f"Nice! {get_random_emoji('positive')} Kya aur chal raha hai?",
            f"Accha! {get_random_emoji('hindi')} Tell me more!",
            f"Sunke accha laga! {get_random_emoji('positive')} Next kya hai?",
            f"Badhiya! {get_random_emoji('hindi')} Keep going!"
        ]
    
    return random.choice(responses)

def generate_with_gemini(user_msg):
    """Generate response using Gemini with enhanced error handling"""
    if not GEMINI_AVAILABLE:
        return None
    
    try:
        # Create a safer, more specific prompt
        safe_prompt = f"""
        You are a friendly WhatsApp bot. Respond to this message naturally and include appropriate emojis.
        Keep responses short (1-2 sentences max), friendly, and conversational.
        Support both English and Hindi mixed language (Hinglish).
        Message: "{user_msg}"
        
        Guidelines:
        - Be casual and fun
        - Use relevant emojis
        - Keep it under 100 characters if possible
        - Support Hindi/Hinglish expressions
        """
        
        # Ultra-safe generation config
        generation_config = {
            "temperature": 0.7,
            "top_p": 0.8,
            "top_k": 20,
            "max_output_tokens": 80,
            "stop_sequences": []
        }
        
        # Very permissive safety settings for casual chat
        safety_settings = [
            {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
            {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_ONLY_HIGH"},
            {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_ONLY_HIGH"},
        ]
        
        # Generate with timeout
        response = text_model.generate_content(
            safe_prompt,
            generation_config=generation_config,
            safety_settings=safety_settings,
            request_options={"timeout": 10}
        )
        
        # Enhanced response parsing
        if response and response.candidates:
            candidate = response.candidates[0]
            
            # Check finish reason
            if hasattr(candidate, 'finish_reason'):
                finish_reason = candidate.finish_reason
                print(f"🔍 Gemini finish reason: {finish_reason}")
                
                if finish_reason == 1:  # STOP - successful completion
                    try:
                        reply_text = response.text.strip()
                        if reply_text and len(reply_text) > 0:
                            print(f"✅ Gemini success: {reply_text[:50]}...")
                            return reply_text
                    except Exception as text_error:
                        print(f"⚠️ Text extraction error: {text_error}")
                        return None
                        
                elif finish_reason == 2:  # SAFETY
                    print("⚠️ Gemini blocked by safety filter")
                    return None
                    
                elif finish_reason == 3:  # RECITATION
                    print("⚠️ Gemini blocked for recitation")
                    return None
                    
                else:
                    print(f"⚠️ Gemini unexpected finish reason: {finish_reason}")
                    return None
            else:
                # Try to get text anyway
                try:
                    reply_text = response.text.strip()
                    if reply_text:
                        return reply_text
                except:
                    return None
        
        print("⚠️ No valid response from Gemini")
        return None
        
    except Exception as e:
        print(f"❌ Gemini API error: {e}")
        return None

@app.route('/')
def home():
    return render_template_string(HTML_TEMPLATE)

@app.route('/api-status')
def api_status():
    """Check API status"""
    return jsonify({
        "gemini": GEMINI_AVAILABLE and bool(os.getenv("GOOGLE_API_KEY")),
        "huggingface": HF_AVAILABLE and bool(HF_TOKEN),
        "hf_token_configured": bool(HF_TOKEN),
        "image_models_available": len(IMAGE_MODELS)
    })

@app.route('/test-image', methods=['POST'])
def test_image_generation():
    """Test endpoint for image generation"""
    try:
        test_prompt = "a beautiful sunset over mountains, digital art, high quality"
        print(f"🧪 Testing image generation with prompt: {test_prompt}")
        
        # Try the enhanced HF API method first
        try:
            image_data = generate_image_with_hf_api(test_prompt)
            print("✅ Image generation test successful!")
            return send_file(
                BytesIO(image_data),
                mimetype='image/png',
                as_attachment=False,
                download_name='test_image.png'
            )
        except Exception as hf_error:
            print(f"❌ HF API method failed: {hf_error}")
            
            # Try InferenceClient as fallback
            try:
                image_data = generate_image_with_inference_client(test_prompt)
                print("✅ Image generation test successful with InferenceClient!")
                return send_file(
                    BytesIO(image_data),
                    mimetype='image/png',
                    as_attachment=False,
                    download_name='test_image.png'
                )
            except Exception as client_error:
                print(f"❌ InferenceClient method failed: {client_error}")
                
                # Try simple fallback
                try:
                    image_data = generate_simple_image_fallback(test_prompt)
                    if image_data:
                        print("✅ Image generation test successful with fallback!")
                        return send_file(
                            BytesIO(image_data),
                            mimetype='image/png',
                            as_attachment=False,
                            download_name='test_image.png'
                        )
                    else:
                        raise Exception("Fallback method returned no data")
                except Exception as fallback_error:
                    print(f"❌ Fallback method failed: {fallback_error}")
                    raise Exception("All image generation methods failed")
                
    except Exception as e:
        print(f"❌ Image generation test failed: {e}")
        return jsonify({
            "error": str(e),
            "hf_available": HF_AVAILABLE,
            "hf_token": bool(HF_TOKEN),
            "suggestions": [
                "Check your Hugging Face token in .env file",
                "Ensure you have internet connection",
                "Try again in a few minutes (models might be loading)",
                "Verify your HF token has appropriate permissions",
                "Check if your HF account has access to image generation models"
            ]
        }), 500

@app.route('/start', methods=['POST'])
def start_bot():
    global bot_process, bot_status
    
    if bot_process is None or bot_process.poll() is not None:
        try:
            bot_status = {"running": True, "qr_code": None, "ready": False}
            
            # Start the Node.js bot process
            bot_process = subprocess.Popen(
                ['node', 'bot.js'],
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                universal_newlines=True,
                encoding='utf-8',
                errors='replace'
            )
            
            # Start monitoring
            threading.Thread(target=monitor_bot_output, daemon=True).start()
            
            return jsonify({"success": True, "message": f"Bot starting... {get_random_emoji('positive')}"})
        except Exception as e:
            bot_status = {"running": False, "qr_code": None, "ready": False}
            return jsonify({"success": False, "message": f"Failed to start bot: {str(e)}"}), 500
    else:
        return jsonify({"success": False, "message": "Bot is already running!"}), 400

@app.route('/stop', methods=['POST'])
def stop_bot():
    global bot_process, bot_status
    
    try:
        if bot_process and bot_process.poll() is None:
            bot_process.terminate()
            time.sleep(2)
            if bot_process.poll() is None:
                bot_process.kill()
            bot_process.wait(timeout=5)
            print("✅ Bot process terminated successfully")
        bot_process = None
    except Exception as e:
        print(f"❌ Error stopping bot: {e}")
        bot_process = None
    
    bot_status = {"running": False, "qr_code": None, "ready": False}
    return jsonify({"success": True, "message": f"Bot stopped! {get_random_emoji('positive')}"})

@app.route('/status')
def get_status():
    global bot_status, bot_process
    
    # Check if process is still running
    if bot_process and bot_process.poll() is not None:
        bot_status = {"running": False, "qr_code": None, "ready": False}
        bot_process = None
    
    return jsonify(bot_status)

@app.route('/qr-update', methods=['POST'])
def update_qr():
    global bot_status
    data = request.json
    
    if data and 'qr_code' in data:
        try:
            import qrcode
            import io
            
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=1,
                border=2,
            )
            qr.add_data(data['qr_code'])
            qr.make(fit=True)
            
            f = io.StringIO()
            qr.print_ascii(out=f, tty=False, invert=False)
            f.seek(0)
            ascii_qr = f.read()
            
            bot_status["qr_code"] = ascii_qr
            bot_status["ready"] = False
            print("📱 QR Code received and processed")
            
        except ImportError:
            bot_status["qr_code"] = "QR Code received (install 'qrcode' package for display)"
        except Exception as e:
            print(f"❌ QR processing error: {e}")
    
    return jsonify({"success": True})

@app.route('/bot-ready', methods=['POST'])
def bot_ready():
    global bot_status
    bot_status["ready"] = True
    bot_status["qr_code"] = None
    print("✅ Bot is ready and connected!")
    return jsonify({"success": True})

def monitor_bot_output():
    global bot_process, bot_status
    
    if not bot_process:
        return
    
    try:
        print("📊 Monitoring bot output...")
        
        while bot_process and bot_process.poll() is None:
            try:
                output = bot_process.stdout.readline()
                if output:
                    output = output.strip()
                    print(f"🤖 Bot: {output}")
                    
                    if "Client is ready!" in output:
                        print("✅ Bot is ready!")
                        bot_status["ready"] = True
                        bot_status["qr_code"] = None
                        
                    elif "QR RECEIVED" in output:
                        print("📱 QR code received")
                        
                    elif "authenticated" in output.lower():
                        print("🔐 Bot authenticated")
                        
                    elif "disconnected" in output.lower():
                        print("🔌 Bot disconnected")
                        bot_status["ready"] = False
                        
            except UnicodeDecodeError:
                continue
                
            if bot_process.poll() is not None:
                print("📴 Bot process ended")
                bot_status = {"running": False, "qr_code": None, "ready": False}
                break
                
    except Exception as e:
        print(f"❌ Error monitoring bot: {e}")
        bot_status = {"running": False, "qr_code": None, "ready": False}

@app.route('/reply', methods=['POST'])
def reply():
    try:
        user_msg = request.json.get('text', '').strip()
        print(f"📨 Processing message: {user_msg}")

        # Check for image generation keywords
        image_keywords = [
            "generate", "create", "make", "draw", "image", "picture", "photo", "art", 
            "design", "banao", "banaiye", "paint", "sketch", "illustration"
        ]
        
        if any(word.lower() in user_msg.lower() for word in image_keywords):
            print(f"🎨 Image generation requested for: {user_msg}")
            
            if not HF_TOKEN:
                return jsonify({'reply': f"Sorry, image generation is not available right now {get_random_emoji('thinking')} Please configure your Hugging Face token!"})
            
            try:
                print(f"🎨 Starting image generation process...")
                
                # Clean the prompt for image generation
                clean_prompt = user_msg.replace("@", "").strip()
                
                # Remove trigger words to get the actual prompt
                for keyword in image_keywords:
                    clean_prompt = clean_prompt.replace(keyword, "").strip()
                
                if not clean_prompt:
                    clean_prompt = "beautiful landscape, digital art"
                
                print(f"🖼️ Final prompt: {clean_prompt}")
                
                # Try enhanced HF API method first
                image_data = None
                try:
                    image_data = generate_image_with_hf_api(clean_prompt)
                    print("✅ Image generated with HF API method")
                except Exception as hf_error:
                    print(f"❌ HF API method failed: {hf_error}")
                    
                    # Try InferenceClient as fallback
                    try:
                        image_data = generate_image_with_inference_client(clean_prompt)
                        print("✅ Image generated with InferenceClient method")
                    except Exception as client_error:
                        print(f"❌ InferenceClient method failed: {client_error}")
                        
                        # Try simple fallback
                        try:
                            image_data = generate_simple_image_fallback(clean_prompt)
                            if image_data:
                                print("✅ Image generated with simple fallback")
                        except Exception as fallback_error:
                            print(f"❌ Simple fallback failed: {fallback_error}")
                            return jsonify({'reply': f"Image generation failed {get_random_emoji('thinking')} All methods encountered errors. Try again in a moment!"})
                
                if image_data:
                    print("✅ Image data ready, sending response")
                    return send_file(
                        BytesIO(image_data),
                        mimetype='image/png',
                        as_attachment=False,
                        download_name='generated_image.png'
                    )
                else:
                    return jsonify({'reply': f"Couldn't generate image right now {get_random_emoji('thinking')} Try a text message instead!"})
                    
            except Exception as img_error:
                print(f"❌ Image generation error: {img_error}")
                traceback.print_exc()
                return jsonify({'reply': f"Image generation failed {get_random_emoji('thinking')} Error: {str(img_error)[:100]}"})
        
        else:
            # Try Gemini first, then fallback
            reply_text = None
            
            if GEMINI_AVAILABLE:
                print("🤖 Trying Gemini API...")
                reply_text = generate_with_gemini(user_msg)
            
            # If Gemini fails or is not available, use enhanced fallback
            if not reply_text:
                print("🔄 Using enhanced fallback response")
                reply_text = get_enhanced_fallback_response(user_msg)
            
            # Ensure there's at least one emoji
            if not any(char in reply_text for char in "😀😂🤣😊😍🎉👍✨🔥💯🤖📱💻❤️🎯💪🌟🙏"):
                # Add contextual emoji based on message
                if any(word in user_msg.lower() for word in ["arey", "are", "hello", "hi", "hey", "namaste"]):
                    reply_text += f" {get_random_emoji('hindi')}"
                elif any(word in user_msg.lower() for word in ["food", "khana", "eat", "hungry"]):
                    reply_text += f" {get_random_emoji('food')}"
                elif any(word in user_msg.lower() for word in ["love", "pyaar", "heart", "like"]):
                    reply_text += f" {get_random_emoji('love')}"
                else:
                    reply_text += f" {get_random_emoji('positive')}"
            
            print(f"✅ Final response: {reply_text}")
            return jsonify({'reply': reply_text})

    except Exception as e:
        print(f"❌ Error in reply: {e}")
        traceback.print_exc()
        fallback_msg = f"Something went wrong {get_random_emoji('thinking')} Please try again!"
        return jsonify({'reply': fallback_msg}), 500

# Health check for hosting platforms
@app.route('/health')
def health_check():
    return jsonify({
        "status": "healthy",
        "apis": {
            "gemini": GEMINI_AVAILABLE,
            "huggingface": HF_AVAILABLE,
            "hf_token": bool(HF_TOKEN)
        },
        "image_models": IMAGE_MODELS,
        "timestamp": time.time()
    })

# Cleanup function
def cleanup():
    global bot_process
    if bot_process:
        try:
            print("🧹 Cleaning up...")
            if bot_process.poll() is None:
                bot_process.terminate()
                bot_process.wait(timeout=5)
            bot_process = None
            print("✅ Cleanup completed")
        except Exception as e:
            print(f"⚠️ Cleanup error: {e}")
            if bot_process:
                try:
                    bot_process.kill()
                except:
                    pass
                bot_process = None

import atexit
atexit.register(cleanup)

def signal_handler(signum, frame):
    print(f"🛑 Received signal {signum}. Shutting down...")
    cleanup()
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == '__main__':
    print("🚀 Starting Enhanced WhatsApp Bot Server...")
    print(f"📡 API Status:")
    print(f"   Gemini: {'✅ Ready' if GEMINI_AVAILABLE else '❌ Not configured'}")
    print(f"   Hugging Face: {'✅ Ready' if HF_AVAILABLE else '❌ Not configured'}")
    print(f"   HF Token: {'✅ Configured' if HF_TOKEN else '❌ Missing'}")
    
    if not GEMINI_AVAILABLE:
        print("⚠️  Gemini API not available - using fallback responses only")
        print("   Add GOOGLE_API_KEY to your .env file to enable AI responses")
    
    if not HF_AVAILABLE:
        print("⚠️  Hugging Face not available - image generation disabled")
        print("   Add 'token' (HF token) to your .env file to enable image generation")
    
    print(f"🎨 Available Image Models: {len(IMAGE_MODELS)}")
    for i, model in enumerate(IMAGE_MODELS, 1):
        print(f"   {i}. {model}")
    
    # Try to check qrcode package
    try:
        import qrcode
        print("✅ QR code library available")
    except ImportError:
        print("⚠️  Install qrcode package: pip install qrcode[pil]")
    
    port = int(os.environ.get('PORT', 5000))
    host = os.environ.get('HOST', '0.0.0.0')
    
    print(f"🌐 Server starting on {host}:{port}")
    print("🎯 Enhanced features:")
    print("   - Updated working image models (FLUX.1, SDXL)")
    print("   - Multiple fallback methods for image generation") 
    print("   - Enhanced error handling and diagnostics")
    print("   - Image generation test endpoint")
    print("   - Better Hindi/Hinglish support")
    print("   - Comprehensive model fallback system")
    
    app.run(host=host, port=port, debug=False, threaded=True)