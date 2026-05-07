import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@google/model-viewer';
import './App.css';
import {
  combineModelsIntoGlb,
  createModelScale,
  DEFAULT_MODEL_TRANSFORM,
  formatMetric,
  formatScale,
  formatSignedMetric,
  hasCustomModelTransform,
  inspectModel,
  normalizeModelTransform,
} from './modelScene';

const SNAPSHOTS_STORAGE_KEY = 'placia-snapshots';
const MAX_SNAPSHOTS = 6;
const MAX_SCENE_MODELS = 6;
const POSITION_STEP = 0.15;
const ROTATION_STEP = 15;
const SCALE_STEP = 0.1;
const MIN_COMPOSER_SCALE = 0.4;
const MAX_COMPOSER_SCALE = 2.5;

const revokeObjectUrl = (url) => {
  if (url?.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

const revokeModelAssets = (model) => {
  revokeObjectUrl(model.assetUrl);
  revokeObjectUrl(model.imageUrl);
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const decodeSharePayload = (encodedPayload) => {
  const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

  return JSON.parse(new TextDecoder().decode(bytes));
};

export default function App() {
  const [imageFile, setImageFile] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [models, setModels] = useState([]);
  const [sceneModelUrl, setSceneModelUrl] = useState(null);
  const [sceneBlob, setSceneBlob] = useState(null);
  const [sceneTitle, setSceneTitle] = useState('');
  const [sceneBuilding, setSceneBuilding] = useState(false);
  const [arGuideOpen, setArGuideOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [sharedSceneLoaded, setSharedSceneLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
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
  const sceneUrlRef = useRef(null);
  const sceneBuildRequestRef = useRef(0);
  const modelsRef = useRef([]);

  const imagePreviewUrl = useMemo(() => {
    if (!imageFile) return null;
    return URL.createObjectURL(imageFile);
  }, [imageFile]);

  const selectedModels = useMemo(() => models.filter((model) => model.selected), [models]);
  const selectedModelCount = selectedModels.length;
  const singleSelectedModel = selectedModelCount === 1 ? selectedModels[0] : null;
  const selectedSceneHasTransforms = selectedModels.some(hasCustomModelTransform);
  const modelScale =
    singleSelectedModel && !selectedSceneHasTransforms ? createModelScale(singleSelectedModel.metadata) : '1 1 1';
  const modelUrl = sceneModelUrl;
  const hasNativeRoomAnchor = Boolean(
    singleSelectedModel?.publicUrl?.startsWith('https://') &&
      modelUrl === singleSelectedModel.publicUrl &&
      !selectedSceneHasTransforms,
  );
  const arModes = hasNativeRoomAnchor ? 'scene-viewer webxr quick-look' : 'webxr quick-look';
  const hasPreview = previewMode || imageFile || loading || sceneBuilding || modelUrl || models.length > 0;
  const convertUrl = import.meta.env.VITE_CONVERT_URL || 'https://trellis-mock-backend.vercel.app/convert';
  const statusTone = error ? 'error' : loading || sceneBuilding ? 'loading' : modelUrl ? 'ready' : 'idle';
  const statusText = error
    ? 'Check model'
    : loading
    ? 'Generating'
    : sceneBuilding
    ? 'Combining'
    : modelUrl
    ? 'AR ready'
    : 'Ready';

  const websiteUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';

    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';

    return url.toString();
  }, []);

  const qrImageUrl = websiteUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(websiteUrl)}`
    : '';

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

  const replaceScene = useCallback(({ url, blob = null, title = '', ownsUrl = false }) => {
    if (sceneUrlRef.current && sceneUrlRef.current !== url) {
      URL.revokeObjectURL(sceneUrlRef.current);
    }

    sceneUrlRef.current = ownsUrl ? url : null;
    setSceneModelUrl(url);
    setSceneBlob(blob);
    setSceneTitle(title);
  }, []);

  const clearScene = useCallback(() => {
    if (sceneUrlRef.current) {
      URL.revokeObjectURL(sceneUrlRef.current);
      sceneUrlRef.current = null;
    }

    setSceneModelUrl(null);
    setSceneBlob(null);
    setSceneTitle('');
    setSceneBuilding(false);
  }, []);

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

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
      if (sceneUrlRef.current) {
        URL.revokeObjectURL(sceneUrlRef.current);
      }
      modelsRef.current.forEach(revokeModelAssets);
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

  useEffect(() => {
    if (sharedSceneLoaded || typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    const sceneParam = params.get('scene');
    const singleModelUrl = params.get('modelUrl') || params.get('sceneUrl');

    if (!sceneParam && !singleModelUrl) {
      setSharedSceneLoaded(true);
      return;
    }

    let canceled = false;

    const loadSharedScene = async () => {
      setSharedSceneLoaded(true);
      setPreviewMode(true);
      setLoading(true);
      setError(null);
      clearScene();
      modelsRef.current.forEach(revokeModelAssets);
      modelsRef.current = [];
      setModels([]);

      try {
        const payload = sceneParam
          ? decodeSharePayload(sceneParam)
          : {
              version: 1,
              models: [{ name: 'Shared model', url: singleModelUrl, transform: DEFAULT_MODEL_TRANSFORM }],
            };

        if (!Array.isArray(payload.models) || payload.models.length === 0) {
          throw new Error('Shared scene did not include any models.');
        }

        const createdAt = new Date();
        const loadedModels = await Promise.all(
          payload.models.slice(0, MAX_SCENE_MODELS).map(async (sharedModel, index) => {
            if (!sharedModel.url?.startsWith('https://')) {
              throw new Error('Shared scenes must use public HTTPS model URLs.');
            }

            const metadata = await inspectModel(sharedModel.url);

            return {
              id: `shared-${createdAt.getTime()}-${index}`,
              name: sharedModel.name || `Shared model ${index + 1}`,
              assetUrl: sharedModel.url,
              imageUrl: null,
              publicUrl: sharedModel.url,
              metadata,
              transform: normalizeModelTransform(sharedModel.transform),
              selected: true,
              createdAt: createdAt.toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
            };
          }),
        );

        if (canceled) return;
        setModels(loadedModels);
      } catch (err) {
        if (!canceled) {
          setError(err.message || 'Unable to load the shared AR scene.');
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    };

    loadSharedScene();

    return () => {
      canceled = true;
    };
  }, [clearScene, sharedSceneLoaded]);

  useEffect(() => {
    if (loading) return;

    if (selectedModels.length === 0) {
      clearScene();
      return;
    }

    if (selectedModels.length === 1 && !selectedSceneHasTransforms) {
      const model = selectedModels[0];
      const url = model.publicUrl?.startsWith('https://') ? model.publicUrl : model.assetUrl;
      replaceScene({
        url,
        title: model.name,
        ownsUrl: false,
      });
      setSceneBuilding(false);
      return;
    }

    const requestId = sceneBuildRequestRef.current + 1;
    sceneBuildRequestRef.current = requestId;
    let canceled = false;

    setSceneBuilding(true);
    setError(null);

    combineModelsIntoGlb(selectedModels)
      .then((combinedBlob) => {
        if (canceled || requestId !== sceneBuildRequestRef.current) return;

        const url = URL.createObjectURL(combinedBlob);
        replaceScene({
          url,
          blob: combinedBlob,
          title: `${selectedModels.length} model AR scene`,
          ownsUrl: true,
        });
      })
      .catch((err) => {
        if (canceled || requestId !== sceneBuildRequestRef.current) return;
        setError(err.message || 'Unable to combine selected models.');
      })
      .finally(() => {
        if (!canceled && requestId === sceneBuildRequestRef.current) {
          setSceneBuilding(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [clearScene, loading, replaceScene, selectedModels, selectedSceneHasTransforms]);

  const resetToHome = () => {
    uploadRequestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;

    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }

    clearScene();
    modelsRef.current.forEach(revokeModelAssets);
    modelsRef.current = [];
    setModels([]);
    setImageFile(null);
    setPreviewMode(false);
    setLoading(false);
    setError(null);
    setCameraStream(null);
    setCameraOpen(false);
    setArGuideOpen(false);
    setQrOpen(false);
    setCopyStatus('');
  };

  const addModelToScene = (model) => {
    setModels((currentModels) => {
      const nextModels = [...currentModels, model];
      const extraCount = Math.max(nextModels.length - MAX_SCENE_MODELS, 0);

      if (extraCount > 0) {
        nextModels.splice(0, extraCount).forEach(revokeModelAssets);
      }

      return nextModels;
    });
  };

  const processModelBlob = async ({ modelBlob, publicUrl, file, requestId }) => {
    const assetUrl = URL.createObjectURL(modelBlob);
    const imageUrl = URL.createObjectURL(file);

    try {
      const metadata = await inspectModel(assetUrl);

      if (requestId !== uploadRequestRef.current) {
        revokeObjectUrl(assetUrl);
        revokeObjectUrl(imageUrl);
        return;
      }

      const createdAt = new Date();

      addModelToScene({
        id: `${createdAt.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
        name: file.name || `Model ${modelsRef.current.length + 1}`,
        assetUrl,
        imageUrl,
        publicUrl,
        metadata,
        transform: DEFAULT_MODEL_TRANSFORM,
        selected: true,
        createdAt: createdAt.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
    } catch (err) {
      revokeObjectUrl(assetUrl);
      revokeObjectUrl(imageUrl);
      throw err;
    }
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

        await processModelBlob({
          modelBlob,
          publicUrl: normalizedModelUrl,
          file,
          requestId,
        });
        return;
      }

      const blob = await response.blob();

      if (requestId !== uploadRequestRef.current) return;

      if (blob.type === 'application/json') {
        const errorData = await blob.text();
        throw new Error(JSON.parse(errorData).error || 'Unknown error');
      }

      await processModelBlob({
        modelBlob: blob,
        publicUrl: null,
        file,
        requestId,
      });
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
    if (!modelUrl || sceneBuilding) return;
    setArGuideOpen(true);
  };

  const handleStartAr = () => {
    setArGuideOpen(false);
    window.requestAnimationFrame(() => {
      modelRef.current?.activateAR?.();
    });
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
        title: sceneTitle || imageFile?.name || 'Placia snapshot',
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

  const toggleModelSelection = (modelId) => {
    setModels((currentModels) =>
      currentModels.map((model) => (model.id === modelId ? { ...model, selected: !model.selected } : model)),
    );
  };

  const updateModelTransform = (modelId, updater) => {
    setModels((currentModels) =>
      currentModels.map((model) => {
        if (model.id !== modelId) return model;

        const currentTransform = normalizeModelTransform(model.transform);
        const nextTransform = normalizeModelTransform(updater(currentTransform));

        return {
          ...model,
          transform: {
            ...nextTransform,
            scale: clamp(nextTransform.scale, MIN_COMPOSER_SCALE, MAX_COMPOSER_SCALE),
          },
        };
      }),
    );
  };

  const nudgeModelTransform = (modelId, key, delta) => {
    updateModelTransform(modelId, (transform) => ({
      ...transform,
      [key]: transform[key] + delta,
    }));
  };

  const resetModelTransform = (modelId) => {
    updateModelTransform(modelId, () => DEFAULT_MODEL_TRANSFORM);
  };

  const removeModel = (modelId) => {
    setModels((currentModels) => {
      const modelToRemove = currentModels.find((model) => model.id === modelId);
      if (modelToRemove) revokeModelAssets(modelToRemove);
      return currentModels.filter((model) => model.id !== modelId);
    });
  };

  const handleCopyWebsiteUrl = async () => {
    if (!websiteUrl) return;

    try {
      await navigator.clipboard.writeText(websiteUrl);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Select and copy the link below.');
    }
  };

  const downloadScene = () => {
    const downloadUrl = sceneBlob ? URL.createObjectURL(sceneBlob) : modelUrl;
    if (!downloadUrl) return;

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${sceneTitle || 'placia-scene'}.glb`;
    link.click();

    if (sceneBlob) {
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
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
          <div className="header-actions">
            <button
              type="button"
              className="header-qr-button"
              onClick={() => {
                setCopyStatus('');
                setQrOpen(true);
              }}
            >
              App QR
            </button>
            <div className={`header-status is-${statusTone}`} aria-live="polite">
              <span />
              {statusText}
            </div>
          </div>
        </header>

        <section className={`app-workspace ${hasPreview ? 'has-viewer' : ''}`}>
          {hasPreview && (
            <section className="viewer-panel" aria-label="3D model preview" ref={previewRef}>
              <div className="viewer-toolbar">
                <div>
                  <span>
                    {loading
                      ? 'Generating preview'
                      : sceneBuilding
                      ? 'Combining scene'
                      : modelUrl
                      ? `${selectedModelCount} selected`
                      : 'Image selected'}
                  </span>
                  <strong>
                    {loading
                      ? 'Creating your model'
                      : sceneBuilding
                      ? 'Building AR scene'
                      : modelUrl
                      ? sceneTitle
                      : 'Preparing conversion'}
                  </strong>
                </div>
                <div className="viewer-toolbar-actions">
                  <button type="button" className="toolbar-home-button" onClick={resetToHome} aria-label="Return to home">
                    <span />
                  </button>
                </div>
              </div>

              <div className="viewer-surface">
                {loading || sceneBuilding ? (
                  <div className="loading-state">
                    {imagePreviewUrl && loading && <img src={imagePreviewUrl} alt="Uploaded preview" />}
                    <div className="spinner" />
                    <p>{loading ? 'Building your 3D preview...' : 'Combining selected models into one GLB scene...'}</p>
                  </div>
                ) : modelUrl ? (
                  <model-viewer
                    key={modelUrl}
                    ref={modelRef}
                    src={modelUrl}
                    scale={modelScale}
                    ar
                    ar-modes={arModes}
                    ar-scale="auto"
                    ar-placement="floor"
                    camera-controls
                    shadow-intensity="1"
                    shadow-softness="0.8"
                    environment-image="neutral"
                    exposure="0.9"
                    interaction-prompt="none"
                    style={{ width: '100%', height: '100%' }}
                  >
                    <button slot="ar-button" className="viewer-hidden-ar-button" aria-hidden="true" tabIndex="-1" />
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
                    <button type="button" className="image-action primary-action ar-action-button" onClick={handleViewAr}>
                      View in AR
                    </button>
                    <button type="button" className="image-action secondary-action" onClick={handleSaveSnapshot}>
                      Save snapshot
                    </button>
                    <button type="button" className="image-action secondary-action" onClick={downloadScene}>
                      Download GLB
                    </button>
                    <button
                      type="button"
                      className="image-action secondary-action"
                      onClick={() => {
                        setCopyStatus('');
                        setQrOpen(true);
                      }}
                    >
                      App QR
                    </button>
                  </div>
                  <p className="ar-placement-note">
                    {selectedModelCount > 1
                      ? 'Selected models are combined into one GLB scene before AR opens.'
                      : hasNativeRoomAnchor
                      ? 'Place the model, adjust size with two fingers, then walk around it. One-finger dragging is disabled to avoid accidental movement.'
                      : 'Browser AR fallback is active. For fixed Android room anchoring, the generated model must come from a public HTTPS URL.'}
                  </p>
                </div>
              )}
            </section>
          )}

          <section className="studio-panel" aria-label="Interior AI designer controls">
            <div className="status-strip top-status-strip" role="status">
              {loading && (
                <>
                  <span className="status-dot is-loading" />
                  Generating 3D model...
                </>
              )}
              {sceneBuilding && !loading && (
                <>
                  <span className="status-dot is-loading" />
                  Combining selected models...
                </>
              )}
              {error && (
                <>
                  <span className="status-dot is-error" />
                  {error}
                </>
              )}
              {modelUrl && !loading && !sceneBuilding && (
                <>
                  <span className="status-dot is-ready" />
                  {selectedModelCount > 1 ? 'Combined scene ready for AR viewing.' : 'Model ready for 3D and AR viewing.'}
                </>
              )}
              {!loading && !sceneBuilding && !error && models.length === 0 && (
                <>
                  <span className="status-dot" />
                  Waiting for an image.
                </>
              )}
            </div>

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
                    <strong>{models.length ? 'Add another design image' : 'Upload your design image'}</strong>
                    <small>
                      {models.length
                        ? 'Add more models, select them below, then open the combined AR scene.'
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
                      <span>Latest image</span>
                      <strong>{imageFile.name}</strong>
                    </div>
                  </div>
                )}
              </div>
            )}

            {models.length > 0 && (
              <section className="scene-panel" aria-label="Scene models">
                <div className="scene-heading">
                  <div>
                    <span>Scene models</span>
                    <strong>
                      {selectedModelCount}/{models.length} selected
                    </strong>
                  </div>
                  <span className="scene-badge">{selectedModelCount > 1 ? 'Combined GLB' : 'Single GLB'}</span>
                </div>

                <div className="model-list">
                  {models.map((model, index) => {
                    const transform = normalizeModelTransform(model.transform);

                    return (
                      <article className={`model-card ${model.selected ? 'is-selected' : ''}`} key={model.id}>
                        <label className="model-select-row">
                          <input
                            type="checkbox"
                            checked={model.selected}
                            onChange={() => toggleModelSelection(model.id)}
                          />
                          {model.imageUrl ? (
                            <img src={model.imageUrl} alt={`Source for ${model.name}`} />
                          ) : (
                            <span className="model-thumb-placeholder">3D</span>
                          )}
                          <span>
                            <small>Model {index + 1}</small>
                            <strong>{model.name}</strong>
                          </span>
                        </label>

                        <div className="metadata-grid" aria-label={`${model.name} metadata`}>
                          <span>W {formatMetric(model.metadata.normalizedDimensions.x)}</span>
                          <span>H {formatMetric(model.metadata.normalizedDimensions.y)}</span>
                          <span>D {formatMetric(model.metadata.normalizedDimensions.z)}</span>
                          <span>Base {formatScale(model.metadata.scaleFactor)}</span>
                          <span>Floor {formatSignedMetric(model.metadata.floorOffset)}</span>
                        </div>

                        <div className="composer-controls" aria-label={`${model.name} scene composer controls`}>
                          <div className="composer-row">
                            <span>X {formatSignedMetric(transform.offsetX)}</span>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'offsetX', -POSITION_STEP)}>
                              Left
                            </button>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'offsetX', POSITION_STEP)}>
                              Right
                            </button>
                          </div>
                          <div className="composer-row">
                            <span>Z {formatSignedMetric(transform.offsetZ)}</span>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'offsetZ', -POSITION_STEP)}>
                              Back
                            </button>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'offsetZ', POSITION_STEP)}>
                              Front
                            </button>
                          </div>
                          <div className="composer-row">
                            <span>Rot {Math.round(transform.rotationY)} deg</span>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'rotationY', -ROTATION_STEP)}>
                              -15
                            </button>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'rotationY', ROTATION_STEP)}>
                              +15
                            </button>
                          </div>
                          <div className="composer-row">
                            <span>Size {formatScale(transform.scale)}</span>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'scale', -SCALE_STEP)}>
                              Small
                            </button>
                            <button type="button" onClick={() => nudgeModelTransform(model.id, 'scale', SCALE_STEP)}>
                              Big
                            </button>
                          </div>
                        </div>

                        <div className="model-card-footer">
                          <span>{model.createdAt}</span>
                          <button type="button" onClick={() => resetModelTransform(model.id)}>
                            Reset
                          </button>
                          <button type="button" onClick={() => removeModel(model.id)}>
                            Remove
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

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

      {arGuideOpen && (
        <div className="ar-guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="ar-guide-title">
          <div className="ar-guide-modal">
            <div className="ar-guide-header">
              <span>AR placement</span>
              <strong id="ar-guide-title">{sceneTitle}</strong>
            </div>
            <div className="ar-guide-steps">
              <span>Scan the floor slowly until the placement marker appears.</span>
              <span>Tap once to place the scene on the surface.</span>
              <span>Use two fingers to resize or rotate, then walk around the model.</span>
            </div>
            <div className="ar-guide-actions">
              <button type="button" className="image-action secondary-action" onClick={() => setArGuideOpen(false)}>
                Cancel
              </button>
              <button type="button" className="image-action primary-action" onClick={handleStartAr}>
                Start AR
              </button>
            </div>
          </div>
        </div>
      )}

      {qrOpen && (
        <div className="ar-guide-backdrop" role="dialog" aria-modal="true" aria-labelledby="qr-guide-title">
          <div className="ar-guide-modal qr-modal">
            <div className="ar-guide-header">
              <span>App link</span>
              <strong id="qr-guide-title">Open Placia</strong>
            </div>

            <div className="qr-frame">
              <img src={qrImageUrl} alt="QR code for opening this website on a phone" />
            </div>
            <textarea className="share-link-field" value={websiteUrl} readOnly aria-label="Phone handoff link" />
            <p className="qr-helper">Scan or copy this link to open the same website in another browser.</p>
            {copyStatus && <p className="qr-status">{copyStatus}</p>}
            <div className="ar-guide-actions">
              <button type="button" className="image-action secondary-action" onClick={() => setQrOpen(false)}>
                Close
              </button>
              <button type="button" className="image-action primary-action" onClick={handleCopyWebsiteUrl}>
                Copy link
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
