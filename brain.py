import google.generativeai as genai
import os
from PIL import Image
import traceback
from io import BytesIO
import base64
from flask import Flask, request, jsonify, send_file
from gradio_client import Client
from huggingface_hub import InferenceClient
from dotenv import load_dotenv

load_dotenv()
genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))

text_model = genai.GenerativeModel("models/gemini-2.5-flash")
image_model = InferenceClient(token=os.getenv("token"))
app = Flask(__name__)

@app.route('/', methods=['GET'])
def home():
    return "Gemini AI backend is running."

@app.route('/reply', methods=['POST'])
def reply():
    try:
        user_msg = request.json.get('text', '').strip()
        print(f"Received message: {user_msg }")

        if any(word.lower() in ["generate", "create", "make", "draw", "image", "picture", "photo"] for word in user_msg.split()):
            response = image_model.text_to_image(
                prompt=user_msg,
                negative_prompt="low quality, blurry, distorted",
                guidance_scale=7,
                num_inference_steps=50,
                width=512,
                height=512,
                model="stabilityai/stable-diffusion-xl-base-1.0"
               
            )
            buffer = BytesIO()
            response.save(buffer, format="PNG")
            buffer.seek(0)
            print(response)
            if isinstance(response, str) and os.path.exists(response):
                return send_file(buffer,mimetype="image/png",as_attachment=False,download_name="generated_image.png")
            elif isinstance(response, str) and response.startswith("http"):
                return jsonify({'image_url': response})

            elif hasattr(response, "save"):
                buffer = BytesIO()
                response.save(buffer, format="PNG")
                buffer.seek(0)
                return send_file(buffer, mimetype="image/png", as_attachment=False)
            print("Generated image path:", response)
        
        else:
            response = text_model.generate_content([f"{user_msg}\nResopnd with peacful reply and good interactive reply around 10 to 20 words only"],generation_config={"temperature": 1.2},stream=False)
            return jsonify({'reply': response.text.strip()})

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
        return jsonify({'reply': 'Something went wrong.'}), 500

if __name__ == '__main__':
    app.run(port=5000)