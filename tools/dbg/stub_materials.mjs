import * as THREE from 'three';
const cache = new Map();
export function get(n) { if (!cache.has(n)) { const m = new THREE.MeshStandardMaterial(); m.name = n; m.map = new THREE.Texture(); cache.set(n, m); } return cache.get(n); }
export function make(n) { const m = new THREE.MeshStandardMaterial(); m.name = n; m.map = new THREE.Texture(); return m; }
export function has() { return true; }
