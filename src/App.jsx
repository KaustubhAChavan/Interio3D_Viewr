import React, { useState, useMemo, useRef, useEffect } from 'react';
import '@google/model-viewer';
import './App.css';

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [glbBlob, setGlbBlob] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modelScale, setModelScale] = useState('1 1 1');
  const modelRef = useRef(null);
  const previewRef = useRef(null);
  const uploadRequestRef = useRef(0);
  const abortRef = useRef(null);

  const modelUrl = useMemo(() => {
    if (!glbBlob) return null;
    return URL.createObjectURL(glbBlob);
  }, [glbBlob]);

  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return null;
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  const hasPreview = previewMode || imageFile || loading || modelUrl;

  useEffect(() => {
    return () => {
      if (modelUrl) URL.revokeObjectURL(modelUrl);
    };
  }, [modelUrl]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);

  useEffect(() => {
    if (!hasPreview) return;
    previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hasPreview]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const resetToHome = () => {
    uploadRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setImageFile(null);
    setPreviewMode(false);
    setGlbBlob(null);
    setLoading(false);
    setError(null);
    setModelScale('1 1 1');
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    uploadRequestRef.current += 1;
    const requestId = uploadRequestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setImageFile(file);
    setPreviewMode(true);
    setError(null);
    setLoading(true);
    setGlbBlob(null);
    setModelScale('1 1 1');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('https://excavate-persecute-punctuate.ngrok-free.dev/convert', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      if (requestId !== uploadRequestRef.current) return;

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();

      if (requestId !== uploadRequestRef.current) return;

      if (blob.type === 'application/json') {
        const errorData = await blob.text();
        throw new Error(JSON.parse(errorData).error || 'Unknown error');
      }

      setGlbBlob(blob);
    } catch (err) {
      if (err.name === 'AbortError' || requestId !== uploadRequestRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === uploadRequestRef.current) {
        setLoading(false);
        abortRef.current = null;
      }
      e.target.value = '';
    }
  };

  const handleViewAr = () => {
    modelRef.current?.activateAR?.();
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
      <div className={`app-shell ${hasPreview ? 'has-viewer' : ''}`}>
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

        <section className={`app-workspace ${hasPreview ? 'has-viewer' : ''}`}>
          {hasPreview && (
            <section className="viewer-panel" aria-label="3D model preview" ref={previewRef}>
              <div className="viewer-toolbar">
                <div>
                  <span>{loading ? 'Generating preview' : modelUrl ? '3D preview' : 'Image selected'}</span>
                  <strong>{loading ? 'Creating your model' : modelUrl ? 'Model ready' : 'Preparing conversion'}</strong>
                </div>
                <div className="viewer-toolbar-actions">
                  {modelUrl && (
                    <button type="button" className="toolbar-ar-button" onClick={handleViewAr}>
                      AR
                    </button>
                  )}
                  <button type="button" className="toolbar-home-button" onClick={resetToHome} aria-label="Return to home">
                    X
                  </button>
                </div>
              </div>

              <div className="viewer-surface">
                {loading ? (
                  <div className="loading-state">
                    {imagePreviewUrl && <img src={imagePreviewUrl} alt="Uploaded preview" />}
                    <div className="spinner" />
                    <p>Building your 3D preview...</p>
                  </div>
                ) : modelUrl ? (
                  <model-viewer
                    ref={modelRef}
                    src={modelUrl}
                    scale={modelScale}
                    onLoad={handleModelLoad}
                    ar
                    ar-modes="scene-viewer webxr quick-look"
                    ar-scale="fixed"
                    ar-placement="floor"
                    camera-controls
                    interaction-prompt="none"
                    shadow-intensity="1"
                    environment-image="neutral"
                    exposure="0.9"
                    camera-orbit="0deg 75deg 2.4m"
                    field-of-view="30deg"
                    style={{ width: '100%', height: '100%' }}
                  >
                    <button slot="ar-button" className="ar-button">
                      View in AR
                    </button>
                  </model-viewer>
                ) : (
                  <div className="pending-preview">
                    {imagePreviewUrl && (
                      <img src={imagePreviewUrl} alt="Selected image waiting for 3D conversion" />
                    )}
                    <strong>3D preview will appear here.</strong>
                    <p>Your image is uploaded. Keep this screen open while the model is generated.</p>
                  </div>
                )}
              </div>

              {modelUrl && (
                <div className="viewer-actions">
                  <button type="button" className="image-action primary-action" onClick={handleViewAr}>
                    View in AR
                  </button>
                  <p className="ar-placement-note">Move slowly until the floor is detected, then tap once to place.</p>
                </div>
              )}
            </section>
          )}

          <section className="studio-panel" aria-label="Interior AI designer controls">
            <div className="content-stack">
              <p className="eyebrow">Photo to AR</p>
              <h1>{loading ? 'Generating 3D preview' : hasPreview ? 'Preview ready' : 'Create a mobile AR model'}</h1>
              <p className="intro-copy">
                {loading
                  ? 'Please wait while your AR-ready model is being created.'
                  : hasPreview
                  ? 'Your preview screen is above. Replace the image anytime.'
                  : 'Upload an image and this app will open the 3D preview screen automatically.'}
              </p>
            </div>

            {!loading && (
              <div className="upload-zone">
              <div className={`upload-card ${loading ? 'is-disabled' : ''}`}>
                <span className="upload-icon">+</span>
                <div>
                  <strong>{imageFile ? 'Replace selected image' : 'Add image for AR preview'}</strong>
                  <small>Use JPG, PNG, or a camera photo</small>
                </div>
                <div className="action-row single-action">
                  <label className="image-action primary-action">
                    Upload Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={loading}
                    />
                  </label>
                </div>
              </div>

              {imageFile && (
                <div className="preview-card">
                  <img src={imagePreviewUrl} alt="Uploaded image preview" />
                  <div>
                    <span>Selected image</span>
                    <strong>{imageFile.name}</strong>
                  </div>
                </div>
              )}
              </div>
            )}

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
        </section>
      </div>
    </main>
  );
}
