import google.generativeai as genai
from flask import Flask, request, jsonify

app =Flask(__name__)
genai.configure(api_key="AIzaSyBq_9eLUHmT13hZKz9ZW571xrrmDm85MMk")

model=genai.GenerativeModel("models/gemini-2.5-flash")
@app.route('/reply',methods=['POST'])

def reply():
    user_msg= request.json['text']
    response = model.generate_content(user_msg)
    print(response)
    return jsonify(
        {
            'reply': response.text.strip()
            }
        )
if __name__ == '__main__':
    app.run(port=5000)