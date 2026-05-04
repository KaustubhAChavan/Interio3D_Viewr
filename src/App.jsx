import React, { useState, useMemo, useRef, useEffect } from 'react';
import '@google/model-viewer';
import './App.css';

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [glbBlob, setGlbBlob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modelScale, setModelScale] = useState('1 1 1');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const modelRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const captureInputRef = useRef(null);

  const modelUrl = useMemo(() => {
    if (!glbBlob) return null;
    return URL.createObjectURL(glbBlob);
  }, [glbBlob]);

  useEffect(() => {
    if (!videoRef.current || !cameraStream) return;

    videoRef.current.srcObject = cameraStream;
    videoRef.current.play();
  }, [cameraStream]);

  useEffect(() => {
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cameraStream]);

  const processImageFile = async (file) => {
    setImageFile(file);
    setError(null);
    setLoading(true);
    setGlbBlob(null);
    setModelScale('1 1 1');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('https://unovert-unengaged-edwardo.ngrok-free.dev/convert', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();

      if (blob.type === 'application/json') {
        const errorData = await blob.text();
        throw new Error(JSON.parse(errorData).error || 'Unknown error');
      }

      setGlbBlob(blob);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    await processImageFile(file);
    e.target.value = '';
  };

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    setCameraStream(null);
    setCameraOpen(false);
  };

  const handleCameraOpen = async () => {
    if (loading) return;

    try {
      setError(null);

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access is not supported in this browser.');
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      setCameraStream(stream);
      setCameraOpen(true);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
        setError('Camera permission was blocked. Allow camera access, or open this app on mobile for capture.');
      } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        setError('No suitable camera was found. Use Upload Image on desktop, or open on mobile to capture.');
      } else {
        setError(err.message || 'Unable to open camera. Use Upload Image on desktop, or try capture on mobile.');
      }
    }
  };

  const handleCaptureClick = () => {
    if (loading) return;

    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobileDevice && captureInputRef.current) {
      captureInputRef.current.click();
      return;
    }

    handleCameraOpen();
  };

  const handleCameraCapture = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    if (!video.videoWidth || !video.videoHeight) {
      setError('Camera is still starting. Please wait a moment and try again.');
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, width, height);

    const blob = await new Promise((resolve) => {
      if (canvas.toBlob) {
        canvas.toBlob(resolve, 'image/jpeg', 0.92);
        return;
      }

      fetch(canvas.toDataURL('image/jpeg', 0.92))
        .then((response) => response.blob())
        .then(resolve)
        .catch(() => resolve(null));
    });

    if (!blob) {
      setError('Unable to capture photo. Please try again.');
      return;
    }

    const file = new File([blob], `camera-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
    stopCamera();
    await processImageFile(file);
  };

  const handleModelLoad = () => {
    const model = modelRef.current;
    if (!model) return;

    const { x, y, z } = model.getDimensions();
    const largestDimension = Math.max(x, y, z);
    const targetSize = 0.8;

    if (largestDimension > 0) {
      const scaleFactor = targetSize / largestDimension;
      setModelScale(`${scaleFactor} ${scaleFactor} ${scaleFactor}`);
    }
  };

  return (
    <main className="design-app">
      <div className={`app-shell ${imageFile || loading || modelUrl ? 'has-viewer' : ''}`}>
        <header className="app-header">
          <div className="brand-block">
            <span className="brand-mark">ID</span>
            <div>
              <p className="eyebrow">Interio3D Studio</p>
              <strong>Mobile AR scanner</strong>
            </div>
          </div>
          <div className="header-actions" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        </header>

        <section className={`app-workspace ${imageFile || loading || modelUrl ? 'has-viewer' : ''}`}>
          <section className="studio-panel" aria-label="Interior AI designer controls">
            <div className="content-stack">
              <p className="eyebrow">Photo to AR</p>
              <h1>Scan from mobile. Generate for AR.</h1>
              <p className="intro-copy">
                Upload an image or capture a photo with your phone camera to create the AR-ready 3D model.
              </p>
              <p className="device-note">
                Desktop supports 2D to 3D preview. For full scan-to-AR placement, open this app on mobile.
              </p>
            </div>

            <div className="upload-zone">
              <div className={`upload-card ${loading ? 'is-disabled' : ''}`}>
                <span className="upload-icon">+</span>
                <div>
                  <strong>{imageFile ? 'Replace selected image' : 'Add image for AR preview'}</strong>
                  <small>Use JPG, PNG, or a camera photo</small>
                </div>
                <div className="action-row">
                  <label className="image-action primary-action">
                    Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={loading}
                    />
                  </label>
                  <button
                    type="button"
                    className="image-action secondary-action"
                    onClick={handleCaptureClick}
                    disabled={loading}
                  >
                    Capture Image
                  </button>
                  <input
                    ref={captureInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={handleImageUpload}
                    disabled={loading}
                    style={{ display: 'none' }}
                  />
                </div>
                <p className="capture-hint">Capture is best on mobile. Desktop browsers may block camera permission.</p>
              </div>

              {cameraOpen && (
                <div className="camera-panel">
                  <video ref={videoRef} className="camera-preview" playsInline muted />
                  <canvas ref={canvasRef} className="camera-canvas" />
                  <div className="camera-actions">
                    <button type="button" className="camera-capture" onClick={handleCameraCapture}>
                      Take Photo
                    </button>
                    <button type="button" className="camera-close" onClick={stopCamera}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {imageFile && (
                <div className="preview-card">
                  <img src={URL.createObjectURL(imageFile)} alt="Uploaded image preview" />
                  <div>
                    <span>Selected image</span>
                    <strong>{imageFile.name}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="status-strip" role="status">
              {loading && (
                <>
                  <span className="status-dot is-loading" />
                  Generating 3D model...
                </>
              )}
              {error && (
                <>
                  <span className="status-dot is-error" />
                  {error}
                </>
              )}
              {glbBlob && !loading && (
                <>
                  <span className="status-dot is-ready" />
                  Model ready for 3D and AR viewing.
                </>
              )}
              {!loading && !error && !glbBlob && (
                <>
                  <span className="status-dot" />
                  Waiting for an image.
                </>
              )}
            </div>
          </section>

          {(imageFile || loading || modelUrl) && (
            <section className="viewer-panel" aria-label="3D model viewer">
              <div className="viewer-toolbar">
                <div>
                  <span>{loading ? 'Processing' : modelUrl ? 'Model generated' : 'Desktop preview'}</span>
                  <strong>{loading ? 'Creating 3D model' : modelUrl ? '3D preview ready' : 'Waiting for conversion'}</strong>
                </div>
              </div>

              <div className="viewer-surface">
                {loading ? (
                  <div className="loading-state">
                    <div className="spinner" />
                    <p>Building your AR preview...</p>
                  </div>
                ) : modelUrl ? (
                  <model-viewer
                    ref={modelRef}
                    src={modelUrl}
                    scale={modelScale}
                    onLoad={handleModelLoad}
                    ar
                    ar-modes="webxr scene-viewer"
                    ar-scale="auto"
                    ar-placement="floor"
                    camera-controls
                    auto-rotate
                    shadow-intensity="1"
                    environment-image="neutral"
                    exposure="0.9"
                    style={{ width: '100%', height: '100%' }}
                  >
                    <button slot="ar-button" className="ar-button">
                      View in AR
                    </button>
                  </model-viewer>
                ) : (
                  <div className="pending-preview">
                    {imageFile && (
                      <img src={URL.createObjectURL(imageFile)} alt="Selected image waiting for 3D conversion" />
                    )}
                    <strong>3D preview will appear here after conversion.</strong>
                    <p>On desktop you can inspect the generated model. Use mobile for camera scanning and AR placement.</p>
                  </div>
                )}
              </div>
              {modelUrl && (
                <p className="mobile-note">On desktop you can inspect the 3D model. Open on mobile to continue into AR placement.</p>
              )}
            </section>
          )}
        </section>
      </div>
    </main>
  );
}
