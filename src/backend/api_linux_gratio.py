import os
import io
import uuid
import torch
import uvicorn
import gradio as gr
from fastapi import FastAPI, UploadFile, File, Request
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool # Import for non-blocking execution
from fastapi.staticfiles import StaticFiles
from PIL import Image
from sanitize_filename import sanitize
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils

# --- 1. SETUP PIPELINE ---
app = FastAPI()
GENERATED_MODELS_DIR = os.path.join(os.getcwd(), "generated_models")
os.makedirs(GENERATED_MODELS_DIR, exist_ok=True)
app.mount("/models", StaticFiles(directory=GENERATED_MODELS_DIR), name="models")

print("⏳ Loading Model...")

# CHECK FOR CUDA (Critical for Trellis)
if not torch.cuda.is_available():
    print("⚠️ WARNING: CUDA not detected. TRELLIS requires an NVIDIA GPU to run.")
    print("If you are on a Mac, this will likely fail or require a specific 'mps' fork.")
    device = "cpu" # Fallback (will be extremely slow/broken for Trellis)
else:
    device = "cuda"

try:
    # OPTIMIZATION: Load in float16 for speed and lower VRAM
    pipeline = TrellisImageTo3DPipeline.from_pretrained(
        "microsoft/TRELLIS-image-large",
    )
    pipeline.to(device)
except Exception as e:
    print(f"❌ Model Load Failed: {e}")
    pipeline = None

# --- 2. FASTAPI CONFIG ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def root():
    return {"status": "✅ Backend is running!", "device": device}

# --- 3. CORE LOGIC ---
def process_image_to_glb_bytes(image: Image.Image):
    if pipeline is None:
        raise RuntimeError("Model is not loaded.")
        
    # Run pipeline
    outputs = pipeline.run(
        image, 
        seed=1, 
        formats=["gaussian", "mesh"],
    )
    
    glb = postprocessing_utils.to_glb(
        outputs['gaussian'][0],
        outputs['mesh'][0],
        simplify=0.95,
        texture_size=1024,
    )
    
    glb_buffer = io.BytesIO()
    glb.export(glb_buffer, file_type='glb')
    glb_bytes = glb_buffer.getvalue()
    
    # Cleanup VRAM
    del outputs
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        
    return glb_bytes

# --- 4. FASTAPI ENDPOINT ---
# FIX: Removed 'async' from the definition to let FastAPI use threadpool
# OR: Keep async and use run_in_threadpool (shown below)
@app.post("/convert")
async def convert_image(request: Request, file: UploadFile = File(...)):
    try:
        original_name = file.filename
        safe_name = sanitize(original_name)
        base_name, _ = os.path.splitext(safe_name)
        if not base_name: base_name = "output"

        image_data = await file.read()
        
        # Load image in threadpool to avoid blocking
        image = await run_in_threadpool(Image.open, io.BytesIO(image_data))
        
        # CRITICAL FIX: Run heavy inference in threadpool
        glb_bytes = await run_in_threadpool(process_image_to_glb_bytes, image)

        model_filename = f"{base_name}-{uuid.uuid4().hex}.glb"
        model_path = os.path.join(GENERATED_MODELS_DIR, model_filename)

        def write_model_file():
            with open(model_path, "wb") as model_file:
                model_file.write(glb_bytes)

        await run_in_threadpool(write_model_file)

        model_url = str(request.url_for("models", path=model_filename))
        return JSONResponse(content={"model_url": model_url, "filename": model_filename})
    except Exception as e:
        print(f"❌ Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
