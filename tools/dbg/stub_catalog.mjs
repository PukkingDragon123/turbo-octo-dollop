import * as THREE from 'three';
export function buildModel() { return { object: new THREE.Group(), halfHeight: 0.4, colliders: [] }; }
export function modelHalfHeight() { return 0.4; }
export function hasModel() { return true; }
