import { Box3, Group, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MODEL_TARGET_SIZE = 0.8;
const SCENE_MODEL_GAP = 0.35;
export const DEFAULT_MODEL_TRANSFORM = {
  offsetX: 0,
  offsetZ: 0,
  rotationY: 0,
  scale: 1,
};

const loader = new GLTFLoader();
const exporter = new GLTFExporter();

const getBoxMetadata = (scene) => {
  scene.updateMatrixWorld(true);

  const box = new Box3().setFromObject(scene);
  const dimensions = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const largestDimension = Math.max(dimensions.x, dimensions.y, dimensions.z);
  const scaleFactor = largestDimension > 0 ? MODEL_TARGET_SIZE / largestDimension : 1;

  return {
    dimensions: {
      x: dimensions.x,
      y: dimensions.y,
      z: dimensions.z,
    },
    normalizedDimensions: {
      x: dimensions.x * scaleFactor,
      y: dimensions.y * scaleFactor,
      z: dimensions.z * scaleFactor,
    },
    center: {
      x: center.x,
      y: center.y,
      z: center.z,
    },
    minY: box.min.y,
    floorOffset: -box.min.y * scaleFactor,
    largestDimension,
    scaleFactor,
  };
};

export const inspectModel = async (assetUrl) => {
  const gltf = await loader.loadAsync(assetUrl);
  return getBoxMetadata(gltf.scene);
};

export const createModelScale = (metadata) => {
  const scale = metadata?.scaleFactor || 1;
  return `${scale} ${scale} ${scale}`;
};

export const formatMetric = (value, suffix = 'u') => {
  if (!Number.isFinite(value)) return `0.00${suffix}`;
  return `${value.toFixed(2)}${suffix}`;
};

export const formatScale = (value) => {
  if (!Number.isFinite(value)) return '1.00x';
  return `${value.toFixed(2)}x`;
};

export const formatSignedMetric = (value, suffix = 'u') => {
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return `0.00${suffix}`;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}${suffix}`;
};

export const normalizeModelTransform = (transform = {}) => ({
  offsetX: Number.isFinite(transform.offsetX) ? transform.offsetX : DEFAULT_MODEL_TRANSFORM.offsetX,
  offsetZ: Number.isFinite(transform.offsetZ) ? transform.offsetZ : DEFAULT_MODEL_TRANSFORM.offsetZ,
  rotationY: Number.isFinite(transform.rotationY) ? transform.rotationY : DEFAULT_MODEL_TRANSFORM.rotationY,
  scale: Number.isFinite(transform.scale) ? transform.scale : DEFAULT_MODEL_TRANSFORM.scale,
});

export const hasCustomModelTransform = (model) => {
  const transform = normalizeModelTransform(model?.transform);

  return (
    Math.abs(transform.offsetX - DEFAULT_MODEL_TRANSFORM.offsetX) > 0.001 ||
    Math.abs(transform.offsetZ - DEFAULT_MODEL_TRANSFORM.offsetZ) > 0.001 ||
    Math.abs(transform.rotationY - DEFAULT_MODEL_TRANSFORM.rotationY) > 0.001 ||
    Math.abs(transform.scale - DEFAULT_MODEL_TRANSFORM.scale) > 0.001
  );
};

export const combineModelsIntoGlb = async (models) => {
  if (!models.length) {
    throw new Error('Select at least one model to build an AR scene.');
  }

  const root = new Group();
  root.name = 'Placia_AR_Scene';

  const preparedModels = await Promise.all(
    models.map(async (model, index) => {
      const gltf = await loader.loadAsync(model.assetUrl);
      const scene = gltf.scene;
      const metadata = model.metadata || getBoxMetadata(scene);
      const transform = normalizeModelTransform(model.transform);
      const scaleFactor = metadata.scaleFactor || 1;
      const rawWidth = metadata.dimensions?.x || MODEL_TARGET_SIZE;
      const finalScale = scaleFactor * transform.scale;

      scene.position.x -= metadata.center?.x || 0;
      scene.position.y -= metadata.minY || 0;
      scene.position.z -= metadata.center?.z || 0;

      const wrapper = new Group();
      wrapper.name = `Placia_Model_${index + 1}`;
      wrapper.scale.setScalar(finalScale);
      wrapper.rotation.y = (transform.rotationY * Math.PI) / 180;
      wrapper.add(scene);

      return {
        wrapper,
        transform,
        width: Math.max(rawWidth * finalScale, 0.25),
      };
    }),
  );

  const totalWidth =
    preparedModels.reduce((sum, model) => sum + model.width, 0) +
    SCENE_MODEL_GAP * Math.max(preparedModels.length - 1, 0);
  let cursor = -totalWidth / 2;

  preparedModels.forEach(({ wrapper, width, transform }) => {
    wrapper.position.x = cursor + width / 2 + transform.offsetX;
    wrapper.position.z = transform.offsetZ;
    root.add(wrapper);
    cursor += width + SCENE_MODEL_GAP;
  });

  const output = await exporter.parseAsync(root, {
    binary: true,
    onlyVisible: true,
  });

  if (!(output instanceof ArrayBuffer)) {
    throw new Error('Unable to export the selected models as a GLB scene.');
  }

  return new Blob([output], { type: 'model/gltf-binary' });
};