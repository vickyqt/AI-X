from flask import Flask, render_template, request, jsonify
import google.generativeai as genai
import os
from dotenv import load_dotenv
from google.generativeai.types import GenerationConfig
import json
import re

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Configure Gemini API
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
if not GEMINI_API_KEY:
    raise ValueError("GEMINI_API_KEY not found in environment variables")

genai.configure(api_key=GEMINI_API_KEY)

def get_gemini_model():
    """Get a working Gemini model with fallback options"""
    model_options = [
        'gemini-1.5-flash',
        'gemini-1.5-pro',
        'gemini-pro',
        'models/gemini-1.0-pro',
    ]
    
    for model_name in model_options:
        try:
            model = genai.GenerativeModel(model_name)
            # Test with minimal request
            model.generate_content("test", generation_config=GenerationConfig(max_output_tokens=10))
            print(f"Successfully initialized model: {model_name}")
            return model
        except Exception as e:
            print(f"Failed to initialize {model_name}: {str(e)}")
            continue
    
    raise Exception("No Gemini models available. Please check your API key and permissions.")

# Initialize the model
try:
    model = get_gemini_model()
except Exception as e:
    print(f"Error initializing Gemini model: {e}")
    model = None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/list-models')
def list_models():
    """Endpoint to list all available models"""
    try:
        models = genai.list_models()
        available_models = []
        for m in models:
            if 'generateContent' in m.supported_generation_methods:
                available_models.append({
                    'name': m.name,
                    'description': getattr(m, 'description', ''),
                    'input_token_limit': getattr(m, 'input_token_limit', None),
                    'output_token_limit': getattr(m, 'output_token_limit', None)
                })
        
        return jsonify({
            'success': True,
            'models': available_models
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def clean_and_parse_json(response_text):
    """Clean and parse JSON response from Gemini"""
    try:
        # Remove markdown code blocks
        cleaned = response_text.strip()
        if cleaned.startswith('```json'):
            cleaned = cleaned[7:]
        if cleaned.startswith('```'):
            cleaned = cleaned[3:]
        if cleaned.endswith('```'):
            cleaned = cleaned[:-3]
        
        # Try to find JSON object in the response
        json_match = re.search(r'\{.*\}', cleaned, re.DOTALL)
        if json_match:
            cleaned = json_match.group(0)
        
        # Parse JSON
        result = json.loads(cleaned)
        
        # Ensure required fields exist and map to expected format
        # Map to the format expected by the frontend
        formatted_result = {
            "is_correct": bool(result.get("is_correct", False)),
            "confidence": int(result.get("confidence", 50)),
            "reasoning": str(result.get("explanation", result.get("reasoning", "No reasoning provided."))),
            "suggestions": str(result.get("correction", result.get("suggestions", "No suggestions provided.")))
        }
        
        return formatted_result
    except Exception as e:
        # Return a default structure if parsing fails
        return {
            "is_correct": False,
            "confidence": 50,
            "reasoning": f"Could not parse AI response: {str(e)}. Raw response: {response_text[:200]}...",
            "suggestions": "Please try rephrasing your input or try again."
        }

@app.route('/verify', methods=['POST'])
def verify_input():
    try:
        # Validate request
        if not request.is_json:
            return jsonify({
                'success': False, 
                'error': 'Content-Type must be application/json'
            }), 400
        
        json_data = request.get_json()
        if json_data is None:
            return jsonify({
                'success': False, 
                'error': 'Invalid JSON data'
            }), 400
        
        # Get and validate user input
        user_input = json_data.get('input', '').strip()  # Fixed: was 'user_input'
        
        if not user_input:
            return jsonify({
                'success': False, 
                'error': 'No input provided'
            }), 400
        
        # Limit input length for safety
        if len(user_input) > 5000:
            return jsonify({
                'success': False,
                'error': 'Input too long (max 5000 characters)'
            }), 400
        
        # Check if model is available
        if model is None:
            return jsonify({
                'success': False,
                'error': 'Gemini model not available. Please check server logs.'
            }), 500
        
        # Create improved prompt
        prompt = f"""
        You are a fact-checking assistant. Analyze the following input and determine if it is factually correct, 
        logically sound, and free of errors.
        
        Input: {user_input}
        
        Respond ONLY with a JSON object in this exact format:
        {{
            "is_correct": true/false,
            "confidence": 0-100 (percentage confidence in your assessment),
            "reasoning": "Brief explanation of your assessment",
            "suggestions": "Corrected version or suggestions if needed, otherwise 'None'"
        }}
        
        Rules:
        - Be concise in your reasoning (max 200 words)
        - If the input is correct, set suggestions to "None"
        - Confidence should reflect how certain you are (0-100)
        - Only output the JSON object, no additional text
        """
        
        # Generate response
        try:
            generation_config = GenerationConfig(
                temperature=0.1,
                max_output_tokens=1024,  # Reduced from 2048 for faster responses
                top_p=0.95,
                top_k=40
            )
            
            response = model.generate_content(
                prompt, 
                generation_config=generation_config
            )
        except Exception as e:
            error_details = str(e)
            # Try to get more info about the error
            try:
                models = genai.list_models()
                available_models = [m.name for m in models if 'generateContent' in m.supported_generation_methods]
                error_details += f" | Available models: {', '.join(available_models[:3])}"
            except:
                pass
                
            return jsonify({
                'success': False,
                'error': f'Failed to generate content: {error_details}',
                'suggestion': 'Try again or contact support if the problem persists'
            }), 500
        
        # Process response
        if not hasattr(response, 'text') or not response.text:
            return jsonify({
                'success': False,
                'error': 'No response text received from Gemini API',
                'response_info': str(response)
            }), 500
            
        response_text = response.text.strip()
        
        # Parse and clean the response
        result = clean_and_parse_json(response_text)
        
        return jsonify({
            'success': True,
            'result': result,
            'model_used': getattr(model, 'model_name', str(model)) if model else 'unknown'
        })
        
    except Exception as e:
        # Log the error for debugging
        print(f"Unexpected error in /verify: {str(e)}")
        return jsonify({
            'success': False,
            'error': 'An unexpected error occurred. Please try again.'
        }), 500

if __name__ == '__main__':
    app.run(debug=False)
