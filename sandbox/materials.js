// Shows every material on a sphere + box grid
export default async function ({ THREE, scene, Mat }) {
  const names = Mat.list().filter((n) => !['wallpaper', 'carpet', 'ceiling'].includes(n));
  const cols = 10;
  names.forEach((n, i) => {
    const x = (i % cols) - cols / 2 + 0.5, z = Math.floor(i / cols) - 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.32, 32, 16), Mat.get(n));
    m.position.set(x * 0.9, 0.5, z * 0.9);
    m.castShadow = true;
    scene.add(m);
  });
}
