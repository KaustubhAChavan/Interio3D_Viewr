import React, { useState, useMemo, useRef, useEffect } from 'react';
import '@google/model-viewer';
import './App.css';

const SNAPSHOTS_STORAGE_KEY = 'placia-snapshots';
const MAX_SNAPSHOTS = 6;

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [glbBlob, setGlbBlob] = useState(null);
  const [publicModelUrl, setPublicModelUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [modelScale, setModelScale] = useState('1 1 1');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [snapshots, setSnapshots] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(SNAPSHOTS_STORAGE_KEY)) || [];
    } catch {
      return [];
    }
  });
  const modelRef = useRef(null);
  const previewRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const uploadRequestRef = useRef(0);
  const abortRef = useRef(null);

  const objectModelUrl = useMemo(() => {
    if (!glbBlob) return null;
    return URL.createObjectURL(glbBlob);
  }, [glbBlob]);

  const modelUrl = publicModelUrl || objectModelUrl;
  const arModes = publicModelUrl
    ? 'scene-viewer webxr quick-look'
    : 'webxr quick-look';

  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return null;
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  const hasPreview = previewMode || imageFile || loading || modelUrl;
  const convertUrl = 'https://excavate-persecute-punctuate.ngrok-free.dev/convert';
  const statusTone = error ? 'error' : loading ? 'loading' : modelUrl ? 'ready' : 'idle';
  const statusText = error ? 'Check model' : loading ? 'Generating' : modelUrl ? 'AR ready' : 'Ready';

  const normalizeModelUrl = (rawModelUrl, responseUrl) => {
    const resolvedUrl = new URL(rawModelUrl, responseUrl);
    const responseOrigin = new URL(responseUrl).origin;

    if (
      resolvedUrl.hostname === 'localhost' ||
      resolvedUrl.hostname === '127.0.0.1' ||
      resolvedUrl.protocol === 'http:'
    ) {
      return `${responseOrigin}${resolvedUrl.pathname}${resolvedUrl.search}`;
    }

    return resolvedUrl.href;
  };

  useEffect(() => {
    return () => {
      if (objectModelUrl) URL.revokeObjectURL(objectModelUrl);
    };
  }, [objectModelUrl]);

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

  useEffect(() => {
    try {
      localStorage.setItem(SNAPSHOTS_STORAGE_KEY, JSON.stringify(snapshots));
    } catch {
      // Ignore storage quota errors; snapshots still remain for the current session.
    }
  }, [snapshots]);

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

  const resetToHome = () => {
    uploadRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    setImageFile(null);
    setPreviewMode(false);
    setGlbBlob(null);
    setPublicModelUrl(null);
    setLoading(false);
    setError(null);
    setModelScale('1 1 1');
    setCameraStream(null);
    setCameraOpen(false);
  };

  const processImageFile = async (file) => {
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
    setPublicModelUrl(null);
    setModelScale('1 1 1');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(convertUrl, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
        headers: {
          'ngrok-skip-browser-warning': 'true',
        },
      });

      if (requestId !== uploadRequestRef.current) return;

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();

        if (requestId !== uploadRequestRef.current) return;

        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.model_url) {
          throw new Error('Conversion response did not include a model URL.');
        }

        const normalizedModelUrl = normalizeModelUrl(data.model_url, response.url);
        setPublicModelUrl(normalizedModelUrl);

        const modelResponse = await fetch(normalizedModelUrl, {
          signal: controller.signal,
          headers: {
            'ngrok-skip-browser-warning': 'true',
          },
        });

        if (requestId !== uploadRequestRef.current) return;

        if (!modelResponse.ok) {
          throw new Error(`Model download error: ${modelResponse.status} ${modelResponse.statusText}`);
        }

        const modelBlob = await modelResponse.blob();

        if (requestId !== uploadRequestRef.current) return;

        if (!modelBlob.type.includes('gltf-binary') && !normalizedModelUrl.toLowerCase().includes('.glb')) {
          throw new Error('Downloaded model was not a valid GLB file.');
        }

        setGlbBlob(modelBlob);
        return;
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
    }
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
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
        setError('Camera permission was blocked. Allow camera access, or upload an image instead.');
      } else if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
        setError('No suitable camera was found. Upload an image instead.');
      } else {
        setError(err.message || 'Unable to open camera. Upload an image instead.');
      }
    }
  };

  const handleCameraCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, width, height);

    canvas.toBlob(async (blob) => {
      if (!blob) {
        setError('Unable to capture photo. Please try again.');
        return;
      }

      const file = new File([blob], `placia-capture-${Date.now()}.jpg`, { type: 'image/jpeg' });
      stopCamera();
      await processImageFile(file);
    }, 'image/jpeg', 0.92);
  };

  const handleViewAr = () => {
    modelRef.current?.activateAR?.();
  };

  const handleSaveSnapshot = () => {
    const model = modelRef.current;
    if (!model) return;

    try {
      const imageUrl = model.toDataURL('image/png');
      const createdAt = new Date();
      const snapshot = {
        id: `${createdAt.getTime()}`,
        imageUrl,
        title: imageFile?.name || 'Placia snapshot',
        createdAt: createdAt.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      setSnapshots((currentSnapshots) => [snapshot, ...currentSnapshots].slice(0, MAX_SNAPSHOTS));
    } catch {
      setError('Unable to save snapshot. Try rotating the preview and saving again.');
    }
  };

  const deleteSnapshot = (snapshotId) => {
    setSnapshots((currentSnapshots) => currentSnapshots.filter((snapshot) => snapshot.id !== snapshotId));
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
            <span className="brand-mark">P</span>
            <div>
              <p className="eyebrow brand-title">Placia Studio</p>
            </div>
          </div>
          <div className={`header-status is-${statusTone}`} aria-live="polite">
            <span />
            {statusText}
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
                  <button type="button" className="toolbar-home-button" onClick={resetToHome} aria-label="Return to home">
                    <span />
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
                    ar-modes={arModes}
                    ar-scale="fixed"
                    ar-placement="floor"
                    xr-environment
                    camera-controls
                    auto-rotate
                    shadow-intensity="1"
                    shadow-softness="0.8"
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
                  <div className="viewer-action-row">
                    <button type="button" className="image-action primary-action" onClick={handleViewAr}>
                      View in AR
                    </button>
                    <button type="button" className="image-action secondary-action" onClick={handleSaveSnapshot}>
                      Save snapshot
                    </button>
                  </div>
                  <p className="ar-placement-note">Scan the floor slowly, tap once on the detected surface, then walk around the placed model.</p>
                </div>
              )}
            </section>
          )}

          <section className="studio-panel" aria-label="Interior AI designer controls">
            <div className="placia-hero">
              <div className="placia-title-block">
                <div className="placia-lockup">
                  <p className="placia-name">Placia</p>
                  <h1>
                    {loading
                      ? 'Creating your 3D model'
                      : hasPreview
                      ? 'Your design is ready'
                      : 'Place your designs'}
                  </h1>
                </div>
              </div>
              <div className="hero-design" aria-hidden="true">
                <span className="hero-arch" />
                <span className="hero-cube hero-cube-main" />
                <span className="hero-cube hero-cube-side" />
                <span className="hero-floor" />
              </div>
            </div>

            {!loading && (
              <div className="upload-zone">
              <div className={`upload-card ${loading ? 'is-disabled' : ''}`}>
                <div className="upload-copy">
                  <strong>{imageFile ? 'Replace design image' : 'Upload your design image'}</strong>
                  <small>
                    {loading
                      ? 'Keep this screen open while Placia prepares your AR-ready model.'
                      : hasPreview
                      ? 'Preview it above, then open AR.'
                      : 'Upload or capture an image for a 3D preview and AR placement.'}
                  </small>
                </div>
                <div className="action-row">
                  <label className="image-action upload-choice primary-choice">
                    <span className="choice-icon upload-choice-icon" aria-hidden="true" />
                    <span>
                      <strong>Upload Image</strong>
                      <small>Choose from gallery</small>
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={loading}
                    />
                  </label>
                  <button type="button" className="image-action upload-choice secondary-choice" onClick={handleCameraOpen}>
                    <span className="choice-icon camera-choice-icon" aria-hidden="true" />
                    <span>
                      <strong>Live Capture</strong>
                      <small>Use your camera</small>
                    </span>
                  </button>
                </div>
              </div>

              {cameraOpen && (
                <div className="camera-panel">
                  <video ref={videoRef} className="camera-preview" playsInline muted />
                  <canvas ref={canvasRef} className="camera-canvas" />
                  <div className="camera-actions">
                    <button type="button" className="camera-capture" onClick={handleCameraCapture}>
                      Capture
                    </button>
                    <button type="button" className="camera-close" onClick={stopCamera}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}

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
              {modelUrl && !loading && (
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

            {snapshots.length > 0 && (
              <section className="snapshots-panel" aria-label="Saved snapshots">
                <div className="snapshots-heading">
                  <span>Saved snapshots</span>
                  <strong>{snapshots.length}</strong>
                </div>
                <div className="snapshots-grid">
                  {snapshots.map((snapshot) => (
                    <article className="snapshot-card" key={snapshot.id}>
                      <img src={snapshot.imageUrl} alt={`Saved snapshot from ${snapshot.createdAt}`} />
                      <div className="snapshot-meta">
                        <span>{snapshot.createdAt}</span>
                        <div className="snapshot-actions">
                          <a href={snapshot.imageUrl} download={`${snapshot.title}.png`}>
                            Download
                          </a>
                          <button type="button" onClick={() => deleteSnapshot(snapshot.id)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
