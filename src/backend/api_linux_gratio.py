import os
import io
import torch
import uvicorn
import gradio as gr
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import Response, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.concurrency import run_in_threadpool # Import for non-blocking execution
from PIL import Image
from sanitize_filename import sanitize
from trellis.pipelines import TrellisImageTo3DPipeline
from trellis.utils import postprocessing_utils

# --- 1. SETUP PIPELINE ---
app = FastAPI()

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
async def convert_image(file: UploadFile = File(...)):
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

        return Response(
            content=glb_bytes,
            media_type="model/gltf-binary",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.glb"'}
        )
    except Exception as e:
        print(f"❌ Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080)
