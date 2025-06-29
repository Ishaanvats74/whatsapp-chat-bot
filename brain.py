import google.generativeai as genai
from google import genai
from google.genai import types
from PIL import Image
from io import BytesIO
import base64
from flask import Flask, request, jsonify, send_file

genai.configure(api_key="AIzaSyBq_9eLUHmT13hZKz9ZW571xrrmDm85MMk")

model = genai.GenerativeModel(
    model_name="models/gemini-2.5-flash",
    generation_config={"response_mime_type": "image/png"}
)

app = Flask(__name__)
@app.route('/reply',methods=['POST'])

def reply():
    try:
        user_msg= request.json.get('text','')
        response = model.generate_content([user_msg],stream=False)
        part = response.candidates[0].content.parts[0]
        
        if hasattr(part,'inline_image') and part.inline_data.mime_type.startwith('image/'): 
            image_data = part.inline_data.data
            return send_file(
                BytesIO(image_data),
                mimetype='image/png',
                download_name='generated_image.png',
            )
        elif hasattr(part,'text'):
            return jsonify({
                'reply': part.text.strip()
                })
        else: 
            return jsonify({'reply': 'No valid response generated.'}), 400

    except Exception as e:
        print(f"Error:{e}")
        return jsonify({'reply':'Something went wrong, please try again later.'}), 500
    

if __name__ == '__main__':
    app.run(port=5000)

